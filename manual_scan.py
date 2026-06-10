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
from psycopg2.extras import execute_values
from config import NEON_URL

WORKERS = 3

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
            msg = str(res.get('message', ''))
            tqdm.write(f"⚠️ Fyers non-ok response: {res}")
            if 'limit' in msg.lower():
                tqdm.write("⏳ Fyers rate limit — cooling 45s...")
                time.sleep(45)
                continue
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
            # Only update existing stocks — never insert new ones from Screener
            # (Screener may list delisted/SME stocks not in NSE's official list)
            query = f"UPDATE stocks SET {db_column} = True WHERE fyers_symbol = %s"
            cursor.execute(query, (symbol,))
        
        conn.commit()
        print(f"✅ Database {label} flags updated successfully.\n")

    except Exception as e:
        print(f"❌ Error during {label} Screener fetch/upsert: {e}")
        conn.rollback()

def fetch_and_flag_dividend_stocks(conn, cursor):
    """Downloads Nifty Dividend Opportunities 50 CSV and sets is_dividend_stock = True for matching stocks."""
    print("\n💰 Fetching Nifty Dividend Opportunities 50 from NSE...")
    url = "https://www.niftyindices.com/IndexConstituent/ind_niftydivopp50list.csv"
    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        syms = []
        for line in resp.text.splitlines()[1:]:
            parts = line.split(",")
            if len(parts) >= 3:
                symbol = parts[2].strip()
                if symbol and not symbol.startswith("Dummy"):
                    syms.append(f"NSE:{symbol}-EQ")
        if not syms:
            print("⚠️ No dividend symbols parsed — skipping flag update.")
            return
        for symbol in syms:
            cursor.execute("UPDATE stocks SET is_dividend_stock = True WHERE fyers_symbol = %s", (symbol,))
        conn.commit()
        print(f"✅ Dividend stock flags updated: {len(syms)} symbols from NSE.")
    except Exception as e:
        print(f"❌ Error fetching dividend list: {e}")
        conn.rollback()


def fetch_and_flag_fno_stocks(conn, cursor):
    """Downloads NSE F&O securities list and sets is_fno_stock = True for matching stocks."""
    print("\n📊 Fetching F&O securities list from NSE...")
    url = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.nseindia.com/",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        session = requests.Session()
        # Prime the session cookie NSE requires
        session.get("https://www.nseindia.com", headers=headers, timeout=10)
        resp = session.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        syms = []
        for line in resp.text.splitlines()[1:]:
            parts = line.split(",")
            if parts:
                symbol = parts[0].strip()
                if symbol and symbol not in ("SYMBOL", ""):
                    syms.append(f"NSE:{symbol}-EQ")
        if not syms:
            print("⚠️ No F&O symbols parsed — skipping flag update.")
            return
        for symbol in syms:
            cursor.execute("UPDATE stocks SET is_fno_stock = True WHERE fyers_symbol = %s", (symbol,))
        conn.commit()
        print(f"✅ F&O stock flags updated: {len(syms)} symbols from NSE.")
    except Exception as e:
        print(f"❌ Error fetching F&O list: {e}")
        conn.rollback()


