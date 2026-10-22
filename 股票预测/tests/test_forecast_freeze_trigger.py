from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from scripts.forecast_freeze_trigger import parse_symbols, publication_window, qualified_row, run


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def eligible(day: str) -> dict:
    return {"As_Of_Date": day, "Created_At": f"{day}T21:00:00Z", "Time_Eligibility": {"1D": {"status": "eligible", "protocol": "frozen-close-v1"}}}


class FakeSite:
    def __init__(self, records: dict[str, list[dict]], failing: set[str] = frozenset()) -> None:
        self.records, self.failing, self.urls = records, failing, []

    def __call__(self, url: str) -> dict:
        self.urls.append(url)
        symbol = url.split("symbol=")[1].split("&")[0] if "forecast/latest" in url else url.split("/history/")[1].split("?")[0]
        if symbol in self.failing:
            raise OSError("provider unavailable")
        if "forecast/latest" in url:
            return {"data": {"data_as_of": "2026-10-21", "publication_pending": not self.records.get(symbol)}}
        return {"data": {"live": {"records": self.records.get(symbol, [])}}}


class PublicationWindowTests(unittest.TestCase):
    def test_window_opens_15_minutes_after_the_close_and_ends_at_the_next_open(self) -> None:
        self.assertIsNone(publication_window(utc("2026-10-21T19:59:00Z")))  # 15:59 ET, session open
        self.assertIsNone(publication_window(utc("2026-10-21T20:14:59Z")))  # before close confirmation
        self.assertEqual(publication_window(utc("2026-10-21T20:15:00Z"))[0], "2026-10-21")
        self.assertEqual(publication_window(utc("2026-10-22T13:29:59Z"))[0], "2026-10-21")
        self.assertIsNone(publication_window(utc("2026-10-22T13:30:00Z")))  # next session opened

    def test_weekends_holidays_and_early_closes_use_the_reviewed_calendar(self) -> None:
        self.assertEqual(publication_window(utc("2026-10-24T15:00:00Z"))[0], "2026-10-23")  # Saturday
        self.assertEqual(publication_window(utc("2026-11-26T18:00:00Z"))[0], "2026-11-25")  # Thanksgiving
        self.assertIsNone(publication_window(utc("2026-11-27T18:10:00Z")))  # 13:10 EST, early close + <15m
        self.assertEqual(publication_window(utc("2026-11-27T18:20:00Z"))[0], "2026-11-27")

    def test_est_schedule_slot_before_the_close_is_a_no_op(self) -> None:
        self.assertIsNone(publication_window(utc("2026-11-02T20:40:00Z")))  # 15:40 EST


class TriggerTests(unittest.TestCase):
    def test_symbols_are_validated_and_deduplicated(self) -> None:
        self.assertEqual(parse_symbols("spy, QQQ nvda,SPY"), ["SPY", "QQQ", "NVDA"])
        with self.assertRaises(ValueError):
            parse_symbols("SPY;rm -rf")

    def test_only_an_eligible_frozen_close_row_for_the_base_counts(self) -> None:
        intraday = {"As_Of_Date": "2026-10-21", "Time_Eligibility": {"1D": {"status": "ineligible", "protocol": "frozen-close-v1"}}}
        other_protocol = {**eligible("2026-10-21"), "Time_Eligibility": {"1D": {"status": "eligible", "protocol": "v0"}}}
        self.assertIsNone(qualified_row([intraday, other_protocol, eligible("2026-10-20")], "2026-10-21"))
        self.assertEqual(qualified_row([intraday, eligible("2026-10-21")], "2026-10-21")["As_Of_Date"], "2026-10-21")

    def test_outside_the_window_nothing_is_requested(self) -> None:
        site = FakeSite({})
        code, lines = run(["SPY"], "https://site", utc("2026-10-21T18:00:00Z"), site, timedelta(hours=4), pause=0)
        self.assertEqual((code, site.urls), (0, []))
        self.assertIn("outside", lines[0])

    def test_requests_forecast_then_history_and_skips_unreviewed_symbols(self) -> None:
        site = FakeSite({"SPY": [eligible("2026-10-21")]})
        code, lines = run(["SPY", "AAPL"], "https://site", utc("2026-10-21T20:40:00Z"), site, timedelta(hours=4), pause=0)
        self.assertEqual(code, 0)
        self.assertEqual(len(site.urls), 2)
        self.assertIn("/api/forecast/latest?symbol=SPY&contract=frozen-close-v1&_trigger=2026-10-21-", site.urls[0])
        self.assertTrue(site.urls[1].endswith("/api/predictions/history/SPY?contract=frozen-close-v1"))
        self.assertTrue(any("AAPL" in line and "skipped" in line for line in lines))

    def test_missing_records_fail_only_on_a_late_run(self) -> None:
        site = FakeSite({"SPY": [eligible("2026-10-21")]}, failing={"QQQ"})
        early, _ = run(["SPY", "QQQ", "NVDA"], "https://site", utc("2026-10-21T22:40:00Z"), site, timedelta(hours=4), pause=0)
        late, lines = run(["SPY", "QQQ", "NVDA"], "https://site", utc("2026-10-22T01:40:00Z"), site, timedelta(hours=4), pause=0)
        self.assertEqual((early, late), (0, 1))
        self.assertTrue(any("Missing qualified records: QQQ, NVDA" in line for line in lines))
        self.assertTrue(any("QQQ" in line and "OSError" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
