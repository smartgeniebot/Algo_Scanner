"""
Run this locally (not on GitHub Actions) to fetch sector, industry &
basic_industry from NSE and save to nse_classifications.json.

Usage: python fetch_classifications.py
Then commit and push nse_classifications.json.
GitHub Actions will use this file to update the DB.
"""

import csv, io, json, time, requests
from urllib.parse import quote

DELAY         = 0.5
BATCH_LOG     = 100
OUTPUT        = "nse_classifications.json"
SESSION_REFRESH = 300

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
    session.get("https://www.nseindia.com", headers={**BASE_HEADERS, "Accept": "text/html,*/*"}, timeout=15)
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
    stocks = []
    for row in csv.DictReader(io.StringIO(resp.text)):
        sym    = row.get("SYMBOL", "").strip()
        series = row.get(" SERIES", "").strip()
        if sym and sym not in seen:
            seen.add(sym)
            stocks.append({"symbol": sym, "series": series})
    return stocks

def fetch_one(session, symbol, series):
    api_url = (f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"
               f"?functionName=getSymbolData&marketType=N&series={series}&symbol={quote(symbol, safe='')}")
    try:
        resp = session.get(api_url, headers={
            **BASE_HEADERS,
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
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

def main():
    print("=" * 55)
    print("NSE Classification Fetcher - Local Run")
    print("=" * 55)

    session = make_session()
    print("Session initialized")

    print("\n[1/2] Downloading stock list from NSE...")
    stocks = fetch_equity_list(session)
    total  = len(stocks)
    print(f"      {total} symbols loaded")

    # Resume from existing file if interrupted
    try:
        with open(OUTPUT, encoding="utf-8") as f:
            results = json.load(f)
        print(f"      Resuming — {len(results)} already classified")
    except Exception:
        results = {}

    print(f"\n[2/2] Fetching classifications ({DELAY}s delay)...")
    count  = 0
    failed = 0

    for i, stock in enumerate(stocks):
        symbol = stock["symbol"]
        series = stock["series"]

        if symbol in results:
            count += 1
            continue

        if i > 0 and i % SESSION_REFRESH == 0:
            print(f"      Refreshing session at {i}/{total}...")
            session = make_session()

        time.sleep(DELAY)
        data = fetch_one(session, symbol, series)
        count += 1

        if data:
            results[symbol] = data
        else:
            failed += 1

        if count % BATCH_LOG == 0 or count == total:
            print(f"      {count}/{total} — {len(results)} classified, {failed} failed")
            with open(OUTPUT, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nDone: {len(results)}/{total} classified")
    print(f"Saved to {OUTPUT}")
    print(f"Next: git add {OUTPUT} && git commit -m 'update nse classifications' && git push")
    print("=" * 55)

if __name__ == "__main__":
    main()