# --- 🚀 MASTER FUNDAMENTAL RUNNER ---
def run_all_fundamental_scrapes(conn, cursor):
    print("\n🧹 Phase 1: Resetting all fundamental flags in database to False...")
    cursor.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS is_fno_stock BOOLEAN DEFAULT FALSE")
    cursor.execute("UPDATE stocks SET is_high_roce = False, is_moderate_growth = False, is_dividend_stock = False, is_fno_stock = False")
    conn.commit()

    # 1. Scrape High Growth
    high_growth_url = "https://www.screener.in/screens/181364/winner-high-roce-high-growth/"
    fetch_and_upsert_screener(conn, cursor, high_growth_url, "is_high_roce", "High Growth")

    # 2. Scrape Moderate Growth
    mod_growth_url = "https://www.screener.in/screens/181365/aspirer-high-roce-moderate-growth/"
    fetch_and_upsert_screener(conn, cursor, mod_growth_url, "is_moderate_growth", "Moderate Growth")

    # 3. Fetch Nifty Dividend Opportunities 50
    fetch_and_flag_dividend_stocks(conn, cursor)

    # 4. Fetch NSE F&O securities list
    fetch_and_flag_fno_stocks(conn, cursor)


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

    n_res = fetch_safe(fyers, {"symbol": "NSE:NIFTY500-INDEX", "resolution": "1D", "date_format": "1",
                                "range_from": (today_ist - timedelta(days=300)).strftime("%Y-%m-%d"),
                                "range_to": today_ist.strftime("%Y-%m-%d"), "cont_flag": "1"})

    n_df = pd.DataFrame(n_res.get('candles', []), columns=['date','open','high','low','close','vol'])

    # Ensure new columns exist
    cursor.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS weekly_ema_bullish BOOLEAN DEFAULT FALSE")
    cursor.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS is_dividend_stock BOOLEAN DEFAULT FALSE")

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

    SERIES_PRIORITY = ["EQ", "BE", "BZ", "BL", "BT", "SM", "ST"]

    # Shared inter-worker delay — stagger requests so no two workers fire simultaneously
    _last_req   = [0.0]
    _req_lock   = threading.Lock()
    MIN_SPACING = 0.4  # seconds between any two Fyers calls across all workers

    def _throttled_call(fyers_obj, payload):
        with _req_lock:
            gap = MIN_SPACING - (time.monotonic() - _last_req[0])
            if gap > 0:
                time.sleep(gap)
            _last_req[0] = time.monotonic()
        for attempt in range(3):
            res = fyers_obj.history(data=payload)
            if isinstance(res, dict):
                if res.get('s') == 'ok' and res.get('candles'):
                    return res
                tqdm.write(f"⚠️ Fyers response: {res}")
                if 'limit' in str(res.get('message', '')).lower():
                    tqdm.write("⏳ Rate limit — cooling 45s...")
                    time.sleep(45)
                    continue
            if attempt < 2:
                time.sleep(3)
        return res

    def fetch_stock(task, fyers_obj):
        """All Fyers calls for one stock. Returns result dict — no DB access."""
        stock_id, symbol, _, __ = task

        # --- Main fetch: last 364 days ---
        range_from = (today_ist - timedelta(days=364)).strftime("%Y-%m-%d")
        range_to   = today_ist.strftime("%Y-%m-%d")
        res = _throttled_call(fyers_obj, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                          "range_from": range_from, "range_to": range_to, "cont_flag": "1"})

        resolved_symbol = None
        if not isinstance(res, dict) or not res.get("candles"):
            ticker_base    = symbol.rsplit("-", 1)[0]
            current_series = symbol.rsplit("-", 1)[-1]
            for series in [s for s in SERIES_PRIORITY if s != current_series]:
                candidate = f"{ticker_base}-{series}"
                tqdm.write(f"🔄 Fallback: {candidate}")
                fb = _throttled_call(fyers_obj, {"symbol": candidate, "resolution": "1D", "date_format": "1",
                                                  "range_from": range_from, "range_to": range_to, "cont_flag": "1"})
                if isinstance(fb, dict) and fb.get("candles"):
                    res = fb
                    resolved_symbol = candidate
                    symbol = candidate
                    break
            else:
                return {"error": True, "symbol": symbol, "stock_id": stock_id}

        df = pd.DataFrame(res['candles'], columns=['date','open','high','low','close','vol'])
        if len(df) < 56:
            return {"skip": True, "symbol": symbol}

        ohlcv_rows = list(zip([symbol]*len(df), df['date'].astype(int).tolist(),
                               df['open'].tolist(), df['high'].tolist(),
                               df['low'].tolist(), df['close'].tolist(),
                               df['vol'].astype(int).tolist()))

        # --- Warmup fetch: days 730-365 for 2yr weekly EMA ---
        w_from = (today_ist - timedelta(days=730)).strftime("%Y-%m-%d")
        w_to   = (today_ist - timedelta(days=364)).strftime("%Y-%m-%d")
        res_w  = _throttled_call(fyers_obj, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                              "range_from": w_from, "range_to": w_to, "cont_flag": "1"})
        warmup_rows = []
        df_combined = df
        if isinstance(res_w, dict) and res_w.get("candles"):
            df_w = pd.DataFrame(res_w['candles'], columns=['date','open','high','low','close','vol'])
            warmup_rows = list(zip([symbol]*len(df_w), df_w['date'].astype(int).tolist(),
                                    df_w['open'].tolist(), df_w['high'].tolist(),
                                    df_w['low'].tolist(), df_w['close'].tolist(),
                                    df_w['vol'].astype(int).tolist()))
            df_combined = pd.concat([df_w, df]).drop_duplicates('date').sort_values('date').reset_index(drop=True)

        # RS score (based on 364-day df)
        bars   = min(len(df), 56)
        rs_val = float(round(((df['close'].iloc[-1] / df['close'].iloc[-bars]) /
                               (n_df['close'].iloc[-1] / n_df['close'].iloc[-bars])) - 1, 2))

        # Weekly EMA from 2yr combined data
        new_weekly_bullish = False
        df_dt = df_combined.copy()
        df_dt['dt'] = pd.to_datetime(df_dt['date'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')
        dfw = df_dt.set_index('dt')['close'].resample('W').last().dropna().reset_index(drop=True)
        if len(dfw) >= 60:
            new_weekly_bullish = bool(ta.ema(dfw, 20).iloc[-1] > ta.ema(dfw, 50).iloc[-1])

        # Daily EMA crossover
        df['E20'] = ta.ema(df['close'], 20)
        df['E50'] = ta.ema(df['close'], 50)
        df['P20'] = df['E20'].shift(1)
        df['P50'] = df['E50'].shift(1)

        new_active, new_date, new_1h, new_15m = "No", "--", None, None

        if df['E20'].iloc[-1] > df['E50'].iloc[-1]:
            crosses = df[(df['E20'] > df['E50']) & (df['P20'] <= df['P50'])]
            if not crosses.empty:
                daily_cross_epoch = int(float(crosses['date'].iloc[-1]))
                last_dt     = datetime.fromtimestamp(daily_cross_epoch, IST).date()
                days_active = (today_ist - last_dt).days
                if days_active <= LOOKBACK_DAYS:
                    new_active = "Yes"
                    new_date   = last_dt.strftime('%Y-%m-%d')
                    fetch_days    = min(days_active + 25, 95)
                    from_dt_intra = (today_ist - timedelta(days=fetch_days)).strftime("%Y-%m-%d")
                    to_dt_intra   = today_ist.strftime("%Y-%m-%d")

                    res_60 = _throttled_call(fyers_obj, {"symbol": symbol, "resolution": "60", "date_format": "1",
                                                          "range_from": from_dt_intra, "range_to": to_dt_intra, "cont_flag": "1"})
                    if isinstance(res_60, dict) and len(res_60.get("candles", [])) >= 50:
                        df60 = pd.DataFrame(res_60['candles'], columns=['date','open','high','low','close','vol'])
                        df60['E20'], df60['E50'] = ta.ema(df60['close'], 20), ta.ema(df60['close'], 50)
                        df60['P20'], df60['P50'] = df60['E20'].shift(1), df60['E50'].shift(1)
                        c60 = df60[(df60['E20'] < df60['E50']) & (df60['P20'] >= df60['P50'])]
                        c60 = c60[c60['date'] >= daily_cross_epoch]
                        if not c60.empty:
                            new_1h = datetime.fromtimestamp(int(float(c60['date'].iloc[0])), IST).strftime('%Y-%m-%d %H:%M')

                    res_15 = _throttled_call(fyers_obj, {"symbol": symbol, "resolution": "15", "date_format": "1",
                                                          "range_from": from_dt_intra, "range_to": to_dt_intra, "cont_flag": "1"})
                    if isinstance(res_15, dict) and len(res_15.get("candles", [])) >= 50:
                        df15 = pd.DataFrame(res_15['candles'], columns=['date','open','high','low','close','vol'])
                        df15['E20'], df15['E50'] = ta.ema(df15['close'], 20), ta.ema(df15['close'], 50)
                        df15['P20'], df15['P50'] = df15['E20'].shift(1), df15['E50'].shift(1)
                        c15 = df15[(df15['E20'] < df15['E50']) & (df15['P20'] >= df15['P50'])]
                        c15 = c15[c15['date'] >= daily_cross_epoch]
                        if not c15.empty:
                            new_15m = datetime.fromtimestamp(int(float(c15['date'].iloc[0])), IST).strftime('%Y-%m-%d %H:%M')

        return {"stock_id": stock_id, "symbol": symbol, "resolved_symbol": resolved_symbol,
                "ohlcv_rows": ohlcv_rows, "warmup_rows": warmup_rows,
                "rs_val": rs_val, "new_active": new_active, "new_date": new_date,
                "new_1h": new_1h, "new_15m": new_15m, "new_weekly_bullish": new_weekly_bullish}

    # --- Worker threads ---
    task_q   = queue.Queue()
    result_q = queue.Queue()
    for task in stocks:
        task_q.put(task)

    def worker():
        fyers_obj = get_fyers()
        while True:
            try:
                task = task_q.get(timeout=5)
            except queue.Empty:
                break
            try:
                result_q.put(fetch_stock(task, fyers_obj))
            except Exception as e:
                result_q.put({"error": True, "symbol": task[1], "stock_id": task[0], "exc": str(e)})
            task_q.task_done()

    for _ in range(WORKERS):
        threading.Thread(target=worker, daemon=True).start()

    # --- Main thread: collect results and write DB ---
    failed_stocks   = []
    pending_updates = []
    all_ohlcv_rows  = []
    BATCH_SIZE        = 10
    OHLCV_FLUSH_EVERY = 50000  # flush daily_ohlcv every ~140 stocks worth of rows (364+365 rows each)

    def flush_batch():
        if not pending_updates:
            return
        try:
            cursor.executemany("""
                UPDATE stocks SET rs_score=%s, daily_cross_active=%s, daily_cross_date=%s,
                    first_1h_cross_time=%s, first_15m_cross_time=%s, weekly_ema_bullish=%s
                WHERE id=%s
            """, pending_updates)
            conn.commit()
            pending_updates.clear()
        except Exception as e:
            tqdm.write(f"❌ DB flush_batch failed: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
            pending_updates.clear()

    def flush_ohlcv(label=""):
        if not all_ohlcv_rows:
            return
        try:
            # Deduplicate by (fyers_symbol, date) — last value wins
            deduped = list({(r[0], r[1]): r for r in all_ohlcv_rows}.values())
            execute_values(cursor, """
                INSERT INTO daily_ohlcv (fyers_symbol, date, open, high, low, close, vol)
                VALUES %s
                ON CONFLICT (fyers_symbol, date) DO UPDATE SET
                    open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                    close=EXCLUDED.close, vol=EXCLUDED.vol
            """, deduped, page_size=1000)
            conn.commit()
            tqdm.write(f"💾 OHLCV saved: {len(deduped)} rows{' ' + label if label else ''}")
            all_ohlcv_rows.clear()
        except Exception as e:
            tqdm.write(f"❌ DB flush_ohlcv failed: {e} — {len(all_ohlcv_rows)} rows NOT saved")
            try:
                conn.rollback()
            except Exception:
                pass

    total = len(stocks)
    pbar  = tqdm(total=total, desc="Scanning stocks")
    done  = 0
    while done < total:
        try:
            r = result_q.get(timeout=300)
        except queue.Empty:
            tqdm.write("⚠️ Worker timeout — stopping early")
            break
        done += 1
        pbar.update(1)

        if r.get("skip"):
            tqdm.write(f"⚠️ Skipped {r.get('symbol','?')} — insufficient candles (<56 bars)")
            continue
        if r.get("error"):
            tqdm.write(f"❌ Fetch failed {r.get('symbol','?')}: {r.get('exc', 'all series exhausted')}")
            failed_stocks.append(r.get("symbol","?"))
            continue

        sym = r["symbol"]
        if r["resolved_symbol"]:
            flush_batch()
            cursor.execute("UPDATE stocks SET fyers_symbol=%s WHERE id=%s", (r["resolved_symbol"], r["stock_id"]))
            conn.commit()
            log_progress(cursor, conn, f"✅ Series fixed: {r['resolved_symbol']}")

        all_ohlcv_rows.extend(r["ohlcv_rows"])
        all_ohlcv_rows.extend(r["warmup_rows"])

        pending_updates.append((r["rs_val"], r["new_active"], r["new_date"],
                                 r["new_1h"], r["new_15m"], r["new_weekly_bullish"], r["stock_id"]))
        if len(pending_updates) >= BATCH_SIZE:
            flush_batch()
        if len(all_ohlcv_rows) >= OHLCV_FLUSH_EVERY:
            flush_ohlcv(f"at {done}/{total} stocks")
        if r["new_active"] == "Yes":
            log_progress(cursor, conn, f"🎯 {sym} → Daily: {r['new_date']} | 1H: {r['new_1h']} | 15M: {r['new_15m']}")

    pbar.close()
    flush_batch()
    flush_ohlcv()  # final flush for any remaining rows
    print("✅ daily_ohlcv cache updated")

    # --- FINAL SUMMARY ---
    total      = len(stocks)
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