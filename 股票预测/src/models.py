from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
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

    def fit(self, x_train: pd.DataFrame, y_train: pd.Series) -> "ArimaReturnModel":
        self.series = pd.Series(y_train).astype(float).dropna()
        self.fallback_return = float(self.series.median()) if not self.series.empty else 0.0
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        if self.series is None or len(self.series) < 30:
            return np.full(len(x), self.fallback_return)
        return self.forecast_steps(len(x))

    def forecast_steps(self, steps: int) -> np.ndarray:
        if self.series is None or len(self.series) < 30:
            return np.full(steps, self.fallback_return)
        try:
            fitted = ARIMA(self.series, order=self.order).fit()
            forecast = fitted.forecast(steps=steps)
            return np.asarray(forecast, dtype=float)
        except Exception:
            return np.full(steps, self.fallback_return)


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
) -> tuple[list[TrainedModel], pd.DataFrame]:
    x_train, x_test, y_train, _ = split_time_series(data, feature_columns, train_ratio)
    test_data = data.loc[x_test.index].copy()

    candidates: list[tuple[str, ReturnModel]] = [
        ("Baseline", BaselineReturnModel()),
        (
            "Linear Regression",
            Pipeline(
                [
                    ("scaler", StandardScaler()),
                    ("model", LinearRegression()),
                ]
            ),
        ),
        (
            "Random Forest",
            RandomForestRegressor(
                n_estimators=300,
                max_depth=8,
                min_samples_leaf=5,
                random_state=42,
                n_jobs=-1,
            ),
        ),
    ]
    if include_arima:
        candidates.append(("ARIMA", ArimaReturnModel()))

    trained: list[TrainedModel] = []
    metrics_rows: list[dict[str, float | str]] = []
    for name, model in candidates:
        model.fit(x_train, y_train)
        predicted_return = pd.Series(model.predict(x_test), index=x_test.index, dtype=float)
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
        metrics_rows.append({"Model": name, **metrics})
        trained.append(
            TrainedModel(
                name=name,
                model=model,
                predictions=predictions,
                metrics=metrics,
                feature_importance=_feature_importance(name, model, feature_columns),
            )
        )

    metrics_frame = pd.DataFrame(metrics_rows).sort_values(
        ["MAPE", "Return_RMSE", "Directional_Accuracy"],
        ascending=[True, True, False],
    )
    return trained, metrics_frame.reset_index(drop=True)


def choose_best_model(models: list[TrainedModel], metrics: pd.DataFrame) -> TrainedModel:
    best_name = str(metrics.iloc[0]["Model"])
    for model in models:
        if model.name == best_name:
            return model
    return models[0]


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
        return _forecast_frame_from_returns(predicted_returns, latest_price)

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
    if name != "Random Forest":
        return None
    importances = getattr(model, "feature_importances_", None)
    if importances is None:
        return None
    return (
        pd.DataFrame({"Feature": feature_columns, "Importance": importances})
        .sort_values("Importance", ascending=False)
        .reset_index(drop=True)
    )
