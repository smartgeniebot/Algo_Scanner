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
from pathlib import Path

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
    basic_industries: Optional[List[str]] = None
    fundamentals: Optional[List[str]] = None
    weekly_ema_filter: Optional[bool] = True

def get_db_connection():
    # Connecting to Neon Cloud
    return psycopg2.connect(NEON_URL)

@app.get("/api/stocks-directory")
async def get_stocks_directory():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT fyers_symbol, stock_name, sector, industry, basic_industry, rs_score
        FROM stocks
        WHERE fyers_symbol IS NOT NULL
        ORDER BY rs_score DESC NULLS LAST
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/filters")
async def get_filters():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT DISTINCT sector, industry, basic_industry
        FROM stocks
        WHERE sector IS NOT NULL AND sector != ''
          AND industry IS NOT NULL AND industry != ''
          AND basic_industry IS NOT NULL AND basic_industry != ''
        ORDER BY sector, industry, basic_industry
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    # Build 3-level tree: { sector: { macro: [micros] } }
    tree = {}
    for r in rows:
        s, m, mi = r["sector"], r["industry"], r["basic_industry"]
        if s not in tree:
            tree[s] = {}
        if m not in tree[s]:
            tree[s][m] = []
        if mi not in tree[s][m]:
            tree[s][m].append(mi)

    return {"status": "success", "data": tree}

@app.post("/api/stocks")
async def get_stocks(request: IndustryRequest):
    if not request.industries and not request.basic_industries and not request.fundamentals:
        return {"status": "success", "data": []}

    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    query_conditions = ["daily_cross_active = 'Yes'"]
    query_params = []

    # Weekly EMA filter: only stocks where weekly EMA20 > EMA50
    if request.weekly_ema_filter:
        query_conditions.append("weekly_ema_bullish = TRUE")

    # 1. Micro industry filter (basic_industry) takes priority over macro
    if request.basic_industries:
        placeholders = ', '.join(['%s'] * len(request.basic_industries))
        query_conditions.append(f"basic_industry IN ({placeholders})")
        query_params.extend(request.basic_industries)
    elif request.industries:
        placeholders = ', '.join(['%s'] * len(request.industries))
        query_conditions.append(f"industry IN ({placeholders})")
        query_params.extend(request.industries)

    # 2. Fundamental filters
    if request.fundamentals:
        fund_conditions = []
        if "high_growth" in request.fundamentals:
            fund_conditions.append("is_high_roce = True")
        if "moderate_growth" in request.fundamentals:
            fund_conditions.append("is_moderate_growth = True")
        if fund_conditions:
            query_conditions.append("(" + " OR ".join(fund_conditions) + ")")

    where_clause = " AND ".join(query_conditions)

    cursor.execute(f"""
        SELECT stock_name, fyers_symbol, industry, basic_industry, daily_cross_date,
               first_15m_cross_time, first_1h_cross_time, rs_score
        FROM stocks
        WHERE {where_clause}
    """, tuple(query_params))
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
        CASE WHEN COUNT(rs_score) > 0
            THEN ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(rs_score)) * 100, 2)
            ELSE NULL
        END as outperforming_pct
    FROM stocks
    WHERE sector IS NOT NULL AND sector != ''
    GROUP BY sector
    ORDER BY avg_rs DESC NULLS LAST
    """

    industry_query = """
    SELECT
        sector,
        industry,
        COUNT(*) as total_stocks,
        ROUND(AVG(rs_score)::numeric, 3) as avg_rs,
        COUNT(CASE WHEN daily_cross_active = 'Yes' THEN 1 END) as active_crosses,
        CASE WHEN COUNT(rs_score) > 0
            THEN ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(rs_score)) * 100, 2)
            ELSE NULL
        END as outperforming_pct
    FROM stocks
    WHERE sector IS NOT NULL AND sector != '' AND industry IS NOT NULL AND industry != ''
    GROUP BY sector, industry
    ORDER BY avg_rs DESC NULLS LAST
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

    industry_query = """
    SELECT
        industry,
        sector,
        COUNT(*) as total_stocks,
        ROUND(AVG(rs_score)::numeric, 3) as avg_rs,
        COUNT(CASE WHEN daily_cross_active = 'Yes' THEN 1 END) as active_crosses,
        CASE WHEN COUNT(rs_score) > 0
            THEN ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(rs_score)) * 100, 2)
            ELSE NULL
        END as outperforming_pct
    FROM stocks
    WHERE industry IS NOT NULL AND industry != ''
    GROUP BY industry, sector
    ORDER BY avg_rs DESC NULLS LAST
    """

    cursor.execute(industry_query)
    industries = [dict(row) for row in cursor.fetchall()]

    cursor.close()
    conn.close()
    return industries


