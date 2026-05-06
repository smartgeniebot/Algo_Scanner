import io
import requests
import pandas as pd
import psycopg2
from datetime import date, timedelta
from config import NEON_URL

BHAVCOPY_URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{date}.csv"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.nseindia.com",
    "Accept-Encoding": "gzip, deflate, br",
}
KEEP_DAYS = 14


def log(conn, cursor, msg):
    print(msg)
    try:
        cursor.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ("bhavcopy", msg))
        conn.commit()
    except Exception:
        pass


def ensure_table(cursor, conn):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS delivery_data (
            id           SERIAL PRIMARY KEY,
            symbol       TEXT NOT NULL,
            trade_date   DATE NOT NULL,
            delivery_pct NUMERIC(6,2),
            UNIQUE (symbol, trade_date)
        )
    """)
    conn.commit()


def fetch_bhavcopy(trade_date: date) -> pd.DataFrame | None:
    date_str = trade_date.strftime("%d%m%Y")
    url = BHAVCOPY_URL.format(date=date_str)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            return None
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = df.columns.str.strip()
        return df
    except Exception as e:
        print(f"Bhavcopy fetch error for {trade_date}: {e}")
        return None


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    col_map = {}
    for col in df.columns:
        lc = col.strip().lower()
        if lc in ("symbol", "series"):
            col_map[col] = lc
        elif "dly_qt" in lc or "deliv_qty" in lc or "deliverable" in lc:
            col_map[col] = "deliv_qty"
        elif "trd_qty" in lc or "ttl_trd_qnty" in lc or "total_traded" in lc:
            col_map[col] = "traded_qty"
        elif "deliv_per" in lc or "pct_dly" in lc or "% dly qt to" in lc:
            col_map[col] = "deliv_pct"
    df = df.rename(columns=col_map)
    if "series" in df.columns:
        df = df[df["series"].str.strip() == "EQ"]
    return df


def get_active_symbols(cursor) -> list[str]:
    cursor.execute("""
        SELECT fyers_symbol FROM stocks
        WHERE daily_cross_active = 'Yes'
           OR first_15m_cross_time IS NOT NULL
           OR first_1h_cross_time IS NOT NULL
    """)
    raw = [r[0] for r in cursor.fetchall() if r[0]]
    symbols = []
    for s in raw:
        ticker = s.split(":")[-1].split("-")[0].upper()
        symbols.append(ticker)
    return list(set(symbols))


def get_stored_dates(cursor) -> set:
    """Returns set of (symbol, trade_date) tuples already in DB."""
    cursor.execute("SELECT symbol, trade_date FROM delivery_data")
    return {(r[0], r[1]) for r in cursor.fetchall()}


def upsert_delivery(cursor, conn, symbol: str, trade_date: date, delivery_pct: float):
    cursor.execute("""
        INSERT INTO delivery_data (symbol, trade_date, delivery_pct)
        VALUES (%s, %s, %s)
        ON CONFLICT (symbol, trade_date) DO UPDATE SET delivery_pct = EXCLUDED.delivery_pct
    """, (symbol, trade_date, delivery_pct))
    conn.commit()


def purge_old_rows(cursor, conn):
    cutoff = date.today() - timedelta(days=KEEP_DAYS + 1)
    cursor.execute("DELETE FROM delivery_data WHERE trade_date < %s", (cutoff,))
    conn.commit()


def trading_days_last_n(n: int) -> list[date]:
    """Returns last n calendar days excluding weekends, most recent first."""
    days = []
    d = date.today()
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return days


def extract_pct(df: pd.DataFrame, symbol: str) -> float | None:
    if "symbol" not in df.columns:
        return None
    row = df[df["symbol"].str.strip() == symbol]
    if row.empty:
        return None
    if "deliv_pct" in df.columns:
        val = pd.to_numeric(row["deliv_pct"].iloc[0], errors="coerce")
    elif "deliv_qty" in df.columns and "traded_qty" in df.columns:
        dq = pd.to_numeric(row["deliv_qty"].iloc[0], errors="coerce")
        tq = pd.to_numeric(row["traded_qty"].iloc[0], errors="coerce")
        val = round((dq / tq) * 100, 2) if tq and tq > 0 else None
    else:
        return None
    return None if val is None or pd.isna(val) else float(val)


def main():
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    ensure_table(cursor, conn)
    log(conn, cursor, "📦 Bhavcopy Delivery Fetch — starting")

    active_symbols = get_active_symbols(cursor)
    if not active_symbols:
        log(conn, cursor, "⚠️ No active stocks found in DB — nothing to fetch")
        cursor.close()
        conn.close()
        return

    log(conn, cursor, f"  ↳ {len(active_symbols)} active stocks to track")

    stored = get_stored_dates(cursor)
    candidate_days = trading_days_last_n(KEEP_DAYS)

    # Find dates where at least one symbol is missing data
    dates_needed = []
    for d in candidate_days:
        missing = any((sym, d) not in stored for sym in active_symbols)
        if missing:
            dates_needed.append(d)

    if not dates_needed:
        log(conn, cursor, "✅ Delivery data already up to date for all stocks")
        cursor.close()
        conn.close()
        return

    log(conn, cursor, f"📅 Need to fetch {len(dates_needed)} date(s) — backfilling missing data...")

    total_saved = 0
    skipped_dates = 0

    for trade_date in reversed(dates_needed):  # oldest first
        log(conn, cursor, f"  ↳ Fetching {trade_date.strftime('%d-%b-%Y')}...")
        df = fetch_bhavcopy(trade_date)
        if df is None:
            log(conn, cursor, f"  ↳ Not available (holiday or not yet published) — skipping")
            skipped_dates += 1
            continue

        df = normalize_columns(df)
        saved = 0
        for sym in active_symbols:
            if (sym, trade_date) in stored:
                continue
            pct = extract_pct(df, sym)
            if pct is None:
                continue
            upsert_delivery(cursor, conn, sym, trade_date, pct)
            stored.add((sym, trade_date))
            saved += 1
            total_saved += 1

        log(conn, cursor, f"     ✅ {saved} stocks saved for {trade_date.strftime('%d-%b-%Y')}")

    purge_old_rows(cursor, conn)

    log(conn, cursor, f"🧹 Purged delivery data older than {KEEP_DAYS} days")
    log(conn, cursor, f"🎉 Done — {total_saved} records saved across {len(dates_needed) - skipped_dates} trading days")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    main()
