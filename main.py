from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import List, Optional
from config import NEON_URL
import os          # 🚀 NEW: Required to read Render environment variables
import requests    # 🚀 NEW: Required to send the POST request to GitHub

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