from __future__ import annotations

from dataclasses import asdict
from html import escape
from pathlib import Path
from typing import Iterable

import pandas as pd

from src.market_analyst import MarketSnapshot
from src.news import NewsItem


def write_html_daily_report(
    report_dir: Path,
    generated_at_text: str,
    snapshots: list[MarketSnapshot],
    prediction_frame: pd.DataFrame,
    news_items: list[NewsItem],
    commentary: str,
    commentary_source: str,
) -> tuple[Path, dict[str, Path]]:
    inline_images = _collect_inline_images(report_dir)
    html = _render_html(
        generated_at_text=generated_at_text,
        snapshots=snapshots,
        prediction_frame=prediction_frame,
        news_items=news_items,
        commentary=commentary,
        commentary_source=commentary_source,
        inline_images=inline_images,
    )
    path = report_dir / "summary.html"
    path.write_text(html, encoding="utf-8")
    return path, inline_images


def _render_html(
    generated_at_text: str,
    snapshots: list[MarketSnapshot],
    prediction_frame: pd.DataFrame,
    news_items: list[NewsItem],
    commentary: str,
    commentary_source: str,
    inline_images: dict[str, Path],
) -> str:
    lookup = {snapshot.ticker: snapshot for snapshot in snapshots}
    lead = _market_lead(lookup)
    cards = "\n".join(_metric_card(snapshot) for snapshot in snapshots)
    market_rows = "\n".join(_market_row(snapshot) for snapshot in snapshots)
    prediction_rows = "\n".join(_prediction_row(row) for _, row in prediction_frame.iterrows())
    news_html = _news_list(news_items)
    commentary_html = _markdownish_to_html(commentary)
    chart_blocks = "\n".join(
        _chart_block(title, cid) for title, cid in _chart_titles(inline_images)
    )
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>专业投资日报</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      background: #f4f6f8;
      color: #1f2937;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      line-height: 1.55;
    }}
    .wrap {{
      max-width: 980px;
      margin: 0 auto;
      padding: 24px 14px 40px;
    }}
    .hero {{
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 62%, #0f766e 100%);
      color: #fff;
      padding: 28px;
      border-radius: 18px;
    }}
    .hero h1 {{
      margin: 0 0 8px;
      font-size: 30px;
      letter-spacing: 0;
    }}
    .hero p {{
      margin: 8px 0 0;
      color: #dbeafe;
      font-size: 15px;
    }}
    .section {{
      background: #fff;
      margin-top: 18px;
      padding: 22px;
      border-radius: 14px;
      border: 1px solid #e5e7eb;
    }}
    h2 {{
      margin: 0 0 14px;
      font-size: 20px;
      color: #111827;
    }}
    h3 {{
      margin: 18px 0 8px;
      font-size: 16px;
      color: #111827;
    }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 18px;
    }}
    .card {{
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 14px;
    }}
    .label {{
      color: #6b7280;
      font-size: 12px;
      margin-bottom: 4px;
    }}
    .value {{
      font-size: 20px;
      font-weight: 700;
      color: #111827;
    }}
    .up {{ color: #047857; }}
    .down {{ color: #b91c1c; }}
    .neutral {{ color: #374151; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      overflow: hidden;
      border-radius: 10px;
    }}
    th {{
      background: #eef2ff;
      color: #374151;
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid #dbe4ff;
    }}
    td {{
      padding: 10px 8px;
      border-bottom: 1px solid #edf2f7;
      vertical-align: top;
    }}
    .chart {{
      margin-top: 14px;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 12px;
      background: #fbfdff;
    }}
    .chart img {{
      width: 100%;
      max-width: 900px;
      border-radius: 10px;
      display: block;
    }}
    .news li {{
      margin-bottom: 9px;
    }}
    a {{ color: #1d4ed8; text-decoration: none; }}
    .note {{
      font-size: 12px;
      color: #6b7280;
      margin-top: 16px;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>专业投资日报</h1>
      <p>{escape(generated_at_text)} 北京时间</p>
      <p>{escape(lead)}</p>
    </div>

    <div class="cards">
      {cards}
    </div>

    <div class="section">
      <h2>市场概况</h2>
      <table>
        <thead>
          <tr>
            <th>资产</th>
            <th>最新价格</th>
            <th>1日</th>
            <th>20日</th>
            <th>RSI14</th>
            <th>趋势</th>
            <th>风险</th>
          </tr>
        </thead>
        <tbody>{market_rows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>模型预测</h2>
      <table>
        <thead>
          <tr>
            <th>资产</th>
            <th>最佳模型</th>
            <th>行动信号</th>
            <th>信号质量</th>
            <th>1日收益率</th>
            <th>5日价格</th>
            <th>MAPE</th>
            <th>测试方向准确率</th>
            <th>多数类基准</th>
            <th>滚动验证准确率</th>
            <th>滚动验证优势</th>
          </tr>
        </thead>
        <tbody>{prediction_rows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>关键图表</h2>
      {chart_blocks}
    </div>

    <div class="section">
      <h2>中文市场解读</h2>
      <div>{commentary_html}</div>
      <p class="note">解读来源：{escape(commentary_source)}</p>
    </div>

    <div class="section">
      <h2>最近24小时新闻</h2>
      {news_html}
    </div>

    <div class="section">
      <h2>风险提示</h2>
      <p>本日报用于个人观察和研究，不构成投资建议。市场价格会受到宏观数据、突发新闻、流动性和情绪变化影响，模型预测不能保证未来表现。</p>
    </div>
  </div>
</body>
</html>"""


def _collect_inline_images(report_dir: Path) -> dict[str, Path]:
    wanted = [
        ("ndx_actual_vs_predicted", report_dir / "model_runs" / "NDX"),
        ("spy_actual_vs_predicted", report_dir / "model_runs" / "SPY"),
        ("qqq_actual_vs_predicted", report_dir / "model_runs" / "QQQ"),
        ("vix_actual_vs_predicted", report_dir / "model_runs" / "VIX"),
        ("usdcny_actual_vs_predicted", report_dir / "model_runs" / "USDCNY_X"),
        ("spy_feature_importance", report_dir / "model_runs" / "SPY"),
    ]
    images: dict[str, Path] = {}
    for cid, root in wanted:
        if not root.exists():
            continue
        runs = sorted([path for path in root.iterdir() if path.is_dir()])
        if not runs:
            continue
        figure_dir = runs[-1] / "figures"
        file_name = "feature_importance.png" if "feature_importance" in cid else "actual_vs_predicted.png"
        image_path = figure_dir / file_name
        if image_path.exists():
            images[cid] = image_path
    return images


def _chart_titles(images: dict[str, Path]) -> Iterable[tuple[str, str]]:
    titles = {
        "ndx_actual_vs_predicted": "纳斯达克100：实际 vs 预测",
        "spy_actual_vs_predicted": "SPY：实际 vs 预测",
        "qqq_actual_vs_predicted": "QQQ：实际 vs 预测",
        "vix_actual_vs_predicted": "VIX：实际 vs 预测",
        "usdcny_actual_vs_predicted": "USDCNY：实际 vs 预测",
        "spy_feature_importance": "SPY：随机森林特征重要性",
    }
    for cid in images:
        yield titles.get(cid, cid), cid


def _chart_block(title: str, cid: str) -> str:
    return f"""
      <div class="chart">
        <h3>{escape(title)}</h3>
        <img src="cid:{escape(cid)}" alt="{escape(title)}">
      </div>
    """


def _metric_card(snapshot: MarketSnapshot) -> str:
    movement_class = _movement_class(snapshot.return_1d)
    return f"""
      <div class="card">
        <div class="label">{escape(snapshot.name)}</div>
        <div class="value">{snapshot.latest_price:.4f}</div>
        <div class="{movement_class}">1日 {_fmt_pct(snapshot.return_1d)}</div>
        <div class="label">趋势：{escape(snapshot.trend_signal)} | 风险：{escape(snapshot.risk_signal)}</div>
      </div>
    """


def _market_row(snapshot: MarketSnapshot) -> str:
    return f"""
      <tr>
        <td>{escape(snapshot.name)}<br><span class="label">{escape(snapshot.ticker)}</span></td>
        <td>{snapshot.latest_price:.4f}</td>
        <td class="{_movement_class(snapshot.return_1d)}">{_fmt_pct(snapshot.return_1d)}</td>
        <td class="{_movement_class(snapshot.return_20d)}">{_fmt_pct(snapshot.return_20d)}</td>
        <td>{_fmt_num(snapshot.rsi14)}</td>
        <td>{escape(snapshot.trend_signal)}</td>
        <td>{escape(snapshot.risk_signal)}</td>
      </tr>
    """


def _prediction_row(row: pd.Series) -> str:
    if row.get("Error"):
        return f"""
          <tr>
            <td>{escape(str(row.get("Ticker", "")))}</td>
            <td colspan="10">{escape(str(row.get("Error")))}</td>
          </tr>
        """
    return f"""
      <tr>
        <td>{escape(str(row.get("Ticker", "")))}</td>
        <td>{escape(str(row.get("Best_Model", "")))}</td>
        <td class="{_direction_class(row.get("Forecast_1D_Signal"))}">{escape(str(row.get("Forecast_1D_Signal", "")))}</td>
        <td>{escape(str(row.get("Signal_Quality", "")))}</td>
        <td class="{_movement_class(row.get("Forecast_1D_Return"))}">{_fmt_pct(row.get("Forecast_1D_Return"))}</td>
        <td>{_fmt_num(row.get("Forecast_5D_Price"))}</td>
        <td>{_fmt_num(row.get("MAPE"))}%</td>
        <td>{_fmt_num(row.get("Directional_Accuracy"))}%</td>
        <td>{_fmt_num(row.get("Majority_Baseline_Accuracy"))}%</td>
        <td>{_fmt_num(row.get("CV_Directional_Accuracy"))}%</td>
        <td>{_fmt_num(row.get("CV_Directional_Edge"))} pp</td>
      </tr>
    """


def _news_list(items: list[NewsItem]) -> str:
    if not items:
        return "<p>最近24小时没有抓取到可用新闻。</p>"
    rows = []
    for item in items[:18]:
        rows.append(
            f'<li><strong>{escape(item.keyword)}</strong> | {escape(item.source)} | '
            f'<a href="{escape(item.link)}">{escape(item.title)}</a></li>'
        )
    return '<ul class="news">' + "\n".join(rows) + "</ul>"


def _markdownish_to_html(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("### "):
            lines.append(f"<h3>{escape(line[4:])}</h3>")
        elif line.startswith("## "):
            lines.append(f"<h3>{escape(line[3:])}</h3>")
        elif line.startswith("- "):
            lines.append(f"<p>• {escape(line[2:])}</p>")
        else:
            lines.append(f"<p>{escape(line)}</p>")
    return "\n".join(lines)


def _market_lead(lookup: dict[str, MarketSnapshot]) -> str:
    parts = []
    for ticker in ["^NDX", "SPY", "QQQ"]:
        item = lookup.get(ticker)
        if item:
            parts.append(f"{item.name}{item.trend_signal}，1日{_fmt_pct(item.return_1d)}")
    vix = lookup.get("^VIX")
    if vix:
        parts.append(f"VIX {vix.latest_price:.2f}，{vix.risk_signal}")
    return "；".join(parts) + "。"


def _movement_class(value: object) -> str:
    numeric = _to_float(value)
    if numeric is None:
        return "neutral"
    if numeric > 0:
        return "up"
    if numeric < 0:
        return "down"
    return "neutral"


def _direction_class(value: object) -> str:
    text = str(value).lower()
    if text == "up":
        return "up"
    if text == "down":
        return "down"
    return "neutral"


def _fmt_pct(value: object) -> str:
    numeric = _to_float(value)
    return "N/A" if numeric is None else f"{numeric:.2%}"


def _fmt_num(value: object) -> str:
    numeric = _to_float(value)
    return "N/A" if numeric is None else f"{numeric:.2f}"


def _to_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)
