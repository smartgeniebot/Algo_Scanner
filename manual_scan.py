import time
import queue
import threading
import requests
import pandas as pd
import pandas_ta_classic as ta
from bs4 import BeautifulSoup
from fyers_apiv3 import fyersModel
from datetime import date, datetime, timedelta, timezone
from tqdm import tqdm
import psycopg2
from config import NEON_URL

WORKERS = 5  # concurrent Fyers fetch threads — Fyers limit is 10 req/s; 5 workers stays safely under

CLIENT_ID = "QTKF8KZDM9-100"
LOOKBACK_DAYS = 45
IST = timezone(timedelta(hours=5, minutes=30))

def log_progress(cursor, conn, msg):
    print(msg)
    try:
        cursor.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ('daily_scan', msg))
        conn.commit()
    except Exception:
        pass

def get_fyers():
    with open("access_token.txt", "r") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

# --- 🛡️ THE ANTI-BAN ENGINE ---
def fetch_safe(fyers_obj, payload):
    for attempt in range(3):
        res = fyers_obj.history(data=payload)
        if isinstance(res, dict):
            if res.get('s') == 'ok' and res.get('candles'):
                return res
            if 'limit' in str(res.get('message', '')).lower():
                tqdm.write("⏳ Fyers Speed Limit Hit! Cooling down for 45 seconds...")
                time.sleep(45)
                continue
        # Transient empty/error — short backoff before retry
        if attempt < 2:
            time.sleep(3)
    return res

