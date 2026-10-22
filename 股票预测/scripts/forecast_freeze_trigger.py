"""Trigger the cloud's closed-session freeze and settlement for reviewed US assets.

The cloud freezes a qualified forecast only when a forecast request arrives between the base
session's close + 15 minutes and the next open, and settles due outcomes when an asset's
history is read. Nothing did either on a schedule, so qualified samples depended on someone
visiting after the close. This runs from GitHub Actions after the US close.

Public GET endpoints only: no secrets, no repository writes. Outside the window it does
nothing; inside it, a symbol already frozen for the base session is served from cache.
Symbols outside the reviewed calendar (`US_SYMBOLS`) are skipped: they cannot qualify.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.forecast_eligibility import NY, US_SYMBOLS, VERSION, following_sessions, session  # noqa: E402

DEFAULT_SITE = "https://orivane-market-intelligence.pages.dev"
DEFAULT_SYMBOLS = "SPY,QQQ,NVDA"
USER_AGENT = "orivane-forecast-freeze-trigger/1 (+GitHub Actions)"
CONFIRMATION = timedelta(minutes=15)
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.^=-]{1,15}$")

Fetch = Callable[[str], dict]


def publication_window(now: datetime) -> tuple[str, datetime, datetime] | None:
    """Latest completed session's window (base, opens, closes); mirrors the cloud's currentPublicationWindow."""
    local_day = now.astimezone(NY).date()
    for offset in range(10):
        day = (local_day - timedelta(days=offset)).isoformat()
        times = session(day)
        if not times or times[1] > now:
            continue
        upcoming = following_sessions(day, 1)
        if not upcoming:
            return None
        opens, closes = times[1] + CONFIRMATION, session(upcoming[0])[0]
        return (day, opens, closes) if opens <= now < closes else None
    return None


def parse_symbols(value: str) -> list[str]:
    symbols = [item.strip().upper() for item in re.split(r"[\s,]+", value or "") if item.strip()]
    invalid = [item for item in symbols if not SYMBOL_PATTERN.match(item)]
    if invalid:
        raise ValueError(f"Invalid symbols: {', '.join(invalid)}")
    return list(dict.fromkeys(symbols))


def qualified_row(records: list[dict], base: str) -> dict | None:
    for row in records:
        timing = (row.get("Time_Eligibility") or {}).get("1D") or {}
        if str(row.get("As_Of_Date", ""))[:10] == base and timing.get("status") == "eligible" and timing.get("protocol") == VERSION:
            return row
    return None


def http_json(url: str, timeout: float = 120) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def trigger_symbol(site: str, symbol: str, base: str, fetch: Fetch, stamp: str) -> dict:
    result: dict = {"symbol": symbol, "qualified": False}
    quoted = urllib.parse.quote(symbol)
    try:
        # The unique parameter bypasses the 5-minute edge cache so the request reaches the Worker.
        forecast = fetch(f"{site}/api/forecast/latest?symbol={quoted}&contract={VERSION}&_trigger={stamp}").get("data") or {}
        result.update(forecast_as_of=forecast.get("data_as_of"), pending=bool(forecast.get("publication_pending")))
        # Reading history reconciles the ledger, which settles any outcomes now due.
        history = fetch(f"{site}/api/predictions/history/{quoted}?contract={VERSION}").get("data") or {}
        live = history.get("live") if isinstance(history.get("live"), dict) else history
        row = qualified_row(live.get("records") or [], base)
        result.update(qualified=row is not None, created_at=row.get("Created_At") if row else None)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as cause:
        result["error"] = f"{type(cause).__name__}: {cause}"[:200]
    return result


def run(symbols: list[str], site: str, now: datetime, fetch: Fetch, strict_after: timedelta, pause: float = 2.0) -> tuple[int, list[str]]:
    window = publication_window(now)
    if not window:
        return 0, [f"{now.isoformat()}: outside the closed-session publication window; nothing to do."]
    base, opens, closes = window
    lines = [f"Base session {base}; window {opens.isoformat()} to {closes.isoformat()}.", "",
             "| Symbol | Qualified 1D record | Forecast as of | Pending | Note |", "| --- | --- | --- | --- | --- |"]
    missing = []
    stamp = f"{base}-{int(now.timestamp())}"
    for index, symbol in enumerate(symbols):
        if symbol not in US_SYMBOLS:
            lines.append(f"| {symbol} | — | — | — | skipped: not on the reviewed calendar |")
            continue
        if index and pause:
            time.sleep(pause)
        result = trigger_symbol(site, symbol, base, fetch, stamp)
        if not result["qualified"]:
            missing.append(symbol)
        note = result.get("error") or (f"frozen {result['created_at']}" if result["qualified"] else "not yet qualified")
        lines.append(f"| {symbol} | {'yes' if result['qualified'] else 'no'} | {result.get('forecast_as_of') or '—'} | "
                     f"{'yes' if result.get('pending') else 'no'} | {note} |")
    # Early runs may precede the provider's close data; only a late run treats a gap as failure.
    late = now >= opens - CONFIRMATION + strict_after
    if missing:
        lines += ["", f"Missing qualified records: {', '.join(missing)}" + (" (late run: failing)." if late else " (will retry on a later run).")]
    return (1 if missing and late else 0), lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--symbols", default=os.environ.get("FORECAST_FREEZE_SYMBOLS") or DEFAULT_SYMBOLS)
    parser.add_argument("--site", default=DEFAULT_SITE)
    parser.add_argument("--strict-after-hours", type=float, default=4.0, help="Fail on missing records only this long after the close.")
    args = parser.parse_args(argv)
    code, lines = run(parse_symbols(args.symbols), args.site.rstrip("/"), datetime.now(timezone.utc), http_json,
                      timedelta(hours=args.strict_after_hours))
    print("\n".join(lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("## Forecast freeze trigger\n\n" + "\n".join(lines) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
