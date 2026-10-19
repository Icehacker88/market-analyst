"""Pure, fail-closed qualification for close-to-close frozen forecasts.

No inference of historical publication time, no network or ledger writes.
Only reviewed US equity sessions qualify; indices/FX/other markets stay unknown.
Live freeze and settlement use the unadjusted Close: Adj Close is rewritten for every
past day at each ex-dividend date, so a frozen Adj Close base would never match again.
Scores are therefore price returns: any window that spans an ex-dividend date omits that dividend.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CALENDAR = json.loads((Path(__file__).resolve().parents[1] / "contracts/us-equity-calendar.json").read_text())
VERSION = "frozen-close-v1"
NY = ZoneInfo("America/New_York")
HORIZONS = {"1D": 1, "5D": 5, "10D": 10, "1M": 22}
SETTLEMENT_BASIS = "Close"
# Reviewed US equity symbols (the report's ETFs plus NVDA). Do not classify by regex.
US_SYMBOLS = {"SPY", "QQQ", "NVDA"}


def timestamp(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def positive(value: object) -> bool:
    try:
        return not isinstance(value, bool) and math.isfinite(float(value)) and float(value) > 0
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=800)
def session(day: str) -> tuple[datetime, datetime] | None:
    try:
        d = date.fromisoformat(day)
    except (ValueError, TypeError):
        return None
    if not CALENDAR["first_date"] <= day <= CALENDAR["last_date"] or d.weekday() > 4 or day in CALENDAR["holidays"]:
        return None
    hour = 13 if day in CALENDAR["early_closes"] else 16
    return (datetime(d.year, d.month, d.day, 9, 30, tzinfo=NY), datetime(d.year, d.month, d.day, hour, tzinfo=NY))


def following_sessions(day: str, count: int) -> list[str]:
    if not session(day):
        return []
    d = date.fromisoformat(day)
    result = []
    while len(result) < count:
        d += timedelta(days=1)
        if d.isoformat() > CALENDAR["last_date"]:
            return []
        if session(d.isoformat()):
            result.append(d.isoformat())
    return result


def make_snapshot(ticker: str, as_of: str, price: float, basis: str, source: str,
                  observed_at: str, generated_at: str, frozen_at: str) -> dict:
    return dict(schema_version=VERSION, calendar=CALENDAR["version"] if ticker in US_SYMBOLS else None,
                symbol=ticker, base_session=as_of, base_price=price, price_basis=basis,
                source=source, source_observed_at=observed_at, generated_at=generated_at,
                frozen_at=frozen_at, target_sessions=following_sessions(as_of, 22) if ticker in US_SYMBOLS else [])


def qualify(row: dict, horizon: str = "1D", now: datetime | None = None) -> dict:
    def result(status: str, reason: str) -> dict:
        return {"status": status, "reason": reason, "protocol": VERSION}
    snapshot = row.get("Evaluation_Snapshot")
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    known = row.get("Ticker") in US_SYMBOLS or snapshot.get("calendar") == CALENDAR["version"]
    if not known:
        return result("unknown", "unsupported_market_calendar")
    base = str(row.get("As_Of_Date", ""))
    times = session(base)
    targets = following_sessions(base, HORIZONS.get(horizon, 0))
    if not times or not targets:
        return result("unknown", "calendar_unavailable")
    generated = timestamp(row.get("Created_At"))
    if not generated:
        return result("unknown", "generation_time_missing")
    first_open = session(targets[0])[0]
    if generated < times[1]:
        return result("ineligible", "base_session_unclosed")
    if generated >= first_open:
        return result("ineligible", "published_after_target_open")
    if snapshot.get("schema_version") != VERSION:
        return result("unknown", "legacy_snapshot_missing")
    if snapshot.get("symbol") != row.get("Ticker") or snapshot.get("base_session") != base or snapshot.get("calendar") != CALENDAR["version"]:
        return result("unknown", "snapshot_identity_mismatch")
    if not isinstance(snapshot.get("target_sessions"), list) or snapshot["target_sessions"][:len(targets)] != targets:
        return result("unknown", "target_sessions_mismatch")
    if not positive(snapshot.get("base_price")) or snapshot.get("price_basis") != SETTLEMENT_BASIS or not snapshot.get("source"):
        return result("unknown", "price_provenance_missing")
    observed = timestamp(snapshot.get("source_observed_at"))
    frozen = timestamp(snapshot.get("frozen_at"))
    if not observed or not frozen or timestamp(snapshot.get("generated_at")) != generated:
        return result("unknown", "snapshot_time_missing")
    if observed < times[1] + timedelta(minutes=15):
        return result("ineligible", "source_close_unconfirmed")
    if not observed <= generated <= frozen or frozen > (now or datetime.now(timezone.utc)):
        return result("unknown", "snapshot_time_order_invalid")
    if frozen >= first_open:
        return result("ineligible", "published_after_target_open")
    return result("eligible", "qualified")


def outcome_eligible(row: dict, horizon: str, now: datetime | None = None) -> bool:
    if qualify(row, horizon, now)["status"] != "eligible":
        return False
    s = row["Evaluation_Snapshot"]
    evidence = row.get("Outcome_Evidence")
    proof = evidence.get(horizon, {}) if isinstance(evidence, dict) else {}
    if not isinstance(proof, dict):
        return False
    target = s["target_sessions"][HORIZONS[horizon] - 1]
    observed = timestamp(proof.get("source_observed_at"))
    return (row.get(f"Actual_{horizon}_Date") == target and proof.get("target_session") == target
            and proof.get("base_price") == s["base_price"] and positive(proof.get("actual_price"))
            and proof.get("price_basis") == s["price_basis"] and proof.get("source") == s["source"]
            and observed is not None and session(target)[1] + timedelta(minutes=15) <= observed <= (now or datetime.now(timezone.utc)))
