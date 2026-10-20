from __future__ import annotations

from dataclasses import dataclass
import warnings
from typing import Callable, Mapping, Protocol

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, RandomForestRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import balanced_accuracy_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from statsmodels.tsa.arima.model import ARIMA

from src.evaluation import build_prediction_frame, evaluate_regression
from src.features import build_latest_feature_row


class ReturnModel(Protocol):
    def fit(self, x_train: pd.DataFrame, y_train: pd.Series) -> "ReturnModel":
        ...

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        ...


@dataclass
class TrainedModel:
    name: str
    model: ReturnModel
    predictions: pd.DataFrame
    metrics: dict[str, float]
    feature_importance: pd.DataFrame | None = None
    skipped_reason: str | None = None
    validation_predictions: pd.DataFrame | None = None


class BaselineReturnModel:
    def __init__(self) -> None:
        self.fallback_return = 0.0

    def fit(self, x_train: pd.DataFrame, y_train: pd.Series) -> "BaselineReturnModel":
        self.fallback_return = float(y_train.dropna().median()) if y_train.notna().any() else 0.0
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        if "Log_Return" in x.columns:
            return x["Log_Return"].fillna(self.fallback_return).to_numpy()
        return np.full(len(x), self.fallback_return)


class ArimaReturnModel:
    def __init__(self, order: tuple[int, int, int] = (1, 0, 1)) -> None:
        self.order = order
        self.series: pd.Series | None = None
        self.fallback_return = 0.0
        self.forecast_status = "not_forecast"
        self.fallback_reason = ""

    def fit(self, x_train: pd.DataFrame, y_train: pd.Series) -> "ArimaReturnModel":
        self.series = pd.Series(y_train, dtype=float).dropna().reset_index(drop=True)
        self.fallback_return = float(self.series.median()) if not self.series.empty else 0.0
        self.forecast_status, self.fallback_reason = "not_forecast", ""
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        # A batch of feature rows is not a sequence of future ARIMA horizons.
        if len(x) != 1:
            raise ValueError("ARIMA predict requires one origin; use rolling evaluation or forecast_steps.")
        return self.forecast_steps(1)

    def forecast_steps(self, steps: int) -> np.ndarray:
        if steps < 1:
            raise ValueError("steps must be positive")
        self.forecast_status, self.fallback_reason = "ok", ""
        if self.series is None or len(self.series) < 30:
            self.fallback_reason = "insufficient_history"
        else:
            try:
                with warnings.catch_warnings(record=True):
                    warnings.simplefilter("always")
                    fitted = ARIMA(self.series, order=self.order).fit()
                if not getattr(fitted, "mle_retvals", {}).get("converged", True):
                    self.fallback_reason = "non_convergence"
                else:
                    forecast = np.asarray(fitted.forecast(steps=steps), dtype=float)
                    if forecast.shape == (steps,) and np.isfinite(forecast).all():
                        return forecast
                    self.fallback_reason = "invalid_forecast"
            except Exception as exc:
                # Record the type only; provider/input details do not belong in reports.
                self.fallback_reason = f"fit_or_forecast_error:{type(exc).__name__}"
        self.forecast_status = "fallback"
        return np.full(steps, self.fallback_return)


def _evaluation_predictions(
    factory: Callable[[], ReturnModel],
    x: pd.DataFrame,
    y: pd.Series,
    train_positions: np.ndarray,
    validation_positions: np.ndarray,
    observed_returns: pd.Series | None = None,
    origin_dates: pd.Series | None = None,
) -> tuple[ReturnModel, np.ndarray, list[str], list[str]]:
    model = factory()
    if isinstance(model, ArimaReturnModel):
        values, statuses, reasons = [], [], []
        for origin in validation_positions:
            # y[t] is return[t+1]. At origin t, y[:t] has been observed,
            # including the CV gap and earlier validation outcomes, never y[t].
            # Refit at every origin, matching the daily one-step forecast protocol.
            visible = y.iloc[:origin]
            if observed_returns is not None and origin_dates is not None:
                visible = observed_returns.loc[observed_returns.index <= pd.Timestamp(origin_dates.iloc[origin])]
            model.fit(x.iloc[:origin], visible)
            values.append(float(model.predict(x.iloc[[origin]])[0]))
            statuses.append(model.forecast_status)
            reasons.append(model.fallback_reason)
        return model, np.asarray(values), statuses, reasons
    # Feature regressors retain their existing fold-fitted protocol: each row's
    # contemporaneous features are supplied, with the training gap unchanged.
    model.fit(x.iloc[train_positions], y.iloc[train_positions])
    values = np.asarray(model.predict(x.iloc[validation_positions]), dtype=float)
    return model, values, ["ok"] * len(values), [""] * len(values)


