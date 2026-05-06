"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives.
2. Smoke test: verifies quote-equity API works with 5 stocks.
3. Upserts all stocks into Neon DB, deletes delisted ones.
4. Fetches sector, industry & basic_industry for all stocks (multithreaded).
5. Updates classifications in Neon DB.

Root cause fix: Accept-Encoding must be 'gzip, deflate' only.
Adding 'br' causes NSE to return Brotli which requests cannot decode.

Session fix: NSE cookies expire mid-run (~500-1000 requests). A shared session
lock lets any thread detect 401/403 and refresh the session before continuing,
preventing cascade failures that corrupt 40%+ of results.
"""

import csv, io, os, time, requests, psycopg2
from psycopg2.extras import execute_values
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

NEON_URL  = os.environ["NEON_URL"]
WORKERS   = 10
DELAY     = 0.3
BATCH_LOG = 100

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",   # NO 'br' — brotli breaks requests decoding
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-site",
    "Connection": "keep-alive",
}

API_HEADERS = {
    **NSE_HEADERS,
    "Accept": "application/json, text/plain, */*",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

# Shared mutable session — refreshed when any thread sees 401/403
_session_lock = threading.Lock()
_shared_session: requests.Session | None = None


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(NSE_HEADERS)
    s.get("https://www.nseindia.com/get-quote/equity/RELIANCE", timeout=15)
    time.sleep(2)
    return s


def get_session() -> requests.Session:
    global _shared_session
    with _session_lock:
        if _shared_session is None:
            _shared_session = make_session()
        return _shared_session


def refresh_session() -> requests.Session:
    """Re-initialize the shared session. Called when any thread gets 401/403."""
    global _shared_session
    with _session_lock:
        print("      🔄 Session expired — refreshing NSE cookies...")
        _shared_session = make_session()
        return _shared_session


def fetch_equity_list(session: requests.Session) -> list[dict]:
    resp = session.get(
        "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        headers={**NSE_HEADERS, "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading"},
        timeout=30,
    )
    resp.raise_for_status()
    stocks = []
    for row in csv.DictReader(io.StringIO(resp.text)):
        symbol = row.get("SYMBOL", "").strip()
        name   = row.get("NAME OF COMPANY", "").strip()
        series = row.get(" SERIES", "").strip()
        isin   = row.get(" ISIN NUMBER", "").strip()
        if symbol:
            stocks.append({
                "symbol": symbol, "name": name,
                "series": series, "isin": isin,
                "fyers_symbol": f"NSE:{symbol}-{series}",
            })
    return stocks


def fetch_classification(symbol: str) -> dict:
    """
    Fetch sector, industry AND basic_industry from NSE in a single API call.
    Uses the shared session; refreshes it on 401/403 and retries once.
    """
    empty = {"symbol": symbol, "sector": "", "industry": "", "basic_industry": ""}

    for attempt in range(2):  # try twice: once normally, once after session refresh
        try:
            session = get_session()
            time.sleep(DELAY)
            r = session.get(
                f"https://www.nseindia.com/api/quote-equity?symbol={symbol}",
                headers={**API_HEADERS, "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}"},
                timeout=15,
            )
            if r.status_code == 200:
                info = r.json().get("industryInfo", {})
                sector         = info.get("sector", "")
                industry       = info.get("industry", "")
                basic_industry = info.get("basicIndustry", "")
                if sector or industry or basic_industry:
                    return {
                        "symbol": symbol,
                        "sector": sector,
                        "industry": industry,
                        "basic_industry": basic_industry,
                    }
                # 200 but empty industryInfo — stock may genuinely have no classification
                return empty
            elif r.status_code in (401, 403):
                # Session cookie expired — refresh and retry
                if attempt == 0:
                    refresh_session()
                    continue
        except Exception:
            if attempt == 0:
                time.sleep(1)
                continue

    return empty


def ensure_schema(cur):
    cur.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS isin           TEXT;")
    cur.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS series         TEXT;")
    cur.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS basic_industry TEXT;")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id         SERIAL PRIMARY KEY,
            job        TEXT NOT NULL,
            line       TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'stocks_fyers_symbol_key'
            ) THEN
                ALTER TABLE stocks ADD CONSTRAINT stocks_fyers_symbol_key UNIQUE (fyers_symbol);
            END IF;
        END $$;
    """)


_log_conn = None

