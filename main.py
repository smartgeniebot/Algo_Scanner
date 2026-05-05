from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from typing import List, Optional
from config import NEON_URL
import os
import io
import csv
import time
import json
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

app = FastAPI(title="Algo Scanner Cloud API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 🚀 UPGRADED: Added fundamentals to the request model
class IndustryRequest(BaseModel):
    industries: List[str]
    fundamentals: Optional[List[str]] = None

def get_db_connection():
    # Connecting to Neon Cloud
    return psycopg2.connect(NEON_URL)

@app.get("/api/filters")
async def get_filters():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor) 
    
    # 🛡️ THE FIX: Strictly ignore NULL and empty sectors/industries from the cloud
    cursor.execute("""
        SELECT DISTINCT sector, industry 
        FROM stocks 
        WHERE sector IS NOT NULL AND sector != '' 
          AND industry IS NOT NULL AND industry != ''
        ORDER BY sector, industry
    """)
    rows = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    hierarchy = {}
    for r in rows:
        if r["sector"] not in hierarchy: 
            hierarchy[r["sector"]] = []
        hierarchy[r["sector"]].append(r["industry"])
        
    return {"status": "success", "data": hierarchy}

@app.post("/api/stocks")
async def get_stocks(request: IndustryRequest):
    # 🚀 UPGRADED: Allow scanning if EITHER industries OR fundamentals are selected
    if not request.industries and not request.fundamentals: 
        return {"status": "success", "data": []}
        
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Base query logic
    query_conditions = ["daily_cross_active = 'Yes'"]
    query_params = []
    
    # 1. Handle Industry Filters
    if request.industries:
        placeholders = ', '.join(['%s'] * len(request.industries))
        query_conditions.append(f"industry IN ({placeholders})")
        query_params.extend(request.industries)
        
    # 2. Handle Fundamental Filters
    if request.fundamentals:
        fund_conditions = []
        if "high_growth" in request.fundamentals:
            fund_conditions.append("is_high_roce = True")
        if "moderate_growth" in request.fundamentals:
            fund_conditions.append("is_moderate_growth = True")
            
        # If any fundamental filters were checked, group them with an OR
        # Example output: AND (is_high_roce = True OR is_moderate_growth = True)
        if fund_conditions:
            query_conditions.append("(" + " OR ".join(fund_conditions) + ")")
            
    # Combine everything into the final SQL string
    where_clause = " AND ".join(query_conditions)
    
    query = f"""
        SELECT stock_name, fyers_symbol, industry, daily_cross_date, 
               first_15m_cross_time, first_1h_cross_time, rs_score
        FROM stocks 
        WHERE {where_clause}
    """
    
    cursor.execute(query, tuple(query_params))
    rows = cursor.fetchall()
    
    cursor.close()
    conn.close()

    return {"status": "success", "data": [dict(r) for r in rows]}

@app.get("/api/sector-heatmap")
async def get_sector_heatmap():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    sector_query = """
    SELECT 
        sector,
        COUNT(*) as total_stocks,
        ROUND(AVG(rs_score)::numeric, 3) as avg_rs,
        COUNT(CASE WHEN daily_cross_active = 'Yes' THEN 1 END) as active_crosses,
        ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(*)) * 100, 2) as outperforming_pct
    FROM stocks
    WHERE sector IS NOT NULL AND sector != ''
    GROUP BY sector
    ORDER BY avg_rs DESC
    """
    
    industry_query = """
    SELECT 
        sector,
        industry,
        COUNT(*) as total_stocks,
        ROUND(AVG(rs_score)::numeric, 3) as avg_rs,
        COUNT(CASE WHEN daily_cross_active = 'Yes' THEN 1 END) as active_crosses,
        ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(*)) * 100, 2) as outperforming_pct
    FROM stocks
    WHERE sector IS NOT NULL AND sector != '' AND industry IS NOT NULL AND industry != ''
    GROUP BY sector, industry
    ORDER BY avg_rs DESC
    """
    
    cursor.execute(sector_query)
    sectors = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute(industry_query)
    industries = [dict(row) for row in cursor.fetchall()]
    
    cursor.close()
    conn.close()
    
    for s in sectors:
        s['industries'] = [ind for ind in industries if ind['sector'] == s['sector']]
        
    return sectors

