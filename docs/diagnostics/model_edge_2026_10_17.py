"""Offline reproduction of docs/diagnostics/model-edge-2026-10-17.md.

Reads only fixed files; makes no network calls. Usage (from the repository root):

    git show 38ad853ae8f84e1a41f648c8d7a3c413ef97914d:股票预测/data/history/prediction_ledger.csv > /tmp/ledger.csv
    python docs/diagnostics/model_edge_2026_10_17.py docs/diagnostics/data/live-records-2026-10-17.csv /tmp/ledger.csv
"""

import sys

import pandas as pd

HORIZONS = [
    ("1D", "Raw_Direction_Correct", "Forecast_1D_Return", "Actual_1D_Return", "Kronos_Direction_Correct_1D", "Kronos_Forecast_1D_Return"),
    ("5D", "Direction_Correct_5D", "Forecast_5D_Return", "Actual_5D_Return", "Kronos_Direction_Correct_5D", "Kronos_Forecast_5D_Return"),
    ("10D", "Direction_Correct_10D", "Forecast_10D_Return", "Actual_10D_Return", "Kronos_Direction_Correct_10D", "Kronos_Forecast_10D_Return"),
    ("1M", "Direction_Correct_1M", "Forecast_1M_Return", "Actual_1M_Return", "Kronos_Direction_Correct_1M", "Kronos_Forecast_1M_Return"),
]


def ratio(series: pd.Series) -> str:
    settled = series.dropna()
    return f"{int(settled.sum())}/{len(settled)} = {settled.mean():.1%}" if len(settled) else "—"


def live(path: str) -> None:
    df = pd.read_csv(path)
    print(f"cloud live records {len(df)}, dates {df.As_Of_Date.min()} → {df.As_Of_Date.max()}, distinct dates {df.As_Of_Date.nunique()}")
    for horizon, correct, forecast, actual, _, _ in HORIZONS:
        d = df[df[correct].notna()]
        print(f"  {horizon}: {ratio(d[correct])} over {d.As_Of_Date.nunique()} dates | actual up {(d[actual] > 0).mean():.1%} | "
              f"predicted up {(d[forecast] > 0).mean():.1%} | corr(forecast, actual) {d[forecast].corr(d[actual]):+.2f}")
    print("by model:")
    for model, g in df.groupby("Best_Model"):
        print(f"  {model}: {g.As_Of_Date.min()} → {g.As_Of_Date.max()} | 1D {ratio(g.Raw_Direction_Correct)} over "
              f"{g[g.Raw_Direction_Correct.notna()].As_Of_Date.nunique()} dates | 5D {ratio(g.Direction_Correct_5D)}")
        for ticker, t in g.groupby("Ticker"):
            print(f"      {ticker}: {t.As_Of_Date.min()} → {t.As_Of_Date.max()} ({len(t)} records)")
    df["month"] = df.As_Of_Date.str[:7]
    print("by month:")
    for month, g in df.groupby("month"):
        print(f"  {month}: 1D {ratio(g.Raw_Direction_Correct)} | 5D {ratio(g.Direction_Correct_5D)}")
    print("rows with an official Kronos result (same rows for both):")
    for horizon, correct, forecast, actual, k_correct, k_forecast in HORIZONS:
        d = df[df[correct].notna() & df[k_correct].notna()]
        print(f"  {horizon}: n={len(d)} dates={d.As_Of_Date.nunique()} | ensemble {ratio(d[correct])} corr {d[forecast].corr(d[actual]):+.2f} | "
              f"Kronos {ratio(d[k_correct])} corr {d[k_forecast].corr(d[actual]):+.2f}")
    d = df[df.Raw_Direction_Correct.notna()].copy()
    d["tercile"] = pd.qcut(d.Confidence_Score, 3, duplicates="drop")
    print("1D by Confidence_Score tercile:", {str(k): ratio(g.Raw_Direction_Correct) for k, g in d.groupby("tercile", observed=True)})


def ledger(path: str) -> None:
    df = pd.read_csv(path)
    done = df[df.Actual_1D_Direction.notna()].copy()
    up = (done.Actual_1D_Direction == "Up").sum()
    print(f"\nPython ledger rows {len(df)}, settled 1D {len(done)} asset-date records over {done.As_Of_Date.nunique()} dates")
    print(f"  1D accuracy {ratio(done.Raw_Direction_Correct)} | actual up {up}/{len(done)} = {up / len(done):.1%} of asset-date records")
    for direction in ("Up", "Down"):
        print(f"  predicted {direction}: {ratio(done.loc[done.Raw_Direction == direction, 'Raw_Direction_Correct'])}")
    print("  by model:", {m: f"{ratio(g.Raw_Direction_Correct)}, predicted up {(g.Raw_Direction == 'Up').mean():.1%}" for m, g in done.groupby("Best_Model")})
    print("  by ticker:", {t: ratio(g.Raw_Direction_Correct) for t, g in done.groupby("Ticker")})
    acted = done[done.Action_Signal.isin(["Up", "Down"])]
    print(f"  non-Observe action signals {ratio(acted.Action_Signal_Correct)}; Observe share {(done.Action_Signal == 'Observe').mean():.1%}")
    done["quartile"] = pd.qcut(done.Forecast_1D_Return.abs(), 4, labels=["Q1 small", "Q2", "Q3", "Q4 large"])
    print("  by |forecast| quartile:", {str(k): ratio(g.Raw_Direction_Correct) for k, g in done.groupby("quartile", observed=True)})
    risk = df[df.Risk_5D_Correct.notna()]
    print(f"  5D risk accuracy {ratio(risk.Risk_5D_Correct)} | actual high-risk {risk.Actual_5D_High_Risk.mean():.1%} | predicted High {(risk.Risk_5D_Status == 'High').mean():.1%}")


if __name__ == "__main__":
    live(sys.argv[1])
    ledger(sys.argv[2])