class DirectionClassifierReturnModel:
    def __init__(self, classifier: object) -> None:
        self.classifier = classifier
        self.return_scale = 0.001
        self.fallback_probability = 0.5

    def fit(
        self,
        x_train: pd.DataFrame,
        y_train: pd.Series,
    ) -> "DirectionClassifierReturnModel":
        returns = pd.Series(y_train).astype(float).dropna()
        if returns.empty:
            return self
        labels = (returns >= 0).astype(int)
        self.return_scale = max(float(returns.abs().median()), 1e-6)
        self.fallback_probability = float(labels.mean())
        if labels.nunique() >= 2:
            self.classifier.fit(x_train.loc[returns.index], labels)
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        classes = getattr(self.classifier, "classes_", None)
        if classes is None and hasattr(self.classifier, "named_steps"):
            classes = getattr(self.classifier.named_steps.get("model"), "classes_", None)
        if classes is None:
            probabilities = np.full(len(x), self.fallback_probability)
        else:
            probabilities = np.asarray(self.classifier.predict_proba(x), dtype=float)[:, 1]
        direction = np.where(probabilities >= 0.5, 1.0, -1.0)
        confidence = np.maximum(np.abs(probabilities - 0.5) * 2, 0.1)
        return direction * confidence * self.return_scale


