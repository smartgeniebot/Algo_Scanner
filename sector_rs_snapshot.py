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

_log_conn = None

def _get_log_conn():
    global _log_conn
    if _log_conn is None or _log_conn.closed:
        _log_conn = psycopg2.connect(NEON_URL)
    return _log_conn

def log(msg):
    print(msg)
    try:
        c = _get_log_conn()
        cur = c.cursor()
        cur.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ("sector_rs", msg))
        c.commit()
        cur.close()
    except Exception:
        pass
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
            log("⏳ Rate limit hit — cooling 45 s")
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
    log("📥 Fetching Nifty500 benchmark closes from Fyers...")
    nifty_closes = fetch_daily_closes(fyers, NIFTY500, range_from, range_to)
    if nifty_closes.empty:
        log("⚠️  Nifty500 failed, falling back to Nifty50...")
        nifty_closes = fetch_daily_closes(fyers, NIFTY50, range_from, range_to)
    if nifty_closes.empty:
        log("❌ Could not fetch benchmark data. Aborting.")
        return False
    log(f"✅ Nifty benchmark: {len(nifty_closes)} days ({nifty_closes.index[0]} → {nifty_closes.index[-1]})")

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
    log(f"📊 Loaded {len(stock_rows)} stocks from DB")

    # Build group mappings
    groups = {"sector": {}, "industry": {}, "basic_industry": {}}
    for sym, sec, ind, bi in stock_rows:
        if sec: groups["sector"].setdefault(sec, []).append(sym)
        if ind: groups["industry"].setdefault(ind, []).append(sym)
        if bi:  groups["basic_industry"].setdefault(bi, []).append(sym)

    # Load closes from daily_ohlcv cache
    log(f"\n📂 Loading daily closes from daily_ohlcv cache for {len(stock_rows)} stocks...")
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
    log(f"✅ Got closes for {len(stock_closes)} / {len(seen)} stocks")

    if not stock_closes:
        log("❌ daily_ohlcv cache is empty — market_engine must run first. Aborting.")
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
    log(f"💾 Cache saved to {CACHE_FILE}")
    return True


def do_write():
    """Phase 2 — load cache and write to Neon. Can be retried independently."""
    if not CACHE_FILE.exists():
        log("❌ No cache file found. Run without --write-only first.")
        return

    log(f"📂 Loading cache from {CACHE_FILE}...")
    with open(CACHE_FILE, "rb") as f:
        cache = pickle.load(f)

    nifty_closes = cache["nifty_closes"]
    groups       = cache["groups"]
    stock_closes = cache["stock_closes"]
    backfill     = cache["backfill"]

    all_dates_window = sorted(nifty_closes.index)[-LOOKBACK:]
    anchor_date      = all_dates_window[0]   # fixed base — all returns measured from here
    write_dates      = all_dates_window if backfill else [all_dates_window[-1]]

    # Nifty return base — fixed for the whole write phase
    if anchor_date not in nifty_closes.index:
        log("❌ Anchor date not found in Nifty closes. Aborting.")
        return
    nifty_anchor = float(nifty_closes[anchor_date])

    log("🔌 Connecting to DB...")
    conn   = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()
    ensure_table(cursor, conn)

    # Precompute per-stock: anchor close, date set, and per-date closes — all as plain
    # Python dicts/sets so every lookup is O(1) instead of O(n) pandas index search.
    stock_anchor = {}   # sym -> float anchor close
    stock_dates  = {}   # sym -> set of dates
    stock_day    = {}   # sym -> {date: float close}
    for sym, closes in stock_closes.items():
        if anchor_date not in closes.index:
            continue
        stock_anchor[sym] = float(closes[anchor_date])
        dates_set = set(closes.index)
        stock_dates[sym]  = dates_set
        stock_day[sym]    = {d: float(closes[d]) for d in dates_set}

    for group_type, group_dict in groups.items():
        batch = []
        n_groups = len(group_dict)
        for g_idx, (group_name, symbols) in enumerate(group_dict.items()):
            # Eligible = stocks that have a close on the anchor date.
            # Anchor presence is the key gate — without it we cannot compute a
            # return. New listings are excluded until they have anchor-date data,
            # and their first contribution is always ~1.0 (neutral), never a spike.
            eligible = [sym for sym in symbols if sym in stock_anchor]
            if not eligible:
                continue

            for trade_date in write_dates:
                if trade_date not in nifty_closes.index:
                    continue
                nifty_now = float(nifty_closes[trade_date])
                if not nifty_now:
                    continue

                # Only stocks that also have data on this trade_date
                paired = [sym for sym in eligible if trade_date in stock_dates[sym]]
                if not paired:
                    continue

                # Each stock contributes its % return from anchor — price-neutral
                avg_return   = sum(stock_day[sym][trade_date] / stock_anchor[sym]
                                   for sym in paired) / len(paired)
                nifty_return = nifty_now / nifty_anchor
                rs_ratio     = avg_return / nifty_return

                batch.append((
                    str(group_type), str(group_name), str(trade_date),
                    round(float(rs_ratio), 6), int(len(paired)),
                ))

            if (g_idx + 1) % 50 == 0 or (g_idx + 1) == n_groups:
                log(f"  {group_type}: {g_idx+1}/{n_groups} groups computed...")

        cursor.executemany("""
            INSERT INTO sector_rs_history (group_type, group_name, trade_date, rs_ratio, stock_count)
            VALUES (%s, %s, %s::date, %s, %s)
            ON CONFLICT (group_type, group_name, trade_date)
            DO UPDATE SET rs_ratio = EXCLUDED.rs_ratio, stock_count = EXCLUDED.stock_count
        """, batch)
        conn.commit()
        log(f"  ✅ {group_type}: {len(batch)} rows upserted")

    cursor.close()
    conn.close()
    log("\n🏁 Sector RS snapshot complete.")
    CACHE_FILE.unlink(missing_ok=True)
    log("🗑️  Cache file removed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill",        action="store_true", help="Populate last 63 trading days")
    parser.add_argument("--write-only",      action="store_true", help="Skip fetch, write from saved cache")
    parser.add_argument("--wipe-and-backfill", action="store_true", help="Wipe sector_rs_history and recompute all 63 days fresh")
    args = parser.parse_args()

    if args.wipe_and_backfill:
        conn = psycopg2.connect(NEON_URL)
        cur  = conn.cursor()
        cur.execute("TRUNCATE TABLE sector_rs_history")
        conn.commit()
        cur.close()
        conn.close()
        log("🗑️  sector_rs_history wiped — running full backfill...")
        if do_fetch(backfill=True):
            do_write()
    elif args.write_only:
        do_write()
    else:
        if do_fetch(backfill=args.backfill):
            do_write()
