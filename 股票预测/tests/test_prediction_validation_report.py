from __future__ import annotations

import unittest

import pandas as pd

from src.daily_report import _validation_summary
from src.email_report import _validation_table


class PredictionValidationReportTests(unittest.TestCase):
    def test_validation_is_rendered_in_markdown_and_html(self) -> None:
        validation = pd.DataFrame(
            [
                {
                    "Prediction_Date": "2026-06-10",
                    "Actual_Date": "2026-06-11",
                    "Ticker": "SPY",
                    "Forecast_Return": 0.002,
                    "Actual_Return": -0.003,
                    "Return_Error": -0.005,
                    "Absolute_Return_Error": 0.005,
                    "Forecast_Direction": "Up",
                    "Actual_Direction": "Down",
                    "Direction_Correct": 0,
                }
            ]
        )

        markdown = _validation_summary(validation)
        html = _validation_table(validation)

        self.assertIn("预计 +0.20%，实际 -0.30%", markdown)
        self.assertIn("方向验证错误", markdown)
        self.assertIn("方向准确率 0.00%", markdown)
        self.assertIn("预测收益", html)
        self.assertIn("错误", html)
        self.assertIn("平均绝对收益误差 0.50%", html)


if __name__ == "__main__":
    unittest.main()
