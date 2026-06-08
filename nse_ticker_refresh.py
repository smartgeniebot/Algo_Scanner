"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives.
2. Upserts all stocks into Neon DB, deletes delisted ones.
3. Clears daily_ohlcv cache.
4. Fetches sector/industry/basic_industry for stocks missing classifications
   using NSE GetQuoteApi (works from GitHub Actions, no browser session needed).
"""

import csv, io, os, time, requests, psycopg2
from psycopg2.extras import execute_values
from urllib.parse import quote

NEON_URL = os.environ["NEON_URL"]
DELAY    = 0.5

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}



def fetch_equity_list() -> list[dict]:
    resp = requests.get(
        "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        headers={**BASE_HEADERS, "Accept": "text/html,*/*"},
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


def fetch_classification(symbol, series):
    api_url = (f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"
               f"?functionName=getSymbolData&marketType=N&series={series}&symbol={quote(symbol, safe='')}")
    try:
        resp = requests.get(api_url, headers={
            "User-Agent": BASE_HEADERS["User-Agent"],
            "Accept": "application/json",
        }, timeout=10)
        if resp.status_code == 200:
            eq = resp.json().get("equityResponse", [{}])
            if eq:
                sec_info       = eq[0].get("secInfo", {})
                sector         = sec_info.get("sector", "")
                industry       = sec_info.get("industryInfo", "")
                basic_industry = sec_info.get("basicIndustry", "")
                if sector or industry or basic_industry:
                    return {"sector": sector, "industry": industry, "basic_industry": basic_industry}
        return None
    except Exception:
        return None


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


def main():
    print("=" * 60)
    print("NSE Ticker Refresh - Starting")
    print("=" * 60)

    # Step 1: Download stock list
    print("\n[1/3] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list()
    total = len(stock_list)
    print(f"      OK {total} stocks loaded")

    # Step 2: Upsert into DB & remove delisted
    print("\n[2/3] Syncing stock list to Neon DB...")
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

    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'daily_ohlcv') THEN
                TRUNCATE TABLE daily_ohlcv;
            END IF;
        END $$
    """)
    conn.commit()
    print(f"      OK Upserted {total} | Removed {deleted} delisted | daily_ohlcv cache cleared")

    # Step 3: Fetch classifications for stocks missing sector
    cur.execute("SELECT fyers_symbol FROM stocks WHERE sector IS NULL OR sector = '' ORDER BY fyers_symbol")
    missing = cur.fetchall()
    print(f"\n[3/3] Fetching classifications for {len(missing)} stocks missing sector...")

    if not missing:
        print("      OK All stocks already have classifications")
    else:
        updated = 0
        for i, (fyers_sym,) in enumerate(missing):
            base   = fyers_sym.split(":")[1].rsplit("-", 1)[0]
            series = fyers_sym.split(":")[1].rsplit("-", 1)[-1]

            time.sleep(DELAY)
            data = fetch_classification(base, series)

            if not data:
                time.sleep(2)
                data = fetch_classification(base, series)

            if data:
                cur.execute("""
                    UPDATE stocks SET sector = %s, industry = %s, basic_industry = %s
                    WHERE fyers_symbol IN (%s, %s, %s, %s)
                """, (data["sector"], data["industry"], data["basic_industry"],
                      f"NSE:{base}-EQ", f"NSE:{base}-BE", f"NSE:{base}-BZ", f"NSE:{base}-BL"))
                updated += cur.rowcount
                print(f"      [{i+1}/{len(missing)}] {fyers_sym} -> {data['sector']} / {data['industry']}")
            else:
                print(f"      [{i+1}/{len(missing)}] {fyers_sym} -> no data on NSE")

            if (i + 1) % 20 == 0:
                conn.commit()

        conn.commit()
        print(f"      OK {updated} rows updated with classifications")

    cur.close()
    conn.close()

    print("\n" + "=" * 60)
    print(f"OK Done — {total} synced, {deleted} removed")
    print("=" * 60)


if __name__ == "__main__":
    main()