@app.get("/api/micro-industry-heatmap")
async def get_micro_industry_heatmap():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    query = """
    SELECT
        basic_industry,
        industry,
        sector,
        COUNT(*) as total_stocks,
        ROUND(AVG(rs_score)::numeric, 3) as avg_rs,
        COUNT(CASE WHEN daily_cross_active = 'Yes' THEN 1 END) as active_crosses,
        CASE WHEN COUNT(rs_score) > 0
            THEN ROUND((SUM(CASE WHEN rs_score > 0 THEN 1.0 ELSE 0.0 END) / COUNT(rs_score)) * 100, 2)
            ELSE NULL
        END as outperforming_pct
    FROM stocks
    WHERE basic_industry IS NOT NULL AND basic_industry != ''
    GROUP BY basic_industry, industry, sector
    ORDER BY avg_rs DESC NULLS LAST
    """

    cursor.execute(query)
    rows = [dict(row) for row in cursor.fetchall()]

    cursor.close()
    conn.close()
    return rows


@app.get("/api/sector-rs-history")
async def get_sector_rs_history(group_type: str = "sector", days: int = 63):
    """
    Returns up to `days` rows of daily RS ratio per group from sector_rs_history.
    Used by the RS Ratio Report to draw sparklines, compute 10D direction, ROC and trend.

    Response shape:
    {
      "GroupName": [
        {"trade_date": "2025-05-01", "rs_ratio": 1.0234, "stock_count": 12},
        ...
      ],
      ...
    }
    """
    if group_type not in ("sector", "industry", "basic_industry"):
        return {"error": "group_type must be sector, industry or basic_industry"}
    if days < 2 or days > 252:
        days = 63

    conn   = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # Check table exists first
    cursor.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'sector_rs_history'
        )
    """)
    if not cursor.fetchone()["exists"]:
        cursor.close()
        conn.close()
        return {}

    # Use 100 calendar days to guarantee at least 63 trading days returned.
    # Then in Python we keep only the last `days` rows per group so the
    # frontend always gets exactly 63 trading-day points regardless of holidays.
    cursor.execute("""
        SELECT group_name, trade_date, rs_ratio, stock_count
        FROM sector_rs_history
        WHERE group_type = %s
          AND trade_date >= CURRENT_DATE - INTERVAL '100 days'
        ORDER BY group_name, trade_date ASC
    """, (group_type,))

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    # Group rows, then trim each to the last `days` trading-day points
    raw: dict = {}
    for row in rows:
        name = row["group_name"]
        raw.setdefault(name, []).append({
            "trade_date":  str(row["trade_date"]),
            "rs_ratio":    float(row["rs_ratio"]),
            "stock_count": int(row["stock_count"]),
        })
    return {name: pts[-days:] for name, pts in raw.items()}


@app.post("/api/refresh-nse-tickers")
async def refresh_nse_tickers():
    """
    Trigger GitHub Actions to sync the stock list and classifications into DB.
    Clears the job_progress log so the frontend gets a clean stream.
    """
    token    = os.environ.get("GITHUB_TOKEN")
    repo     = os.environ.get("GITHUB_REPO")
    workflow = "ticker_refresh.yml"

    if not token or not repo:
        return {"status": "error", "message": "Server missing GITHUB_TOKEN or GITHUB_REPO env vars"}

    # Clear previous run's progress log
    try:
        conn = get_db_connection()
        cur  = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS job_progress (
                id SERIAL PRIMARY KEY, job TEXT NOT NULL,
                line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("DELETE FROM job_progress WHERE job = 'nse_refresh'")
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass

    gh_headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    trigger_url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
    resp = requests.post(trigger_url, headers=gh_headers, json={"ref": "main"}, timeout=15)

    if resp.status_code != 204:
        return {"status": "error", "message": f"GitHub error: {resp.text}"}

    return {"status": "triggered"}


@app.get("/api/refresh-progress")
async def refresh_progress(since_id: int = 0):
    """Return new job_progress lines since the given id (for incremental polling)."""
    try:
        conn = get_db_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT id, line FROM job_progress
            WHERE job = 'nse_refresh' AND id > %s
            ORDER BY id ASC
        """, (since_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"lines": [{"id": r["id"], "line": r["line"]} for r in rows]}
    except Exception as e:
        return {"lines": [], "error": str(e)}


@app.get("/api/refresh-nse-status")
async def refresh_nse_status():
    """Poll status of the most recent NSE Ticker Refresh GitHub Actions run."""
    token    = os.environ.get("GITHUB_TOKEN")
    repo     = os.environ.get("GITHUB_REPO")
    workflow = "ticker_refresh.yml"

    if not token or not repo:
        return {"status": "error"}

    gh_headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    r    = requests.get(
        f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs?per_page=1",
        headers=gh_headers, timeout=10
    )
    runs = r.json().get("workflow_runs", [])
    if not runs:
        return {"status": "none"}

    run = runs[0]
    return {
        "status":     run.get("status"),
        "conclusion": run.get("conclusion"),
        "url":        run.get("html_url"),
    }