def split_time_series(
    data: pd.DataFrame,
    feature_columns: list[str],
    train_ratio: float,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    if not 0.5 <= train_ratio < 1:
        raise ValueError("train_ratio 必须在 0.5 到 1 之间。")
    split_index = int(len(data) * train_ratio)
    if split_index < 50 or len(data) - split_index < 10:
        raise ValueError("数据量不足，无法可靠划分训练集和测试集。")
    x_train = data.iloc[:split_index][feature_columns]
    x_test = data.iloc[split_index:][feature_columns]
    y_train = data.iloc[:split_index]["Target_Log_Return"]
    y_test = data.iloc[split_index:]["Target_Log_Return"]
    return x_train, x_test, y_train, y_test


def train_and_evaluate_models(
    data: pd.DataFrame,
    feature_columns: list[str],
    train_ratio: float = 0.8,
    include_arima: bool = True,
    price_history: pd.DataFrame | None = None,
) -> tuple[list[TrainedModel], pd.DataFrame]:
    x_train, x_test, y_train, _ = split_time_series(data, feature_columns, train_ratio)
    test_data = data.loc[x_test.index].copy()

    candidates = _candidate_factories(include_arima)
    observed_returns = _observed_return_series(price_history, data["Date"].iloc[0])

    trained: list[TrainedModel] = []
    metrics_rows: list[dict[str, float | str]] = []
    for name, factory in candidates:
        cv_rows: list[dict[str, object]] = []
        cv_metrics = _cross_validated_direction_metrics(
            factory, x_train, y_train, cv_rows, observed_returns, data["Date"].iloc[:len(x_train)],
        )
        model, values, statuses, reasons = _evaluation_predictions(
            factory, data[feature_columns], data["Target_Log_Return"],
            np.arange(len(x_train)), np.arange(len(x_train), len(data)),
            observed_returns, data["Date"],
        )
        predicted_return = pd.Series(values, index=x_test.index, dtype=float)
        predictions = build_prediction_frame(
            dates=test_data["Date"],
            current_price=test_data["Price"],
            actual_price=test_data["Target_Price"],
            actual_return=test_data["Target_Log_Return"],
            predicted_return=predicted_return,
            model_name=name,
        )
        metrics = evaluate_regression(
            actual_price=predictions["Actual_Price"],
            predicted_price=predictions["Predicted_Price"],
            actual_return=predictions["Actual_Return"],
            predicted_return=predictions["Predicted_Return"],
        )
        predictions["Forecast_Status"] = statuses
        predictions["Fallback_Reason"] = reasons
        metrics["Holdout_Samples"] = len(values)
        metrics["Holdout_Fallback_Count"] = statuses.count("fallback")
        metrics_rows.append({"Model": name, **cv_metrics, **metrics})
        validation = pd.DataFrame(cv_rows)
        validation["Model"] = name
        validation["Date"] = data.iloc[validation["Origin_Position"].to_numpy()]["Date"].to_numpy()
        trained.append(
            TrainedModel(
                name=name,
                model=model,
                predictions=predictions,
                metrics={**cv_metrics, **metrics},
                feature_importance=_feature_importance(name, model, feature_columns),
                validation_predictions=validation,
            )
        )

    metrics_frame = _rank_metrics(pd.DataFrame(metrics_rows))
    return trained, metrics_frame.reset_index(drop=True)


def _candidate_factories(
    include_arima: bool,
) -> list[tuple[str, Callable[[], ReturnModel]]]:
    candidates: list[tuple[str, Callable[[], ReturnModel]]] = [
        ("Baseline", BaselineReturnModel),
        (
            "Linear Regression",
            lambda: Pipeline(
                [("scaler", StandardScaler()), ("model", LinearRegression())]
            ),
        ),
        (
            "Random Forest",
            lambda: RandomForestRegressor(
                n_estimators=300,
                max_depth=8,
                min_samples_leaf=5,
                random_state=42,
                n_jobs=-1,
            ),
        ),
        (
            "Logistic Direction",
            lambda: DirectionClassifierReturnModel(
                Pipeline(
                    [
                        ("scaler", StandardScaler()),
                        (
                            "model",
                            LogisticRegression(
                                C=0.05,
                                class_weight="balanced",
                                max_iter=3000,
                                random_state=42,
                            ),
                        ),
                    ]
                )
            ),
        ),
        (
            "Extra Trees Direction",
            lambda: DirectionClassifierReturnModel(
                ExtraTreesClassifier(
                    n_estimators=400,
                    max_depth=5,
                    min_samples_leaf=5,
                    max_features="sqrt",
                    class_weight="balanced",
                    random_state=42,
                    n_jobs=-1,
                )
            ),
        ),
    ]
    if include_arima:
        candidates.append(("ARIMA", ArimaReturnModel))
    return candidates


def _cross_validated_direction_metrics(
    factory: Callable[[], ReturnModel],
    x_train: pd.DataFrame,
    y_train: pd.Series,
    diagnostics: list[dict[str, object]] | None = None,
    observed_returns: pd.Series | None = None,
    origin_dates: pd.Series | None = None,
) -> dict[str, float]:
    splitter = TimeSeriesSplit(n_splits=3, gap=1)
    accuracies, balanced_accuracies, edges, errors, percentage_errors = [], [], [], [], []
    fallback_count, sample_count = 0, 0
    for fold, (fold_train, fold_validation) in enumerate(splitter.split(x_train), start=1):
        model, predicted, statuses, reasons = _evaluation_predictions(
            factory, x_train, y_train, fold_train, fold_validation, observed_returns, origin_dates,
        )
        actual = y_train.iloc[fold_validation].to_numpy()
        actual_direction, predicted_direction = actual >= 0, predicted >= 0
        accuracy = float((actual_direction == predicted_direction).mean() * 100)
        balanced = float(balanced_accuracy_score(actual_direction, predicted_direction) * 100)
        up_rate = float(actual_direction.mean() * 100)
        majority_baseline = max(up_rate, 100 - up_rate)
        accuracies.append(accuracy)
        balanced_accuracies.append(balanced)
        edges.append(accuracy - majority_baseline)
        errors.extend((actual - predicted) ** 2)
        percentage_errors.extend(np.abs(1 - np.exp(predicted - actual)) * 100)
        sample_count += len(predicted)
        fallback_count += statuses.count("fallback")
        if diagnostics is not None:
            for origin, prediction, truth, status, reason in zip(fold_validation, predicted, actual, statuses, reasons):
                diagnostics.append({"Fold": fold, "Origin_Position": int(origin),
                    "Training_Target_Last_Position": int(origin - 1 if isinstance(model, ArimaReturnModel) else fold_train[-1]),
                    "Predicted_Return": prediction, "Actual_Return": truth,
                    "Forecast_Status": status, "Fallback_Reason": reason,
                    "Evaluation_Protocol": "daily-refit-one-step-v2" if isinstance(model, ArimaReturnModel) else "fold-fit-features-v1"})
    return {
        "CV_Directional_Accuracy": float(np.mean(accuracies)),
        "CV_Balanced_Accuracy": float(np.mean(balanced_accuracies)),
        "CV_Directional_Edge": float(np.mean(edges)),
        "CV_Return_RMSE": float(np.sqrt(np.mean(errors))),
        "CV_MAPE": float(np.mean(percentage_errors)),
        "CV_Samples": sample_count,
        "CV_Fallback_Count": fallback_count,
    }


def classify_signal_quality(metrics: Mapping[str, object]) -> str:
    cv_edge = _metric_float(metrics, "CV_Directional_Edge")
    cv_balanced = _metric_float(metrics, "CV_Balanced_Accuracy")
    if cv_edge >= 2 and cv_balanced >= 53:
        return "High"
    if cv_edge > 0 and cv_balanced > 50:
        return "Medium"
    return "Low"


def actionable_signal(direction: object, quality: str) -> str:
    if quality == "Low":
        return "Observe"
    return str(direction)


def _metric_float(metrics: Mapping[str, object], key: str) -> float:
    value = metrics.get(key)
    if value is None or pd.isna(value):
        return float("-inf")
    return float(value)


def _rank_metrics(metrics: pd.DataFrame) -> pd.DataFrame:
    scored = metrics.copy()
    scored["Prediction_Score"] = scored.apply(_model_prediction_score, axis=1)
    return scored.sort_values(
        [
            "Prediction_Score",
            "CV_Directional_Edge",
            "CV_Balanced_Accuracy",
            "Model",
        ],
        ascending=[False, False, False, True],
        kind="stable",
    )


def _model_prediction_score(row: pd.Series) -> float:
    cv_edge = _metric_float(row, "CV_Directional_Edge")
    cv_balanced = _metric_float(row, "CV_Balanced_Accuracy")
    cv_accuracy = _metric_float(row, "CV_Directional_Accuracy")
    return_rmse = _metric_float(row, "CV_Return_RMSE")
    mape = _metric_float(row, "CV_MAPE")
    if not np.isfinite(return_rmse):
        return_rmse = 1.0
    if not np.isfinite(mape):
        mape = 100.0
    return (
        cv_balanced * 0.45
        + cv_accuracy * 0.25
        + cv_edge * 2.4
        - return_rmse * 20
        - mape * 0.02
    )


def choose_best_model(models: list[TrainedModel], metrics: pd.DataFrame) -> TrainedModel:
    best_name = str(metrics.iloc[0]["Model"])
    for model in models:
        if model.name == best_name:
            return model
    return models[0]


def _observed_return_series(price_history: pd.DataFrame | None, first_origin: object) -> pd.Series | None:
    if price_history is None:
        return None
    prices = price_history.set_index(pd.to_datetime(price_history["Date"]))["Price"].astype(float)
    if not prices.index.is_monotonic_increasing or not prices.index.is_unique:
        raise ValueError("Price history must have unique ascending dates")
    returns = np.log(prices / prices.shift(1))
    # Match the original target-series start, but keep bars omitted by feature
    # filtering so ARIMA never compresses a missing feature row into one step.
    return returns.loc[returns.index > pd.Timestamp(first_origin)].dropna()


def refit_model_on_all_data(
    trained_model: TrainedModel,
    data: pd.DataFrame,
    feature_columns: list[str],
    price_history: pd.DataFrame | None = None,
) -> ReturnModel:
    returns = _observed_return_series(price_history, data["Date"].iloc[0])
    target = returns if isinstance(trained_model.model, ArimaReturnModel) and returns is not None else data["Target_Log_Return"]
    trained_model.model.fit(data[feature_columns], target)
    return trained_model.model


def forecast_future_returns(
    model: ReturnModel,
    cleaned: pd.DataFrame,
    feature_columns: list[str],
    latest_price: float,
    forecast_days: int = 5,
) -> pd.DataFrame:
    if forecast_days < 1:
        raise ValueError("forecast_days 必须大于 0。")
    if isinstance(model, ArimaReturnModel):
        predicted_returns = model.forecast_steps(forecast_days)
        frame = _forecast_frame_from_returns(predicted_returns, latest_price)
        frame["Forecast_Status"] = model.forecast_status
        frame["Fallback_Reason"] = model.fallback_reason
        return frame

    history = cleaned.copy()
    rows = []
    current_price = float(latest_price)
    current_date = pd.to_datetime(history["Date"].iloc[-1])
    for day in range(1, forecast_days + 1):
        features = build_latest_feature_row(history, feature_columns)
        predicted_return = float(model.predict(features)[0])
        predicted_price = current_price * float(np.exp(predicted_return))
        rows.append(
            {
                "Forecast_Day": day,
                "Predicted_Return": predicted_return,
                "Predicted_Price": predicted_price,
                "Predicted_Direction": "Up" if predicted_return >= 0 else "Down",
            }
        )
        current_date = _next_business_day(current_date)
        history = pd.concat(
            [history, _synthetic_future_row(history, current_date, predicted_price)],
            ignore_index=True,
        )
        current_price = predicted_price
    return pd.DataFrame(rows)


def _forecast_frame_from_returns(predicted_returns: np.ndarray, latest_price: float) -> pd.DataFrame:
    rows = []
    current_price = float(latest_price)
    for index, predicted_return in enumerate(predicted_returns, start=1):
        predicted_price = current_price * float(np.exp(float(predicted_return)))
        rows.append(
            {
                "Forecast_Day": index,
                "Predicted_Return": float(predicted_return),
                "Predicted_Price": predicted_price,
                "Predicted_Direction": "Up" if predicted_return >= 0 else "Down",
            }
        )
        current_price = predicted_price
    return pd.DataFrame(rows)


def _next_business_day(date: pd.Timestamp) -> pd.Timestamp:
    next_day = date + pd.Timedelta(days=1)
    while next_day.weekday() >= 5:
        next_day += pd.Timedelta(days=1)
    return next_day


def _synthetic_future_row(history: pd.DataFrame, date: pd.Timestamp, price: float) -> pd.DataFrame:
    latest = history.iloc[-1].copy()
    latest["Date"] = date
    latest["Price"] = price
    for column in ["Open", "High", "Low", "Close", "Adj Close", "NAV"]:
        if column in latest.index and pd.notna(latest[column]):
            latest[column] = price
    if "Volume" in latest.index and pd.notna(latest["Volume"]):
        latest["Volume"] = history["Volume"].dropna().tail(20).median()
    return pd.DataFrame([latest])


def optional_model_status() -> pd.DataFrame:
    import importlib.util
    
    def _is_installed(package_name: str) -> bool:
        try:
            spec = importlib.util.find_spec(package_name)
            return spec is not None
        except Exception:
            return False
    
    xgb_status = (
        "Available but not enabled in default lightweight run"
        if _is_installed("xgboost")
        else "Skipped: xgboost is not installed"
    )
    lstm_status = (
        "Available but not enabled in default lightweight run"
        if _is_installed("tensorflow")
        else "Skipped: tensorflow/keras is not installed"
    )
    shap_status = (
        "Available for future explainability extension"
        if _is_installed("shap")
        else "Skipped: shap is not installed; using feature importance"
    )

    return pd.DataFrame(
        [
            {"Component": "XGBoost", "Status": xgb_status},
            {"Component": "LSTM", "Status": lstm_status},
            {"Component": "SHAP", "Status": shap_status},
        ]
    )


def _feature_importance(
    name: str,
    model: ReturnModel,
    feature_columns: list[str],
) -> pd.DataFrame | None:
    source = model.classifier if isinstance(model, DirectionClassifierReturnModel) else model
    importances = getattr(source, "feature_importances_", None)
    if importances is None:
        return None
    return (
        pd.DataFrame({"Feature": feature_columns, "Importance": importances})
        .sort_values("Importance", ascending=False)
        .reset_index(drop=True)
    )
