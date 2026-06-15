from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch

from src.trading_session import (
    expected_latest_session_date,
    latest_recorded_session_date,
    should_generate_scheduled_report,
    workflow_decision,
)


class TradingSessionTests(unittest.TestCase):
    def test_expected_session_uses_new_york_date(self):
        now = datetime(2026, 6, 15, 0, 30, tzinfo=timezone.utc)

        self.assertEqual(expected_latest_session_date(now), date(2026, 6, 14))

    def test_skips_when_no_new_us_session_exists(self):
        self.assertFalse(
            should_generate_scheduled_report(date(2026, 6, 12), date(2026, 6, 12))
        )

    def test_sends_when_latest_session_matches_new_york_date(self):
        self.assertTrue(
            should_generate_scheduled_report(date(2026, 6, 15), date(2026, 6, 12))
        )

    def test_sends_when_ledger_does_not_exist(self):
        self.assertTrue(should_generate_scheduled_report(date(2026, 6, 15), None))

    def test_reads_latest_recorded_ndx_session(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "ledger.csv"
            path.write_text(
                "As_Of_Date,Ticker\n"
                "2026-06-11,^NDX\n"
                "2026-06-12,SPY\n"
                "2026-06-12,^NDX\n",
                encoding="utf-8",
            )

            self.assertEqual(latest_recorded_session_date(path), date(2026, 6, 12))

    def test_manual_run_can_override_closed_market_gate(self):
        send, message = workflow_decision("workflow_dispatch")

        self.assertTrue(send)
        self.assertIn("手动运行", message)

    @patch("src.trading_session.latest_recorded_session_date")
    @patch("src.trading_session.fetch_latest_session_date")
    def test_scheduled_run_reports_skip_reason(self, fetch_latest, recorded_latest):
        fetch_latest.return_value = date(2026, 6, 12)
        recorded_latest.return_value = date(2026, 6, 12)

        send, message = workflow_decision("schedule")

        self.assertFalse(send)
        self.assertIn("最新 2026-06-12", message)


if __name__ == "__main__":
    unittest.main()