@app.get("/api/industry-heatmap")
async def get_industry_heatmap():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # 🛡️ THE FIX: Added 'sector' to the GROUP BY clause for PostgreSQL strictness
    industry_query = """
    SELECT 
        industry,
        sector,
        COUNT(*) as total_stocks,
        ROUND(AVG(rs_score)::numeric, 3) as avg_rs,
        COUNT(CASE WHEN daily_cross_active = 'Yes' THEN 1 END) as active_crosses,
        ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(*)) * 100, 2) as outperforming_pct
    FROM stocks
    WHERE industry IS NOT NULL AND industry != ''
    GROUP BY industry, sector
    ORDER BY avg_rs DESC
    """
    
    cursor.execute(industry_query)
    industries = [dict(row) for row in cursor.fetchall()]
    
    cursor.close()
    conn.close()
    return industries

def _fetch_industry_info(symbol: str, session: requests.Session, lock: Lock) -> dict:
    """Fetch sector and industry for one symbol from NSE quote-equity API."""
    url = f"https://www.nseindia.com/api/quote-equity?symbol={symbol}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.nseindia.com/get-quote/equity/{symbol}",
    }
    try:
        with lock:
            resp = session.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            info = data.get("industryInfo", {})
            return {
                "symbol": symbol,
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
            }
    except Exception:
        pass
    return {"symbol": symbol, "sector": "", "industry": ""}


