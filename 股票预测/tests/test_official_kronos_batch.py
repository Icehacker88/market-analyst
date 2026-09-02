import importlib.util
import math
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "run_official_kronos_batch.py"
SPEC = importlib.util.spec_from_file_location("official_kronos_batch", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_clipped_return_limits_extreme_model_output():
    assert math.isclose(MODULE.clipped_return(100, 250, 0.01, 1), 0.03)
    assert math.isclose(MODULE.clipped_return(100, 50, 0.01, 1), -0.03)


def test_default_batch_uses_official_model_identity():
    assert MODULE.MODEL_ID == "NeoQuasar/Kronos-mini"
    assert MODULE.TOKENIZER_ID == "NeoQuasar/Kronos-Tokenizer-2k"
    assert "NVDA" in MODULE.DEFAULT_SYMBOLS


def test_asset_resolution_respects_compare_api_limit():
    symbols = [f"TEST{index}" for index in range(12)]
    calls = []

    def fake_request(url, method="GET", payload=None, token=None, timeout=90):
        del url, method, token, timeout
        calls.append(payload["symbols"])
        return {"assets": [{"symbol": symbol} for symbol in payload["symbols"]]}

    with mock.patch.object(MODULE, "request_json", side_effect=fake_request):
        assets = MODULE.resolve_assets("https://example.test", symbols)

    assert [len(batch) for batch in calls] == [5, 5, 2]
    assert set(assets) == set(symbols)


def test_timestamp_series_supports_official_kronos_datetime_accessors():
    timestamps = MODULE.timestamp_series(["2026-07-15", "2026-07-16"])

    assert timestamps.dt.day.tolist() == [15, 16]
