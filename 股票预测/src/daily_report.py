from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from src.data_loader import download_yahoo_chart
from src.emailer import send_report_email
from src.email_report import write_html_daily_report
from src.gpt_analysis import generate_market_commentary
from src.market_analyst import MARKET_ASSETS, MarketSnapshot, analyze_market_frame, save_market_snapshot
from src.models import actionable_signal, classify_signal_quality
from src.news import NEWS_KEYWORDS, fetch_recent_news, save_news
from src.pipeline import _run_frame
from src.prediction_ledger import update_prediction_ledger


def run_daily_report(
    output_root: Path,
    market_start: str = "2024-01-01",
    end: str | None = None,
    train_ratio: float = 0.8,
    forecast_days: int = 5,
    include_arima: bool = True,
    news_hours: int = 24,
    email_to: list[str] | None = None,
    ledger_path: Path | None = None,
) -> Path:
    beijing_now = datetime.now(ZoneInfo("Asia/Shanghai"))
    report_dir = output_root / "daily_reports" / beijing_now.strftime("%Y%m%d_%H%M%S")
    model_root = report_dir / "model_runs"
    report_dir.mkdir(parents=True, exist_ok=True)

    snapshots: list[MarketSnapshot] = []
    market_frames: dict[str, pd.DataFrame] = {}
    model_rows = []
    for ticker in MARKET_ASSETS:
        raw = download_yahoo_chart(ticker=ticker, start=market_start, end=end)
        market_frames[ticker] = raw
        snapshot, technical = analyze_market_frame(ticker, raw)
        snapshots.append(snapshot)
        technical.to_csv(report_dir / f"technical_{_safe_name(ticker)}.csv", index=False)
        try:
            model_dir = _run_frame(
                raw=raw,
                ticker=ticker,
                source=f"Yahoo Finance chart API ({market_start} to {end or 'today'})",
                output_root=model_root,
                train_ratio=train_ratio,
                forecast_days=forecast_days,
                include_arima=include_arima,
            )
            model_rows.append(_read_model_summary(ticker, model_dir))
        except Exception as exc:
            model_rows.append(
                {
                    "Ticker": ticker,
                    "Model_Dir": "",
                    "Best_Model": "Failed",
                    "Forecast_1D_Return": None,
                    "Forecast_1D_Price": None,
                    "Forecast_1D_Direction": None,
                    "Forecast_1D_Signal": None,
                    "Signal_Quality": None,
                    "Forecast_5D_Price": None,
                    "Directional_Accuracy": None,
                    "Balanced_Accuracy": None,
                    "Majority_Baseline_Accuracy": None,
                    "Directional_Edge": None,
                    "CV_Directional_Accuracy": None,
                    "CV_Balanced_Accuracy": None,
                    "CV_Directional_Edge": None,
                    "Risk_5D_Model": None,
                    "Risk_5D_Probability": None,
                    "Risk_5D_Status": None,
                    "Risk_5D_Threshold_Daily_Vol": None,
                    "Risk_5D_CV_AUC": None,
                    "Risk_5D_Test_AUC": None,
                    "MAPE": None,
                    "Error": str(exc),
                }
            )

    market_csv, market_md = save_market_snapshot(snapshots, report_dir)
    news_items = fetch_recent_news(NEWS_KEYWORDS, hours=news_hours)
    news_csv, news_md = save_news(news_items, report_dir)

    prediction_frame = pd.DataFrame(model_rows)
    prediction_path = report_dir / "daily_model_predictions.csv"
    prediction_frame.to_csv(prediction_path, index=False)
    ledger_path = ledger_path or Path("data/history/prediction_ledger.csv")
    ledger, ledger_metrics = update_prediction_ledger(
        ledger_path=ledger_path,
        prediction_frame=prediction_frame,
        market_frames=market_frames,
        generated_at=beijing_now,
    )
    ledger_snapshot_path = report_dir / "prediction_ledger_snapshot.csv"
    ledger_metrics_path = report_dir / "prediction_ledger_metrics.csv"
    ledger.to_csv(ledger_snapshot_path, index=False)
    ledger_metrics.to_csv(ledger_metrics_path, index=False)
    prediction_summary = _prediction_summary_text(prediction_frame)

    commentary, commentary_source = generate_market_commentary(
        snapshots=snapshots,
        prediction_summary=prediction_summary,
        news_items=news_items,
    )
    summary_path = _write_investment_daily(
        report_dir=report_dir,
        generated_at=beijing_now,
        snapshots=snapshots,
        prediction_frame=prediction_frame,
        news_count=len(news_items),
        commentary=commentary,
        commentary_source=commentary_source,
        artifact_paths={
            "market_csv": market_csv,
            "market_md": market_md,
            "news_csv": news_csv,
            "news_md": news_md,
            "prediction_csv": prediction_path,
            "ledger_snapshot": ledger_snapshot_path,
            "ledger_metrics": ledger_metrics_path,
        },
        ledger_metrics=ledger_metrics,
    )
    html_path, inline_images = write_html_daily_report(
        report_dir=report_dir,
        generated_at_text=beijing_now.strftime("%Y-%m-%d %H:%M:%S"),
        snapshots=snapshots,
        prediction_frame=prediction_frame,
        news_items=news_items,
        commentary=commentary,
        commentary_source=commentary_source,
        ledger_metrics=ledger_metrics,
    )
    _, message = send_report_email(
        report_path=summary_path,
        subject=f"投资日报 {beijing_now.strftime('%Y-%m-%d')}",
        recipients=email_to,
        html_path=html_path,
        inline_images=inline_images,
    )
    (report_dir / "email_status.txt").write_text(message + "\n", encoding="utf-8")
    print(f"投资日报完成：{summary_path}")
    print(message)
    return report_dir