# --- 🏆 GENERALIZED SCREENER.IN FETCH & UPSERT ENGINE ---
def fetch_and_upsert_screener(conn, cursor, url, db_column, label):
    print(f"\n🔍 Fetching {label} from Screener.in...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    fyers_symbols = []
    page = 1

    try:
        while True:
            print(f"   -> Scraping Page {page}...")
            paginated_url = f"{url}?page={page}"
            response = requests.get(paginated_url, headers=headers)
            
            if response.status_code != 200:
                print(f"⚠️ Failed to fetch page {page} (Status {response.status_code}). Stopping pagination.")
                break

            soup = BeautifulSoup(response.text, 'html.parser')
            table = soup.find('table', class_='data-table')
            
            if not table:
                break

            rows = table.find('tbody').find_all('tr')
            if not rows:
                break
            
            symbols_on_page = 0
            for row in rows:
                name_cell = row.find('a')
                if name_cell and 'href' in name_cell.attrs:
                    href = name_cell['href']
                    parts = href.split('/')
                    if len(parts) > 2:
                        raw_ticker = parts[2]
                        # Fix: Screener replaces '&' with '_' in some URLs. We convert it back for Fyers.
                        clean_ticker = raw_ticker.replace('_', '&')
                        fyers_symbol = f"NSE:{clean_ticker}-EQ"
                        
                        if fyers_symbol not in fyers_symbols:
                            fyers_symbols.append(fyers_symbol)
                            symbols_on_page += 1
            
            if symbols_on_page == 0:
                break
                
            page += 1
            time.sleep(1) 

        print(f"✅ Successfully scraped {len(fyers_symbols)} {label} symbols across {page-1} pages.")

        if not fyers_symbols:
            print(f"⚠️ No symbols scraped for {label}. Skipping database update.")
            return

        for symbol in fyers_symbols:
            # Dynamically insert/update based on which column we are currently scraping
            query = f"""
                INSERT INTO stocks (fyers_symbol, industry, {db_column}) 
                VALUES (%s, 'Unclassified', True)
                ON CONFLICT (fyers_symbol) 
                DO UPDATE SET {db_column} = True
            """
            cursor.execute(query, (symbol,))
        
        conn.commit()
        print(f"✅ Database {label} flags updated successfully.\n")

    except Exception as e:
        print(f"❌ Error during {label} Screener fetch/upsert: {e}")
        conn.rollback()

# --- 🚀 MASTER FUNDAMENTAL RUNNER ---
def run_all_fundamental_scrapes(conn, cursor):
    print("\n🧹 Phase 1: Resetting all fundamental flags in database to False...")
    # Reset both columns before we start injecting the fresh daily data
    cursor.execute("UPDATE stocks SET is_high_roce = False, is_moderate_growth = False")
    conn.commit()
    
    # 1. Scrape High Growth
    high_growth_url = "https://www.screener.in/screens/181364/winner-high-roce-high-growth/"
    fetch_and_upsert_screener(conn, cursor, high_growth_url, "is_high_roce", "High Growth")
    
    # 2. Scrape Moderate Growth
    mod_growth_url = "https://www.screener.in/screens/181365/aspirer-high-roce-moderate-growth/"
    fetch_and_upsert_screener(conn, cursor, mod_growth_url, "is_moderate_growth", "Moderate Growth")


# --- 🚀 THE MAIN TECHNICAL SCAN ENGINE ---
def run_daily_scan():
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    # Ensure job_progress table exists and clear previous daily_scan run
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id SERIAL PRIMARY KEY, job TEXT NOT NULL,
            line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("DELETE FROM job_progress WHERE job = 'daily_scan'")
    conn.commit()

    log_progress(cursor, conn, "🚀 Daily Scan Started")

    # PHASE 1: Run both Screener.in scrapes
    log_progress(cursor, conn, "📋 Phase 1: Fetching fundamentals from Screener.in...")
    run_all_fundamental_scrapes(conn, cursor)
    log_progress(cursor, conn, "✅ Phase 1 Complete: Fundamentals updated")

    # PHASE 2: Technical Scan
    fyers = get_fyers()
    today_ist = datetime.now(IST).date()

    n_res = fetch_safe(fyers, {"symbol": "NSE:NIFTY50-INDEX", "resolution": "1D", "date_format": "1",
                                "range_from": (today_ist - timedelta(days=300)).strftime("%Y-%m-%d"),
                                "range_to": today_ist.strftime("%Y-%m-%d"), "cont_flag": "1"})

    n_df = pd.DataFrame(n_res.get('candles', []), columns=['date','open','high','low','close','vol'])

    # Ensure weekly_ema_bullish column exists
    cursor.execute("""
        ALTER TABLE stocks ADD COLUMN IF NOT EXISTS weekly_ema_bullish BOOLEAN DEFAULT FALSE
    """)

    # Shared OHLCV cache — populated here, consumed by base scan jobs later tonight
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_ohlcv (
            fyers_symbol  TEXT    NOT NULL,
            date          BIGINT  NOT NULL,
            open          FLOAT,
            high          FLOAT,
            low           FLOAT,
            close         FLOAT,
            vol           BIGINT,
            PRIMARY KEY (fyers_symbol, date)
        )
    """)
    # Prune data older than 730 days to keep table size bounded
    cutoff_epoch = int((datetime.combine(today_ist - timedelta(days=730), datetime.min.time())
                        .replace(tzinfo=IST)).timestamp())
    cursor.execute("DELETE FROM daily_ohlcv WHERE date < %s", (cutoff_epoch,))
    conn.commit()

    cursor.execute("SELECT id, fyers_symbol, daily_cross_active, daily_cross_date FROM stocks")
    stocks = cursor.fetchall()

    log_progress(cursor, conn, f"📊 Phase 2: Technical Scan Started for {len(stocks)} stocks...")

    # Priority order: EQ, BE, BZ first; then remaining equity series as fallback
    SERIES_PRIORITY = ["EQ", "BE", "BZ", "BL", "BT", "SM", "ST"]

    # Shared rate-limit lock: only one thread may enter fetch_safe at a time when
    # the 45s cooldown fires, preventing thundering-herd retries across workers.
    rate_limit_lock = threading.Lock()

    def fetch_safe_threadsafe(fyers_obj, payload):
        """Thread-safe wrapper: serialises the 45s cooldown across all workers."""
        for attempt in range(3):
            res = fyers_obj.history(data=payload)
            if isinstance(res, dict):
                if res.get('s') == 'ok' and res.get('candles'):
                    return res
                if 'limit' in str(res.get('message', '')).lower():
                    with rate_limit_lock:
                        tqdm.write("⏳ Fyers rate limit — cooling 45 s...")
                        time.sleep(45)
                    continue
            if attempt < 2:
                time.sleep(3)
        return res

    def fetch_stock(task, fyers_obj):
        """
        Pure fetch + compute for one stock. No DB access.
        Returns a result dict consumed by the main thread for DB writes.
        """
        stock_id, symbol, db_daily_active, db_daily_date = task
        range_from = (today_ist - timedelta(days=364)).strftime("%Y-%m-%d")
        range_to   = today_ist.strftime("%Y-%m-%d")

        res = fetch_safe_threadsafe(fyers_obj, {
            "symbol": symbol, "resolution": "1D", "date_format": "1",
            "range_from": range_from, "range_to": range_to, "cont_flag": "1",
        })

        # Series fallback
        resolved_symbol = None
        if not isinstance(res, dict) or "candles" not in res or not res["candles"]:
            ticker_base    = symbol.rsplit("-", 1)[0]
            current_series = symbol.rsplit("-", 1)[-1]
            for series in [s for s in SERIES_PRIORITY if s != current_series]:
                candidate = f"{ticker_base}-{series}"
                tqdm.write(f"🔄 Series fallback: trying {candidate}")
                fb = fetch_safe_threadsafe(fyers_obj, {
                    "symbol": candidate, "resolution": "1D", "date_format": "1",
                    "range_from": range_from, "range_to": range_to, "cont_flag": "1",
                })
                if isinstance(fb, dict) and "candles" in fb and fb["candles"]:
                    res = fb
                    resolved_symbol = candidate
                    symbol = candidate
                    break
            else:
                return {"error": True, "symbol": symbol, "stock_id": stock_id, "resolved_symbol": None}

        df = pd.DataFrame(res['candles'], columns=['date','open','high','low','close','vol'])
        if len(df) < 56:
            return {"skip": True, "symbol": symbol}

        # Build OHLCV rows for main batch
        ohlcv_rows = list(zip(
            [symbol] * len(df),
            df['date'].astype(int).tolist(),
            df['open'].tolist(), df['high'].tolist(),
            df['low'].tolist(), df['close'].tolist(),
            df['vol'].astype(int).tolist()
        ))

        # RS score
        bars = min(len(df), 56)
        s_curr, s_past = df['close'].iloc[-1], df['close'].iloc[-bars]
        n_curr, n_past = n_df['close'].iloc[-1], n_df['close'].iloc[-bars]
        rs_val = float(round(((s_curr / s_past) / (n_curr / n_past)) - 1, 2))

        # Weekly EMA — fetch warmup batch (days 730-365) for 2yr combined history
        warmup_from = (today_ist - timedelta(days=730)).strftime("%Y-%m-%d")
        warmup_to   = (today_ist - timedelta(days=365)).strftime("%Y-%m-%d")
        res_w = fetch_safe_threadsafe(fyers_obj, {
            "symbol": symbol, "resolution": "1D", "date_format": "1",
            "range_from": warmup_from, "range_to": warmup_to, "cont_flag": "1",
        })
        warmup_rows = []
        frames = []
        if isinstance(res_w, dict) and "candles" in res_w and res_w["candles"]:
            df_warmup = pd.DataFrame(res_w['candles'], columns=['date','open','high','low','close','vol'])
            frames.append(df_warmup)
            warmup_rows = list(zip(
                [symbol] * len(df_warmup),
                df_warmup['date'].astype(int).tolist(),
                df_warmup['open'].tolist(), df_warmup['high'].tolist(),
                df_warmup['low'].tolist(), df_warmup['close'].tolist(),
                df_warmup['vol'].astype(int).tolist()
            ))
        frames.append(df)
        df_combined = pd.concat(frames).drop_duplicates(subset='date').sort_values('date').reset_index(drop=True)

        df_dt = df_combined.copy()
        df_dt['dt'] = pd.to_datetime(df_dt['date'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')
        df_dt = df_dt.set_index('dt')
        dfw = df_dt['close'].resample('W').last().dropna().reset_index(drop=True)
        new_weekly_bullish = False
        if len(dfw) >= 60:
            new_weekly_bullish = bool(ta.ema(dfw, 20).iloc[-1] > ta.ema(dfw, 50).iloc[-1])

        # Daily EMA crossover
        df['E20'] = ta.ema(df['close'], 20)
        df['E50'] = ta.ema(df['close'], 50)
        df['P20'] = df['E20'].shift(1)
        df['P50'] = df['E50'].shift(1)

        new_active = "No"
        new_date   = "--"
        new_1h     = None
        new_15m    = None

        if df['E20'].iloc[-1] > df['E50'].iloc[-1]:
            crosses = df[(df['E20'] > df['E50']) & (df['P20'] <= df['P50'])]
            if not crosses.empty:
                daily_cross_epoch = int(float(crosses['date'].iloc[-1]))
                last_dt   = datetime.fromtimestamp(daily_cross_epoch, IST).date()
                days_active = (today_ist - last_dt).days

                if days_active <= LOOKBACK_DAYS:
                    new_active = "Yes"
                    new_date   = last_dt.strftime('%Y-%m-%d')

                    fetch_days    = min(days_active + 25, 95)
                    from_dt_intra = (today_ist - timedelta(days=fetch_days)).strftime("%Y-%m-%d")
                    to_dt_intra   = today_ist.strftime("%Y-%m-%d")

                    res_60 = fetch_safe_threadsafe(fyers_obj, {
                        "symbol": symbol, "resolution": "60", "date_format": "1",
                        "range_from": from_dt_intra, "range_to": to_dt_intra, "cont_flag": "1",
                    })
                    if isinstance(res_60, dict) and "candles" in res_60 and len(res_60["candles"]) >= 50:
                        df60 = pd.DataFrame(res_60['candles'], columns=['date','open','high','low','close','vol'])
                        df60['E20'], df60['E50'] = ta.ema(df60['close'], 20), ta.ema(df60['close'], 50)
                        df60['P20'], df60['P50'] = df60['E20'].shift(1), df60['E50'].shift(1)
                        c_60 = df60[(df60['E20'] < df60['E50']) & (df60['P20'] >= df60['P50'])]
                        c_60 = c_60[c_60['date'] >= daily_cross_epoch]
                        if not c_60.empty:
                            new_1h = datetime.fromtimestamp(int(float(c_60['date'].iloc[0])), IST).strftime('%Y-%m-%d %H:%M')

                    res_15 = fetch_safe_threadsafe(fyers_obj, {
                        "symbol": symbol, "resolution": "15", "date_format": "1",
                        "range_from": from_dt_intra, "range_to": to_dt_intra, "cont_flag": "1",
                    })
                    if isinstance(res_15, dict) and "candles" in res_15 and len(res_15["candles"]) >= 50:
                        df15 = pd.DataFrame(res_15['candles'], columns=['date','open','high','low','close','vol'])
                        df15['E20'], df15['E50'] = ta.ema(df15['close'], 20), ta.ema(df15['close'], 50)
                        df15['P20'], df15['P50'] = df15['E20'].shift(1), df15['E50'].shift(1)
                        c_15 = df15[(df15['E20'] < df15['E50']) & (df15['P20'] >= df15['P50'])]
                        c_15 = c_15[c_15['date'] >= daily_cross_epoch]
                        if not c_15.empty:
                            new_15m = datetime.fromtimestamp(int(float(c_15['date'].iloc[0])), IST).strftime('%Y-%m-%d %H:%M')

        return {
            "stock_id":        stock_id,
            "symbol":          symbol,
            "resolved_symbol": resolved_symbol,
            "ohlcv_rows":      ohlcv_rows,
            "warmup_rows":     warmup_rows,
            "rs_val":          rs_val,
            "new_active":      new_active,
            "new_date":        new_date,
            "new_1h":          new_1h,
            "new_15m":         new_15m,
            "new_weekly_bullish": new_weekly_bullish,
        }

    # --- PARALLEL FETCH WITH WORKER THREADS ---
    result_queue = queue.Queue()
    task_queue   = queue.Queue()

    for task in stocks:
        task_queue.put(task)

    def worker(worker_id):
        fyers_obj = get_fyers()  # each worker owns its Fyers instance
        while True:
            try:
                task = task_queue.get(timeout=2)
            except queue.Empty:
                break
            try:
                result = fetch_stock(task, fyers_obj)
            except Exception as e:
                result = {"error": True, "symbol": task[1], "stock_id": task[0],
                          "resolved_symbol": None, "exc": str(e)}
            result_queue.put(result)
            task_queue.task_done()
            time.sleep(0.05)  # tiny yield between tasks

    threads = []
    for w in range(WORKERS):
        t = threading.Thread(target=worker, args=(w,), daemon=True)
        t.start()
        threads.append(t)

    # Main thread: drain result_queue and write to DB
    failed_stocks  = []
    pending_updates = []
    BATCH_SIZE = 10

    def flush_batch():
        if not pending_updates:
            return
        cursor.executemany("""
            UPDATE stocks
            SET rs_score=%s, daily_cross_active=%s, daily_cross_date=%s,
                first_1h_cross_time=%s, first_15m_cross_time=%s, weekly_ema_bullish=%s
            WHERE id=%s
        """, pending_updates)
        conn.commit()
        pending_updates.clear()

    completed = 0
    total = len(stocks)
    pbar = tqdm(total=total, desc="Scanning stocks")

    while completed < total:
        try:
            result = result_queue.get(timeout=120)
        except queue.Empty:
            # Workers may have crashed — break to avoid infinite wait
            tqdm.write("⚠️ Result queue timeout — workers may have stalled")
            break

        completed += 1
        pbar.update(1)

        if result.get("skip"):
            continue

        if result.get("error"):
            sym = result.get("symbol", "?")
            exc = result.get("exc", "no data")
            tqdm.write(f"❌ Error on {sym}: {exc}")
            failed_stocks.append(sym)
            continue

        sym        = result["symbol"]
        stock_id   = result["stock_id"]
        resolved   = result["resolved_symbol"]

        # Persist any series fix immediately (before batch flush)
        if resolved:
            flush_batch()
            cursor.execute("UPDATE stocks SET fyers_symbol = %s WHERE id = %s", (resolved, stock_id))
            conn.commit()
            log_progress(cursor, conn, f"✅ Series fixed: {resolved} saved to DB permanently")

        # Write OHLCV rows to cache table
        if result["ohlcv_rows"]:
            cursor.executemany("""
                INSERT INTO daily_ohlcv (fyers_symbol, date, open, high, low, close, vol)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (fyers_symbol, date) DO UPDATE SET
                    open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                    close=EXCLUDED.close, vol=EXCLUDED.vol
            """, result["ohlcv_rows"])
            conn.commit()
        if result["warmup_rows"]:
            cursor.executemany("""
                INSERT INTO daily_ohlcv (fyers_symbol, date, open, high, low, close, vol)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (fyers_symbol, date) DO UPDATE SET
                    open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                    close=EXCLUDED.close, vol=EXCLUDED.vol
            """, result["warmup_rows"])
            conn.commit()

        pending_updates.append((
            result["rs_val"], result["new_active"], result["new_date"],
            result["new_1h"], result["new_15m"], result["new_weekly_bullish"],
            stock_id,
        ))
        if len(pending_updates) >= BATCH_SIZE:
            flush_batch()

        if result["new_active"] == "Yes":
            log_progress(cursor, conn,
                f"🎯 {sym} → Daily: {result['new_date']} | 1H: {result['new_1h']} | 15M: {result['new_15m']}")

    pbar.close()

    # Wait for all worker threads to finish
    for t in threads:
        t.join(timeout=10)

    flush_batch()

    # --- FINAL SUMMARY ---
    fail_count = len(failed_stocks)
    if failed_stocks:
        ticker_names = ', '.join(s.split(':')[1] if ':' in s else s for s in failed_stocks)
        log_progress(cursor, conn, f"⚠️ {fail_count}/{total} stock(s) failed: {ticker_names}")
    else:
        log_progress(cursor, conn, f"✅ All {total} stocks fetched successfully. No failures.")

    log_progress(cursor, conn, "🎉 Daily Scan Complete. Database fully synchronized!")

    cursor.close()
    conn.close()

if __name__ == "__main__":
    run_daily_scan()