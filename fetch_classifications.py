"""
Run this locally (not on GitHub Actions) to fetch sector, industry &
basic_industry from NSE and save to nse_classifications.json.

Usage: python fetch_classifications.py
Then commit and push nse_classifications.json.
GitHub Actions will use this file to update the DB.
"""

import csv, io, json, time, requests
from concurrent.futures import ThreadPoolExecutor, as_completed

WORKERS   = 10
DELAY     = 0.2
BATCH_LOG = 100
OUTPUT    = "nse_classifications.json"

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}

def make_session():
    session = requests.Session()
    session.headers.update(BASE_HEADERS)
    # Use a stock page to init the session cookie (homepage returns 403 from some IPs)
    session.get("https://www.nseindia.com/get-quote/equity/RELIANCE", timeout=15)
    time.sleep(2)
    return session

def fetch_equity_list(session):
    """Download the live stock list from NSE — same source as GitHub Actions.
    This ensures fetch_classifications.py always works on the current official list,
    regardless of what's in the DB."""
    resp = session.get(
        "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        headers={"Accept": "text/html,*/*",
                 "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading"},
        timeout=30,
    )
    resp.raise_for_status()
    # Extract unique symbols (one symbol can appear in multiple series e.g. EQ, BE)
    seen = set()
    symbols = []
    for row in csv.DictReader(io.StringIO(resp.text)):
        sym = row.get("SYMBOL","").strip()
        if sym and sym not in seen:
            seen.add(sym)
            symbols.append(sym)
    return symbols

# One shared session — works locally since browser cookies are valid
_session = None

def fetch_one(symbol):
    global _session
    try:
        time.sleep(DELAY)
        resp = _session.get(
            f"https://www.nseindia.com/api/quote-equity?symbol={symbol}",
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
            },
            timeout=10,
        )
        if resp.status_code == 200:
            info = resp.json().get("industryInfo", {})
            return {
                "symbol": symbol,
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "basic_industry": info.get("basicIndustry", ""),
            }
        elif resp.status_code in (401, 403):
            # Refresh session on auth errors
            _session = make_session()
    except Exception:
        pass
    return {"symbol": symbol, "sector": "", "industry": "", "basic_industry": ""}

def main():
    global _session
    print("=" * 55)
    print("NSE Classification Fetcher — Local Run")
    print("=" * 55)

    _session = make_session()

    print("\n[1/2] Downloading stock list from NSE...")
    symbols = fetch_equity_list(_session)
    total   = len(symbols)
    print(f"      ✅ {total} symbols loaded")

    print(f"\n[2/2] Fetching sector, industry & basic_industry ({WORKERS} threads)...")
    results    = {}
    failed     = 0
    done_count = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_one, sym): sym for sym in symbols}
        for future in as_completed(futures):
            done_count += 1
            r = future.result()
            if r["sector"] or r["industry"] or r["basic_industry"]:
                results[r["symbol"]] = {
                    "sector": r["sector"],
                    "industry": r["industry"],
                    "basic_industry": r["basic_industry"],
                }
            else:
                failed += 1
            if done_count % BATCH_LOG == 0 or done_count == total:
                print(f"      ↳ {done_count}/{total} — {len(results)} classified, {failed} failed")

    print(f"\n      ✅ {len(results)}/{total} classified")

    with open(OUTPUT, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Saved to {OUTPUT}")
    print(f"   Next: git add {OUTPUT} && git commit -m 'update nse classifications' && git push")
    print("   Then click 'Refresh NSE Tickers' on the site to sync to DB.")
    print("=" * 55)

if __name__ == "__main__":
    main()