class ClassificationPayload(BaseModel):
    classifications: List[dict]   # [{symbol, sector, industry}, ...]


@app.post("/api/save-classifications")
async def save_classifications(payload: ClassificationPayload):
    """
    Step 2: Receives sector/industry fetched by the browser directly from NSE,
    and writes them to the DB. Browser IPs are never blocked by NSE.
    """
    if not payload.classifications:
        return {"status": "error", "message": "No data received"}

    conn = get_db_connection()
    cur  = conn.cursor()
    updated = 0
    for item in payload.classifications:
        sym            = item.get("symbol", "").strip()
        sector         = item.get("sector", "").strip()
        industry       = item.get("industry", "").strip()
        basic_industry = item.get("basic_industry", "").strip()
        if not sym:
            continue
        cur.execute("""
            UPDATE stocks SET sector = %s, industry = %s, basic_industry = %s
            WHERE fyers_symbol IN (%s, %s, %s)
        """, (sector, industry, basic_industry,
              f"NSE:{sym}-EQ", f"NSE:{sym}-BE", f"NSE:{sym}-BZ"))
        updated += cur.rowcount

    conn.commit()
    cur.close()
    conn.close()
    return {"status": "success", "updated": updated}


# 🚀 NEW: Secure GitHub Trigger Endpoint
def _gh_headers():
    return {
        "Authorization": f"Bearer {os.environ.get('GITHUB_TOKEN')}",
        "Accept": "application/vnd.github.v3+json",
    }

def _clear_job(job: str):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS job_progress (
                id SERIAL PRIMARY KEY, job TEXT NOT NULL,
                line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("DELETE FROM job_progress WHERE job = %s", (job,))
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass

def _get_progress(job: str, since_id: int):
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT id, line FROM job_progress WHERE job = %s AND id > %s ORDER BY id ASC", (job, since_id))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"lines": [{"id": r["id"], "line": r["line"]} for r in rows]}
    except Exception as e:
        return {"lines": [], "error": str(e)}

def _get_workflow_status(workflow_file: str):
    token = os.environ.get("GITHUB_TOKEN")
    repo  = os.environ.get("GITHUB_REPO")
    if not token or not repo:
        return {"status": "error"}
    try:
        r = requests.get(
            f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_file}/runs?per_page=1",
            headers=_gh_headers(), timeout=10
        )
        runs = r.json().get("workflow_runs", [])
        if not runs:
            return {"status": "none"}
        run = runs[0]
        return {"status": run.get("status"), "conclusion": run.get("conclusion"), "url": run.get("html_url")}
    except Exception:
        return {"status": "error"}


@app.post("/api/trigger-scan")
async def trigger_github_scan():
    token = os.environ.get("GITHUB_TOKEN")
    repo  = os.environ.get("GITHUB_REPO")
    workflow = os.environ.get("GITHUB_WORKFLOW")

    if not token or not repo or not workflow:
        return {"status": "error", "message": "Server missing GitHub credentials"}

    _clear_job("daily_scan")

    response = requests.post(
        f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches",
        headers=_gh_headers(), json={"ref": "main"}
    )
    if response.status_code == 204:
        return {"status": "success", "message": "Background scan initiated successfully"}
    return {"status": "error", "message": f"GitHub Error: {response.text}"}


@app.get("/api/scan-progress")
async def scan_progress(since_id: int = 0):
    return _get_progress("daily_scan", since_id)


@app.get("/api/scan-status")
async def scan_status():
    workflow = os.environ.get("GITHUB_WORKFLOW", "market_engine.yml")
    return _get_workflow_status(workflow)


@app.post("/api/trigger-intraday")
async def trigger_intraday_scan():
    token = os.environ.get("GITHUB_TOKEN")
    repo  = os.environ.get("GITHUB_REPO")

    if not token or not repo:
        return {"status": "error", "message": "Server missing GitHub credentials"}

    _clear_job("intraday_pulse")

    response = requests.post(
        f"https://api.github.com/repos/{repo}/actions/workflows/intraday_engine.yml/dispatches",
        headers=_gh_headers(), json={"ref": "main"}
    )
    if response.status_code == 204:
        return {"status": "success", "message": "Intraday pulse initiated successfully"}
    return {"status": "error", "message": f"GitHub Error: {response.text}"}


@app.get("/api/intraday-progress")
async def intraday_progress(since_id: int = 0):
    return _get_progress("intraday_pulse", since_id)


@app.get("/api/intraday-status")
async def intraday_status():
    return _get_workflow_status("intraday_engine.yml")




