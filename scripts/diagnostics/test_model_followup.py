import unittest
from model_followup import summary, timing_screen, cloud_stats


def row(**changes):
    value = {"Ticker": "SPY", "As_Of_Date": "2026-09-02", "Actual_1D_Date": "2026-09-03",
             "Created_At": "2026-09-03T08:00:00+08:00", "Actual_1D_Return": -.01,
             "Forecast_1D_Return": .01, "Raw_Direction_Correct": 0, "Best_Model": "ARIMA"}
    return {**value, **changes}


class DiagnosticTests(unittest.TestCase):
    def test_missing_outcome_is_not_a_failed_prediction(self):
        result = summary([row(), row(Actual_1D_Return=None, Raw_Direction_Correct=None)])
        self.assertEqual(result["n"], 1)
        self.assertEqual(result["accuracy"], 0)
        self.assertEqual(result["majority_baseline"], 100)

    def test_assets_on_one_date_are_not_independent_days(self):
        result = summary([row(), row(Ticker="QQQ")])
        self.assertEqual(result["n"], 2)
        self.assertEqual(result["distinct_as_of_dates"], 1)

    def test_timing_compares_timezone_aware_instants(self):
        # 04:00 +08 is previous day 16:00 New York, not late under the 17:00 screen.
        data = [row(Created_At="2026-09-04T04:00:00+08:00"),
                row(Created_At="2026-09-04T08:00:00+08:00")]
        self.assertEqual(timing_screen(data)["flagged"], 1)
        self.assertEqual(timing_screen([row(Ticker="USDCNY=X")])["examined"], 0)

    def test_missing_timezone_is_not_inferred(self):
        with self.assertRaises(ValueError):
            timing_screen([row(Created_At="2026-09-04T08:00:00")])

    def test_different_dates_do_not_form_a_model_pair(self):
        rows = [row(Best_Model="Orivane Horizon Router"),
                row(Best_Model="Orivane Ensemble Safe Mode", As_Of_Date="2026-09-03")]
        self.assertEqual(cloud_stats(rows)["router_safe_same_asset_date_pairs"], 0)


if __name__ == "__main__":
    unittest.main()
