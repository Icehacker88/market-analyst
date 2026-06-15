from __future__ import annotations

import csv
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


NEW_YORK = ZoneInfo("America/New_York")
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"


def expected_latest_session_date(now: datetime | None = None) -> date:
    current = now or datetime.now(timezone.utc)
    return current.astimezone(NEW_YORK).date()


def should_generate_scheduled_report(
    latest_session_date: date,
    recorded_session_date: date | None,
) -> bool:
    return recorded_session_date is None or latest_session_date > recorded_session_date


def fetch_latest_session_date(ticker: str = "^NDX") -> date:
    url = YAHOO_CHART_URL.format(ticker=quote(ticker.upper(), safe=""))
    request = Request(
        f"{url}?range=10d&interval=1d&events=history",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    result = payload.get("chart", {}).get("result") or []
    timestamps = result[0].get("timestamp") if result else None
    if not timestamps:
        raise RuntimeError(f"Yahoo 没有返回 {ticker} 的最近交易日")
    latest = datetime.fromtimestamp(timestamps[-1], timezone.utc)
    return latest.astimezone(NEW_YORK).date()


def latest_recorded_session_date(
    ledger_path: Path = Path("data/history/prediction_ledger.csv"),
    ticker: str = "^NDX",
) -> date | None:
    if not ledger_path.exists():
        return None
    with ledger_path.open(encoding="utf-8", newline="") as ledger_file:
        dates = [
            date.fromisoformat(row["As_Of_Date"])
            for row in csv.DictReader(ledger_file)
            if row.get("Ticker") == ticker and row.get("As_Of_Date")
        ]
    return max(dates, default=None)


def workflow_decision(event_name: str) -> tuple[bool, str]:
    if event_name != "schedule":
        return True, "手动运行，允许生成日报。"
    latest = fetch_latest_session_date()
    recorded = latest_recorded_session_date()
    if should_generate_scheduled_report(latest, recorded):
        return True, f"检测到新的美国交易日数据：最新 {latest}，已记录 {recorded}。"
    return False, f"美国市场无新交易日数据：最新 {latest}，已记录 {recorded}。"


def main() -> None:
    send, message = workflow_decision(os.getenv("GITHUB_EVENT_NAME", "schedule"))
    output_path = os.getenv("GITHUB_OUTPUT")
    if output_path:
        with Path(output_path).open("a", encoding="utf-8") as output:
            output.write(f"send={'true' if send else 'false'}\n")
    print(message)


if __name__ == "__main__":
    main()
