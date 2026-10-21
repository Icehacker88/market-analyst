from __future__ import annotations

import unittest

from src.forecast_text import arima_fallback_text, forecast_sentence
from src.daily_report import _all_asset_forecasts
from src.email_report import _prediction_row
import pandas as pd


class ForecastTextTests(unittest.TestCase):
    def test_forecast_sentence_shows_direction_and_absolute_change(self) -> None:
        text = forecast_sentence(
            {
                "Forecast_1D_Return": 0.0123,
                "Forecast_5D_Return": -0.0456,
            }
        )

        self.assertEqual(text, "预计明日上涨 1.23%；预计未来五日下降 4.56%。")


    def test_daily_markdown_and_email_show_arima_candidate_fallback_ratio(self) -> None:
        row = pd.Series({"Ticker": "SPY", "Best_Model": "Baseline", "ARIMA_CV_Fallback_Count": 22,
                         "ARIMA_CV_Samples": 100, "Forecast_1D_Return": .01, "Forecast_5D_Return": .02})
        expected = "ARIMA 验证回退：22/100（22.0%）"
        self.assertIn(expected, _all_asset_forecasts(pd.DataFrame([row])))
        self.assertIn(expected, _prediction_row(row))
        self.assertIn("中位数基线", arima_fallback_text(row))
        for missing in ({}, {"ARIMA_CV_Fallback_Count": 0, "ARIMA_CV_Samples": 0},
                        {"ARIMA_CV_Fallback_Count": float("nan"), "ARIMA_CV_Samples": 100}):
            self.assertEqual(arima_fallback_text(missing), "ARIMA 验证回退比例：暂无数据。")


if __name__ == "__main__":
    unittest.main()
