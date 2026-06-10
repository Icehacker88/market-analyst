from __future__ import annotations

import unittest

import pandas as pd

from src.models import _rank_metrics, actionable_signal, classify_signal_quality


class RankMetricsTests(unittest.TestCase):
    def test_direction_edge_candidate_is_preferred(self) -> None:
        metrics = pd.DataFrame(
            [
                {
                    "Model": "Low MAPE",
                    "CV_Directional_Accuracy": 58.0,
                    "CV_Directional_Edge": 0.0,
                    "CV_Balanced_Accuracy": 50.0,
                    "MAPE": 0.5,
                    "Return_RMSE": 0.01,
                    "Directional_Accuracy": 58.0,
                },
                {
                    "Model": "Direction Edge",
                    "CV_Directional_Accuracy": 57.0,
                    "CV_Directional_Edge": 3.0,
                    "CV_Balanced_Accuracy": 56.0,
                    "MAPE": 0.8,
                    "Return_RMSE": 0.02,
                    "Directional_Accuracy": 60.0,
                },
            ]
        )

        ranked = _rank_metrics(metrics)

        self.assertEqual(ranked.iloc[0]["Model"], "Direction Edge")

    def test_lowest_mape_is_preferred_when_no_model_has_direction_edge(self) -> None:
        metrics = pd.DataFrame(
            [
                {
                    "Model": "Higher CV Accuracy",
                    "CV_Directional_Accuracy": 58.0,
                    "CV_Directional_Edge": 0.0,
                    "CV_Balanced_Accuracy": 50.0,
                    "MAPE": 0.8,
                    "Return_RMSE": 0.02,
                    "Directional_Accuracy": 58.0,
                },
                {
                    "Model": "Lower MAPE",
                    "CV_Directional_Accuracy": 50.0,
                    "CV_Directional_Edge": -5.0,
                    "CV_Balanced_Accuracy": 50.0,
                    "MAPE": 0.5,
                    "Return_RMSE": 0.01,
                    "Directional_Accuracy": 50.0,
                },
            ]
        )

        ranked = _rank_metrics(metrics)

        self.assertEqual(ranked.iloc[0]["Model"], "Lower MAPE")

    def test_balanced_accuracy_breaks_direction_candidate_tie(self) -> None:
        metrics = pd.DataFrame(
            [
                {
                    "Model": "Lower Balanced",
                    "CV_Directional_Accuracy": 58.0,
                    "CV_Directional_Edge": 2.0,
                    "CV_Balanced_Accuracy": 53.0,
                    "MAPE": 0.5,
                    "Return_RMSE": 0.01,
                    "Directional_Accuracy": 58.0,
                },
                {
                    "Model": "Higher Balanced",
                    "CV_Directional_Accuracy": 58.0,
                    "CV_Directional_Edge": 2.0,
                    "CV_Balanced_Accuracy": 54.0,
                    "MAPE": 0.8,
                    "Return_RMSE": 0.02,
                    "Directional_Accuracy": 60.0,
                },
            ]
        )

        ranked = _rank_metrics(metrics)

        self.assertEqual(ranked.iloc[0]["Model"], "Higher Balanced")


class SignalQualityTests(unittest.TestCase):
    def test_high_quality_signal_uses_validation_only(self) -> None:
        quality = classify_signal_quality(
            {
                "CV_Directional_Edge": 2.5,
                "CV_Balanced_Accuracy": 54.0,
                "Directional_Edge": -10.0,
            }
        )

        self.assertEqual(quality, "High")
        self.assertEqual(actionable_signal("Down", quality), "Down")

    def test_low_quality_signal_becomes_observe(self) -> None:
        quality = classify_signal_quality(
            {
                "CV_Directional_Edge": -1.0,
                "CV_Balanced_Accuracy": 51.0,
                "Directional_Edge": 4.0,
            }
        )

        self.assertEqual(quality, "Low")
        self.assertEqual(actionable_signal("Up", quality), "Observe")


if __name__ == "__main__":
    unittest.main()
