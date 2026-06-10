from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from src.features import (
    build_latest_feature_row,
    build_technical_indicators,
    infer_feature_columns,
)


RISK_FEATURE_PREFIXES = (
    "Daily_Return",
    "Log_Return",
    "Weekly_Return",
    "Price_to_MA_",
    "Return_Lag_",
    "Rolling_Mean_",
    "Rolling_Std_",
    "Momentum_",
    "RSI_",
    "BB_Position",
    "Volume_Change",
    "Volume_Ratio_",
)


def train_and_forecast_risk(
    cleaned: pd.DataFrame,
    train_ratio: float = 0.8,
    horizon: int = 5,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    data, feature_columns = build_risk_dataset(cleaned, horizon)
    split_index = int(len(data) * train_ratio)
    if split_index < 50 or len(data) - split_index < 10:
        raise ValueError("风险模型数据量不足，无法可靠划分训练集和测试集。")

    x_train = data.iloc[:split_index][feature_columns]
    y_train = data.iloc[:split_index]["Target_High_Risk"].astype(int)
    x_test = data.iloc[split_index:][feature_columns]
    y_test = data.iloc[split_index:]["Target_High_Risk"].astype(int)

    rows: list[dict[str, float | str]] = []
    candidates = _risk_candidate_factories()
    for name, factory in candidates:
        cv_metrics = _cross_validated_risk_metrics(factory, x_train, y_train, horizon)
        model = factory()
        model.fit(x_train, y_train)
        test_probability = model.predict_proba(x_test)[:, 1]
        rows.append(
            {
                "Model": name,
                **cv_metrics,
                **_risk_metrics(y_test, test_probability, "Test"),
            }
        )

    comparison = pd.DataFrame(rows).sort_values(
        ["CV_AUC", "CV_Balanced_Accuracy", "CV_Brier"],
        ascending=[False, False, True],
    ).reset_index(drop=True)
    best = comparison.iloc[0]
    best_factory = dict(candidates)[str(best["Model"])]
    best_model = best_factory()
    best_model.fit(data[feature_columns], data["Target_High_Risk"].astype(int))
    latest_features = build_latest_feature_row(cleaned, feature_columns)
    probability = float(best_model.predict_proba(latest_features)[0, 1])
    latest_technical = build_technical_indicators(cleaned).replace([np.inf, -np.inf], np.nan)
    threshold = float(latest_technical["Rolling_Std_20"].dropna().iloc[-1])
    forecast = pd.DataFrame(
        [
            {
                "Risk_Horizon_Days": horizon,
                "Risk_5D_Model": best["Model"],
                "Risk_5D_Probability": probability,
                "Risk_5D_Status": risk_status(probability),
                "Risk_5D_Threshold_Daily_Vol": threshold,
                "Risk_5D_CV_AUC": best["CV_AUC"],
                "Risk_5D_CV_Balanced_Accuracy": best["CV_Balanced_Accuracy"],
                "Risk_5D_CV_Brier": best["CV_Brier"],
                "Risk_5D_Test_AUC": best["Test_AUC"],
                "Risk_5D_Test_Balanced_Accuracy": best["Test_Balanced_Accuracy"],
                "Risk_5D_Test_Brier": best["Test_Brier"],
                "Risk_5D_Event_Rate": float(data["Target_High_Risk"].mean()),
            }
        ]
    )
    return comparison, forecast


def build_risk_dataset(
    cleaned: pd.DataFrame,
    horizon: int = 5,
) -> tuple[pd.DataFrame, list[str]]:
    if horizon < 2:
        raise ValueError("风险预测 horizon 必须至少为 2。")
    data = build_technical_indicators(cleaned).replace([np.inf, -np.inf], np.nan)
    feature_columns = [
        column
        for column in infer_feature_columns(data)
        if column.startswith(RISK_FEATURE_PREFIXES)
    ]
    future_squared_returns = pd.concat(
        [data["Log_Return"].shift(-step).pow(2) for step in range(1, horizon + 1)],
        axis=1,
    )
    data["Target_Realized_Vol"] = np.sqrt(future_squared_returns.mean(axis=1))
    data["Target_High_Risk"] = (
        data["Target_Realized_Vol"] > data["Rolling_Std_20"]
    ).astype(int)
    model_data = data.dropna(
        subset=feature_columns + ["Target_Realized_Vol", "Rolling_Std_20"]
    )
    return model_data.reset_index(drop=True), feature_columns


def risk_status(probability: float) -> str:
    if probability >= 0.65:
        return "High"
    if probability >= 0.5:
        return "Elevated"
    return "Normal"


def _risk_candidate_factories() -> list[tuple[str, Callable[[], object]]]:
    return [
        (
            "Logistic Risk",
            lambda: Pipeline(
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
            ),
        ),
        (
            "Extra Trees Risk",
            lambda: ExtraTreesClassifier(
                n_estimators=400,
                max_depth=5,
                min_samples_leaf=5,
                max_features="sqrt",
                class_weight="balanced",
                random_state=42,
                n_jobs=-1,
            ),
        ),
    ]


def _cross_validated_risk_metrics(
    factory: Callable[[], object],
    x_train: pd.DataFrame,
    y_train: pd.Series,
    horizon: int,
) -> dict[str, float]:
    aucs = []
    balanced = []
    briers = []
    for fold_train, fold_validation in TimeSeriesSplit(
        n_splits=3,
        gap=horizon,
    ).split(x_train):
        model = factory()
        model.fit(x_train.iloc[fold_train], y_train.iloc[fold_train])
        probability = model.predict_proba(x_train.iloc[fold_validation])[:, 1]
        metrics = _risk_metrics(y_train.iloc[fold_validation], probability, "")
        aucs.append(metrics["AUC"])
        balanced.append(metrics["Balanced_Accuracy"])
        briers.append(metrics["Brier"])
    return {
        "CV_AUC": float(np.mean(aucs)),
        "CV_Balanced_Accuracy": float(np.mean(balanced)),
        "CV_Brier": float(np.mean(briers)),
    }


def _risk_metrics(
    actual: pd.Series,
    probability: np.ndarray,
    prefix: str,
) -> dict[str, float]:
    predicted = np.asarray(probability) >= 0.5
    key_prefix = f"{prefix}_" if prefix else ""
    return {
        f"{key_prefix}AUC": float(roc_auc_score(actual, probability)),
        f"{key_prefix}Balanced_Accuracy": float(
            balanced_accuracy_score(actual, predicted)
        ),
        f"{key_prefix}Brier": float(brier_score_loss(actual, probability)),
    }
