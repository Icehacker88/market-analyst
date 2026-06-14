from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd

from src.config import RunConfig
from src.data_loader import (
    download_online_data,
    infer_ticker_from_path,
    load_csv,
    online_source_description,
    safe_ticker_for_path,
)
from src.features import build_features
from src.models import (
    choose_best_model,
    forecast_future_returns,
    optional_model_status,
    refit_model_on_all_data,
    train_and_evaluate_models,
)
from src.plots import create_all_plots
from src.preprocessing import clean_price_data
from src.reporting import write_run_metadata, write_summary
from src.risk_model import train_and_forecast_risk


def run_single(
    input_path: Path,
    output_root: Path,
    train_ratio: float = 0.8,
    forecast_days: int = 5,
    include_arima: bool = True,
) -> Path:
    ticker = infer_ticker_from_path(input_path)
    raw = load_csv(input_path)
    return _run_frame(
        raw=raw,
        ticker=ticker,
        source=str(input_path),
        output_root=output_root,
        train_ratio=train_ratio,
        forecast_days=forecast_days,
        include_arima=include_arima,
    )


def run_many(
    tickers: list[str],
    start: str,
    end: str | None,
    output_root: Path,
    train_ratio: float = 0.8,
    forecast_days: int = 5,
    include_arima: bool = True,
    data_source: str = "yahoo",
    asset_type: str = "market",
) -> list[Path]:
    output_paths = []
    for ticker in tickers:
        raw = download_online_data(
            ticker=ticker,
            start=start,
            end=end,
            data_source=data_source,
            asset_type=asset_type,
        )
        output_paths.append(
            _run_frame(
                raw=raw,
                ticker=ticker.upper(),
                source=online_source_description(data_source, asset_type, start, end),
                output_root=output_root,
                train_ratio=train_ratio,
                forecast_days=forecast_days,
                include_arima=include_arima,
            )
        )
    return output_paths


def _run_frame(
    raw: pd.DataFrame,
    ticker: str,
    source: str,
    output_root: Path,
    train_ratio: float,
    forecast_days: int,
    include_arima: bool,
) -> Path:
    run_stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = output_root / safe_ticker_for_path(ticker) / run_stamp
    output_dir.mkdir(parents=True, exist_ok=True)
    config = RunConfig(
        ticker=ticker.upper(),
        output_dir=output_dir,
        train_ratio=train_ratio,
        forecast_days=forecast_days,
        include_arima=include_arima,
    )

    cleaned, quality = clean_price_data(raw)
    feature_data, feature_columns = build_features(cleaned)
    if len(feature_data) < 120:
        raise ValueError("可建模数据少于 120 行，暂不建议训练预测模型。")

    processed_path = output_dir / "processed_features.csv"
    cleaned_path = output_dir / "cleaned_prices.csv"
    cleaned.to_csv(cleaned_path, index=False)
    feature_data.to_csv(processed_path, index=False)

    trained_models, metrics = train_and_evaluate_models(
        feature_data,
        feature_columns,
        train_ratio=config.train_ratio,
        include_arima=config.include_arima,
    )
    best_model = choose_best_model(trained_models, metrics)
    forecast_model = refit_model_on_all_data(best_model, feature_data, feature_columns)
    forecast = forecast_future_returns(
        model=forecast_model,
        cleaned=cleaned,
        feature_columns=feature_columns,
        latest_price=float(cleaned["Price"].iloc[-1]),
        forecast_days=config.forecast_days,
    )
    random_forest_importance = next(
        (model.feature_importance for model in trained_models if model.feature_importance is not None),
        None,
    )

    all_predictions = pd.concat(
        [model.predictions for model in trained_models],
        ignore_index=True,
    )
    all_predictions.to_csv(output_dir / "prediction_results.csv", index=False)
    best_model.predictions.to_csv(output_dir / "best_model_predictions.csv", index=False)
    metrics.to_csv(output_dir / "model_comparison.csv", index=False)
    forecast.to_csv(output_dir / "forecast_1d_5d.csv", index=False)
    risk_forecast = None
    try:
        risk_comparison, risk_forecast = train_and_forecast_risk(
            cleaned,
            train_ratio=config.train_ratio,
        )
        risk_comparison.to_csv(output_dir / "risk_model_comparison.csv", index=False)
        risk_forecast.to_csv(output_dir / "risk_forecast_5d.csv", index=False)
    except Exception as exc:
        (output_dir / "risk_model_error.txt").write_text(str(exc) + "\n", encoding="utf-8")
    optional_status = optional_model_status()
    optional_status.to_csv(output_dir / "optional_components.csv", index=False)
    if random_forest_importance is not None:
        random_forest_importance.to_csv(output_dir / "feature_importance.csv", index=False)

    figure_paths = create_all_plots(
        cleaned=cleaned,
        feature_data=feature_data,
        best_predictions=best_model.predictions,
        feature_importance=random_forest_importance,
        output_dir=output_dir,
    )
    write_summary(
        ticker=config.ticker,
        quality=quality,
        metrics=metrics,
        forecast=forecast,
        output_dir=output_dir,
        figure_paths=figure_paths,
        optional_status=optional_status,
        risk_forecast=risk_forecast,
    )
    write_run_metadata(
        output_dir=output_dir,
        source=source,
        ticker=config.ticker,
        feature_columns=feature_columns,
        quality=quality,
    )

    print(f"{config.ticker} 完成，结果目录：{output_dir}")
    return output_dir
