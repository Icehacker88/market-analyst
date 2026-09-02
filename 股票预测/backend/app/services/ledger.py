from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.core.config import LEDGER_PATH
from app.core.json_utils import safe_json
from src.prediction_ledger import LEDGER_COLUMNS


class LedgerService:
    def load(self) -> pd.DataFrame:
        ledger = pd.read_csv(LEDGER_PATH) if LEDGER_PATH.exists() else pd.DataFrame()
        for column in LEDGER_COLUMNS:
            if column not in ledger:
                ledger[column] = pd.NA
        return ledger.reindex(columns=LEDGER_COLUMNS)

    def history(self, symbol: str) -> dict[str, Any]:
        ledger = self.load()
        scope = ledger[ledger["Ticker"].astype(str).str.upper() == symbol.upper()].copy()
        scope = scope.sort_values(["As_Of_Date", "Created_At"], ascending=False)
        records = []
        for _, row in scope.iterrows():
            forecast = _number(row.get("Forecast_1D_Return"))
            actual = _number(row.get("Actual_1D_Return"))
            records.append(
                {
                    **row.to_dict(),
                    "Verified": actual is not None,
                    "Return_Error": None if forecast is None or actual is None else actual - forecast,
                    "Absolute_Return_Error": None if forecast is None or actual is None else abs(actual - forecast),
                }
            )
        return safe_json(
            {
                "symbol": symbol,
                "notice": "历史预测准确率基于已完成验证的真实预测记录。尚未到目标日期的预测不计入准确率。",
                "statistics": self.statistics(scope),
                "records": records,
                "charts": self._charts(scope),
            }
        )

    def statistics(self, scope: pd.DataFrame) -> list[dict[str, Any]]:
        ordered = scope.sort_values("As_Of_Date")
        completed_all = ordered.dropna(subset=["Actual_1D_Return", "Raw_Direction_Correct"])
        rows = []
        for window in [20, 60, 120, None]:
            completed = completed_all if window is None else completed_all.tail(window)
            actual_direction = completed["Actual_1D_Direction"].dropna()
            up_rate = float((actual_direction == "Up").mean() * 100) if len(actual_direction) else np.nan
            baseline = max(up_rate, 100 - up_rate) if len(actual_direction) else np.nan
            accuracy = float(completed["Raw_Direction_Correct"].astype(float).mean() * 100) if len(completed) else np.nan
            forecast = pd.to_numeric(completed["Forecast_1D_Return"], errors="coerce")
            actual = pd.to_numeric(completed["Actual_1D_Return"], errors="coerce")
            errors = (actual - forecast).dropna().abs()
            rows.append(
                {
                    "window": "All" if window is None else str(window),
                    "completed": len(completed),
                    "pending": int(scope["Actual_1D_Return"].isna().sum()),
                    "direction_accuracy": accuracy,
                    "majority_baseline_accuracy": baseline,
                    "direction_edge": accuracy - baseline if len(completed) else np.nan,
                    "mean_absolute_return_error": float(errors.mean()) if len(errors) else np.nan,
                    "median_absolute_return_error": float(errors.median()) if len(errors) else np.nan,
                    "hit_count": int((completed["Raw_Direction_Correct"] == 1).sum()),
                    "miss_count": int((completed["Raw_Direction_Correct"] == 0).sum()),
                }
            )
        return safe_json(rows)

    def _charts(self, scope: pd.DataFrame) -> dict[str, Any]:
        completed = scope.dropna(subset=["Actual_1D_Return", "Forecast_1D_Return"]).sort_values("As_Of_Date").copy()
        if completed.empty:
            return {"scatter": [], "timeline": [], "rolling_accuracy": [], "errors": []}
        completed["Absolute_Error"] = (
            pd.to_numeric(completed["Actual_1D_Return"], errors="coerce")
            - pd.to_numeric(completed["Forecast_1D_Return"], errors="coerce")
        ).abs()
        completed["Rolling_Accuracy_20"] = (
            pd.to_numeric(completed["Raw_Direction_Correct"], errors="coerce")
            .rolling(20, min_periods=1)
            .mean()
            * 100
        )
        completed["Cumulative_Accuracy"] = (
            pd.to_numeric(completed["Raw_Direction_Correct"], errors="coerce")
            .expanding()
            .mean()
            * 100
        )
        return safe_json(
            {
                "scatter": completed[["As_Of_Date", "Forecast_1D_Return", "Actual_1D_Return", "Best_Model"]].to_dict("records"),
                "timeline": completed[["As_Of_Date", "Raw_Direction_Correct", "Raw_Direction", "Actual_1D_Direction"]].to_dict("records"),
                "rolling_accuracy": completed[["As_Of_Date", "Rolling_Accuracy_20", "Cumulative_Accuracy"]].to_dict("records"),
                "errors": completed[["As_Of_Date", "Absolute_Error", "Best_Model"]].to_dict("records"),
            }
        )


def _number(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)
