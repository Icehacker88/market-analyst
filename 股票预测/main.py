from __future__ import annotations

import argparse
from pathlib import Path

from src.daily_report import run_daily_report
from src.pipeline import run_many, run_single


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="多资产预测分析工具：支持本地 CSV、市场行情和基金净值数据。"
    )
    source = parser.add_mutually_exclusive_group(required=False)
    source.add_argument("--input", help="本地 CSV 文件路径，例如 data/raw/AAPL.csv")
    source.add_argument(
        "--ticker",
        help="单个资产代码，例如 SPY、600519.SH 或 016452.OF",
    )
    source.add_argument(
        "--tickers",
        nargs="+",
        help="多个同类型资产代码，例如 AAPL MSFT SPY 或 016452.OF 016453.OF",
    )
    parser.add_argument("--start", default="2016-01-01", help="在线数据开始日期")
    parser.add_argument("--end", default=None, help="在线数据结束日期，默认今天")
    parser.add_argument(
        "--data-source",
        choices=["yahoo", "akshare"],
        default="yahoo",
        help="在线数据源，默认 yahoo；akshare 免费且无需Token。",
    )
    parser.add_argument(
        "--asset-type",
        choices=["market", "fund"],
        default="market",
        help="在线资产类型：market 为股票/ETF/指数，fund 为公募基金净值。",
    )
    parser.add_argument(
        "--output-dir",
        default="outputs",
        help="结果输出目录，默认 outputs",
    )
    parser.add_argument(
        "--train-ratio",
        default=0.8,
        type=float,
        help="按时间顺序划分训练集比例，默认 0.8",
    )
    parser.add_argument(
        "--forecast-days",
        default=5,
        type=int,
        help="未来滚动预测天数，默认 5",
    )
    parser.add_argument(
        "--skip-arima",
        action="store_true",
        help="跳过 ARIMA，可用于加快运行速度",
    )
    parser.add_argument(
        "--daily-report",
        action="store_true",
        help="生成专业投资日报：市场分析、新闻、GPT/本地中文解读、邮件发送。",
    )
    parser.add_argument(
        "--market-start",
        default="2024-01-01",
        help="投资日报市场数据开始日期，默认 2024-01-01。",
    )
    parser.add_argument(
        "--news-hours",
        default=24,
        type=int,
        help="投资日报新闻回看小时数，默认 24。",
    )
    parser.add_argument(
        "--email-to",
        nargs="*",
        help="日报收件邮箱；也可用环境变量 REPORT_EMAIL_TO，多个邮箱用逗号分隔。",
    )
    parser.add_argument(
        "--ledger-path",
        default="data/history/prediction_ledger.csv",
        help="每日真实预测账本路径。",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)

    if args.daily_report:
        run_daily_report(
            output_root=output_dir,
            market_start=args.market_start,
            end=args.end,
            train_ratio=args.train_ratio,
            forecast_days=args.forecast_days,
            include_arima=not args.skip_arima,
            news_hours=args.news_hours,
            email_to=args.email_to,
            ledger_path=Path(args.ledger_path),
        )
        return

    if args.input:
        run_single(
            input_path=Path(args.input),
            output_root=output_dir,
            train_ratio=args.train_ratio,
            forecast_days=args.forecast_days,
            include_arima=not args.skip_arima,
        )
        return

    if not args.ticker and not args.tickers:
        raise SystemExit("请提供 --input、--ticker、--tickers，或使用 --daily-report。")

    tickers = args.tickers if args.tickers else [args.ticker]
    run_many(
        tickers=tickers,
        start=args.start,
        end=args.end,
        output_root=output_dir,
        train_ratio=args.train_ratio,
        forecast_days=args.forecast_days,
        include_arima=not args.skip_arima,
        data_source=args.data_source,
        asset_type=args.asset_type,
    )


if __name__ == "__main__":
    main()
