from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Callable

from app.core.config import OUTPUTS_ROOT
from app.core.json_utils import safe_json
from src.pipeline import run_many


Runner = Callable[[str, str, str, bool], str]


class TaskManager:
    def __init__(self, runner: Runner | None = None) -> None:
        self.runner = runner or self._run_prediction
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="forecast")
        self.lock = threading.Lock()
        self.tasks: dict[str, dict[str, object]] = {}
        self.active_by_symbol: dict[str, str] = {}

    def submit(self, symbol: str, data_source: str, asset_type: str, start: str, include_arima: bool) -> dict[str, object]:
        with self.lock:
            active_id = self.active_by_symbol.get(symbol)
            if active_id and self.tasks.get(active_id, {}).get("status") in {"queued", "running"}:
                return safe_json(self.tasks[active_id])
            task_id = uuid.uuid4().hex
            self.tasks[task_id] = {
                "task_id": task_id,
                "symbol": symbol,
                "status": "queued",
                "progress": 0,
                "stage": "等待运行",
                "created_at": datetime.now().isoformat(),
            }
            self.active_by_symbol[symbol] = task_id
            self.executor.submit(self._execute, task_id, symbol, data_source, asset_type, start, include_arima)
            return safe_json(self.tasks[task_id])

    def get(self, task_id: str) -> dict[str, object] | None:
        with self.lock:
            task = self.tasks.get(task_id)
            return safe_json(task) if task else None

    def _execute(self, task_id: str, symbol: str, data_source: str, asset_type: str, start: str, include_arima: bool) -> None:
        self._update(task_id, status="running", progress=15, stage="下载并清洗数据")
        try:
            result = self.runner(symbol, data_source, asset_type, start, include_arima)
            self._update(task_id, status="completed", progress=100, stage="完成", result=result, completed_at=datetime.now().isoformat())
        except Exception as exc:
            self._update(task_id, status="failed", progress=100, stage="失败", error=str(exc), completed_at=datetime.now().isoformat())

    def _update(self, task_id: str, **values: object) -> None:
        with self.lock:
            self.tasks[task_id].update(values)

    @staticmethod
    def _run_prediction(symbol: str, data_source: str, asset_type: str, start: str, include_arima: bool) -> str:
        paths = run_many(
            tickers=[symbol],
            start=start,
            end=None,
            output_root=Path(OUTPUTS_ROOT),
            include_arima=include_arima,
            data_source=data_source,
            asset_type="fund" if asset_type == "fund" else "market",
        )
        return str(paths[0].relative_to(OUTPUTS_ROOT.parent))
