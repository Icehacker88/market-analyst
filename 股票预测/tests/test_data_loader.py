from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from src.data_loader import (
    DataLoadError,
    download_online_data,
    download_tushare_fund_nav,
    online_source_description,
)


class TushareDataLoaderTests(unittest.TestCase):
    @patch("src.data_loader.requests.post")
    def test_fund_nav_is_normalized_and_sorted(self, post: Mock) -> None:
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "code": 0,
            "msg": None,
            "data": {
                "fields": ["nav_date", "unit_nav", "accum_nav", "adj_nav"],
                "items": [
                    ["20260103", 1.03, 1.03, 1.03],
                    ["20260102", 1.01, 1.01, 1.01],
                ],
            },
        }
        post.return_value = response

        frame = download_tushare_fund_nav(
            "016452.OF",
            start="2026-01-01",
            end="2026-01-03",
            token="test-token",
        )

        self.assertEqual(frame["Date"].dt.strftime("%Y%m%d").tolist(), ["20260102", "20260103"])
        self.assertEqual(frame["NAV"].tolist(), [1.01, 1.03])
        request = post.call_args.kwargs["json"]
        self.assertEqual(request["api_name"], "fund_nav")
        self.assertEqual(request["params"]["ts_code"], "016452.OF")

    def test_tushare_requires_token(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(DataLoadError, "TUSHARE_TOKEN"):
                download_tushare_fund_nav("016452.OF")

    @patch("src.data_loader.download_tushare_fund_nav")
    def test_online_fund_routes_to_tushare(self, download: Mock) -> None:
        download.return_value = Mock()

        download_online_data(
            ticker="016452.OF",
            data_source="tushare",
            asset_type="fund",
        )

        download.assert_called_once()
        self.assertIn(
            "Tushare Pro fund_nav",
            online_source_description("tushare", "fund", "2022-11-29", None),
        )


if __name__ == "__main__":
    unittest.main()
