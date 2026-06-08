"""
Uses Playwright (real browser) to fetch sector/industry/basic_industry
from NSE for stocks missing classifications in the DB.

Usage:
  pip install playwright
  playwright install chromium
  python fix_missing_classifications.py
"""

import time
import asyncio
import psycopg2
from playwright.async_api import async_playwright
from config import NEON_URL

async def main():
    conn = psycopg2.connect(NEON_URL)
    cur  = conn.cursor()

    # Fetch stocks missing sector
    cur.execute("""
        SELECT DISTINCT fyers_symbol
        FROM stocks
        WHERE sector IS NULL OR sector = ''
        ORDER BY fyers_symbol
    """)
    rows = cur.fetchall()
    symbols = [r[0] for r in rows]
    print(f"Found {len(symbols)} stocks missing sector classification")

    if not symbols:
        print("Nothing to fix.")
        cur.close()
        conn.close()
        return

    results = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        # Initialize session by visiting NSE
        print("Initializing NSE session...")
        await page.goto("https://www.nseindia.com/get-quote/equity/RELIANCE", wait_until="networkidle")
        await asyncio.sleep(3)

        for i, fyers_sym in enumerate(symbols):
            # Extract base symbol e.g. NSE:GENSOL-BZ -> GENSOL
            base = fyers_sym.split(":")[1].rsplit("-", 1)[0]
            url  = f"https://www.nseindia.com/api/quote-equity?symbol={base}"

            try:
                resp = await page.evaluate(f"""
                    async () => {{
                        const r = await fetch("{url}", {{
                            headers: {{
                                "Accept": "application/json",
                                "Referer": "https://www.nseindia.com/get-quote/equity/{base}"
                            }}
                        }});
                        return r.ok ? r.json() : null;
                    }}
                """)

                if resp and resp.get("industryInfo"):
                    info = resp["industryInfo"]
                    sector         = info.get("sector", "")
                    industry       = info.get("industry", "")
                    basic_industry = info.get("basicIndustry", "")
                    if sector or industry or basic_industry:
                        results[base] = {"sector": sector, "industry": industry, "basic_industry": basic_industry}
                        print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> {sector} / {industry} / {basic_industry}")
                    else:
                        print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> no industryInfo data")
                else:
                    print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> null response")

                # Refresh session every 50 stocks
                if (i + 1) % 50 == 0:
                    print("  Refreshing session...")
                    await page.goto("https://www.nseindia.com/get-quote/equity/RELIANCE", wait_until="networkidle")
                    await asyncio.sleep(3)

            except Exception as e:
                print(f"  [{i+1}/{len(symbols)}] {fyers_sym} -> ERROR: {e}")

            await asyncio.sleep(0.5)

        await browser.close()

    # Write to DB
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

    # Show remaining missing
    cur.execute("SELECT COUNT(*) FROM stocks WHERE sector IS NULL OR sector = ''")
    still_missing = cur.fetchone()[0]
    print(f"Still missing sector: {still_missing}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    asyncio.run(main())
