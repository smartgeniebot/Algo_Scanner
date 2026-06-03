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

def fetch_safe(fyers_obj, payload):
    for attempt in range(3):
        res = fyers_obj.history(data=payload)
        if isinstance(res, dict):
            if res.get("s") == "ok" and res.get("candles"):
                return res
            if "limit" in str(res.get("message", "")).lower():
                print("Rate limit — cooling 45s")
                time.sleep(45)
                continue
        if attempt < 2:
            time.sleep(3)
    return res

def find_bases_fixed(df):
    if len(df) < 210:
        return None
    df = df.copy().reset_index(drop=True)
    df["E9"]   = ta.ema(df["close"], 9)
    df["E20"]  = ta.ema(df["close"], 20)
    df["E50"]  = ta.ema(df["close"], 50)
    df["S200"] = ta.sma(df["close"], 200)
    df = df.dropna(subset=["E9", "E20", "E50", "S200"]).reset_index(drop=True)
    if len(df) < 5:
        return None
    df["pE9"]   = df["E9"].shift(1)
    df["pE20"]  = df["E20"].shift(1)
    df["pE50"]  = df["E50"].shift(1)
    df["pS200"] = df["S200"].shift(1)
    df = df.dropna(subset=["pE9", "pE20", "pE50", "pS200"]).reset_index(drop=True)
    first = df.iloc[0]
    if first["E50"] <= first["S200"]:
        state = 0
        bases_found = []
    elif first["E20"] >= first["E50"]:
        if first["E9"] > first["E20"]:
            state = 1
            bases_found = ["prior"]
        else:
            state = 1
            bases_found = []
    else:
        state = 2 if first["E9"] < first["E20"] else 1
        bases_found = []
    for i in range(len(df)):
        row = df.iloc[i]
        dt = datetime.fromtimestamp(int(float(row["date"])), IST).strftime("%Y-%m-%d")
        if state == 0:
            if row["E50"] > row["S200"] and row["pE50"] <= row["pS200"]:
                state = 1
        elif state == 1:
            if row["E20"] < row["E50"] and row["pE20"] >= row["pE50"]:
                state = 2
        elif state == 2:
            if row["E9"] > row["E20"] and row["pE9"] <= row["pE20"]:
                bases_found.append(dt)
                if len(bases_found) == 2:
                    break
                state = 1
    if not bases_found:
        return None
    return (bases_found[0], bases_found[1] if len(bases_found) > 1 else None)


fyers = get_fyers()
today = datetime.now(IST).date()
cutoff     = (today - timedelta(days=30)).strftime("%Y-%m-%d")
range_from = (today - timedelta(days=364)).strftime("%Y-%m-%d")
range_to   = today.strftime("%Y-%m-%d")

symbols = [
    "NSE:RELIANCE-EQ", "NSE:TCS-EQ",       "NSE:INFY-EQ",      "NSE:HDFCBANK-EQ",
    "NSE:ICICIBANK-EQ","NSE:WIPRO-EQ",      "NSE:SBIN-EQ",      "NSE:AXISBANK-EQ",
    "NSE:BAJFINANCE-EQ","NSE:KOTAKBANK-EQ", "NSE:TATASTEEL-EQ", "NSE:HINDALCO-EQ",
    "NSE:NTPC-EQ",     "NSE:SUNPHARMA-EQ", "NSE:TITAN-EQ",     "NSE:MARUTI-EQ",
    "NSE:TATAMOTORS-EQ","NSE:ADANIENT-EQ", "NSE:ADANIPORTS-EQ","NSE:ITC-EQ",
]

in_window = []
outside   = []
no_pattern = []
no_data   = []

print(f"cutoff={cutoff}  |  range={range_from} to {range_to}")
print("-" * 80)

for sym in symbols:
    res = fetch_safe(fyers, {"symbol": sym, "resolution": "1D", "date_format": "1",
                              "range_from": range_from, "range_to": range_to, "cont_flag": "1"})
    if not isinstance(res, dict) or "candles" not in res or not res["candles"]:
        no_data.append(sym)
        print(f"  NO DATA     {sym}")
        time.sleep(0.15)
        continue

    df = pd.DataFrame(res["candles"], columns=["date","open","high","low","close","vol"])
    result = find_bases_fixed(df)

    if result:
        first, second = result
        most_recent = second if second else first
        in_win = most_recent >= cutoff if most_recent else False
        tag = "IN_WINDOW  " if in_win else "outside    "
        f_str = first if first else "(before window)"
        print(f"  {tag}  {sym:28s}  1st={f_str:16s}  2nd={second or '--':10s}  bars={len(df)}")
        (in_window if in_win else outside).append(sym)
    else:
        no_pattern.append(sym)
        print(f"  no_pattern    {sym:28s}  bars={len(df)}")

    time.sleep(0.15)

print()
print("=" * 80)
print(f"IN WINDOW (30d) : {len(in_window)}")
print(f"Outside window  : {len(outside)}")
print(f"No pattern      : {len(no_pattern)}")
print(f"No data         : {len(no_data)}")

if in_window:
    print()
    print("Signals in window:")
    for s in in_window:
        print(f"  {s}")
