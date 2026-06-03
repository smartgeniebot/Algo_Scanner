import time
import pandas as pd
import pandas_ta_classic as ta
from fyers_apiv3 import fyersModel
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
CLIENT_ID = "QTKF8KZDM9-100"

def get_fyers():
    with open("access_token.txt", "r") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

def fetch_combined(fyers, sym, today):
    warmup_from = (today - timedelta(days=730)).strftime("%Y-%m-%d")
    warmup_to   = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    main_from   = (today - timedelta(days=364)).strftime("%Y-%m-%d")
    main_to     = today.strftime("%Y-%m-%d")
    frames = []
    for rf, rt in [(warmup_from, warmup_to), (main_from, main_to)]:
        res = fyers.history({"symbol": sym, "resolution": "1D", "date_format": "1",
                              "range_from": rf, "range_to": rt, "cont_flag": "1"})
        if isinstance(res, dict) and res.get("s") == "ok" and res.get("candles"):
            frames.append(pd.DataFrame(res["candles"], columns=["date","open","high","low","close","vol"]))
        time.sleep(0.15)
    if not frames:
        return None
    return pd.concat(frames).drop_duplicates(subset="date").sort_values("date").reset_index(drop=True)

def trace(df):
    df = df.copy().reset_index(drop=True)
    df["E9"]   = ta.ema(df["close"], 9)
    df["E20"]  = ta.ema(df["close"], 20)
    df["E50"]  = ta.ema(df["close"], 50)
    df["S200"] = ta.sma(df["close"], 200)
    df["pE9"]   = df["E9"].shift(1)
    df["pE20"]  = df["E20"].shift(1)
    df["pE50"]  = df["E50"].shift(1)
    df["pS200"] = df["S200"].shift(1)
    df = df.dropna(subset=["E9","E20","E50","S200","pE9","pE20","pE50","pS200"]).reset_index(drop=True)

    def dtf(e): return datetime.fromtimestamp(int(float(e)), IST).strftime("%Y-%m-%d")

    print(f"  usable bars after SMA200 warmup: {len(df)}")

    state = 0
    bases_found = []

    for i in range(len(df)):
        row = df.iloc[i]
        dt = dtf(row["date"])

        if state == 0:
            if row["E50"] > row["S200"] and row["pE50"] <= row["pS200"]:
                state = 1
                print(f"  [{dt}] EMA50 crossed ABOVE SMA200 — cycle starts")

        elif state == 1:
            if row["E20"] < row["E50"] and row["pE20"] >= row["pE50"]:
                state = 2
                print(f"  [{dt}] EMA20 crossed below EMA50 (pullback)")

        elif state == 2:
            if row["E9"] > row["E20"] and row["pE9"] <= row["pE20"]:
                bases_found.append(dt)
                print(f"  [{dt}] EMA9 crossed above EMA20 => BASE {len(bases_found)} SIGNAL")
                if len(bases_found) == 2:
                    break
                state = 1

    print()
    if not bases_found:
        print(f"  RESULT: no bases found")
    else:
        print(f"  RESULT: 1st={bases_found[0]}  2nd={bases_found[1] if len(bases_found) > 1 else '--'}")


fyers = get_fyers()
today = datetime.now(IST).date()

test_stocks = [
    ("NSE:INFOBEAN-EQ",  "expected: 1st=2025-10-27  2nd=2026-04-10"),
    ("NSE:AXISBANK-EQ",  "expected: 1st=2025-09-12  2nd=2026-04-09"),
    ("NSE:SBIN-EQ",      "expected: 1st=2026-04-20  2nd=--"),
    ("NSE:HINDALCO-EQ",  "expected: 1st=2026-04-07  2nd=--"),
]

print(f"warmup: {(today-timedelta(days=730)).strftime('%Y-%m-%d')} to {(today-timedelta(days=365)).strftime('%Y-%m-%d')}")
print(f"main  : {(today-timedelta(days=364)).strftime('%Y-%m-%d')} to {today.strftime('%Y-%m-%d')}")
print("=" * 70)

for sym, expected in test_stocks:
    print(f"\n{sym}")
    print(f"  {expected}")
    df = fetch_combined(fyers, sym, today)
    if df is None:
        print("  NO DATA")
        continue
    print(f"  raw bars fetched: {len(df)}")
    trace(df)
