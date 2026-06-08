"""
Run this locally (not on GitHub Actions) to fetch sector, industry &
basic_industry from NSE and save to nse_classifications.json.

Usage: python fetch_classifications.py
Then commit and push nse_classifications.json.
GitHub Actions will use this file to update the DB.
"""

import csv, io, json, time, requests
from urllib.parse import quote

DELAY      = 0.5   # seconds between requests (single thread)
BATCH_LOG  = 100
OUTPUT     = "nse_classifications.json"
SESSION_REFRESH = 200  # refresh session every N requests

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}

API_HEADERS = {
    **BASE_HEADERS,
    "Accept": "application/json, text/plain, */*",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

def make_session():
    session = requests.Session()
    session.headers.update(BASE_HEADERS)
    # Visit two pages to properly initialize cookies
    session.get("https://www.nseindia.com/market-data/securities-available-for-trading",
                headers={**BASE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*"}, timeout=15)
    time.sleep(1)
    session.get("https://www.nseindia.com/get-quote/equity/RELIANCE",
                headers={**BASE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*"}, timeout=15)
    time.sleep(2)
    return session

def fetch_equity_list(session):
    resp = session.get(
        "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
        headers={**BASE_HEADERS, "Accept": "text/html,*/*",
                 "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading"},
        timeout=30,
    )
    resp.raise_for_status()
    seen = set()
    symbols = []
    for row in csv.DictReader(io.StringIO(resp.text)):
        sym = row.get("SYMBOL", "").strip()
        if sym and sym not in seen:
            seen.add(sym)
            symbols.append(sym)
    return symbols

def fetch_one(session, symbol):
    encoded = quote(symbol, safe="")
    try:
        resp = session.get(
            f"https://www.nseindia.com/api/quote-equity?symbol={encoded}",
            headers={**API_HEADERS,
                     "Referer": f"https://www.nseindia.com/get-quote/equity/{encoded}"},
            timeout=10,
        )
        if resp.status_code == 200:
            info = resp.json().get("industryInfo", {})
            sector         = info.get("sector", "")
            industry       = info.get("industry", "")
            basic_industry = info.get("basicIndustry", "")
            if sector or industry or basic_industry:
                return {"sector": sector, "industry": industry, "basic_industry": basic_industry}
        return None
    except Exception:
        return None

def main():
    print("=" * 55)
    print("NSE Classification Fetcher - Local Run")
    print("=" * 55)

    session = make_session()
    print("Session initialized")

    print("\n[1/2] Downloading stock list from NSE...")
    symbols = fetch_equity_list(session)
    total   = len(symbols)
    print(f"      {total} symbols loaded")

    # Load existing results so we can resume if interrupted
    try:
        with open(OUTPUT, encoding="utf-8") as f:
            results = json.load(f)
        print(f"      Resuming — {len(results)} already classified")
    except Exception:
        results = {}

    print(f"\n[2/2] Fetching classifications (single thread, {DELAY}s delay)...")
    failed  = []
    count   = 0

    for i, symbol in enumerate(symbols):
        if symbol in results:
            count += 1
            continue  # already fetched in a previous run

        # Refresh session periodically
        if i > 0 and i % SESSION_REFRESH == 0:
            print(f"      Refreshing session at {i}/{total}...")
            session = make_session()

        time.sleep(DELAY)
        data = fetch_one(session, symbol)
        count += 1

        if data:
            results[symbol] = data
        else:
            failed.append(symbol)
            # Retry once with a fresh session after consecutive failures
            if len(failed) >= 5 and all(f in failed[-5:] for f in failed[-5:]):
                print(f"      5 consecutive failures — refreshing session...")
                session = make_session()
                failed = []

        if count % BATCH_LOG == 0 or count == total:
            print(f"      {count}/{total} — {len(results)} classified, {len(failed)} failed this batch")
            # Save progress after every batch so we can resume
            with open(OUTPUT, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)

    # Final save
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nDone: {len(results)}/{total} classified")
    print(f"Saved to {OUTPUT}")
    print(f"Next: git add {OUTPUT} && git commit -m 'update nse classifications' && git push")
    print("=" * 55)

if __name__ == "__main__":
    main()
