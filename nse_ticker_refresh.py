"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives.
2. Upserts all stocks into Neon DB, deletes delisted ones.
3. Clears daily_ohlcv cache.
4. Fetches sector/industry/basic_industry for all stocks from NSE GetQuoteApi.
   Updates DB only when classification changed or blank (delta update).
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


def log(cur, conn, msg):
    print(msg)
    try:
        cur.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ("nse_refresh", msg))
        conn.commit()
    except Exception:
        pass


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
    conn = psycopg2.connect(NEON_URL)
    cur  = conn.cursor()
    ensure_schema(cur)
    cur.execute("DELETE FROM job_progress WHERE job = 'nse_refresh'")
    conn.commit()

    log(cur, conn, "NSE Ticker Refresh - Starting")

    # Step 1: Download stock list
    log(cur, conn, "[1/3] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list()
    total = len(stock_list)
    log(cur, conn, f"[1/3] OK {total} stocks loaded from NSE")

    # Step 2: Upsert into DB & remove delisted
    log(cur, conn, "[2/3] Syncing stock list to Neon DB...")
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
    log(cur, conn, f"[2/3] OK Upserted {total} | Removed {deleted} delisted | daily_ohlcv cleared")

    # Step 3: Fetch classifications for all stocks, delta update
    cur.execute("SELECT fyers_symbol, sector, industry, basic_industry FROM stocks ORDER BY fyers_symbol")
    all_stocks = cur.fetchall()
    log(cur, conn, f"[3/3] Fetching classifications for all {len(all_stocks)} stocks...")

    updated   = 0
    unchanged = 0
    no_data   = 0

    for i, (fyers_sym, db_sector, db_industry, db_basic) in enumerate(all_stocks):
        base   = fyers_sym.split(":")[1].rsplit("-", 1)[0]
        series = fyers_sym.split(":")[1].rsplit("-", 1)[-1]

        time.sleep(DELAY)
        data = fetch_classification(base, series)

        if not data:
            time.sleep(2)
            data = fetch_classification(base, series)

        if data:
            is_blank   = not (db_sector or db_industry or db_basic)
            is_changed = (data["sector"]        != (db_sector   or "") or
                          data["industry"]       != (db_industry or "") or
                          data["basic_industry"] != (db_basic    or ""))
            if is_blank or is_changed:
                cur.execute("""
                    UPDATE stocks SET sector = %s, industry = %s, basic_industry = %s
                    WHERE fyers_symbol IN (%s, %s, %s, %s)
                """, (data["sector"], data["industry"], data["basic_industry"],
                      f"NSE:{base}-EQ", f"NSE:{base}-BE", f"NSE:{base}-BZ", f"NSE:{base}-BL"))
                updated += cur.rowcount
                tag = "NEW" if is_blank else "CHANGED"
                log(cur, conn, f"  {fyers_sym} [{tag}] -> {data['sector']} / {data['industry']}")
            else:
                unchanged += 1
        else:
            no_data += 1

        if (i + 1) % 20 == 0:
            conn.commit()
            log(cur, conn, f"  Progress: {i+1}/{len(all_stocks)} fetched | {updated} updated | {unchanged} unchanged")

    conn.commit()
    log(cur, conn, f"[3/3] OK {updated} updated | {unchanged} unchanged | {no_data} no data from NSE")

    # Step 1: Apply known canonical mappings (ALL-CAPS NSE values with wrong names)
    SECTOR_MAP = {
        'AUTOMOBILE':          'Automobile and Auto Components',
        'CONSTRUCTION':        'Construction',
        'HEALTHCARE SERVICES': 'Healthcare',
        'SERVICES':            'Services',
    }
    INDUSTRY_MAP = {
        'AUTO ANCILLARIES':                                  'Auto Components',
        'CONSTRUCTION':                                      'Construction',
        'HEALTHCARE SERVICES':                               'Healthcare Services',
        'HOTELS/ RESORTS AND OTHER RECREATIONAL ACTIVITIES': 'Leisure Services',
        'TRADING':                                           'Commercial Services & Supplies',
    }
    norm_count = 0
    for bad, good in SECTOR_MAP.items():
        cur.execute('UPDATE stocks SET sector = %s WHERE sector = %s', (good, bad))
        norm_count += cur.rowcount
    for bad, good in INDUSTRY_MAP.items():
        cur.execute('UPDATE stocks SET industry = %s WHERE industry = %s', (good, bad))
        norm_count += cur.rowcount
        cur.execute('UPDATE stocks SET basic_industry = %s WHERE basic_industry = %s', (good, bad))
        norm_count += cur.rowcount
    conn.commit()

    # Step 2: For any remaining ALL-CAPS values not in the map, title-case them
    known_caps = set(SECTOR_MAP) | set(INDUSTRY_MAP)
    for col in ('sector', 'industry', 'basic_industry'):
        cur.execute(f"SELECT DISTINCT {col} FROM stocks WHERE {col} = UPPER({col}) AND {col} != 'Unclassified'")
        for (val,) in cur.fetchall():
            if not val or val in known_caps:
                continue
            fixed = val.title()
            cur.execute(f'UPDATE stocks SET {col} = %s WHERE {col} = %s', (fixed, val))
            if cur.rowcount:
                log(cur, conn, f"  Normalized {col}: '{val}' -> '{fixed}' ({cur.rowcount} rows)")
                norm_count += cur.rowcount
    conn.commit()
    if norm_count:
        log(cur, conn, f"  Total normalized: {norm_count} value(s)")
    else:
        log(cur, conn, "  No normalization needed")

    # Fill any remaining NULLs with Unclassified
    cur.execute("""
        UPDATE stocks SET
            sector         = COALESCE(NULLIF(sector, ''),         'Unclassified'),
            industry       = COALESCE(NULLIF(industry, ''),       'Unclassified'),
            basic_industry = COALESCE(NULLIF(basic_industry, ''), 'Unclassified')
        WHERE sector IS NULL OR sector = ''
           OR industry IS NULL OR industry = ''
           OR basic_industry IS NULL OR basic_industry = ''
    """)
    fallback = cur.rowcount
    conn.commit()
    if fallback:
        log(cur, conn, f"  {fallback} stock(s) set to Unclassified (no NSE data)")

    log(cur, conn, f"NSE Ticker Refresh Complete — {total} synced, {deleted} removed")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
