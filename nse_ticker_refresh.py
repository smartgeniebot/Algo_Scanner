"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives (GitHub IPs are not blocked).
2. Upserts all stocks (name, fyers_symbol, series, isin) into Neon DB.
3. Deletes stocks no longer in the NSE list.
4. Fetches sector & industry for every symbol via NSE quote-equity API (multithreaded).
5. Updates sector & industry in Neon DB.
"""

import csv
import io
import os
import sys
import time
import requests
import psycopg2
from psycopg2.extras import execute_values
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

NEON_URL     = os.environ["NEON_URL"]
WORKERS      = 10
DELAY        = 0.15   # seconds between requests per thread
BATCH_LOG    = 100    # print progress every N stocks

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-site",
    "Connection": "keep-alive",
}


def get_session() -> requests.Session:
    session = requests.Session()
    session.get("https://www.nseindia.com", headers=NSE_HEADERS, timeout=15)
    time.sleep(1)
    session.get(
        "https://www.nseindia.com/market-data/securities-available-for-trading",
        headers=NSE_HEADERS, timeout=15,
    )
    time.sleep(1)
    return session


def fetch_equity_list(session: requests.Session) -> list[dict]:
    url  = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
    resp = session.get(url, headers=NSE_HEADERS, timeout=30)
    resp.raise_for_status()

    reader = csv.DictReader(io.StringIO(resp.text))
    stocks = []
    for row in reader:
        symbol = row.get("SYMBOL", "").strip()
        name   = row.get("NAME OF COMPANY", "").strip()
        series = row.get(" SERIES", "").strip()
        isin   = row.get(" ISIN NUMBER", "").strip()
        if not symbol:
            continue
        stocks.append({
            "symbol":       symbol,
            "name":         name,
            "series":       series,
            "isin":         isin,
            "fyers_symbol": f"NSE:{symbol}-{series}",
        })
    return stocks


def fetch_classification(symbol: str, session: requests.Session, lock: Lock) -> dict:
    url = f"https://www.nseindia.com/api/quote-equity?symbol={symbol}"
    api_headers = {
        **NSE_HEADERS,
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }
    try:
        with lock:
            time.sleep(DELAY)
            resp = session.get(url, headers=api_headers, timeout=10)
        if resp.status_code == 200:
            info = resp.json().get("industryInfo", {})
            return {
                "symbol":   symbol,
                "sector":   info.get("sector", ""),
                "industry": info.get("industry", ""),
            }
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

    # ── Step 1: Get session & download CSV ──────────────────────
    print("\n[1/4] Fetching EQUITY_L.csv from NSE archives...")
    session = get_session()
    stock_list = fetch_equity_list(session)
    total = len(stock_list)
    print(f"      ✅ {total} stocks loaded from EQUITY_L.csv")

    # ── Step 2: Upsert stock list into DB ────────────────────────
    print("\n[2/4] Syncing stock list to Neon DB...")
    conn = psycopg2.connect(NEON_URL)
    cur  = conn.cursor()
    ensure_schema(cur)
    conn.commit()

    upsert_rows = [(s["name"], s["fyers_symbol"], s["series"], s["isin"]) for s in stock_list]
    execute_values(cur, """
        INSERT INTO stocks (stock_name, fyers_symbol, series, isin)
        VALUES %s
        ON CONFLICT (fyers_symbol) DO UPDATE SET
            stock_name = EXCLUDED.stock_name,
            series     = EXCLUDED.series,
            isin       = EXCLUDED.isin
    """, upsert_rows)
    conn.commit()

    # Delete stocks no longer in NSE list using temp table
    cur.execute("CREATE TEMP TABLE _nse_fresh (fyers_symbol TEXT) ON COMMIT DROP")
    execute_values(cur, "INSERT INTO _nse_fresh VALUES %s",
                   [(s["fyers_symbol"],) for s in stock_list])
    cur.execute("DELETE FROM stocks WHERE fyers_symbol NOT IN (SELECT fyers_symbol FROM _nse_fresh)")
    deleted = cur.rowcount
    conn.commit()
    print(f"      ✅ Upserted {total} stocks | Removed {deleted} delisted stocks")

    # ── Step 3: Fetch sector & industry in parallel ──────────────
    print(f"\n[3/4] Fetching sector & industry ({WORKERS} threads, {DELAY}s delay)...")
    lock        = Lock()
    classified  = {}
    errors      = 0
    done_count  = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_classification, s["symbol"], session, lock): s["symbol"]
                   for s in stock_list}
        for future in as_completed(futures):
            done_count += 1
            result = future.result()
            sym = result["symbol"]
            if result["sector"] or result["industry"]:
                classified[sym] = result
            else:
                errors += 1

            if done_count % BATCH_LOG == 0 or done_count == total:
                print(f"      ↳ {done_count}/{total} fetched — "
                      f"{len(classified)} classified, {errors} failed")

    print(f"      ✅ Classification complete — {len(classified)}/{total} stocks classified")

    # ── Step 4: Write sector & industry to DB ───────────────────
    print(f"\n[4/4] Writing sector & industry to Neon DB...")
    updated = 0
    for sym, info in classified.items():
        cur.execute("""
            UPDATE stocks SET sector = %s, industry = %s
            WHERE fyers_symbol IN (%s, %s, %s)
        """, (
            info["sector"], info["industry"],
            f"NSE:{sym}-EQ", f"NSE:{sym}-BE", f"NSE:{sym}-BZ",
        ))
        updated += cur.rowcount

    conn.commit()
    cur.close()
    conn.close()
    print(f"      ✅ {updated} rows updated with sector & industry")

    print("\n" + "=" * 60)
    print(f"✅ Refresh Complete — {total} stocks synced, "
          f"{len(classified)} classified, {deleted} delisted removed")
    print("=" * 60)


if __name__ == "__main__":
    main()
