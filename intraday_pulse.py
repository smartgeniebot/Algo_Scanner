import time
import pandas as pd
import pandas_ta_classic as ta
from fyers_apiv3 import fyersModel
from datetime import date, datetime, timedelta, timezone
from tqdm import tqdm

# ☁️ NEW: Import psycopg2 and your Neon config
import psycopg2
from config import NEON_URL

CLIENT_ID = "QTKF8KZDM9-100"
IST = timezone(timedelta(hours=5, minutes=30))

def log_progress(cursor, conn, msg):
    print(msg)
    try:
        cursor.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ('intraday_pulse', msg))
        conn.commit()
    except Exception:
        pass

def get_fyers():
    with open("access_token.txt", "r") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

def fetch_safe(fyers_obj, payload):
    res = fyers_obj.history(data=payload)
    if isinstance(res, dict) and res.get('s') == 'error' and 'limit' in str(res.get('message')).lower():
        tqdm.write("⏳ Fyers Limit Hit! 45s Cooldown...")
        time.sleep(45)
        res = fyers_obj.history(data=payload)
    return res

def run_hourly_pulse():
    fyers = get_fyers()
    today_ist = datetime.now(IST).date()
    now_str = datetime.now(IST).strftime('%Y-%m-%d %H:%M')

    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    # Ensure job_progress table exists and clear previous intraday_pulse run
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id SERIAL PRIMARY KEY, job TEXT NOT NULL,
            line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("DELETE FROM job_progress WHERE job = 'intraday_pulse'")
    conn.commit()

    log_progress(cursor, conn, f"⚡ Intraday Pulse Started at {now_str}")

    cursor.execute("""
        SELECT id, fyers_symbol, daily_cross_date, first_1h_cross_time, first_15m_cross_time
        FROM stocks
        WHERE daily_cross_active = 'Yes'
    """)
    active_stocks = cursor.fetchall()

    log_progress(cursor, conn, f"📊 Scanning {len(active_stocks)} active uptrend stocks for pullbacks...")

    updates_made = 0

    for stock_id, symbol, db_daily_date, db_1h_time, db_15m_time in tqdm(active_stocks):
        try:
            # If both timeframes are already locked, SKIP API COMPLETELY!
            if db_1h_time and db_15m_time:
                continue
                
            new_1h = db_1h_time
            new_15m = db_15m_time
            update_needed = False

            # Convert db_daily_date to find out how much history we need to fetch
            cross_obj = datetime.strptime(str(db_daily_date).split(' ')[0], '%Y-%m-%d').date()
            days_active = (today_ist - cross_obj).days
            fetch_days = min(days_active + 25, 95) # 25 days padding for EMA warmup
            
            from_dt = (today_ist - timedelta(days=fetch_days)).strftime("%Y-%m-%d")
            to_dt = today_ist.strftime("%Y-%m-%d")
            
            daily_cross_epoch = int(time.mktime(cross_obj.timetuple()))

            # --- CHECK 1 HOUR ---
            if not new_1h:
                res_60 = fetch_safe(fyers, {"symbol": symbol, "resolution": "60", "date_format": "1",
                                             "range_from": from_dt, "range_to": to_dt, "cont_flag": "1"})
                if isinstance(res_60, dict) and "candles" in res_60 and len(res_60["candles"]) >= 50:
                    df60 = pd.DataFrame(res_60['candles'], columns=['date','open','high','low','close','vol'])
                    df60['E20'], df60['E50'] = ta.ema(df60['close'], 20), ta.ema(df60['close'], 50)
                    df60['P20'], df60['P50'] = df60['E20'].shift(1), df60['E50'].shift(1)
                    
                    c_60 = df60[(df60['E20'] < df60['E50']) & (df60['P20'] >= df60['P50'])]
                    c_60 = c_60[c_60['date'] >= daily_cross_epoch]
                    
                    if not c_60.empty:
                        new_1h = datetime.fromtimestamp(int(float(c_60['date'].iloc[0])), IST).strftime('%Y-%m-%d %H:%M')
                        update_needed = True
                time.sleep(0.1)

            # --- CHECK 15 MIN ---
            if not new_15m:
                res_15 = fetch_safe(fyers, {"symbol": symbol, "resolution": "15", "date_format": "1",
                                             "range_from": from_dt, "range_to": to_dt, "cont_flag": "1"})
                if isinstance(res_15, dict) and "candles" in res_15 and len(res_15["candles"]) >= 50:
                    df15 = pd.DataFrame(res_15['candles'], columns=['date','open','high','low','close','vol'])
                    df15['E20'], df15['E50'] = ta.ema(df15['close'], 20), ta.ema(df15['close'], 50)
                    df15['P20'], df15['P50'] = df15['E20'].shift(1), df15['E50'].shift(1)
                    
                    c_15 = df15[(df15['E20'] < df15['E50']) & (df15['P20'] >= df15['P50'])]
                    c_15 = c_15[c_15['date'] >= daily_cross_epoch]
                    
                    if not c_15.empty:
                        new_15m = datetime.fromtimestamp(int(float(c_15['date'].iloc[0])), IST).strftime('%Y-%m-%d %H:%M')
                        update_needed = True
                time.sleep(0.1)

            # --- DATABASE UPDATE ONLY IF SOMETHING CHANGED ---
            if update_needed:
                cursor.execute("""
                    UPDATE stocks
                    SET first_1h_cross_time=%s, first_15m_cross_time=%s
                    WHERE id=%s
                """, (new_1h, new_15m, stock_id))
                conn.commit()
                updates_made += 1
                log_progress(cursor, conn, f"🚨 Pullback: {symbol.split(':')[1]} | 1H: {new_1h} | 15M: {new_15m}")

        except Exception as e:
            log_progress(cursor, conn, f"❌ Error on {symbol}: {e}")
            conn.rollback()

    log_progress(cursor, conn, f"🎉 Intraday Pulse Complete! New pullbacks found: {updates_made} stocks.")
    cursor.close()
    conn.close()

if __name__ == "__main__":
    run_hourly_pulse()