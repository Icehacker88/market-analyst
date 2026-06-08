from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from src.features import build_technical_indicators
from src.preprocessing import clean_price_data


MARKET_ASSETS = {
    "^NDX": "纳斯达克100",
    "SPY": "SPY 标普500 ETF",
    "QQQ": "QQQ 纳斯达克100 ETF",
    "^VIX": "VIX 波动率指数",
    "USDCNY=X": "美元兑人民币",
}


@dataclass
class MarketSnapshot:
    ticker: str
    name: str
    latest_date: str
    latest_price: float
    return_1d: float | None
    return_5d: float | None
    return_20d: float | None
    ma20: float | None
    ma50: float | None
    price_to_ma20: float | None
    price_to_ma50: float | None
    rsi14: float | None
    macd_hist: float | None
    annualized_volatility_20d: float | None
    trend_signal: str
    risk_signal: str


def analyze_market_frame(ticker: str, raw: pd.DataFrame) -> tuple[MarketSnapshot, pd.DataFrame]:
    cleaned, _ = clean_price_data(raw)
    technical = build_technical_indicators(cleaned).replace([np.inf, -np.inf], np.nan)
    latest = technical.dropna(subset=["Price"]).iloc[-1]
    name = MARKET_ASSETS.get(ticker, ticker)
    snapshot = MarketSnapshot(
        ticker=ticker,
        name=name,
        latest_date=pd.to_datetime(latest["Date"]).date().isoformat(),
        latest_price=_as_float(latest.get("Price")) or 0.0,
        return_1d=_as_float(latest.get("Daily_Return")),
        return_5d=_as_float(latest.get("Weekly_Return")),
        return_20d=_period_return(technical["Price"], 20),
        ma20=_as_float(latest.get("MA_20")),
        ma50=_as_float(latest.get("MA_50")),
        price_to_ma20=_as_float(latest.get("Price_to_MA_20")),
        price_to_ma50=_as_float(latest.get("Price_to_MA_50")),
        rsi14=_as_float(latest.get("RSI_14")),
        macd_hist=_as_float(latest.get("MACD_Hist")),
        annualized_volatility_20d=_as_float(
            latest.get("Rolling_Std_20") * np.sqrt(252)
            if pd.notna(latest.get("Rolling_Std_20"))
            else np.nan
        ),
        trend_signal=_trend_signal(latest),
        risk_signal=_risk_signal(ticker, latest),
    )
    return snapshot, technical


def save_market_snapshot(snapshots: list[MarketSnapshot], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame([asdict(snapshot) for snapshot in snapshots])
    csv_path = output_dir / "market_snapshot.csv"
    md_path = output_dir / "market_snapshot.md"
    frame.to_csv(csv_path, index=False)

    lines = ["# 市场技术面快照", ""]
    for snapshot in snapshots:
        lines.extend(
            [
                f"## {snapshot.name} ({snapshot.ticker})",
                "",
                f"- 最新日期：{snapshot.latest_date}",
                f"- 最新价格：{snapshot.latest_price:.4f}",
                f"- 1日收益率：{_fmt_pct(snapshot.return_1d)}",
                f"- 5日收益率：{_fmt_pct(snapshot.return_5d)}",
                f"- 20日收益率：{_fmt_pct(snapshot.return_20d)}",
                f"- RSI14：{_fmt_num(snapshot.rsi14)}",
                f"- 20日年化波动率：{_fmt_pct(snapshot.annualized_volatility_20d)}",
                f"- 趋势信号：{snapshot.trend_signal}",
                f"- 风险信号：{snapshot.risk_signal}",
                "",
            ]
        )
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return csv_path, md_path


def _trend_signal(row: pd.Series) -> str:
    price_to_ma20 = row.get("Price_to_MA_20")
    price_to_ma50 = row.get("Price_to_MA_50")
    macd_hist = row.get("MACD_Hist")
    rsi = row.get("RSI_14")
    bullish_count = sum(
        [
            pd.notna(price_to_ma20) and price_to_ma20 > 0,
            pd.notna(price_to_ma50) and price_to_ma50 > 0,
            pd.notna(macd_hist) and macd_hist > 0,
            pd.notna(rsi) and 45 <= rsi <= 70,
        ]
    )
    bearish_count = sum(
        [
            pd.notna(price_to_ma20) and price_to_ma20 < 0,
            pd.notna(price_to_ma50) and price_to_ma50 < 0,
            pd.notna(macd_hist) and macd_hist < 0,
            pd.notna(rsi) and rsi < 45,
        ]
    )
    if bullish_count >= 3:
        return "偏多"
    if bearish_count >= 3:
        return "偏弱"
    return "震荡"


def _risk_signal(ticker: str, row: pd.Series) -> str:
    price = row.get("Price")
    rsi = row.get("RSI_14")
    volatility = row.get("Rolling_Std_20")
    if ticker == "^VIX":
        if pd.notna(price) and price >= 25:
            return "风险偏高"
        if pd.notna(price) and price <= 15:
            return "风险偏低"
        return "风险中性"
    if pd.notna(rsi) and rsi >= 75:
        return "短线过热"
    if pd.notna(volatility) and volatility * np.sqrt(252) >= 0.3:
        return "波动偏高"
    return "风险可控"


def _period_return(series: pd.Series, periods: int) -> float | None:
    values = series.dropna()
    if len(values) <= periods:
        return None
    latest = float(values.iloc[-1])
    previous = float(values.iloc[-periods - 1])
    if previous == 0:
        return None
    return latest / previous - 1


def _as_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def _fmt_pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.2%}"


def _fmt_num(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.2f}"
