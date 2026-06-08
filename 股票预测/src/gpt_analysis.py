from __future__ import annotations

import json
import os
from dataclasses import asdict

import requests

from src.market_analyst import MarketSnapshot
from src.news import NewsItem, summarize_news_for_prompt


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


def generate_market_commentary(
    snapshots: list[MarketSnapshot],
    prediction_summary: str,
    news_items: list[NewsItem],
) -> tuple[str, str]:
    prompt = _build_prompt(snapshots, prediction_summary, news_items)
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _fallback_commentary(snapshots, prediction_summary, news_items), "local_fallback_no_api_key"

    model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
    payload = {
        "model": model,
        "input": [
            {
                "role": "developer",
                "content": (
                    "你是一名谨慎的中文市场分析师。输出专业但不过度复杂的中文日报解读。"
                    "不要承诺收益，不要给出确定性判断，必须包含风险提示。"
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    try:
        response = requests.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        text = _extract_response_text(response.json())
        if text:
            return text.strip(), f"openai_responses_api:{model}"
    except Exception as exc:
        return (
            _fallback_commentary(snapshots, prediction_summary, news_items)
            + f"\n\n> GPT 分析未启用或调用失败，已使用本地规则生成。错误：{exc}",
            "local_fallback_api_error",
        )
    return _fallback_commentary(snapshots, prediction_summary, news_items), "local_fallback_empty_response"


def _build_prompt(
    snapshots: list[MarketSnapshot],
    prediction_summary: str,
    news_items: list[NewsItem],
) -> str:
    snapshot_text = json.dumps(
        [asdict(snapshot) for snapshot in snapshots],
        ensure_ascii=False,
        indent=2,
    )
    news_text = summarize_news_for_prompt(news_items)
    return f"""
请根据以下数据生成一份中文市场解读，供个人每日投资参考。

要求：
- 包含市场概况、纳斯达克100分析、SPY分析、QQQ分析、风险分析、投资建议。
- 结合技术指标、模型预测和新闻。
- 语气专业、谨慎、可执行，不要夸张。
- 不要说这是投资保证，不要给确定性收益承诺。

市场技术快照：
{snapshot_text}

模型预测摘要：
{prediction_summary}

最近24小时新闻：
{news_text}
""".strip()


def _extract_response_text(payload: dict) -> str:
    if "output_text" in payload and payload["output_text"]:
        return str(payload["output_text"])
    chunks = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(str(content["text"]))
    return "\n".join(chunks)


def _fallback_commentary(
    snapshots: list[MarketSnapshot],
    prediction_summary: str,
    news_items: list[NewsItem],
) -> str:
    lookup = {snapshot.ticker: snapshot for snapshot in snapshots}
    ndx = lookup.get("^NDX")
    spy = lookup.get("SPY")
    qqq = lookup.get("QQQ")
    vix = lookup.get("^VIX")
    usdcny = lookup.get("USDCNY=X")
    news_count = len(news_items)

    def _line(snapshot: MarketSnapshot | None) -> str:
        if snapshot is None:
            return "数据暂不可用。"
        return (
            f"最新价格 {snapshot.latest_price:.2f}，1日收益率 {_fmt_pct(snapshot.return_1d)}，"
            f"20日收益率 {_fmt_pct(snapshot.return_20d)}，趋势信号为{snapshot.trend_signal}，"
            f"风险信号为{snapshot.risk_signal}。"
        )

    return "\n".join(
        [
            "## GPT市场解读",
            "",
            "当前未检测到可用的 OpenAI API Key，因此本段使用本地规则生成。",
            "",
            "### 市场概况",
            f"最近24小时共抓取到 {news_count} 条相关新闻。整体判断应同时参考指数趋势、VIX 风险偏好和美元兑人民币变化。",
            "",
            "### 纳斯达克100分析",
            _line(ndx),
            "",
            "### SPY分析",
            _line(spy),
            "",
            "### QQQ分析",
            _line(qqq),
            "",
            "### 风险分析",
            f"VIX：{_line(vix)}",
            f"USDCNY：{_line(usdcny)}",
            "",
            "### 投资建议",
            "如果 SPY、QQQ 和纳斯达克100同时处于偏多状态，可考虑维持观察或轻仓顺势；如果 VIX 抬升或指数跌破关键均线，应降低仓位或等待更明确的确认信号。",
            "",
            "### 模型预测摘要",
            prediction_summary,
        ]
    )


def _fmt_pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.2%}"