def _read_model_summary(ticker: str, model_dir: Path) -> dict[str, object]:
    metrics = pd.read_csv(model_dir / "model_comparison.csv")
    forecast = pd.read_csv(model_dir / "forecast_1d_5d.csv")
    best = metrics.iloc[0]
    first = forecast.iloc[0]
    last = forecast.iloc[-1]
    quality = classify_signal_quality(best)
    result = {
        "Ticker": ticker,
        "Model_Dir": str(model_dir),
        "Best_Model": best["Model"],
        "Forecast_1D_Return": first["Predicted_Return"],
        "Forecast_1D_Price": first["Predicted_Price"],
        "Forecast_1D_Direction": first["Predicted_Direction"],
        "Forecast_1D_Signal": actionable_signal(first["Predicted_Direction"], quality),
        "Signal_Quality": quality,
        "Forecast_5D_Price": last["Predicted_Price"],
        "Directional_Accuracy": best["Directional_Accuracy"],
        "Balanced_Accuracy": best["Balanced_Accuracy"],
        "Majority_Baseline_Accuracy": best["Majority_Baseline_Accuracy"],
        "Directional_Edge": best["Directional_Edge"],
        "CV_Directional_Accuracy": best["CV_Directional_Accuracy"],
        "CV_Balanced_Accuracy": best["CV_Balanced_Accuracy"],
        "CV_Directional_Edge": best["CV_Directional_Edge"],
        "MAPE": best["MAPE"],
        "Error": "",
    }
    risk_path = model_dir / "risk_forecast_5d.csv"
    if risk_path.exists():
        risk = pd.read_csv(risk_path).iloc[0]
        for column in risk.index:
            result[column] = risk[column]
    return result


