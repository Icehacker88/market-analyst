from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunConfig:
    ticker: str
    output_dir: Path
    train_ratio: float = 0.8
    forecast_days: int = 5
    include_arima: bool = True


FEATURE_WINDOWS = (5, 10, 20, 50)
LAG_WINDOWS = (1, 3, 5, 10)
ROLLING_WINDOWS = (5, 10, 20)