class WatchlistRequest(BaseModel):
    symbols: List[str]


def _ensure_watchlist_jobs_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_jobs (
            id         SERIAL PRIMARY KEY,
            symbols    TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()
    cur.close()


@app.post("/api/fyers-watchlist")
async def fyers_watchlist(request: WatchlistRequest):
    """Button click: store symbols as a pending job for watchlist_runner.py to pick up."""
    symbols = [s.strip() for s in request.symbols if s.strip()]
    if not symbols:
        return {"status": "error", "message": "No symbols provided"}
    try:
        conn = get_db_connection()
        _ensure_watchlist_jobs_table(conn)
        cur = conn.cursor()
        # Cancel any stale pending jobs first
        cur.execute("UPDATE watchlist_jobs SET status='cancelled' WHERE status='pending'")
        cur.execute(
            "INSERT INTO watchlist_jobs (symbols, status) VALUES (%s, 'pending') RETURNING id",
            (",".join(symbols),)
        )
        job_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "success", "job_id": job_id, "count": len(symbols)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/fyers-watchlist-status")
async def fyers_watchlist_status(job_id: int):
    """Frontend polls this to know when the local runner has finished."""
    try:
        conn = get_db_connection()
        _ensure_watchlist_jobs_table(conn)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT status FROM watchlist_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return {"status": "error", "message": "Job not found"}
        return {"status": row["status"]}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/fyers-watchlist-job")
async def fyers_watchlist_job():
    """watchlist_runner.py calls this to claim a pending job."""
    try:
        conn = get_db_connection()
        _ensure_watchlist_jobs_table(conn)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            UPDATE watchlist_jobs SET status='running', updated_at=NOW()
            WHERE id = (
                SELECT id FROM watchlist_jobs WHERE status='pending'
                ORDER BY created_at DESC LIMIT 1
            )
            RETURNING id, symbols
        """)
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            return {"status": "none"}
        return {"status": "ok", "job_id": row["id"], "symbols": row["symbols"].split(",")}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/fyers-watchlist-done")
async def fyers_watchlist_done(body: dict):
    """watchlist_runner.py calls this when the sync is complete."""
    job_id = body.get("job_id")
    result = body.get("result", "done")   # "done" or "failed"
    if not job_id:
        return {"status": "error"}
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "UPDATE watchlist_jobs SET status=%s, updated_at=NOW() WHERE id=%s",
            (result, job_id)
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/first-daily-base")
async def get_first_daily_base(lookback_days: int = 30):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'first_daily_base'
            )
        """)
        if not cursor.fetchone()["exists"]:
            cursor.close()
            conn.close()
            return {"status": "success", "data": []}

        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=lookback_days)).isoformat()

        cursor.execute("""
            SELECT fyers_symbol, stock_name, sector, industry, basic_industry,
                   rs_score, first_base_date, second_base_date
            FROM first_daily_base
            WHERE GREATEST(first_base_date, COALESCE(second_base_date, first_base_date)) >= %s
            ORDER BY GREATEST(first_base_date, COALESCE(second_base_date, first_base_date)) DESC,
                     rs_score DESC NULLS LAST
        """, (cutoff,))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return {"status": "success", "data": [dict(r) for r in rows]}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}


class FirstDailyBaseRequest(BaseModel):
    lookback_days: int = 30

@app.post("/api/trigger-first-daily-base")
async def trigger_first_daily_base(body: FirstDailyBaseRequest = FirstDailyBaseRequest()):
    token = os.environ.get("GITHUB_TOKEN")
    repo  = os.environ.get("GITHUB_REPO")

    if not token or not repo:
        return {"status": "error", "message": "Server missing GitHub credentials"}

    _clear_job("first_daily_base")

    response = requests.post(
        f"https://api.github.com/repos/{repo}/actions/workflows/first_daily_base_engine.yml/dispatches",
        headers=_gh_headers(), json={"ref": "main", "inputs": {"lookback_days": str(body.lookback_days)}}
    )
    if response.status_code == 204:
        return {"status": "success", "message": "1st Daily Base scan initiated"}
    return {"status": "error", "message": f"GitHub Error: {response.text}"}


@app.get("/api/first-daily-base-progress")
async def first_daily_base_progress(since_id: int = 0):
    return _get_progress("first_daily_base", since_id)


@app.get("/api/first-daily-base-status")
async def first_daily_base_status():
    return _get_workflow_status("first_daily_base_engine.yml")


if __name__ == "__main__":
    import uvicorn
    import os
    
    # This automatically picks the port Render wants, or uses 8000 on your laptop
    port = int(os.environ.get("PORT", 8000))
    
    print(f"🚀 API Engine starting on port {port}...")
    
    # We use 0.0.0.0 so it can be seen by the outside world when live
    uvicorn.run(app, host="0.0.0.0", port=port)