def _write_investment_daily(
    report_dir: Path,
    generated_at: datetime,
    snapshots: list[MarketSnapshot],
    prediction_frame: pd.DataFrame,
    news_count: int,
    commentary: str,
    commentary_source: str,
    artifact_paths: dict[str, Path],
    ledger_metrics: pd.DataFrame,
) -> Path:
    lookup = {snapshot.ticker: snapshot for snapshot in snapshots}
    lines = [
        "# 专业投资日报",
        "",
        f"- 生成时间：{generated_at.strftime('%Y-%m-%d %H:%M:%S')} 北京时间",
        f"- GPT/解读来源：{commentary_source}",
        f"- 最近24小时新闻数量：{news_count}",
        "",
        "## 市场概况",
        "",
        _market_overview(lookup),
        "",
        "## 纳斯达克100分析",
        "",
        _asset_section(lookup.get("^NDX"), prediction_frame),
        "",
        "## SPY分析",
        "",
        _asset_section(lookup.get("SPY"), prediction_frame),
        "",
        "## QQQ分析",
        "",
        _asset_section(lookup.get("QQQ"), prediction_frame),
        "",
        "## 风险分析",
        "",
        _risk_section(lookup, prediction_frame),
        "",
        "## 真实预测跟踪",
        "",
        _ledger_summary(ledger_metrics),
        "",
        "## GPT市场分析",
        "",
        commentary,
        "",
        "## 投资建议",
        "",
        "- 把本日报作为盘前观察清单，不作为单独买卖依据。",
        "- 如果指数趋势、模型预测和新闻情绪一致偏多，可考虑顺势观察或轻仓参与。",
        "- 如果 VIX 上行、指数跌破均线或新闻风险集中，应优先控制仓位。",
        "- 对单一股票保持止损和仓位管理，避免只因一天模型预测改变长期计划。",
        "",
        "## 输出文件",
        "",
    ]
    for name, path in artifact_paths.items():
        lines.append(f"- {name}：{path.name}")
    path = report_dir / "summary.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _market_overview(lookup: dict[str, MarketSnapshot]) -> str:
    parts = []
    for ticker in ["^NDX", "SPY", "QQQ"]:
        item = lookup.get(ticker)
        if item:
            parts.append(f"{item.name} {item.trend_signal}，1日收益率 {_fmt_pct(item.return_1d)}")
    vix = lookup.get("^VIX")
    usdcny = lookup.get("USDCNY=X")
    if vix:
        parts.append(f"VIX {vix.latest_price:.2f}，{vix.risk_signal}")
    if usdcny:
        parts.append(f"USDCNY {usdcny.latest_price:.4f}，20日变化 {_fmt_pct(usdcny.return_20d)}")
    return "；".join(parts) + "。"


def _asset_section(snapshot: MarketSnapshot | None, predictions: pd.DataFrame) -> str:
    if snapshot is None:
        return "数据暂不可用。"
    pred = predictions[predictions["Ticker"] == snapshot.ticker]
    pred_text = "模型预测暂不可用。"
    if not pred.empty and not pred.iloc[0].get("Error"):
        row = pred.iloc[0]
        pred_text = (
            f"最佳模型 {row['Best_Model']}，行动信号 {row['Forecast_1D_Signal']}，"
            f"原始方向 {row['Forecast_1D_Direction']}，信号质量 {row['Signal_Quality']}，"
            f"预测收益率 {_fmt_pct(row['Forecast_1D_Return'])}，"
            f"5日滚动预测价格 {row['Forecast_5D_Price']:.4f}；"
            f"未来5日风险 {row.get('Risk_5D_Status', 'N/A')}，"
            f"高波动概率 {_fmt_pct(row.get('Risk_5D_Probability'))}。"
        )
    return (
        f"{snapshot.name} 最新价格 {snapshot.latest_price:.4f}，"
        f"1日收益率 {_fmt_pct(snapshot.return_1d)}，20日收益率 {_fmt_pct(snapshot.return_20d)}。"
        f"技术信号为{snapshot.trend_signal}，RSI14 为 {_fmt_num(snapshot.rsi14)}，"
        f"20日年化波动率 {_fmt_pct(snapshot.annualized_volatility_20d)}。{pred_text}"
    )


