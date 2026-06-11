from __future__ import annotations

import unittest

from src.forecast_text import forecast_sentence


class ForecastTextTests(unittest.TestCase):
    def test_forecast_sentence_shows_direction_and_absolute_change(self) -> None:
        text = forecast_sentence(
            {
                "Forecast_1D_Return": 0.0123,
                "Forecast_5D_Return": -0.0456,
            }
        )

        self.assertEqual(text, "预计明日上涨 1.23%；预计未来五日下降 4.56%。")


if __name__ == "__main__":
    unittest.main()
