"""
Fetch sector/industry/basic_industry from NSE GetQuoteApi for stocks
missing classifications in the DB.

Usage: python fix_missing_classifications.py
"""

import time
import requests
import psycopg2
from config import NEON_URL

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

def fetch_one(session, base, series):
    api_url = (f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"
               f"?functionName=getSymbolData&marketType=N&series={series}&symbol={base}")
    try:
        resp = session.get(api_url, headers={
            **BASE_HEADERS,
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://www.nseindia.com/get-quote/equity/{base}",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        }, timeout=10)
        if resp.status_code == 200:
            eq = resp.json().get("equityResponse", [{}])
            if eq:
                sec_info = eq[0].get("secInfo", {})
                sector         = sec_info.get("sector", "")
                industry       = sec_info.get("industryInfo", "")
                basic_industry = sec_info.get("basicIndustry", "")
                if sector or industry or basic_industry:
                    return {"sector": sector, "industry": industry, "basic_industry": basic_industry}
        return None
    except Exception:
        return None

def main():
    conn = psycopg2.connect(NEON_URL)
    cur  = conn.cursor()

    cur.execute("""
        SELECT DISTINCT fyers_symbol, stock_name
        FROM stocks
        WHERE sector IS NULL OR sector = ''
        ORDER BY fyers_symbol
    """)
    rows    = cur.fetchall()
    symbols = [(r[0], r[1] or '') for r in rows]
    print(f"Found {len(symbols)} stocks missing sector classification")

    if not symbols:
        print("Nothing to fix.")
        cur.close()
        conn.close()
        return

    session = make_session()
    results = {}

    for i, (fyers_sym, stock_name) in enumerate(symbols):
        base   = fyers_sym.split(":")[1].rsplit("-", 1)[0]
        series = fyers_sym.split(":")[1].rsplit("-", 1)[-1]

        time.sleep(0.5)
        data = fetch_one(session, base, series)

        if data:
            results[base] = data
            print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> {data['sector']} / {data['industry']} / {data['basic_industry']}")
        else:
            session = make_session()
            time.sleep(1)
            data = fetch_one(session, base, series)
            if data:
                results[base] = data
                print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> {data['sector']} / {data['industry']} / {data['basic_industry']}")
            else:
                print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> no data")

    print(f"\nUpdating DB for {len(results)} stocks...")
    updated = 0
    for base, info in results.items():
        cur.execute("""
            UPDATE stocks SET sector = %s, industry = %s, basic_industry = %s
            WHERE fyers_symbol IN (%s, %s, %s, %s)
        """, (info["sector"], info["industry"], info["basic_industry"],
              f"NSE:{base}-EQ", f"NSE:{base}-BE", f"NSE:{base}-BZ", f"NSE:{base}-BL"))
        updated += cur.rowcount

    conn.commit()
    print(f"Updated {updated} rows in DB")

    cur.execute("SELECT COUNT(*) FROM stocks WHERE sector IS NULL OR sector = ''")
    print(f"Still missing sector: {cur.fetchone()[0]}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
