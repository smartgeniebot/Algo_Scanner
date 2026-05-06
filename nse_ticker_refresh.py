"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives.
2. Smoke test: verifies quote-equity API works with 5 stocks.
3. Upserts all stocks into Neon DB, deletes delisted ones.
4. Fetches sector, industry & basic_industry for all stocks (multithreaded).
5. Updates classifications in Neon DB.

Root cause fix: Accept-Encoding must be 'gzip, deflate' only.
Adding 'br' causes NSE to return Brotli which requests cannot decode.
"""

import csv, io, os, time, requests, psycopg2
from psycopg2.extras import execute_values
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

NEON_URL  = os.environ["NEON_URL"]
WORKERS   = 10
DELAY     = 0.3
BATCH_LOG = 100

# Series codes to try in order when the primary series fails for Fyers/NSE lookups
SERIES_FALLBACK = ["EQ", "BE", "BZ", "SM", "ST", "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9"]

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


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    session.get("https://www.nseindia.com/get-quote/equity/RELIANCE", timeout=15)
    time.sleep(2)
    return session


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


def fetch_classification(symbol: str, session: requests.Session) -> dict:
    """Fetch sector, industry AND basic_industry from NSE in a single API call."""
    try:
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
    except Exception:
        pass
    return {"symbol": symbol, "sector": "", "industry": "", "basic_industry": ""}


def fetch_classification_with_retry(symbol: str, primary_series: str, session: requests.Session, conn) -> dict:
    """
    Try fetching NSE classification. If it fails and the stored series might be wrong,
    try alternate series codes and save the correct one to DB.
    Returns the classification dict (sector/industry/basic_industry) plus the working series.
    """
    result = fetch_classification(symbol, session)
    if result["sector"] or result["industry"] or result["basic_industry"]:
        return result, primary_series  # primary series works fine

    # Primary series failed — try other series codes
    tried = {primary_series}
    for alt_series in SERIES_FALLBACK:
        if alt_series in tried:
            continue
        tried.add(alt_series)
        time.sleep(DELAY)
        result = fetch_classification(symbol, session)
        if result["sector"] or result["industry"] or result["basic_industry"]:
            # Found a working series — persist it in DB
            try:
                cur = conn.cursor()
                new_fyers = f"NSE:{symbol}-{alt_series}"
                old_fyers = f"NSE:{symbol}-{primary_series}"
                cur.execute("""
                    UPDATE stocks SET series = %s, fyers_symbol = %s
                    WHERE fyers_symbol = %s
                """, (alt_series, new_fyers, old_fyers))
                conn.commit()
                cur.close()
                print(f"      🔄 Series fix: {symbol} {primary_series}→{alt_series} saved to DB")
            except Exception as e:
                print(f"      ⚠️ Could not save series fix for {symbol}: {e}")
            return result, alt_series

    return {"symbol": symbol, "sector": "", "industry": "", "basic_industry": ""}, primary_series


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
        r = fetch_classification(sym, session)
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

    # Build a symbol→series map from the stock list for retry logic
    symbol_series_map = {s["symbol"]: s["series"] for s in stock_list}

    # ── Step 3: Fetch sector, industry & basic_industry in parallel ──
    log_progress(f"🌐 [3/4] Fetching classifications ({WORKERS} threads, {total} stocks)...")
    classified = {}
    failed     = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_classification, s["symbol"], session): s["symbol"]
                   for s in stock_list}
        for future in as_completed(futures):
            done_count += 1
            result = future.result()
            sym = result["symbol"]
            if result["sector"] or result["industry"] or result["basic_industry"]:
                classified[sym] = result
            else:
                failed += 1
                classified[sym] = None  # placeholder for retry
            if done_count % BATCH_LOG == 0 or done_count == total:
                good = sum(1 for v in classified.values() if v is not None)
                log_progress(f"  ↳ {done_count}/{total} fetched — {good} classified, {failed} failed")

    # ── Series retry for failed symbols ─────────────────────────
    failed_symbols = [sym for sym, v in classified.items() if v is None]
    if failed_symbols:
        log_progress(f"🔄 Retrying {len(failed_symbols)} failed symbols with alternate series codes...")
        recovered = 0
        for sym in failed_symbols:
            primary = symbol_series_map.get(sym, "EQ")
            result, working_series = fetch_classification_with_retry(sym, primary, session, conn)
            if result["sector"] or result["industry"] or result["basic_industry"]:
                classified[sym] = result
                recovered += 1
            else:
                del classified[sym]
        log_progress(f"  ↳ Recovered {recovered}/{len(failed_symbols)} via series retry")

    classified = {k: v for k, v in classified.items() if v is not None}
    log_progress(f"✅ {len(classified)}/{total} stocks classified")

    # ── Step 4: Write to DB ──────────────────────────────────────
    log_progress(f"💾 [4/4] Writing classifications to DB...")
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