@app.get("/api/refresh-nse-tickers")
async def refresh_nse_tickers():
    """
    Streams progress as Server-Sent Events (SSE).
    Steps:
      1. Download EQUITY_L.csv from NSE archives (all stocks, all series).
      2. Upsert stock list into DB; delete delisted stocks.
      3. Fetch sector & industry for every symbol in parallel (10 threads).
      4. Batch-update DB with classification data.
    """

    def event(msg: str, done: bool = False) -> str:
        payload = json.dumps({"message": msg, "done": done})
        return f"data: {payload}\n\n"

    def run():
        # ── Step 1: Download EQUITY_L.csv ──────────────────────────────────
        yield event("📥 Fetching stock list from NSE EQUITY_L.csv...")

        nse_csv_url = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
        http_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.nseindia.com/market-data/securities-available-for-trading",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-site",
            "Sec-Fetch-User": "?1",
        }
        session = requests.Session()
        try:
            # Hit the main site first to get cookies, then the securities page for correct referer context
            session.get("https://www.nseindia.com", headers=http_headers, timeout=15)
            time.sleep(1)
            session.get("https://www.nseindia.com/market-data/securities-available-for-trading",
                        headers=http_headers, timeout=15)
            time.sleep(1)
            resp = session.get(nse_csv_url, headers=http_headers, timeout=30)
            resp.raise_for_status()
        except Exception as e:
            yield event(f"❌ Failed to fetch EQUITY_L.csv: {e}", done=True)
            return

        reader = csv.DictReader(io.StringIO(resp.text))
        stock_list = []
        for row in reader:
            symbol    = row.get("SYMBOL", "").strip()
            name      = row.get("NAME OF COMPANY", "").strip()
            series    = row.get(" SERIES", "").strip()
            isin      = row.get(" ISIN NUMBER", "").strip()
            if not symbol:
                continue
            fyers_symbol = f"NSE:{symbol}-{series}"
            stock_list.append({"symbol": symbol, "name": name, "series": series,
                                "isin": isin, "fyers_symbol": fyers_symbol})

        total = len(stock_list)
        yield event(f"✅ {total} stocks found in EQUITY_L.csv")

        # ── Step 2: Upsert stock list & delete delisted ─────────────────────
        yield event("💾 Syncing stock list to database...")
        try:
            conn = get_db_connection()
            cur  = conn.cursor()

            cur.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS isin TEXT;")
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

            cur.execute("CREATE TEMP TABLE _nse_fresh (fyers_symbol TEXT) ON COMMIT DROP")
            execute_values(cur, "INSERT INTO _nse_fresh VALUES %s",
                           [(s["fyers_symbol"],) for s in stock_list])
            cur.execute("DELETE FROM stocks WHERE fyers_symbol NOT IN (SELECT fyers_symbol FROM _nse_fresh)")
            deleted = cur.rowcount
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            yield event(f"❌ DB sync failed: {e}", done=True)
            return

        yield event(f"✅ DB synced — {deleted} delisted stocks removed")

        # ── Step 3: Fetch sector & industry in parallel ─────────────────────
        yield event(f"🔍 Fetching sector & industry for {total} stocks (10 threads)...")

        # NSE sessions are not thread-safe for cookies; use a shared lock around requests
        lock        = Lock()
        results     = {}
        errors      = 0
        done_count  = 0
        BATCH       = 50   # report progress every 50 stocks
        WORKERS     = 10
        DELAY       = 0.2  # seconds between requests inside each thread

        def fetch_with_delay(stock):
            time.sleep(DELAY)
            return _fetch_industry_info(stock["symbol"], session, lock)

        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = {executor.submit(fetch_with_delay, s): s for s in stock_list}
            for future in as_completed(futures):
                done_count += 1
                result = future.result()
                sym = result["symbol"]
                if result["sector"] or result["industry"]:
                    results[sym] = result
                else:
                    errors += 1

                if done_count % BATCH == 0 or done_count == total:
                    yield event(
                        f"  ↳ Fetched {done_count}/{total} — "
                        f"{len(results)} with classification, {errors} without"
                    )

        yield event(f"✅ Classification fetch complete — {len(results)}/{total} stocks classified")

        # ── Step 4: Batch update sector & industry ──────────────────────────
        yield event("💾 Writing sector & industry to database...")
        try:
            conn = get_db_connection()
            cur  = conn.cursor()

            update_rows = [
                (r["sector"], r["industry"], f"NSE:{sym}-EQ",
                 f"NSE:{sym}-BE", f"NSE:{sym}-BZ")
                for sym, r in results.items()
            ]

            # Update all series variants for the same symbol in one pass
            for sector, industry, eq_sym, be_sym, bz_sym in update_rows:
                cur.execute("""
                    UPDATE stocks SET sector = %s, industry = %s
                    WHERE fyers_symbol IN (%s, %s, %s)
                      AND (sector IS NULL OR sector = '' OR sector != %s OR industry != %s)
                """, (sector, industry, eq_sym, be_sym, bz_sym, sector, industry))

            conn.commit()
            updated = len(update_rows)
            cur.close()
            conn.close()
        except Exception as e:
            yield event(f"❌ Failed to write classifications to DB: {e}", done=True)
            return

        yield event(f"✅ {updated} stocks updated with sector & industry")
        yield event(
            f"🎉 Refresh complete — {total} stocks synced, "
            f"{updated} classified, {deleted} delisted removed.",
            done=True
        )

    return StreamingResponse(run(), media_type="text/event-stream")


# 🚀 NEW: Secure GitHub Trigger Endpoint
@app.post("/api/trigger-scan")
async def trigger_github_scan():
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPO")
    workflow = os.environ.get("GITHUB_WORKFLOW")
    
    if not token or not repo or not workflow:
        return {"status": "error", "message": "Server missing GitHub credentials"}

    url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    # Tells GitHub to run the script on the 'main' branch
    data = {"ref": "main"} 
    
    response = requests.post(url, headers=headers, json=data)
    
    # GitHub returns 204 No Content if the trigger is successful
    if response.status_code == 204:
        return {"status": "success", "message": "Background scan initiated successfully"}
    else:
        return {"status": "error", "message": f"GitHub Error: {response.text}"}


if __name__ == "__main__":
    import uvicorn
    import os
    
    # This automatically picks the port Render wants, or uses 8000 on your laptop
    port = int(os.environ.get("PORT", 8000))
    
    print(f"🚀 API Engine starting on port {port}...")
    
    # We use 0.0.0.0 so it can be seen by the outside world when live
    uvicorn.run(app, host="0.0.0.0", port=port)