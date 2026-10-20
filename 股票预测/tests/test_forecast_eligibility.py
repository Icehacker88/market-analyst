import copy
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from src.forecast_eligibility import make_snapshot, qualify, session, following_sessions, outcome_eligible
from src.prediction_ledger import (LEDGER_COLUMNS, TEXT_COLUMNS, _reconcile_actuals, _evaluation_row,
                                  build_ledger_metrics, update_prediction_ledger)
NOW = datetime(2026, 10, 19, tzinfo=timezone.utc)


def record(day="2026-09-02", generated="2026-09-02T21:00:00Z", observed="2026-09-02T20:30:00Z"):
    return dict(Ticker="SPY", As_Of_Date=day, Created_At=generated,
        Evaluation_Snapshot=make_snapshot("SPY", day, 100, "Close", "yahoo", observed, generated, generated),
        Forecast_1D_Return=.01, Raw_Direction="Up", Action_Signal="Up")


def frame(row):
    values = {k:v for k,v in row.items() if k not in {"Evaluation_Snapshot", "Outcome_Evidence"}}
    values["Evaluation_Snapshot_JSON"] = json.dumps(row.get("Evaluation_Snapshot"))
    values["Outcome_Evidence_JSON"] = json.dumps(row.get("Outcome_Evidence", {}))
    f = pd.DataFrame([values]).reindex(columns=LEDGER_COLUMNS)
    f[TEXT_COLUMNS] = f[TEXT_COLUMNS].astype(object)
    return f


def market(prices=(100, 110), days=("2026-09-02", "2026-09-03"), adjusted=None):
    return pd.DataFrame({"Date": list(days), "Adj Close": list(adjusted or prices), "Close": list(prices)})


