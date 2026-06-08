"""
sector_rs_snapshot.py
---------------------
Runs once per trading day (after manual_scan.py completes).
Computes sector/industry/basic_industry RS ratio = group_avg_close / Nifty500_close
and stores 63 days of history in sector_rs_history (Neon PostgreSQL).

Crash-safe design:
  - Stock closes are cached to sector_rs_cache.pkl after the Fyers fetch phase.
  - If the DB write fails, re-run with --write-only to skip the 28-min fetch
    and go straight to writing from the cache.

Usage:
  python sector_rs_snapshot.py --backfill          # first run: fetch + write 63d
  python sector_rs_snapshot.py                     # daily: fetch + write today only
  python sector_rs_snapshot.py --write-only        # retry DB write from saved cache
"""

import time
import pickle
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import pandas as pd
from fyers_apiv3 import fyersModel
from tqdm import tqdm

from config import NEON_URL

CLIENT_ID  = "QTKF8KZDM9-100"
IST        = timezone(timedelta(hours=5, minutes=30))
LOOKBACK   = 63
NIFTY500   = "NSE:NIFTY500-INDEX"
NIFTY50    = "NSE:NIFTY50-INDEX"
CACHE_FILE = Path("sector_rs_cache.pkl")


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


def fetch_daily_closes_from_db(conn, symbol):
    """Return a date-indexed Series of plain Python floats from daily_ohlcv cache."""
    cur = conn.cursor()
    cur.execute("""
        SELECT date, close FROM daily_ohlcv
        WHERE fyers_symbol = %s ORDER BY date ASC
    """, (symbol,))
    rows = cur.fetchall()
    cur.close()
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows, columns=["ts", "close"])
    df["date"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    s = df.set_index("date")["close"]
    return s.map(float)


def fetch_daily_closes(fyers, symbol, range_from, range_to):
    """Return a date-indexed Series of plain Python floats, or empty Series."""
    res = fetch_safe(fyers, {
        "symbol": symbol, "resolution": "1D", "date_format": "1",
        "range_from": range_from, "range_to": range_to, "cont_flag": "1",
    })
    if not res.get("candles"):
        return pd.Series(dtype=float)
    df = pd.DataFrame(res["candles"], columns=["ts", "open", "high", "low", "close", "vol"])
    df["date"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    s = df.set_index("date")["close"]
    return s.map(float)


def ensure_table(cursor, conn):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sector_rs_history (
            id           SERIAL PRIMARY KEY,
            group_type   TEXT    NOT NULL,
            group_name   TEXT    NOT NULL,
            trade_date   DATE    NOT NULL,
            rs_ratio     DOUBLE PRECISION NOT NULL,
            stock_count  INTEGER NOT NULL,
            UNIQUE (group_type, group_name, trade_date)
        )
    """)
    conn.commit()


def do_fetch(backfill):
    """Phase 1 — load stock closes from daily_ohlcv DB cache; fetch Nifty benchmark from Fyers."""
    today_ist  = datetime.now(IST).date()
    cal_days   = 140
    range_from = (today_ist - timedelta(days=cal_days)).strftime("%Y-%m-%d")
    range_to   = today_ist.strftime("%Y-%m-%d")

    fyers = get_fyers()

    # Nifty index is not in daily_ohlcv — fetch from Fyers as before
    print("📥 Fetching Nifty500 benchmark closes from Fyers...")
    nifty_closes = fetch_daily_closes(fyers, NIFTY500, range_from, range_to)
    if nifty_closes.empty:
        print("⚠️  Nifty500 failed, falling back to Nifty50...")
        nifty_closes = fetch_daily_closes(fyers, NIFTY50, range_from, range_to)
    if nifty_closes.empty:
        print("❌ Could not fetch benchmark data. Aborting.")
        return False
    print(f"✅ Nifty benchmark: {len(nifty_closes)} days ({nifty_closes.index[0]} → {nifty_closes.index[-1]})")

    # Load stock list + closes from DB cache — no Fyers calls for individual stocks
    conn   = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT fyers_symbol, sector, industry, basic_industry
        FROM stocks
        WHERE sector IS NOT NULL AND sector != ''
          AND fyers_symbol IS NOT NULL
    """)
    stock_rows = cursor.fetchall()
    print(f"📊 Loaded {len(stock_rows)} stocks from DB")

    # Build group mappings
    groups = {"sector": {}, "industry": {}, "basic_industry": {}}
    for sym, sec, ind, bi in stock_rows:
        if sec: groups["sector"].setdefault(sec, []).append(sym)
        if ind: groups["industry"].setdefault(ind, []).append(sym)
        if bi:  groups["basic_industry"].setdefault(bi, []).append(sym)

    # Load closes from daily_ohlcv cache
    print(f"\n📂 Loading daily closes from daily_ohlcv cache for {len(stock_rows)} stocks...")
    stock_closes = {}
    seen = set()
    for sym, *_ in tqdm(stock_rows):
        if sym in seen:
            continue
        seen.add(sym)
        closes = fetch_daily_closes_from_db(conn, sym)
        if not closes.empty:
            stock_closes[sym] = closes

    cursor.close()
    conn.close()
    print(f"✅ Got closes for {len(stock_closes)} / {len(seen)} stocks")

    if not stock_closes:
        print("❌ daily_ohlcv cache is empty — market_engine must run first. Aborting.")
        return False

    # Save everything to cache
    cache = {
        "nifty_closes": nifty_closes,
        "groups":       groups,
        "stock_closes": stock_closes,
        "backfill":     backfill,
    }
    with open(CACHE_FILE, "wb") as f:
        pickle.dump(cache, f)
    print(f"💾 Cache saved to {CACHE_FILE}")
    return True


def do_write():
    """Phase 2 — load cache and write to Neon. Can be retried independently."""
    if not CACHE_FILE.exists():
        print("❌ No cache file found. Run without --write-only first.")
        return

    print(f"📂 Loading cache from {CACHE_FILE}...")
    with open(CACHE_FILE, "rb") as f:
        cache = pickle.load(f)

    nifty_closes = cache["nifty_closes"]
    groups       = cache["groups"]
    stock_closes = cache["stock_closes"]
    backfill     = cache["backfill"]

    # Full 63-day window is always needed to determine eligible stocks —
    # even on a daily run we must check which stocks have data across the
    # whole lookback period so composition stays consistent day to day.
    all_dates_window = sorted(nifty_closes.index)[-LOOKBACK:]
    # Dates we actually write rows for: all 63 on backfill, just today otherwise
    write_dates = all_dates_window if backfill else [all_dates_window[-1]]

    print("🔌 Connecting to DB...")
    conn   = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()
    ensure_table(cursor, conn)

    for group_type, group_dict in groups.items():
        batch = []
        for group_name, symbols in group_dict.items():
            # Only keep stocks that have price data on EVERY date in the full
            # 63-day window. This locks the universe so composition never jumps.
            eligible = [
                sym for sym in symbols
                if sym in stock_closes and
                   all(d in stock_closes[sym].index for d in all_dates_window)
            ]
            if not eligible:
                # Fallback: stocks present on at least 90% of the window
                min_dates = int(len(all_dates_window) * 0.9)
                eligible = [
                    sym for sym in symbols
                    if sym in stock_closes and
                       sum(1 for d in all_dates_window if d in stock_closes[sym].index) >= min_dates
                ]
            if not eligible:
                continue

            for trade_date in write_dates:
                if trade_date not in nifty_closes.index:
                    continue
                nifty_val = float(nifty_closes[trade_date])
                if not nifty_val:
                    continue

                closes_on_date = [
                    float(stock_closes[sym][trade_date])
                    for sym in eligible
                    if trade_date in stock_closes[sym].index
                ]
                if not closes_on_date:
                    continue

                avg_close = sum(closes_on_date) / len(closes_on_date)
                rs_ratio  = avg_close / nifty_val

                batch.append((
                    str(group_type),
                    str(group_name),
                    str(trade_date),
                    round(float(rs_ratio), 6),
                    int(len(closes_on_date)),
                ))

        cursor.executemany("""
            INSERT INTO sector_rs_history (group_type, group_name, trade_date, rs_ratio, stock_count)
            VALUES (%s, %s, %s::date, %s, %s)
            ON CONFLICT (group_type, group_name, trade_date)
            DO UPDATE SET rs_ratio = EXCLUDED.rs_ratio, stock_count = EXCLUDED.stock_count
        """, batch)
        conn.commit()
        print(f"  ✅ {group_type}: {len(batch)} rows upserted")

    cursor.close()
    conn.close()
    print("\n🏁 Sector RS snapshot complete.")
    # Remove cache after successful write
    CACHE_FILE.unlink(missing_ok=True)
    print("🗑️  Cache file removed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill",   action="store_true", help="Populate last 63 trading days")
    parser.add_argument("--write-only", action="store_true", help="Skip fetch, write from saved cache")
    args = parser.parse_args()

    if args.write_only:
        do_write()
    else:
        if do_fetch(backfill=args.backfill):
            do_write()
