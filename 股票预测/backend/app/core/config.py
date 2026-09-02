from __future__ import annotations

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = PROJECT_ROOT / "backend"
OUTPUTS_ROOT = PROJECT_ROOT / "outputs"
LEDGER_PATH = PROJECT_ROOT / "data" / "history" / "prediction_ledger.csv"
CACHE_ROOT = Path(os.getenv("MARKET_CACHE_DIR", BACKEND_ROOT / "data" / "cache"))
CACHE_VERSION = "web-v1"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def cors_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [item.strip() for item in raw.split(",") if item.strip()]
