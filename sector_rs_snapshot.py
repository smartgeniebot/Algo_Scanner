"""
sector_rs_snapshot.py
---------------------
Runs once per trading day (after manual_scan.py completes).
Computes sector/industry/basic_industry RS ratio and stores 63 days of
history in sector_rs_history (Neon PostgreSQL).

RS ratio = avg(stock_return_from_anchor) / nifty_return_from_anchor
  - stock_return = close_today / close_anchor  (% return, price-neutral)
  - nifty_return = nifty_today / nifty_anchor
  - rs_ratio > 1.0 means sector outperforming Nifty500 from anchor date

Usage:
  python sector_rs_snapshot.py                  # daily: write today only
  python sector_rs_snapshot.py --backfill       # write last 63 days
  python sector_rs_snapshot.py --wipe-and-backfill  # wipe + recompute all
"""

import time
import argparse
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import execute_values
import pandas as pd
from fyers_apiv3 import fyersModel

from config import NEON_URL

CLIENT_ID = "QTKF8KZDM9-100"
IST       = timezone(timedelta(hours=5, minutes=30))
LOOKBACK  = 63
NIFTY500  = "NSE:NIFTY500-INDEX"
NIFTY50   = "NSE:NIFTY50-INDEX"

_log_conn = None


def _get_log_conn():
    global _log_conn
    if _log_conn is None or _log_conn.closed:
        _log_conn = psycopg2.connect(NEON_URL)
    return _log_conn


def log(msg):
    print(msg, flush=True)
    try:
        c = _get_log_conn()
        cur = c.cursor()
        cur.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ("sector_rs", msg))
        c.commit()
        cur.close()
    except Exception:
        pass


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
            log("⏳ Rate limit hit — cooling 45s")
            time.sleep(45)
            continue
        if attempt < retries - 1:
            time.sleep(3)
    return {}


