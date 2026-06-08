from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus
import xml.etree.ElementTree as ET

import pandas as pd
import requests


NEWS_KEYWORDS = [
    "Fed",
    "CPI",
    "PPI",
    "Jobs",
    "NVIDIA",
    "Microsoft",
    "Apple",
    "Amazon",
    "Meta",
    "Google",
]


@dataclass
class NewsItem:
    keyword: str
    title: str
    source: str
    published_at: str
    link: str


def fetch_recent_news(
    keywords: list[str] | None = None,
    hours: int = 24,
    max_per_keyword: int = 5,
) -> list[NewsItem]:
    keywords = keywords or NEWS_KEYWORDS
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    all_items: list[NewsItem] = []
    for keyword in keywords:
        all_items.extend(_fetch_keyword_news(keyword, cutoff, max_per_keyword))
    return all_items


def save_news(items: list[NewsItem], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame([asdict(item) for item in items])
    csv_path = output_dir / "news_24h.csv"
    md_path = output_dir / "news_24h.md"
    frame.to_csv(csv_path, index=False)

    lines = ["# 最近24小时市场新闻", ""]
    if not items:
        lines.append("最近24小时没有抓取到可用新闻。")
    grouped: dict[str, list[NewsItem]] = {}
    for item in items:
        grouped.setdefault(item.keyword, []).append(item)
    for keyword, keyword_items in grouped.items():
        lines.extend([f"## {keyword}", ""])
        for item in keyword_items:
            lines.append(
                f"- {item.published_at} | {item.source} | [{item.title}]({item.link})"
            )
        lines.append("")
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return csv_path, md_path


def summarize_news_for_prompt(items: list[NewsItem], max_items: int = 30) -> str:
    if not items:
        return "最近24小时未抓取到可用新闻。"
    lines = []
    for item in items[:max_items]:
        lines.append(
            f"- [{item.keyword}] {item.published_at} {item.source}: {item.title}"
        )
    return "\n".join(lines)


def _fetch_keyword_news(keyword: str, cutoff: datetime, max_items: int) -> list[NewsItem]:
    query = quote_plus(f"{keyword} stock market when:1d")
    url = (
        "https://news.google.com/rss/search?"
        f"q={query}&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        response.raise_for_status()
    except Exception:
        return []

    root = ET.fromstring(response.content)
    items = []
    for node in root.findall("./channel/item"):
        title = _node_text(node, "title")
        link = _node_text(node, "link")
        source_node = node.find("source")
        source = source_node.text if source_node is not None and source_node.text else "Unknown"
        pub_date = _parse_pub_date(_node_text(node, "pubDate"))
        if pub_date is None or pub_date < cutoff:
            continue
        items.append(
            NewsItem(
                keyword=keyword,
                title=title,
                source=source,
                published_at=pub_date.astimezone(timezone.utc).isoformat(timespec="minutes"),
                link=link,
            )
        )
        if len(items) >= max_items:
            break
    return items


def _node_text(node: ET.Element, tag: str) -> str:
    child = node.find(tag)
    return child.text.strip() if child is not None and child.text else ""


def _parse_pub_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None
