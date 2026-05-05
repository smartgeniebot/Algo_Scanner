"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives.
2. Upserts all stocks into Neon DB, deletes delisted ones.
3. Each thread creates its own NSE session (cookie) and fetches
   sector & industry via quote-equity API.
4. Updates sector & industry in Neon DB.
"""

import csv
import io
import os
import time
import requests
import psycopg2
from psycopg2.extras import execute_values
from concurrent.futures import ThreadPoolExecutor, as_completed

NEON_URL  = os.environ["NEON_URL"]
WORKERS   = 8
DELAY     = 0.5    # seconds between requests per thread (conservative)
BATCH_LOG = 100
MAX_RETRY = 2

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


def make_session() -> requests.Session:
    """Create a fresh requests session with a valid NSE cookie."""
    session = requests.Session()
    session.headers.update(BASE_HEADERS)
    try:
        session.get(
            "https://www.nseindia.com",
            headers={"Accept": "text/html,*/*", "Referer": "https://www.google.com/"},
            timeout=15,
        )
        time.sleep(0.5)
    except Exception as e:
        print(f"      ⚠ Session init warning: {e}")
    return session


def fetch_equity_list() -> list[dict]:
    """Download EQUITY_L.csv — GitHub IPs are not blocked for this."""
    session = make_session()
    url = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
    resp = session.get(
        url,
        headers={"Accept": "text/html,*/*",
                 "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading"},
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
                "symbol":       symbol,
                "name":         name,
                "series":       series,
                "isin":         isin,
                "fyers_symbol": f"NSE:{symbol}-{series}",
            })
    return stocks


def fetch_classification(symbol: str) -> dict:
    """
    Each call creates its own session so cookies are fresh per-request.
    Falls back to empty strings on failure.
    """
    api_headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }

    for attempt in range(1, MAX_RETRY + 1):
        try:
            session = make_session()
            time.sleep(DELAY)
            resp = session.get(
                f"https://www.nseindia.com/api/quote-equity?symbol={symbol}",
                headers=api_headers,
                timeout=15,
            )
            if resp.status_code == 200:
                info = resp.json().get("industryInfo", {})
                sector   = info.get("sector", "")
                industry = info.get("industry", "")
                if sector or industry:
                    return {"symbol": symbol, "sector": sector, "industry": industry}
            elif resp.status_code == 401:
                # Session expired mid-run — will retry with fresh session
                time.sleep(1)
        except Exception:
            time.sleep(1)

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

    # ── Step 1: Download stock list ──────────────────────────────
    print("\n[1/4] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list()
    total = len(stock_list)
    print(f"      ✅ {total} stocks loaded")

    # ── SMOKE TEST: verify quote-equity works before full run ────
    print("\n[TEST] Verifying NSE quote-equity API with 5 sample stocks...")
    test_symbols = ["RELIANCE", "INFY", "HDFCBANK", "TCS", "SBIN"]
    test_ok = 0
    for sym in test_symbols:
        result = fetch_classification(sym)
        if result["sector"]:
            print(f"      ✅ {sym}: {result['sector']} / {result['industry']}")
            test_ok += 1
        else:
            print(f"      ❌ {sym}: no data")

    if test_ok == 0:
        print("\n❌ ABORT: NSE API is not reachable from this environment.")
        print("   All 5 test stocks failed. Not proceeding with full run.")
        raise SystemExit(1)

    print(f"      {test_ok}/5 test stocks passed — proceeding with full run\n")

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

    # ── Step 3: Fetch sector & industry (parallel) ───────────────
    print(f"\n[3/4] Fetching sector & industry ({WORKERS} workers, {DELAY}s delay each)...")
    classified = {}
    failed     = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_classification, s["symbol"]): s["symbol"]
                   for s in stock_list}
        for future in as_completed(futures):
            done_count += 1
            result = future.result()
            if result["sector"] or result["industry"]:
                classified[result["symbol"]] = result
            else:
                failed += 1

            if done_count % BATCH_LOG == 0 or done_count == total:
                print(f"      ↳ {done_count}/{total} — "
                      f"{len(classified)} classified, {failed} failed")

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
