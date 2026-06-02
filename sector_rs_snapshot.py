"""
sector_rs_snapshot.py
---------------------
Runs once per trading day (after manual_scan.py completes).
For each sector/industry/basic_industry group, fetches 63 trading days of daily
closes for every stock in that group, averages them, divides by Nifty500 close
on that day to produce an RS Ratio series, then stores today's ratio in the
sector_rs_history table.

Over 63+ days of daily runs this table will accumulate the data needed for
sparklines, 10-day direction, ROC and trend classification in the RS Ratio
report on the frontend.

One-time backfill: pass --backfill to re-derive and store up to 63 historical
rows from the Fyers API (one Fyers call per stock for the 63-day window, same
as the normal scan).
"""

import time
import argparse
from datetime import date, datetime, timedelta, timezone

import psycopg2
import pandas as pd
from fyers_apiv3 import fyersModel
from tqdm import tqdm

from config import NEON_URL

CLIENT_ID = "QTKF8KZDM9-100"
IST = timezone(timedelta(hours=5, minutes=30))
LOOKBACK = 63          # trading-day window for the RS ratio
NIFTY500  = "NSE:NIFTY500-INDEX"
NIFTY50   = "NSE:NIFTY50-INDEX"   # fallback


def get_fyers():
    with open("access_token.txt") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")


def fetch_safe(fyers, payload, retries=3):
    for attempt in range(retries):
        res = fyers.history(data=payload)
        if isinstance(res, dict) and res.get("s") == "ok" and res.get("candles"):
            return res
        if "limit" in str(res.get("message", "")).lower():
            print("⏳ Rate limit hit — cooling 45 s")
            time.sleep(45)
            continue
        if attempt < retries - 1:
            time.sleep(3)
    return {}


def fetch_daily_closes(fyers, symbol, range_from, range_to):
    """Return a date-indexed Series of daily closes, or empty Series on failure."""
    res = fetch_safe(fyers, {
        "symbol": symbol, "resolution": "1D", "date_format": "1",
        "range_from": range_from, "range_to": range_to, "cont_flag": "1",
    })
    if not res.get("candles"):
        return pd.Series(dtype=float)
    df = pd.DataFrame(res["candles"], columns=["ts", "open", "high", "low", "close", "vol"])
    df["date"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    return df.set_index("date")["close"]


def ensure_table(cursor, conn):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sector_rs_history (
            id           SERIAL PRIMARY KEY,
            group_type   TEXT    NOT NULL,   -- 'sector' | 'industry' | 'basic_industry'
            group_name   TEXT    NOT NULL,
            trade_date   DATE    NOT NULL,
            rs_ratio     FLOAT   NOT NULL,   -- group_avg_close / nifty500_close on that date
            stock_count  INTEGER NOT NULL,   -- number of stocks that contributed
            UNIQUE (group_type, group_name, trade_date)
        )
    """)
    conn.commit()


def run_snapshot(backfill=False):
    today_ist = datetime.now(IST).date()
    # Use a 100-calendar-day window to ensure we get 63 trading days
    cal_days = 140 if backfill else 10
    range_from = (today_ist - timedelta(days=cal_days)).strftime("%Y-%m-%d")
    range_to   = today_ist.strftime("%Y-%m-%d")

    conn   = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()
    ensure_table(cursor, conn)
    fyers  = get_fyers()

    # --- Fetch Nifty500 benchmark closes ---
    print("📥 Fetching Nifty500 benchmark closes...")
    nifty_closes = fetch_daily_closes(fyers, NIFTY500, range_from, range_to)
    if nifty_closes.empty:
        print("⚠️  Nifty500 failed, falling back to Nifty50...")
        nifty_closes = fetch_daily_closes(fyers, NIFTY50, range_from, range_to)
    if nifty_closes.empty:
        print("❌ Could not fetch benchmark data. Aborting.")
        return

    print(f"✅ Nifty benchmark: {len(nifty_closes)} trading days ({nifty_closes.index[0]} → {nifty_closes.index[-1]})")

    # --- Load all stocks with their group labels ---
    cursor.execute("""
        SELECT fyers_symbol, sector, industry, basic_industry
        FROM stocks
        WHERE sector IS NOT NULL AND sector != ''
          AND fyers_symbol IS NOT NULL
    """)
    rows = cursor.fetchall()
    print(f"📊 Loaded {len(rows)} stocks from DB")

    # Build group → symbol list mapping for all three levels
    groups = {"sector": {}, "industry": {}, "basic_industry": {}}
    for sym, sec, ind, bi in rows:
        if sec:
            groups["sector"].setdefault(sec, []).append(sym)
        if ind:
            groups["industry"].setdefault(ind, []).append(sym)
        if bi:
            groups["basic_industry"].setdefault(bi, []).append(sym)

    # --- For each stock, fetch its daily closes once and cache ---
    print(f"\n📡 Fetching daily closes for {len(rows)} stocks...")
    stock_closes: dict[str, pd.Series] = {}
    seen = set()
    for sym, *_ in tqdm(rows):
        if sym in seen:
            continue
        seen.add(sym)
        closes = fetch_daily_closes(fyers, sym, range_from, range_to)
        if not closes.empty:
            stock_closes[sym] = closes

    print(f"✅ Got closes for {len(stock_closes)} / {len(seen)} stocks")

    # --- Compute and store RS ratio for each group on each trading day ---
    # Determine which dates to store
    if backfill:
        # Use all common dates between benchmark and at least one stock, up to 63
        all_dates = sorted(nifty_closes.index)[-LOOKBACK:]
    else:
        # Just today (or most recent trading day in Nifty series)
        all_dates = [nifty_closes.index[-1]]

    rows_inserted = 0
    for group_type, group_dict in groups.items():
        for group_name, symbols in group_dict.items():
            for trade_date in all_dates:
                if trade_date not in nifty_closes.index:
                    continue
                nifty_val = nifty_closes[trade_date]
                if not nifty_val or nifty_val == 0:
                    continue

                # Average close of stocks in this group that have data for this date
                closes_on_date = []
                for sym in symbols:
                    s = stock_closes.get(sym)
                    if s is not None and trade_date in s.index:
                        closes_on_date.append(s[trade_date])

                if not closes_on_date:
                    continue

                avg_close = sum(closes_on_date) / len(closes_on_date)
                rs_ratio  = avg_close / nifty_val

                cursor.execute("""
                    INSERT INTO sector_rs_history (group_type, group_name, trade_date, rs_ratio, stock_count)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (group_type, group_name, trade_date)
                    DO UPDATE SET rs_ratio = EXCLUDED.rs_ratio, stock_count = EXCLUDED.stock_count
                """, (group_type, group_name, trade_date, round(rs_ratio, 6), len(closes_on_date)))
                rows_inserted += 1

        conn.commit()
        print(f"  ✅ {group_type}: {rows_inserted} rows upserted")
        rows_inserted = 0

    cursor.close()
    conn.close()
    print("\n🏁 Sector RS snapshot complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true",
                        help="Fetch and store up to 63 historical trading days (first run only)")
    args = parser.parse_args()
    run_snapshot(backfill=args.backfill)
