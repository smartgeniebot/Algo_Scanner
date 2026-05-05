"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives.
2. Smoke test: verifies quote-equity API works with 5 stocks.
3. Upserts all stocks into Neon DB, deletes delisted ones.
4. Fetches sector & industry for all stocks (multithreaded).
5. Updates sector & industry in Neon DB.

Root cause fix: Accept-Encoding must be 'gzip, deflate' only.
Adding 'br' causes NSE to return Brotli which requests cannot decode.
"""

import csv, io, os, time, requests, psycopg2
from psycopg2.extras import execute_values
from concurrent.futures import ThreadPoolExecutor, as_completed

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
    try:
        time.sleep(DELAY)
        r = session.get(
            f"https://www.nseindia.com/api/quote-equity?symbol={symbol}",
            headers={**API_HEADERS, "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}"},
            timeout=15,
        )
        if r.status_code == 200:
            info = r.json().get("industryInfo", {})
            return {"symbol": symbol, "sector": info.get("sector", ""), "industry": info.get("industry", "")}
    except Exception:
        pass
    return {"symbol": symbol, "sector": "", "industry": ""}


def ensure_schema(cur):
    cur.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS isin   TEXT;")
    cur.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS series TEXT;")
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


def main():
    print("=" * 60)
    print("NSE Ticker Refresh — Starting")
    print("=" * 60)

    # ── Init session ─────────────────────────────────────────────
    print("\nInitializing NSE session...")
    session = make_session()
    print("      ✅ Session ready")

    # ── Step 1: Download stock list ──────────────────────────────
    print("\n[1/4] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list(session)
    total = len(stock_list)
    print(f"      ✅ {total} stocks loaded")

    # ── Smoke test with 5 stocks ─────────────────────────────────
    print("\n[TEST] Verifying quote-equity API with 5 stocks...")
    test_symbols = ["RELIANCE", "INFY", "HDFCBANK", "TCS", "SBIN"]
    passed = 0
    for sym in test_symbols:
        r = fetch_classification(sym, session)
        if r["sector"]:
            print(f"      ✅ {sym}: {r['sector']} / {r['industry']}")
            passed += 1
        else:
            print(f"      ❌ {sym}: no data")

    if passed == 0:
        print("\n❌ ABORT: All 5 test stocks failed. Not proceeding.")
        raise SystemExit(1)

    print(f"      {passed}/5 passed — proceeding with full run\n")

    # ── Step 2: Upsert stock list into DB ────────────────────────
    print("[2/4] Syncing stock list to Neon DB...")
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
    print(f"      ✅ Upserted {total} | Removed {deleted} delisted stocks")

    # ── Step 3: Fetch sector & industry in parallel ──────────────
    print(f"\n[3/4] Fetching sector & industry ({WORKERS} threads)...")
    classified = {}
    failed     = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_classification, s["symbol"], session): s["symbol"]
                   for s in stock_list}
        for future in as_completed(futures):
            done_count += 1
            result = future.result()
            if result["sector"] or result["industry"]:
                classified[result["symbol"]] = result
            else:
                failed += 1
            if done_count % BATCH_LOG == 0 or done_count == total:
                print(f"      ↳ {done_count}/{total} — {len(classified)} classified, {failed} failed")

    print(f"      ✅ {len(classified)}/{total} stocks classified")

    # ── Step 4: Write to DB ──────────────────────────────────────
    print(f"\n[4/4] Writing sector & industry to DB...")
    updated = 0
    for sym, info in classified.items():
        cur.execute("""
            UPDATE stocks SET sector = %s, industry = %s
            WHERE fyers_symbol IN (%s, %s, %s)
        """, (info["sector"], info["industry"],
              f"NSE:{sym}-EQ", f"NSE:{sym}-BE", f"NSE:{sym}-BZ"))
        updated += cur.rowcount

    conn.commit()
    cur.close()
    conn.close()
    print(f"      ✅ {updated} rows updated")

    print("\n" + "=" * 60)
    print(f"✅ Done — {total} synced, {len(classified)} classified, {deleted} removed")
    print("=" * 60)


if __name__ == "__main__":
    main()
