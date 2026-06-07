"""
test_weekly_base.py
Traces find_weekly_base() step by step for a set of real stocks.
Shows every state transition so you can verify the logic manually.

Run:  python test_weekly_base.py
Needs: access_token.txt (run auth.py first if expired)
"""

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
        time.sleep(0.2)
    if not frames:
        return None
    return pd.concat(frames).drop_duplicates(subset="date").sort_values("date").reset_index(drop=True)


def trace(df, sym):
    df = df.copy().reset_index(drop=True)
    df['E40']  = ta.ema(df['close'], 40)
    df['E50']  = ta.ema(df['close'], 50)
    df['S200'] = ta.sma(df['close'], 200)
    df['pE50']  = df['E50'].shift(1)
    df['pS200'] = df['S200'].shift(1)
    df = df.dropna(subset=['E40','E50','S200','pE50','pS200']).reset_index(drop=True)

    print(f"  Usable bars after SMA200 warmup: {len(df)}")

    def dtf(ts):
        return datetime.fromtimestamp(int(float(ts)), IST).strftime("%Y-%m-%d")

    in_cycle = False
    cycle_start = None
    result = None

    for i in range(len(df)):
        row = df.iloc[i]
        dt = dtf(row['date'])

        # Reset if EMA50 drops back below SMA200
        if in_cycle and row['E50'] < row['S200']:
            print(f"  [{dt}] EMA50 dropped below SMA200 — cycle RESET")
            in_cycle = False
            cycle_start = None
            continue

        if not in_cycle:
            if row['E50'] > row['S200'] and row['pE50'] <= row['pS200']:
                in_cycle = True
                cycle_start = dt
                print(f"  [{dt}] EMA50 crossed ABOVE SMA200 — cycle starts")
        else:
            if row['low'] < row['E40']:
                result = dt
                print(f"  [{dt}] Low ({row['low']:.2f}) < EMA40 ({row['E40']:.2f}) — PULLBACK SIGNAL")
                break

    print()
    if result:
        print(f"  RESULT: cycle started {cycle_start} | pullback date = {result}")
    elif in_cycle:
        print(f"  RESULT: cycle started {cycle_start} | no pullback yet (EMA50 still above SMA200, price hasn't touched EMA40)")
    else:
        print(f"  RESULT: no valid cycle found (EMA50 never crossed above SMA200 in the last 2 years)")


fyers = get_fyers()
today = datetime.now(IST).date()

# Stocks to verify. Add your own expectations in comments.
test_stocks = [
    "NSE:AIAENG-EQ",      # 1st daily base = 10 Apr — expect pullback shortly after
    "NSE:INFOBEAN-EQ",    # known to have daily bases
    "NSE:AXISBANK-EQ",
    "NSE:SBIN-EQ",
    "NSE:RELIANCE-EQ",
    "NSE:HDFCBANK-EQ",
    "NSE:TCS-EQ",
    "NSE:WIPRO-EQ",
]

print(f"Date range: {(today-timedelta(days=730)).strftime('%Y-%m-%d')} to {today}")
print("=" * 70)

for sym in test_stocks:
    print(f"\n{sym}")
    df = fetch_combined(fyers, sym, today)
    if df is None or len(df) == 0:
        print("  NO DATA")
        continue
    print(f"  Raw bars fetched: {len(df)}")
    trace(df, sym)
    print("-" * 70)
