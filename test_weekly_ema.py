"""
Compares weekly EMA20/EMA50 computed two ways:
  A) Resample daily candles (what manual_scan.py now does)
  B) Fetch weekly candles directly from Fyers API

Run: python test_weekly_ema.py
"""
import pandas as pd
import pandas_ta_classic as ta
from fyers_apiv3 import fyersModel
from datetime import datetime, timedelta, timezone

CLIENT_ID = "QTKF8KZDM9-100"
IST = timezone(timedelta(hours=5, minutes=30))

TEST_SYMBOLS = [
    "NSE:RELIANCE-EQ",
    "NSE:HDFCBANK-EQ",
    "NSE:INFY-EQ",
    "NSE:TATAMOTORS-EQ",
    "NSE:SBIN-EQ",
]

def get_fyers():
    with open("access_token.txt", "r") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

def fetch(fyers, symbol, resolution, days):
    today = datetime.now(IST).date()
    return fyers.history({
        "symbol": symbol,
        "resolution": resolution,
        "date_format": "1",
        "range_from": (today - timedelta(days=days)).strftime("%Y-%m-%d"),
        "range_to": today.strftime("%Y-%m-%d"),
        "cont_flag": "1"
    })

def weekly_from_resample(daily_candles):
    df = pd.DataFrame(daily_candles, columns=['date','open','high','low','close','vol'])
    df['dt'] = pd.to_datetime(df['date'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')
    df = df.set_index('dt')
    dfw = df['close'].resample('W').last().dropna().reset_index(drop=True)
    if len(dfw) < 50:
        return None, None, len(dfw)
    e20 = ta.ema(dfw, 20)
    e50 = ta.ema(dfw, 50)
    return round(float(e20.iloc[-1]), 4), round(float(e50.iloc[-1]), 4), len(dfw)

def weekly_from_api(fyers, symbol):
    res = fetch(fyers, symbol, "W", 730)
    if not isinstance(res, dict) or "candles" not in res:
        return None, None, 0
    df = pd.DataFrame(res['candles'], columns=['date','open','high','low','close','vol'])
    if len(df) < 50:
        return None, None, len(df)
    e20 = ta.ema(df['close'], 20)
    e50 = ta.ema(df['close'], 50)
    return round(float(e20.iloc[-1]), 4), round(float(e50.iloc[-1]), 4), len(df)

def main():
    fyers = get_fyers()
    print(f"\n{'Symbol':<25} {'Method':<12} {'EMA20':>10} {'EMA50':>10} {'Bullish':>8} {'Candles':>8}")
    print("-" * 80)

    for sym in TEST_SYMBOLS:
        # Method A: resample daily
        res_d = fetch(fyers, sym, "1D", 364)
        if isinstance(res_d, dict) and "candles" in res_d:
            e20_r, e50_r, n_r = weekly_from_resample(res_d['candles'])
        else:
            e20_r, e50_r, n_r = None, None, 0

        # Method B: direct weekly API
        e20_w, e50_w, n_w = weekly_from_api(fyers, sym)

        name = sym.split(':')[1].replace('-EQ','')

        if e20_r and e50_r:
            bull_r = "YES" if e20_r > e50_r else "NO"
            print(f"{name:<25} {'Resample':<12} {e20_r:>10} {e50_r:>10} {bull_r:>8} {n_r:>8}")
        else:
            print(f"{name:<25} {'Resample':<12} {'N/A':>10} {'N/A':>10} {'N/A':>8} {n_r:>8}")

        if e20_w and e50_w:
            bull_w = "YES" if e20_w > e50_w else "NO"
            match = "MATCH" if (e20_r is not None and (e20_r > e50_r) == (e20_w > e50_w)) else "MISMATCH"
            print(f"{name:<25} {'API Weekly':<12} {e20_w:>10} {e50_w:>10} {bull_w:>8} {n_w:>8}  <- {match}")
        else:
            print(f"{name:<25} {'API Weekly':<12} {'N/A':>10} {'N/A':>10} {'N/A':>8} {n_w:>8}")

        print()

if __name__ == "__main__":
    main()