def log_progress(msg: str):
    """Write a progress line to the job_progress table so the site can stream it."""
    global _log_conn
    print(msg)
    try:
        if _log_conn is None or _log_conn.closed:
            _log_conn = psycopg2.connect(NEON_URL)
        cur = _log_conn.cursor()
        cur.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)",
                    ("nse_refresh", msg))
        _log_conn.commit()
        cur.close()
    except Exception as e:
        # Recover from aborted transaction
        try:
            _log_conn.rollback()
            cur = _log_conn.cursor()
            cur.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)",
                        ("nse_refresh", msg))
            _log_conn.commit()
            cur.close()
        except Exception:
            print(f"[log_progress error] {e}")


def main():
    print("=" * 60)
    print("NSE Ticker Refresh — Starting")
    print("=" * 60)

    # ── Init session ─────────────────────────────────────────────
    log_progress("🔄 Initializing NSE session...")
    get_session()  # warms up the shared session
    log_progress("✅ Session ready")

    # ── Step 1: Download stock list ──────────────────────────────
    log_progress("📥 [1/4] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list(get_session())
    total = len(stock_list)
    log_progress(f"✅ {total} stocks loaded from NSE")

    # ── Smoke test with 5 stocks ─────────────────────────────────
    log_progress("🔍 [TEST] Verifying NSE quote-equity API with 5 stocks...")
    test_symbols = ["RELIANCE", "INFY", "HDFCBANK", "TCS", "SBIN"]
    passed = 0
    for sym in test_symbols:
        r = fetch_classification(sym)
        if r["sector"]:
            log_progress(f"  ↳ ✅ {sym}: {r['sector']} / {r['industry']}")
            passed += 1
        else:
            log_progress(f"  ↳ ❌ {sym}: no data")

    if passed == 0:
        log_progress("❌ ABORT: All 5 test stocks failed. Not proceeding.")
        raise SystemExit(1)

    log_progress(f"  ↳ {passed}/5 passed — proceeding with full run")

    # ── Step 2: Upsert stock list into DB ────────────────────────
    log_progress("💾 [2/4] Syncing stock list to Neon DB...")
    conn = psycopg2.connect(NEON_URL)
    cur  = conn.cursor()
    ensure_schema(cur)
    conn.commit()

    execute_values(cur, """
        INSERT INTO stocks (stock_name, fyers_symbol, series, isin)
        VALUES %s
        ON CONFLICT (fyers_symbol) DO UPDATE SET
            stock_name = EXCLUDED.stock_name,
            series     = EXCLUDED.series,
            isin       = EXCLUDED.isin
    """, [(s["name"], s["fyers_symbol"], s["series"], s["isin"]) for s in stock_list])
    conn.commit()

    cur.execute("CREATE TEMP TABLE _nse_fresh (fyers_symbol TEXT) ON COMMIT DROP")
    execute_values(cur, "INSERT INTO _nse_fresh VALUES %s",
                   [(s["fyers_symbol"],) for s in stock_list])
    cur.execute("DELETE FROM stocks WHERE fyers_symbol NOT IN (SELECT fyers_symbol FROM _nse_fresh)")
    deleted = cur.rowcount
    conn.commit()
    log_progress(f"✅ Upserted {total} stocks | Removed {deleted} delisted")

    # ── Step 3: Fetch classifications in parallel ────────────────
    log_progress(f"🌐 [3/4] Fetching classifications ({WORKERS} threads, {total} stocks)...")
    classified = {}
    failed     = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_classification, s["symbol"]): s["symbol"]
                   for s in stock_list}
        for future in as_completed(futures):
            done_count += 1
            result = future.result()
            sym = result["symbol"]
            if result["sector"] or result["industry"] or result["basic_industry"]:
                classified[sym] = result
            else:
                failed += 1
            if done_count % BATCH_LOG == 0 or done_count == total:
                log_progress(f"  ↳ {done_count}/{total} fetched — {len(classified)} classified, {failed} failed")

    log_progress(f"✅ {len(classified)}/{total} stocks classified")

    # ── Step 4: Write to DB ──────────────────────────────────────
    log_progress("💾 [4/4] Writing classifications to DB...")
    cur = conn.cursor()
    updated = 0
    for sym, info in classified.items():
        cur.execute("""
            UPDATE stocks
            SET sector = %s, industry = %s, basic_industry = %s
            WHERE fyers_symbol IN (%s, %s, %s)
        """, (info["sector"], info["industry"], info["basic_industry"],
              f"NSE:{sym}-EQ", f"NSE:{sym}-BE", f"NSE:{sym}-BZ"))
        updated += cur.rowcount

    conn.commit()
    cur.close()
    conn.close()
    log_progress(f"✅ {updated} rows updated in DB")
    log_progress(f"🎉 Done — {total} synced, {len(classified)} classified, {deleted} removed")


if __name__ == "__main__":
    main()