class ForecastEligibilityTests(unittest.TestCase):
    def test_calendar_dst_holidays_early_close_and_unknown(self):
        self.assertEqual(session("2026-03-06")[0].astimezone(timezone.utc).hour, 14)
        self.assertEqual(session("2026-03-09")[0].astimezone(timezone.utc).hour, 13)
        self.assertEqual(session("2026-11-02")[0].astimezone(timezone.utc).hour, 14)
        self.assertEqual(session("2026-11-27")[1].astimezone(timezone.utc).hour, 18)
        self.assertEqual(following_sessions("2026-09-04", 1), ["2026-09-08"])
        self.assertEqual(following_sessions("2026-07-02", 1), ["2026-07-06"])
        for day in ("2028-01-03","2026-02-30","2026-09-07"):
            self.assertIsNone(session(day))

    def test_46_late_records_excluded_without_snapshot_guessing(self):
        records=json.loads((Path(__file__).resolve().parents[1]/"contracts/late-forecast-regressions.json").read_text())
        self.assertEqual(len(records),46)
        for r in records:
            for horizon in ("1D","5D","1M"):
                self.assertEqual(qualify(r,horizon,NOW)["status"],"ineligible",r)

    def test_22_pending_records_have_separate_conservative_reasons(self):
        records=json.loads((Path(__file__).resolve().parents[1]/"contracts/pending-forecast-regressions.json").read_text())
        self.assertEqual(len(records),22)
        for r in records:
            reason = "unsupported_market_calendar" if r["Ticker"] not in {"SPY", "QQQ", "NVDA"} else "base_session_unclosed"
            self.assertEqual(qualify(r,now=NOW)["reason"],reason,r)

    def test_snapshot_provenance_and_publication_boundaries(self):
        good=record();self.assertEqual(qualify(good,now=NOW)["status"],"eligible")
        cases=[("frozen_at","2026-09-03T13:30:00Z","ineligible"),
               ("source_observed_at","2026-09-02T19:59:59Z","ineligible"),
               ("frozen_at",None,"unknown"),("price_basis","NAV","unknown"),("price_basis","Adj Close","unknown"),
               ("target_sessions",None,"unknown"),("symbol","QQQ","unknown"),
               ("source_observed_at","2026-09-02T21:30:00Z","unknown")]
        for key,value,state in cases:
            r=copy.deepcopy(good);r["Evaluation_Snapshot"][key]=value
            self.assertEqual(qualify(r,now=NOW)["status"],state,key)
        legacy=copy.deepcopy(good);del legacy["Evaluation_Snapshot"]
        self.assertEqual(qualify(legacy,now=NOW)["reason"],"legacy_snapshot_missing")
        self.assertEqual(qualify(record(generated="2026-09-02T18:00:00Z"),now=NOW)["reason"],"base_session_unclosed")
        fx=record();fx["Ticker"]="USDCNY=X";fx["Evaluation_Snapshot"]={}
        self.assertEqual(qualify(fx,now=NOW)["reason"],"unsupported_market_calendar")
        self.assertEqual(qualify(record("2026-09-04","2026-09-06T12:00:00Z","2026-09-04T20:30:00Z"),now=NOW)["status"],"eligible")

    def test_fixed_base_final_data_and_no_legacy_backfill(self):
        original=frame(record());provenance={"SPY":{"source":"yahoo","observed_at":"2026-09-03T20:30:00Z"}}
        settled=_reconcile_actuals(original,{"SPY":market()},provenance)
        self.assertTrue(outcome_eligible(_evaluation_row(settled.iloc[0]),"1D",NOW))
        self.assertEqual(settled.iloc[0]["Raw_Direction_Correct"],1)
        revised=_reconcile_actuals(original,{"SPY":market((105,110))},provenance)
        self.assertTrue(pd.isna(revised.iloc[0]["Actual_1D_Return"]))
        pd.testing.assert_frame_equal(settled,_reconcile_actuals(settled,{"SPY":market((105,115))},provenance))
        for bad in ({}, {"SPY":{"source":"other","observed_at":"2026-09-03T20:30:00Z"}},
                    {"SPY":{"source":"yahoo","observed_at":"2026-09-03T19:00:00Z"}}):
            pd.testing.assert_frame_equal(original,_reconcile_actuals(original,{"SPY":market()},bad))
        legacy=record();legacy.pop("Evaluation_Snapshot");f=frame(legacy)
        pd.testing.assert_frame_equal(f,_reconcile_actuals(f,{"SPY":market()},provenance))
        missing=_reconcile_actuals(original,{"SPY":market(days=("2026-09-02","2026-09-04"))},provenance)
        self.assertTrue(pd.isna(missing.iloc[0]["Actual_1D_Return"]))

    def test_observed_is_not_qualified(self):
        r=record();r.pop("Evaluation_Snapshot");r.update(Actual_1D_Date="2026-09-03",Actual_1D_Return=.1,Raw_Direction_Correct=1)
        metrics=build_ledger_metrics(frame(r)).iloc[0]
        for key,expected in (("Observed_1D",1),("Completed_1D",0),("Excluded_1D",1),("Unknown_1D",1)):
            self.assertEqual(metrics[key],expected)

    def test_publication_ack_crossing_open_cannot_qualify(self):
        prediction=pd.DataFrame([dict(Ticker="SPY",Forecast_Generated_At="2026-09-03T13:29:59Z")])
        with tempfile.TemporaryDirectory() as d, patch("src.prediction_ledger.datetime") as clock:
            clock.now.return_value=datetime(2026,9,3,13,30,1,tzinfo=timezone.utc)
            ledger,_=update_prediction_ledger(Path(d)/"ledger.csv",prediction,{"SPY":market((100,), ("2026-09-02",))},NOW,
                  {"SPY":{"source":"yahoo","observed_at":"2026-09-02T20:30:00Z"}})
            self.assertEqual(qualify(_evaluation_row(ledger.iloc[0]),now=NOW)["status"],"ineligible")

    def test_settles_on_close_when_dividend_rewrites_adjusted_history(self):
        original=frame(record());provenance={"SPY":{"source":"yahoo","observed_at":"2026-09-03T20:30:00Z"}}
        # Ex-dividend on 09-03 rewrites the 09-02 Adj Close (100 -> 99.7); Close is unchanged.
        dividend=_reconcile_actuals(original,{"SPY":market((100,110),adjusted=(99.7,110))},provenance)
        self.assertTrue(outcome_eligible(_evaluation_row(dividend.iloc[0]),"1D",NOW))
        self.assertAlmostEqual(dividend.iloc[0]["Actual_1D_Return"],math.log(110/100))
        evidence=json.loads(dividend.iloc[0]["Outcome_Evidence_JSON"])["1D"]
        self.assertEqual((evidence["price_basis"],evidence["base_price"],evidence["actual_price"]),("Close",100,110))
        # A split rewrites Close itself, so the frozen base no longer matches and nothing settles.
        split=_reconcile_actuals(original,{"SPY":market((50,55))},provenance)
        self.assertTrue(pd.isna(split.iloc[0]["Actual_1D_Return"]))

    def test_new_snapshot_freezes_unadjusted_close(self):
        prediction=pd.DataFrame([dict(Ticker="SPY",Forecast_Generated_At="2026-09-02T21:00:00Z")])
        with tempfile.TemporaryDirectory() as d:
            ledger,_=update_prediction_ledger(Path(d)/"ledger.csv",prediction,
                {"SPY":market((100,),("2026-09-02",),adjusted=(98.5,))},NOW,
                {"SPY":{"source":"yahoo","observed_at":"2026-09-02T20:30:00Z"}})
            snapshot=json.loads(ledger.iloc[0]["Evaluation_Snapshot_JSON"])
            self.assertEqual((snapshot["price_basis"],snapshot["base_price"]),("Close",100.0))

