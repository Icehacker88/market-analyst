from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd

from src.data_loader import (
    DataLoadError,
    download_akshare_a_share,
    download_akshare_fund_nav,
    download_online_data,
    online_source_description,
)


class AkshareDataLoaderTests(unittest.TestCase):
    @patch("src.data_loader._load_akshare")
    def test_fund_nav_is_normalized_filtered_and_sorted(self, load: Mock) -> None:
        load.return_value = SimpleNamespace(
            fund_open_fund_info_em=Mock(
                return_value=pd.DataFrame(
                    {
                        "净值日期": ["2026-01-03", "2026-01-02", "2025-12-31"],
                        "单位净值": [1.03, 1.01, 0.99],
                        "日增长率": [1.98, 2.02, 0.0],
                    }
                )
            )
        )

        frame = download_akshare_fund_nav(
            "016452.OF",
            start="2026-01-01",
            end="2026-01-03",
        )

        self.assertEqual(frame["Date"].dt.strftime("%Y%m%d").tolist(), ["20260102", "20260103"])
        self.assertEqual(frame["NAV"].tolist(), [1.01, 1.03])
        load.return_value.fund_open_fund_info_em.assert_called_once_with(
            symbol="016452",
            indicator="单位净值走势",
        )

    @patch("src.data_loader._load_akshare")
    def test_a_share_uses_qfq_and_normalizes_columns(self, load: Mock) -> None:
        load.return_value = SimpleNamespace(
            stock_zh_a_hist=Mock(
                return_value=pd.DataFrame(
                    {
                        "日期": ["2026-01-02"],
                        "开盘": [100],
                        "最高": [102],
                        "最低": [99],
                        "收盘": [101],
                        "成交量": [1000],
                    }
                )
            )
        )

        frame = download_akshare_a_share(
            "600519.SH",
            start="2026-01-01",
            end="2026-01-03",
        )

        self.assertEqual(frame.iloc[0]["Close"], 101)
        load.return_value.stock_zh_a_hist.assert_called_once_with(
            symbol="600519",
            period="daily",
            start_date="20260101",
            end_date="20260103",
            adjust="qfq",
        )

    @patch("src.data_loader._load_akshare")
    def test_a_share_falls_back_to_tencent(self, load: Mock) -> None:
        load.return_value = SimpleNamespace(
            stock_zh_a_hist=Mock(side_effect=ConnectionError("eastmoney unavailable")),
            stock_zh_a_hist_tx=Mock(
                return_value=pd.DataFrame(
                    {
                        "date": ["2026-01-02"],
                        "open": [100],
                        "close": [101],
                        "high": [102],
                        "low": [99],
                        "amount": [1000],
                    }
                )
            ),
        )

        frame = download_akshare_a_share(
            "600519.SH",
            start="2026-01-01",
            end="2026-01-03",
        )

        self.assertEqual(frame.iloc[0]["Close"], 101)
        load.return_value.stock_zh_a_hist_tx.assert_called_once_with(
            symbol="sh600519",
            start_date="20260101",
            end_date="20260103",
            adjust="qfq",
            timeout=30,
        )

    @patch("src.data_loader.importlib.import_module", side_effect=ImportError)
    def test_akshare_missing_dependency_has_clear_error(self, _: Mock) -> None:
        with self.assertRaisesRegex(DataLoadError, "requirements-free-data.txt"):
            download_akshare_fund_nav("016452.OF")

    @patch("src.data_loader.download_akshare_fund_nav")
    def test_online_fund_routes_to_akshare(self, download: Mock) -> None:
        download.return_value = Mock()

        download_online_data(
            ticker="016452.OF",
            data_source="akshare",
            asset_type="fund",
        )

        download.assert_called_once()
        self.assertIn(
            "AKShare fund_open_fund_info_em",
            online_source_description("akshare", "fund", "2022-11-29", None),
        )


if __name__ == "__main__":
    unittest.main()