def fetch_nifty_closes(fyers):
    """Fetch Nifty500 daily closes from Fyers. Falls back to Nifty50."""
    today_ist  = datetime.now(IST).date()
    range_from = (today_ist - timedelta(days=140)).strftime("%Y-%m-%d")
    range_to   = today_ist.strftime("%Y-%m-%d")

    for symbol in (NIFTY500, NIFTY50):
        res = fetch_safe(fyers, {
            "symbol": symbol, "resolution": "1D", "date_format": "1",
            "range_from": range_from, "range_to": range_to, "cont_flag": "1",
        })
        if res.get("candles"):
            df = pd.DataFrame(res["candles"], columns=["ts", "open", "high", "low", "close", "vol"])
            df["date"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata").dt.date
            s = df.set_index("date")["close"].map(float)
            log(f"✅ Nifty benchmark ({symbol}): {len(s)} days  ({s.index[0]} to {s.index[-1]})")
            return s
        log(f"⚠️  {symbol} failed, trying fallback...")

    return pd.Series(dtype=float)


def ensure_table(cursor, conn):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sector_rs_history (
            id             SERIAL PRIMARY KEY,
            group_type     TEXT    NOT NULL,
            group_name     TEXT    NOT NULL,
            trade_date     DATE    NOT NULL,
            rs_ratio       DOUBLE PRECISION NOT NULL,
            stock_count    INTEGER NOT NULL,
            sector_return  DOUBLE PRECISION,
            UNIQUE (group_type, group_name, trade_date)
        )
    """)
    cursor.execute("""
        ALTER TABLE sector_rs_history ADD COLUMN IF NOT EXISTS sector_return DOUBLE PRECISION
    """)
    conn.commit()


def run(backfill=False):
    """
    Single-pass: fetch Nifty from Fyers, load groups + closes from DB,
    compute RS ratios, write to sector_rs_history. No pkl, no large RAM usage.
    """
    log("=" * 55)
    log(f"Sector RS Snapshot  |  backfill={backfill}  |  window={LOOKBACK}d")
    log("=" * 55)

    # ── Step 1: Nifty benchmark from Fyers ───────────────────────────────────
    log("[1/5] Fetching Nifty500 benchmark from Fyers...")
    fyers        = get_fyers()
    nifty_closes = fetch_nifty_closes(fyers)
    if nifty_closes.empty:
        log("❌ Could not fetch benchmark. Aborting.")
        return False

    all_dates_window = sorted(nifty_closes.index)[-LOOKBACK:]
    anchor_date      = all_dates_window[0]

    if backfill:
        write_dates = all_dates_window
    else:
        # Auto catch-up: find any missing dates in the last 5 trading days
        conn_check = psycopg2.connect(NEON_URL)
        cur_check  = conn_check.cursor()
        cur_check.execute("""
            SELECT DISTINCT trade_date FROM sector_rs_history
            WHERE group_type = 'sector'
              AND trade_date = ANY(%s)
        """, (all_dates_window[-10:],))
        already_written = {r[0] for r in cur_check.fetchall()}
        cur_check.close()
        conn_check.close()
        write_dates = [d for d in all_dates_window[-10:] if d not in already_written]
        if not write_dates:
            log("✅ All recent dates already written — nothing to do.")
            return True
        if len(write_dates) > 1:
            log(f"⚠️  Catching up {len(write_dates)} missed dates: {write_dates}")
        else:
            log(f"   Writing date: {write_dates[0]}")
    nifty_anchor     = float(nifty_closes[anchor_date])
    log(f"   anchor={anchor_date}  write_dates={len(write_dates)}  ({write_dates[0]} to {write_dates[-1]})")

    # ── Step 2: Groups from stocks table ─────────────────────────────────────
    log("[2/5] Loading stock groups from DB...")
    conn   = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()
    ensure_table(cursor, conn)

    cursor.execute("""
        SELECT fyers_symbol, sector, industry, basic_industry
        FROM stocks
        WHERE sector IS NOT NULL AND sector != ''
          AND fyers_symbol IS NOT NULL
    """)
    stock_rows = cursor.fetchall()
    groups = {"sector": {}, "industry": {}, "basic_industry": {}}
    for sym, sec, ind, bi in stock_rows:
        if sec: groups["sector"].setdefault(sec, []).append(sym)
        if ind: groups["industry"].setdefault(ind, []).append(sym)
        if bi:  groups["basic_industry"].setdefault(bi, []).append(sym)
    log(f"   {len(stock_rows)} stocks | {len(groups['sector'])} sectors | "
        f"{len(groups['industry'])} industries | {len(groups['basic_industry'])} basic industries")

    # ── Step 3: Load only needed closes from daily_ohlcv ─────────────────────
    needed_dates = sorted(set(write_dates) | {anchor_date})
    log(f"[3/5] Loading closes for {len(needed_dates)} needed dates from daily_ohlcv...")
    t0 = time.time()
    cursor.execute("""
        SELECT fyers_symbol, to_timestamp(date)::date AS trade_date, close
        FROM daily_ohlcv
        WHERE to_timestamp(date)::date = ANY(%s)
    """, (needed_dates,))
    rows = cursor.fetchall()
    log(f"   {len(rows)} rows fetched in {time.time()-t0:.1f}s")

    stock_day    = {}   # sym -> {date: float close}
    stock_anchor = {}   # sym -> float anchor close
    for sym, td, close in rows:
        if close is None:
            continue
        stock_day.setdefault(sym, {})[td] = float(close)
    for sym, day_map in stock_day.items():
        if anchor_date in day_map:
            stock_anchor[sym] = day_map[anchor_date]
    log(f"   {len(stock_anchor)} stocks have anchor-date data")

    # ── Step 4: Compute RS ratios ─────────────────────────────────────────────
    log("[4/5] Computing RS ratios...")
    group_type_list = list(groups.items())
    total_types     = len(group_type_list)
    all_batches     = {}

    for t_idx, (group_type, group_dict) in enumerate(group_type_list):
        n_groups = len(group_dict)
        log(f"   [{t_idx+1}/{total_types}] {group_type} — {n_groups} groups x {len(write_dates)} dates")
        t0      = time.time()
        batch   = []
        skipped = 0

        for g_idx, (group_name, symbols) in enumerate(group_dict.items()):
            eligible = [s for s in symbols if s in stock_anchor]
            if not eligible:
                skipped += 1
                continue

            for trade_date in write_dates:
                if trade_date not in nifty_closes.index:
                    continue
                nifty_now = float(nifty_closes[trade_date])
                if not nifty_now:
                    continue

                paired = [s for s in eligible if trade_date in stock_day.get(s, {})]
                if not paired:
                    continue

                avg_return   = sum(stock_day[s][trade_date] / stock_anchor[s]
                                   for s in paired) / len(paired)
                nifty_return = nifty_now / nifty_anchor
                rs_ratio     = avg_return / nifty_return

                batch.append((
                    str(group_type), str(group_name), str(trade_date),
                    round(float(rs_ratio), 6), int(len(paired)),
                    round(float(avg_return), 6),
                ))

            if (g_idx + 1) % 50 == 0 or (g_idx + 1) == n_groups:
                pct = round((g_idx + 1) / n_groups * 100)
                log(f"     {g_idx+1}/{n_groups} groups ({pct}%) — {len(batch)} rows computed so far")

        log(f"   {group_type} computed: {len(batch)} rows | {skipped} skipped | {time.time()-t0:.2f}s")
        all_batches[group_type] = batch

    # ── Step 5: Write to DB ───────────────────────────────────────────────────
    log("[5/5] Writing to DB...")
    total_written = 0
    for group_type, batch in all_batches.items():
        t0 = time.time()
        execute_values(
            cursor,
            """
            INSERT INTO sector_rs_history (group_type, group_name, trade_date, rs_ratio, stock_count, sector_return)
            VALUES %s
            ON CONFLICT (group_type, group_name, trade_date)
            DO UPDATE SET rs_ratio = EXCLUDED.rs_ratio, stock_count = EXCLUDED.stock_count, sector_return = EXCLUDED.sector_return
            """,
            [(gt, gn, td, rs, sc, sr) for gt, gn, td, rs, sc, sr in batch],
            template="(%s, %s, %s::date, %s, %s, %s)",
            page_size=1000,
        )
        conn.commit()
        total_written += len(batch)
        log(f"   {group_type}: {len(batch)} rows written in {time.time()-t0:.2f}s")

    cursor.close()
    conn.close()
    log(f"")
    log(f"Sector RS Snapshot complete — {total_written} total rows written.")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill",          action="store_true", help="Write last 63 days")
    parser.add_argument("--wipe-and-backfill", action="store_true", help="Wipe history and recompute all 63 days")
    args = parser.parse_args()

    if args.wipe_and_backfill:
        conn = psycopg2.connect(NEON_URL)
        cur  = conn.cursor()
        cur.execute("TRUNCATE TABLE sector_rs_history")
        conn.commit()
        cur.close()
        conn.close()
        log("sector_rs_history wiped — running full backfill...")
        run(backfill=True)
    else:
        run(backfill=args.backfill)
