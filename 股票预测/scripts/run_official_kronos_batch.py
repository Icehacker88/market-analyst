#!/usr/bin/env python3
"""Run the official NeoQuasar Kronos model and upload dated forecasts to Orivane."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_SITE_URL = "https://orivane-market-intelligence.pages.dev"
DEFAULT_SYMBOLS = [
    "SPY", "QQQ", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "PLTR", "AVGO", "AMD", "TSM", "META", "TSLA", "NFLX", "ORCL", "CRM", "COIN", "HOOD", "MSTR", "SMCI", "ARM", "MU", "LLY", "BIDU", "BABA", "PDD", "JD", "NIO", "XPEV", "LI", "TME", "NTES", "BILI", "BEKE", "FUTU",
    "SOXX", "SMH", "IGV", "ARKK", "XBI", "GLD", "SLV", "IBIT", "QQQM", "^IXIC", "^NDX", "NQ=F", "MNQ=F", "^VIX",
    "600519.SH", "000001.SZ", "300965.SZ", "300750.SZ", "002594.SZ", "601318.SH", "000858.SZ", "016452.OF",
    "0700.HK", "9988.HK", "3690.HK", "9618.HK", "1211.HK", "1299.HK", "0388.HK", "1024.HK", "1810.HK", "9999.HK",
]
MODEL_ID = "NeoQuasar/Kronos-mini"
TOKENIZER_ID = "NeoQuasar/Kronos-Tokenizer-2k"


def request_json(url: str, method: str = "GET", payload: Any | None = None, token: str | None = None, timeout: int = 90) -> Any:
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Accept": "application/json", "User-Agent": "Orivane-Kronos/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def resolve_assets(site_url: str, symbols: list[str]) -> dict[str, dict[str, Any]]:
    payload = request_json(f"{site_url}/api/assets/resolve", "POST", {"symbols": symbols})
    return {str(item["symbol"]).upper(): item for item in payload.get("assets", [])}


def fetch_history(site_url: str, asset: dict[str, Any]) -> dict[str, Any]:
    start = (datetime.now(timezone.utc) - timedelta(days=1500)).date().isoformat()
    query = urllib.parse.urlencode({
        "symbol": asset["symbol"],
        "start": start,
        "data_source": asset.get("data_source", "yahoo"),
        "asset_type": asset.get("asset_type", "stock"),
    })
    return request_json(f"{site_url}/api/market/history?{query}").get("data", {})


def prepare_frame(history: dict[str, Any], lookback: int):
    import pandas as pd

    records = sorted(history.get("records", []), key=lambda row: str(row.get("Date", "")))
    rows: list[dict[str, float | str]] = []
    for row in records:
        close = float(row.get("Close") or row.get("Price") or 0)
        if not math.isfinite(close) or close <= 0:
            continue
        open_price = float(row.get("Open") or close)
        high = max(float(row.get("High") or close), open_price, close)
        low = min(float(row.get("Low") or close), open_price, close)
        volume = max(0.0, float(row.get("Volume") or 0))
        rows.append({"date": str(row["Date"]), "open": open_price, "high": high, "low": low, "close": close, "volume": volume, "amount": volume * (open_price + high + low + close) / 4})
    if len(rows) < max(90, lookback):
        raise ValueError(f"only {len(rows)} valid candles")
    rows = rows[-lookback:]
    frame = pd.DataFrame(rows).set_index(pd.to_datetime([row["date"] for row in rows]))
    frame = frame[["open", "high", "low", "close", "volume", "amount"]]
    future = pd.bdate_range(frame.index[-1] + pd.Timedelta(days=1), periods=22)
    return frame, future


def clipped_return(base_price: float, predicted_price: float, volatility: float, days: int) -> float:
    raw = predicted_price / base_price - 1
    cap = min(0.8, max(0.03, volatility * math.sqrt(days) * 3.0))
    return max(-cap, min(cap, raw))


def build_record(symbol: str, history: dict[str, Any], frame, future, prediction, lookback: int, sample_count: int) -> dict[str, Any]:
    import pandas as pd

    prediction = prediction.copy()
    prediction.index = future
    base_price = float(frame["close"].iloc[-1])
    volatility = float(frame["close"].pct_change().tail(20).std() or 0.012)
    closes = prediction["close"].astype(float)
    for value in closes:
        if not math.isfinite(value) or value <= 0:
            raise ValueError("official Kronos returned an invalid close")
    horizon_prices = {1: closes.iloc[0], 5: closes.iloc[4], 10: closes.iloc[9], 22: closes.iloc[21]}
    path = []
    for timestamp, row in prediction.iloc[:22].iterrows():
        path.append({
            "date": pd.Timestamp(timestamp).date().isoformat(),
            "open": round(float(row["open"]), 6),
            "high": round(float(row["high"]), 6),
            "low": round(float(row["low"]), 6),
            "close": round(float(row["close"]), 6),
            "volume": round(max(0.0, float(row.get("volume", 0))), 2),
        })
    return {
        "schema_version": "orivane-kronos-v1",
        "source": "official_kronos",
        "symbol": symbol,
        "model_id": MODEL_ID,
        "tokenizer_id": TOKENIZER_ID,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data_as_of": str(history.get("data_as_of") or frame.index[-1].date()),
        "base_price": base_price,
        "lookback": lookback,
        "prediction_length": 22,
        "sample_count": sample_count,
        "forecast_1d_return": clipped_return(base_price, float(horizon_prices[1]), volatility, 1),
        "forecast_5d_return": clipped_return(base_price, float(horizon_prices[5]), volatility, 5),
        "forecast_10d_return": clipped_return(base_price, float(horizon_prices[10]), volatility, 10),
        "forecast_1m_return": clipped_return(base_price, float(horizon_prices[22]), volatility, 22),
        "forecast_path": path,
    }


def load_predictor(kronos_repo: Path, device: str, lookback: int):
    sys.path.insert(0, str(kronos_repo))
    from model import Kronos, KronosPredictor, KronosTokenizer

    tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
    model = Kronos.from_pretrained(MODEL_ID)
    return KronosPredictor(model, tokenizer, device=device, max_context=lookback)


def run(args: argparse.Namespace) -> dict[str, Any]:
    import torch

    torch.manual_seed(args.seed)
    site_url = args.site_url.rstrip("/")
    symbols = [item.strip().upper() for item in (args.symbols.split(",") if args.symbols else DEFAULT_SYMBOLS) if item.strip()]
    assets = resolve_assets(site_url, symbols)
    predictor = load_predictor(Path(args.kronos_repo).expanduser().resolve(), args.device, args.lookback)
    forecasts: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for offset in range(0, len(symbols), args.batch_size):
        batch_symbols = symbols[offset:offset + args.batch_size]
        prepared = []
        for symbol in batch_symbols:
            try:
                asset = assets[symbol]
                history = fetch_history(site_url, asset)
                frame, future = prepare_frame(history, args.lookback)
                prepared.append((symbol, history, frame, future))
            except Exception as exc:  # noqa: BLE001
                errors.append({"symbol": symbol, "error": str(exc)})
        if not prepared:
            continue
        try:
            predictions = predictor.predict_batch(
                [item[2] for item in prepared],
                [item[2].index for item in prepared],
                [item[3] for item in prepared],
                pred_len=22,
                T=args.temperature,
                top_p=args.top_p,
                sample_count=args.sample_count,
                verbose=False,
            )
            for item, prediction in zip(prepared, predictions, strict=True):
                forecasts.append(build_record(item[0], item[1], item[2], item[3], prediction, args.lookback, args.sample_count))
        except Exception as exc:  # noqa: BLE001
            for symbol, history, frame, future in prepared:
                try:
                    prediction = predictor.predict(frame, frame.index, future, 22, T=args.temperature, top_p=args.top_p, sample_count=args.sample_count, verbose=False)
                    forecasts.append(build_record(symbol, history, frame, future, prediction, args.lookback, args.sample_count))
                except Exception as single_exc:  # noqa: BLE001
                    errors.append({"symbol": symbol, "error": f"{exc}; retry: {single_exc}"})
    result = {"generated_at": datetime.now(timezone.utc).isoformat(), "forecasts": forecasts, "errors": errors}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.upload and forecasts:
        token = os.environ.get("ORIVANE_GITHUB_OIDC_TOKEN") or os.environ.get("ORIVANE_OPTIMIZER_TOKEN")
        if not token:
            raise RuntimeError("ORIVANE_GITHUB_OIDC_TOKEN or ORIVANE_OPTIMIZER_TOKEN is required for upload")
        result["upload"] = request_json(f"{site_url}/api/kronos/batch", "POST", {"forecasts": forecasts}, token=token, timeout=180)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-url", default=DEFAULT_SITE_URL)
    parser.add_argument("--kronos-repo", default=os.environ.get("KRONOS_REPO", "~/.cache/orivane-kronos/repo"))
    parser.add_argument("--symbols", default="")
    parser.add_argument("--lookback", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--sample-count", type=int, default=1)
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--seed", type=int, default=20260716)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", default="output/kronos/official-kronos-latest.json")
    parser.add_argument("--upload", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args()


if __name__ == "__main__":
    try:
        payload = run(parse_args())
        print(json.dumps({"forecast_count": len(payload["forecasts"]), "error_count": len(payload["errors"]), "upload": payload.get("upload")}, ensure_ascii=False))
    except (urllib.error.URLError, RuntimeError, ValueError, KeyError) as exc:
        raise SystemExit(str(exc)) from exc
