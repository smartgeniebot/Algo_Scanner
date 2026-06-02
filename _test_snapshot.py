# -*- coding: utf-8 -*-
import psycopg2
import pandas as pd
from datetime import datetime, timedelta, timezone
from fyers_apiv3 import fyersModel
from config import NEON_URL

CLIENT_ID = "QTKF8KZDM9-100"
IST = timezone(timedelta(hours=5, minutes=30))

with open("access_token.txt") as f:
    token = f.read().strip()
fyers = fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

today      = datetime.now(IST).date()
range_from = (today - timedelta(days=140)).strftime("%Y-%m-%d")
range_to   = today.strftime("%Y-%m-%d")

def fetch_closes(symbol):
    res = fyers.history(data={
        "symbol": symbol, "resolution": "1D", "date_format": "1",
        "range_from": range_from, "range_to": range_to, "cont_flag": "1"
    })
    if not isinstance(res, dict) or res.get("s") != "ok" or not res.get("candles"):
        raise RuntimeError(f"Fetch failed for {symbol}: {res}")
    df = pd.DataFrame(res["candles"], columns=["ts","open","high","low","close","vol"])
    df["date"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    return df.set_index("date")["close"].map(float)

print("STEP 1: Fetching Nifty500...")
nifty = fetch_closes("NSE:NIFTY500-INDEX")
print(f"  rows={len(nifty)}  dtype={nifty.dtype}  last={float(nifty.iloc[-1])}")

print("STEP 2: Fetching RELIANCE...")
stock = fetch_closes("NSE:RELIANCE-EQ")
print(f"  rows={len(stock)}  dtype={stock.dtype}  last={float(stock.iloc[-1])}")

print("STEP 3: Computing ratio row...")
trade_date = nifty.index[-1]
nifty_val  = float(nifty[trade_date])
stock_val  = float(stock[trade_date])
rs_ratio   = stock_val / nifty_val
row = (
    str("sector"),
    str("TEST_SECTOR"),
    str(trade_date),
    round(float(rs_ratio), 6),
    int(1),
)
print(f"  row    = {row}")
print(f"  types  = {[type(v).__name__ for v in row]}")

print("STEP 4: Writing to Neon...")
conn   = psycopg2.connect(NEON_URL)
cursor = conn.cursor()
cursor.execute("""
    CREATE TABLE IF NOT EXISTS sector_rs_history (
        id SERIAL PRIMARY KEY,
        group_type  TEXT             NOT NULL,
        group_name  TEXT             NOT NULL,
        trade_date  DATE             NOT NULL,
        rs_ratio    DOUBLE PRECISION NOT NULL,
        stock_count INTEGER          NOT NULL,
        UNIQUE (group_type, group_name, trade_date)
    )
""")
cursor.execute("""
    INSERT INTO sector_rs_history (group_type, group_name, trade_date, rs_ratio, stock_count)
    VALUES (%s, %s, %s::date, %s, %s)
    ON CONFLICT (group_type, group_name, trade_date)
    DO UPDATE SET rs_ratio = EXCLUDED.rs_ratio, stock_count = EXCLUDED.stock_count
""", row)
conn.commit()
print("  Write OK")

print("STEP 5: Reading back...")
cursor.execute("SELECT group_type, group_name, trade_date, rs_ratio, stock_count FROM sector_rs_history WHERE group_name = 'TEST_SECTOR'")
result = cursor.fetchone()
print(f"  Result = {result}")

print("STEP 6: Cleaning up test row...")
cursor.execute("DELETE FROM sector_rs_history WHERE group_name = 'TEST_SECTOR'")
conn.commit()
cursor.close()
conn.close()

print("\nALL STEPS PASSED - safe to run full backfill")