def _risk_section(
    lookup: dict[str, MarketSnapshot],
    predictions: pd.DataFrame,
) -> str:
    vix = lookup.get("^VIX")
    usdcny = lookup.get("USDCNY=X")
    lines = []
    if vix:
        lines.append(f"- VIX：{vix.latest_price:.2f}，{vix.risk_signal}。")
    if usdcny:
        lines.append(
            f"- 美元兑人民币：{usdcny.latest_price:.4f}，20日变化 {_fmt_pct(usdcny.return_20d)}。"
        )
    if not lines:
        return "风险数据暂不可用。"
    for ticker in ["SPY", "QQQ", "^VIX", "USDCNY=X"]:
        pred = predictions[predictions["Ticker"] == ticker]
        if pred.empty or pred.iloc[0].get("Error"):
            continue
        row = pred.iloc[0]
        lines.append(
            f"- {ticker} 未来5日风险：{row.get('Risk_5D_Status', 'N/A')}，"
            f"高波动概率 {_fmt_pct(row.get('Risk_5D_Probability'))}，"
            f"滚动验证 AUC {_fmt_num(row.get('Risk_5D_CV_AUC'))}。"
        )
    lines.append("- 若 VIX 快速上行或美元兑人民币明显走强，应降低对高 beta 科技股的短线预期。")
    return "\n".join(lines)


def _prediction_summary_text(frame: pd.DataFrame) -> str:
    if frame.empty:
        return "模型预测暂不可用。"
    lines = []
    for _, row in frame.iterrows():
        if row.get("Error"):
            lines.append(f"- {row['Ticker']}: 模型运行失败，原因：{row['Error']}")
        else:
            lines.append(
                f"- {row['Ticker']}: {row['Best_Model']}，行动信号 {row['Forecast_1D_Signal']}，"
                f"原始方向 {row['Forecast_1D_Direction']}，信号质量 {row['Signal_Quality']}，"
                f"1日预测收益率 {_fmt_pct(row['Forecast_1D_Return'])}，"
                f"MAPE {_fmt_num(row['MAPE'])}%，测试集方向准确率 {_fmt_num(row['Directional_Accuracy'])}%，"
                f"多数类基准 {_fmt_num(row['Majority_Baseline_Accuracy'])}%，"
                f"滚动验证方向准确率 {_fmt_num(row['CV_Directional_Accuracy'])}%，"
                f"滚动验证方向优势 {_fmt_num(row['CV_Directional_Edge'])} 个百分点，"
                f"未来5日风险 {row.get('Risk_5D_Status', 'N/A')}，"
                f"高波动概率 {_fmt_pct(row.get('Risk_5D_Probability'))}"
            )
    return "\n".join(lines)


def _ledger_summary(metrics: pd.DataFrame) -> str:
    if metrics.empty:
        return "暂无真实预测跟踪数据。"
    latest = metrics[(metrics["Ticker"] != "ALL") & (metrics["Window"] == "60")]
    lines = []
    for _, row in latest.iterrows():
        lines.append(
            f"- {row['Ticker']}：已完成1日预测 {int(row['Completed_1D'])} 条，"
            f"行动信号准确率 {_fmt_num(row['Actionable_Accuracy'])}%，"
            f"行动覆盖率 {_fmt_num(row['Actionable_Coverage'])}%，"
            f"5日风险准确率 {_fmt_num(row['Risk_5D_Accuracy'])}%。"
        )
    return "\n".join(lines) if lines else "暂无已完成的真实预测。"


def _safe_name(ticker: str) -> str:
    return ticker.replace("^", "").replace("=", "_").replace("/", "_")


def _fmt_pct(value: object) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return f"{float(value):.2%}"


def _fmt_num(value: object) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return f"{float(value):.2f}"
