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
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
import threading

NEON_URL        = os.environ["NEON_URL"]
WORKERS         = 3     # 3 workers × 1.0s delay = ~3 req/s total — safe for NSE
DELAY           = 1.0   # per-worker delay between requests
BATCH_LOG       = 100
SESSION_REFRESH = 300   # each worker refreshes its own session every N requests

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

REPLACEMENT_CHAR = '�'

def sanitize(text: str) -> str:
    """Replace Unicode replacement characters (garbled encoding) with ' & '."""
    if not text or REPLACEMENT_CHAR not in text:
        return text
    import re
    return re.sub(f'{REPLACEMENT_CHAR}+', ' & ', text).strip()


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(NSE_HEADERS)
    s.get("https://www.nseindia.com/get-quote/equity/RELIANCE", timeout=15)
    time.sleep(2)
    return s


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


_progress_lock = threading.Lock()
_done_count    = 0
_classified    = {}
_failed_syms   = []


def worker_fetch(symbols_chunk: list[str]) -> None:
    """
    Each worker owns its own NSE session and processes its chunk sequentially.
    Refreshes the session every SESSION_REFRESH requests to prevent cookie expiry.
    """
    global _done_count, _classified, _failed_syms

    session = make_session()
    for i, symbol in enumerate(symbols_chunk, 1):
        if i % SESSION_REFRESH == 0:
            session = make_session()

        empty = {"symbol": symbol, "sector": "", "industry": "", "basic_industry": ""}
        result = empty
        for attempt in range(3):  # up to 3 attempts per symbol
            try:
                time.sleep(DELAY if attempt == 0 else 3.0)  # backoff on retry
                encoded = quote(symbol, safe="")
                r = session.get(
                    f"https://www.nseindia.com/api/quote-equity?symbol={encoded}",
                    headers={**API_HEADERS, "Referer": f"https://www.nseindia.com/get-quote/equity/{encoded}"},
                    timeout=15,
                )
                if r.status_code == 200:
                    info = r.json().get("industryInfo", {})
                    sector         = sanitize(info.get("sector", ""))
                    industry       = sanitize(info.get("industry", ""))
                    basic_industry = sanitize(info.get("basicIndustry", ""))
                    if sector or industry or basic_industry:
                        result = {"symbol": symbol, "sector": sector,
                                  "industry": industry, "basic_industry": basic_industry}
                        break  # success — stop retrying
                # empty or non-200: refresh session before next attempt
                if attempt < 2:
                    session = make_session()
            except Exception:
                if attempt < 2:
                    session = make_session()

        with _progress_lock:
            _done_count += 1
            if result["sector"] or result["industry"] or result["basic_industry"]:
                _classified[symbol] = result
            else:
                _failed_syms.append(symbol)


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
    session = make_session()
    log_progress("✅ Session ready")

    # ── Step 1: Download stock list ──────────────────────────────
    log_progress("📥 [1/4] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list(session)
    total = len(stock_list)
    log_progress(f"✅ {total} stocks loaded from NSE")

    # ── Smoke test with 5 stocks ─────────────────────────────────
    log_progress("🔍 [TEST] Verifying NSE quote-equity API with 5 stocks...")
    test_symbols = ["RELIANCE", "INFY", "HDFCBANK", "TCS", "SBIN"]
    passed = 0
    for sym in test_symbols:
        try:
            time.sleep(DELAY)
            encoded_sym = quote(sym, safe="")
            r = session.get(
                f"https://www.nseindia.com/api/quote-equity?symbol={encoded_sym}",
                headers={**API_HEADERS, "Referer": f"https://www.nseindia.com/get-quote/equity/{encoded_sym}"},
                timeout=15,
            )
            info = r.json().get("industryInfo", {}) if r.status_code == 200 else {}
            sector = info.get("sector", "")
        except Exception:
            sector = ""
        if sector:
            log_progress(f"  ↳ ✅ {sym}: {sector} / {info.get('industry', '')}")
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

    # ── Step 3: Fetch classifications — 3 workers, each with own session ──
    est_min = int(total * DELAY / WORKERS / 60)
    log_progress(f"🌐 [3/4] Fetching classifications ({WORKERS} workers, {total} stocks, ~{est_min} min)...")

    global _done_count, _classified, _failed_syms
    _done_count = 0
    _classified = {}
    _failed_syms = []

    # Split stock list evenly across workers
    symbols = [s["symbol"] for s in stock_list]
    chunk_size = (len(symbols) + WORKERS - 1) // WORKERS
    chunks = [symbols[i:i + chunk_size] for i in range(0, len(symbols), chunk_size)]

    # Progress logger runs in main thread while workers fetch
    last_logged = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = [executor.submit(worker_fetch, chunk) for chunk in chunks]
        while any(f.running() for f in futures) or _done_count < total:
            time.sleep(5)
            with _progress_lock:
                done = _done_count
                good = len(_classified)
                bad  = len(_failed_syms)
            if done >= last_logged + BATCH_LOG or done == total:
                log_progress(f"  ↳ {done}/{total} fetched — {good} classified, {bad} failed")
                last_logged = done
            if done >= total:
                break
        # Wait for all futures to finish
        for f in futures:
            f.result()

    classified   = _classified
    failed_syms  = _failed_syms

    if failed_syms:
        log_progress(f"⚠️ {len(failed_syms)} unclassified: {', '.join(failed_syms)}")
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

    # ── Step 5: Normalize sector casing ─────────────────────────
    # NSE API occasionally returns ALL-CAPS sector names for some stocks.
    # Map any known bad variants to their correct canonical form.
    SECTOR_NORMALIZE = {
        'AUTOMOBILE':          'Automobile and Auto Components',
        'AUTO':                'Automobile and Auto Components',
        'CONSTRUCTION':        'Construction',
        'SERVICES':            'Services',
        'HEALTHCARE SERVICES': 'Healthcare',
        'HEALTHCARE':          'Healthcare',
        'IT':                  'Information Technology',
        'FMCG':                'Fast Moving Consumer Goods',
        'METALS & MINING':     'Metals & Mining',
        'OIL & GAS':           'Oil Gas & Consumable Fuels',
        'REALTY':              'Realty',
        'POWER':               'Power',
        'TELECOM':             'Telecommunication',
        'MEDIA':               'Media Entertainment & Publication',
        'CHEMICALS':           'Chemicals',
        'TEXTILES':            'Textiles',
        'UTILITIES':           'Utilities',
        'DIVERSIFIED':         'Diversified',
    }
    INDUSTRY_NORMALIZE = {
        'AUTO ANCILLARIES':                                   'Auto Components',
        'CONSTRUCTION':                                       'Construction',
        'HEALTHCARE SERVICES':                                'Healthcare Services',
        'HOTELS/ RESORTS AND OTHER RECREATIONAL ACTIVITIES':  'Leisure Services',
        'TRADING':                                            'Commercial Services & Supplies',
    }

    BASIC_INDUSTRY_NORMALIZE = {
        'HOTELS/RESORTS':                   'Hotels & Resorts',
        'AUTO ANCILLARIES':                 'Auto Components & Equipments',
        'HOSPITAL':                         'Hospital',
        'TRADING':                          'Trading & Distributors',
        'RESIDENTIAL/COMMERCIAL/SEZ Project': 'Residential Commercial Projects',
    }

    log_progress("🔧 [5/5] Normalizing sector, industry & basic_industry in DB...")
    normalized = 0

    # Pass 1: Fix known wrong-cased names
    for column, mapping in [('sector', SECTOR_NORMALIZE), ('industry', INDUSTRY_NORMALIZE), ('basic_industry', BASIC_INDUSTRY_NORMALIZE)]:
        for bad, good in mapping.items():
            cur = conn.cursor()
            cur.execute(f"UPDATE stocks SET {column} = %s WHERE {column} = %s", (good, bad))
            if cur.rowcount:
                log_progress(f"  ↳ Fixed {column}: '{bad}' → '{good}' ({cur.rowcount} rows)")
                normalized += cur.rowcount
            conn.commit()
            cur.close()

    # Pass 2: Fix garbled Unicode replacement characters (U+FFFD) in all classification columns
    import re
    REPL = '�'
    garbled_fixed = 0
    for column in ['sector', 'industry', 'basic_industry']:
        cur = conn.cursor()
        cur.execute(f"SELECT id, {column} FROM stocks WHERE {column} IS NOT NULL AND {column} LIKE %s", (f'%{REPL}%',))
        rows_to_fix = cur.fetchall()
        cur.close()
        for row_id, val in rows_to_fix:
            fixed = re.sub(f'{REPL}+', ' & ', val).strip()
            cur = conn.cursor()
            cur.execute(f"UPDATE stocks SET {column} = %s WHERE id = %s", (fixed, row_id))
            conn.commit()
            cur.close()
            garbled_fixed += 1
            log_progress(f"  ↳ Fixed garbled {column}: '{fixed}'")

    cur.close()
    conn.close()
    log_progress(f"✅ {updated} rows updated | {normalized} name(s) normalized | {garbled_fixed} garbled char(s) fixed")
    log_progress(f"🎉 Done — {total} synced, {len(classified)} classified, {deleted} removed")


if __name__ == "__main__":
    main()
