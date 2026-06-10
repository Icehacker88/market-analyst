from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from src.risk_model import build_risk_dataset, risk_status


class RiskModelTests(unittest.TestCase):
    def test_risk_dataset_excludes_future_targets_from_features(self) -> None:
        rng = np.random.default_rng(42)
        returns = np.tile(
            np.concatenate([rng.normal(0, 0.004, 30), rng.normal(0, 0.02, 30)]),
            6,
        )
        prices = 100 * np.exp(np.cumsum(returns))
        cleaned = pd.DataFrame(
            {
                "Date": pd.date_range("2024-01-01", periods=len(prices), freq="B"),
                "Close": prices,
                "Adj Close": prices,
                "Volume": np.full(len(prices), 1_000_000),
                "Price": prices,
            }
        )

        data, features = build_risk_dataset(cleaned)

        self.assertGreater(len(data), 200)
        self.assertNotIn("Target_Realized_Vol", features)
        self.assertNotIn("Target_High_Risk", features)
        self.assertGreater(data["Target_High_Risk"].nunique(), 1)

    def test_risk_status_thresholds(self) -> None:
        self.assertEqual(risk_status(0.49), "Normal")
        self.assertEqual(risk_status(0.50), "Elevated")
        self.assertEqual(risk_status(0.65), "High")


if __name__ == "__main__":
    unittest.main()
