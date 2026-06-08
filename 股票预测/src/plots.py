from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


sns.set_theme(style="whitegrid")


def create_all_plots(
    cleaned: pd.DataFrame,
    feature_data: pd.DataFrame,
    best_predictions: pd.DataFrame,
    feature_importance: pd.DataFrame | None,
    output_dir: Path,
) -> dict[str, Path]:
    figures_dir = output_dir / "figures"
    figures_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "price_trend": _price_trend(cleaned, figures_dir / "price_trend.png"),
        "return_distribution": _return_distribution(
            feature_data, figures_dir / "return_distribution.png"
        ),
        "volatility": _volatility(feature_data, figures_dir / "volatility.png"),
        "actual_vs_predicted": _actual_vs_predicted(
            best_predictions, figures_dir / "actual_vs_predicted.png"
        ),
    }
    if "Volume" in cleaned.columns and cleaned["Volume"].fillna(0).gt(0).any():
        paths["volume"] = _volume(cleaned, figures_dir / "volume.png")
    if feature_importance is not None and not feature_importance.empty:
        paths["feature_importance"] = _feature_importance(
            feature_importance, figures_dir / "feature_importance.png"
        )
    return paths


def _price_trend(data: pd.DataFrame, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(data["Date"], data["Price"], color="#1f77b4", linewidth=1.6)
    ax.set_title("Price Trend")
    ax.set_xlabel("Date")
    ax.set_ylabel("Price")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def _return_distribution(data: pd.DataFrame, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(9, 5))
    sns.histplot(data["Log_Return"].dropna(), bins=60, kde=True, ax=ax, color="#4c78a8")
    ax.axvline(0, color="#333333", linewidth=1)
    ax.set_title("Log Return Distribution")
    ax.set_xlabel("Log Return")
    ax.set_ylabel("Frequency")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def _volatility(data: pd.DataFrame, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(11, 5))
    volatility = data["Log_Return"].rolling(20).std() * np.sqrt(252)
    ax.plot(data["Date"], volatility, color="#f58518", linewidth=1.4)
    ax.set_title("Rolling Annualized Volatility")
    ax.set_xlabel("Date")
    ax.set_ylabel("Volatility")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def _volume(data: pd.DataFrame, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(data["Date"], data["Volume"], color="#54a24b", linewidth=1.1)
    ax.set_title("Volume Trend")
    ax.set_xlabel("Date")
    ax.set_ylabel("Volume")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def _actual_vs_predicted(data: pd.DataFrame, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(11, 5))
    dates = pd.to_datetime(data["Date"])
    ax.plot(dates, data["Actual_Price"], label="Actual", color="#1f77b4", linewidth=1.5)
    ax.plot(
        dates,
        data["Predicted_Price"],
        label="Predicted",
        color="#e45756",
        linewidth=1.2,
        alpha=0.85,
    )
    ax.set_title("Actual vs Predicted Price")
    ax.set_xlabel("Date")
    ax.set_ylabel("Price")
    ax.legend()
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def _feature_importance(data: pd.DataFrame, path: Path) -> Path:
    top = data.head(15).sort_values("Importance")
    fig, ax = plt.subplots(figsize=(9, 6))
    ax.barh(top["Feature"], top["Importance"], color="#4c78a8")
    ax.set_title("Random Forest Feature Importance")
    ax.set_xlabel("Importance")
    ax.set_ylabel("Feature")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path
