"""
NSE Ticker Refresh — runs via GitHub Actions.
1. Downloads EQUITY_L.csv from NSE archives (GitHub IPs not blocked for this).
2. Upserts all stocks into Neon DB, deletes delisted ones.
3. Reads sector & industry from nse_classifications.json (committed to repo).
4. Updates sector & industry in Neon DB.

nse_classifications.json is generated locally by fetch_classifications.py
and committed to the repo. Run that script once a month before pushing.
"""

import csv, io, json, os
import psycopg2
from psycopg2.extras import execute_values

NEON_URL = os.environ["NEON_URL"]

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading",
}


def fetch_equity_list() -> list[dict]:
    import requests, time
    session = requests.Session()
    session.get("https://www.nseindia.com", headers=BASE_HEADERS, timeout=15)
    time.sleep(1)
    resp = session.get(
        "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        headers=BASE_HEADERS, timeout=30,
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
    print("\n[1/3] Fetching EQUITY_L.csv from NSE archives...")
    stock_list = fetch_equity_list()
    total = len(stock_list)
    print(f"      ✅ {total} stocks loaded")

    # ── Step 2: Upsert into DB & remove delisted ─────────────────
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
    conn.commit()
    print(f"      ✅ Upserted {total} | Removed {deleted} delisted stocks")

    # ── Step 3: Apply classifications from JSON ──────────────────
    print("\n[3/3] Applying sector & industry from nse_classifications.json...")
    json_path = os.path.join(os.path.dirname(__file__), "nse_classifications.json")

    if not os.path.exists(json_path):
        print("      ⚠ nse_classifications.json not found — skipping classification update.")
        print("        Run fetch_classifications.py locally and commit the file.")
    else:
        with open(json_path) as f:
            classifications = json.load(f)

        updated = 0
        for sym, info in classifications.items():
            cur.execute("""
                UPDATE stocks SET sector = %s, industry = %s
                WHERE fyers_symbol IN (%s, %s, %s)
            """, (info.get("sector",""), info.get("industry",""),
                  f"NSE:{sym}-EQ", f"NSE:{sym}-BE", f"NSE:{sym}-BZ"))
            updated += cur.rowcount

        conn.commit()
        print(f"      ✅ {updated} rows updated with sector & industry")

    cur.close()
    conn.close()

    print("\n" + "=" * 60)
    print(f"✅ Done — {total} synced, {deleted} removed")
    print("=" * 60)


if __name__ == "__main__":
    main()
