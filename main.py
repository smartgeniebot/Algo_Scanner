from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from fastapi.responses import StreamingResponse  # kept for future use
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
import zipfile
import requests

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




@app.post("/api/refresh-nse-tickers")
async def refresh_nse_tickers():
    """Trigger the NSE Ticker Refresh GitHub Actions workflow and return immediately."""
    token    = os.environ.get("GITHUB_TOKEN")
    repo     = os.environ.get("GITHUB_REPO")
    workflow = "ticker_refresh.yml"

    if not token or not repo:
        return {"status": "error", "message": "Server missing GITHUB_TOKEN or GITHUB_REPO env vars"}

    gh_headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
    }

    trigger_url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
    resp = requests.post(trigger_url, headers=gh_headers, json={"ref": "main"}, timeout=15)

    if resp.status_code != 204:
        return {"status": "error", "message": f"GitHub error: {resp.text}"}

    return {"status": "triggered"}


@app.get("/api/refresh-nse-status")
async def refresh_nse_status():
    """Return the status of the most recent NSE Ticker Refresh workflow run."""
    token    = os.environ.get("GITHUB_TOKEN")
    repo     = os.environ.get("GITHUB_REPO")
    workflow = "ticker_refresh.yml"

    if not token or not repo:
        return {"status": "error", "message": "Server missing GITHUB_TOKEN or GITHUB_REPO env vars"}

    gh_headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
    }

    runs_url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs?per_page=1"
    r = requests.get(runs_url, headers=gh_headers, timeout=10)
    runs = r.json().get("workflow_runs", [])

    if not runs:
        return {"status": "none"}

    run = runs[0]
    result = {
        "status":     run.get("status"),        # queued | in_progress | completed
        "conclusion": run.get("conclusion"),    # success | failure | None
        "run_id":     run.get("id"),
        "started_at": run.get("run_started_at"),
        "updated_at": run.get("updated_at"),
        "url":        run.get("html_url"),
    }

    # If completed successfully, fetch key log lines
    if run.get("status") == "completed" and run.get("conclusion") == "success":
        log_url = f"https://api.github.com/repos/{repo}/actions/runs/{run['id']}/logs"
        log_r   = requests.get(log_url, headers=gh_headers, timeout=20, allow_redirects=True)
        lines   = []
        if log_r.status_code == 200:
            try:
                with zipfile.ZipFile(io.BytesIO(log_r.content)) as zf:
                    for name in zf.namelist():
                        content = zf.read(name).decode("utf-8", errors="ignore")
                        for line in content.splitlines():
                            stripped = line.split("Z ")[-1].strip()
                            if any(k in stripped for k in (
                                "stocks loaded", "Upserted", "Removed",
                                "classified", "Refresh Complete", "failed", "Error", "✅", "❌"
                            )):
                                lines.append(stripped)
            except Exception:
                pass
        result["log_lines"] = lines

    return result


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