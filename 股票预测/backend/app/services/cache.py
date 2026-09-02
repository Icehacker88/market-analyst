from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from app.core.config import CACHE_ROOT, CACHE_VERSION
from app.core.json_utils import safe_json


class DiskCache:
    def __init__(self, root: Path = CACHE_ROOT) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def get(self, namespace: str, payload: dict[str, Any], ttl_seconds: int) -> Any | None:
        path = self._path(namespace, payload)
        if not path.exists() or time.time() - path.stat().st_mtime > ttl_seconds:
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))["data"]
        except (OSError, KeyError, json.JSONDecodeError):
            return None

    def set(self, namespace: str, payload: dict[str, Any], data: Any) -> None:
        path = self._path(namespace, payload)
        body = {
            "cache_version": CACHE_VERSION,
            "generated_at": time.time(),
            "data": safe_json(data),
        }
        path.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")

    def last_updated(self) -> str | None:
        files = list(self.root.glob("*.json"))
        if not files:
            return None
        return time.strftime(
            "%Y-%m-%dT%H:%M:%S%z",
            time.localtime(max(path.stat().st_mtime for path in files)),
        )

    def _path(self, namespace: str, payload: dict[str, Any]) -> Path:
        raw = json.dumps(
            {"version": CACHE_VERSION, **safe_json(payload)},
            sort_keys=True,
            ensure_ascii=True,
        )
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
        return self.root / f"{namespace}-{digest}.json"
