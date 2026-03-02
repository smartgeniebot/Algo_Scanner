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
LOOKBACK_DAYS = 45 
IST = timezone(timedelta(hours=5, minutes=30))

def get_fyers():
    with open("access_token.txt", "r") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

# --- 🛡️ THE ANTI-BAN ENGINE ---
def fetch_safe(fyers_obj, payload):
    res = fyers_obj.history(data=payload)
    if isinstance(res, dict) and res.get('s') == 'error' and 'limit' in str(res.get('message')).lower():
        tqdm.write("⏳ Fyers Speed Limit Hit! Cooling down for 45 seconds...")
        time.sleep(45)
        res = fyers_obj.history(data=payload) # Retry after cooldown
    return res

def run_daily_scan():
    fyers = get_fyers()
    today_ist = datetime.now(IST).date()
    
    # 1. Benchmark for RS
    n_res = fetch_safe(fyers, {"symbol": "NSE:NIFTY50-INDEX", "resolution": "1D", "date_format": "1",
                                "range_from": (today_ist - timedelta(days=300)).strftime("%Y-%m-%d"),
                                "range_to": today_ist.strftime("%Y-%m-%d"), "cont_flag": "1"})
    
    n_df = pd.DataFrame(n_res.get('candles', []), columns=['date','open','high','low','close','vol'])

    # ☁️ NEW: Connect to Neon Cloud Database
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()
    cursor.execute("SELECT id, fyers_symbol, daily_cross_active, daily_cross_date, first_1h_cross_time, first_15m_cross_time FROM stocks")
    stocks = cursor.fetchall()

    print(f"🚀 Limit-Proof Cloud Scan Started for {len(stocks)} stocks...")

    for stock_id, symbol, db_daily_active, db_daily_date, db_first_1h_time, db_first_15m_time in tqdm(stocks):
        try:
            # --- FETCH 1D DATA ---
            res = fetch_safe(fyers, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                      "range_from": (today_ist - timedelta(days=364)).strftime("%Y-%m-%d"),
                                      "range_to": today_ist.strftime("%Y-%m-%d"), "cont_flag": "1"})
            
            if not isinstance(res, dict) or "candles" not in res or not res["candles"]: 
                continue
            
            df = pd.DataFrame(res['candles'], columns=['date','open','high','low','close','vol'])
            if len(df) < 10: continue
            
            # --- 1. LATEST RS CALC ---
            bars = min(len(df), 56)
            s_curr, s_past = df['close'].iloc[-1], df['close'].iloc[-bars]
            n_curr, n_past = n_df['close'].iloc[-1], n_df['close'].iloc[-bars]
            
            # 🛡️ THE FIX 1: Wrap in float() to strip away numpy formatting for Postgres
            rs_val = float(round(((s_curr / s_past) / (n_curr / n_past)) - 1, 2))

            new_active = "No"
            new_date = "--"
            new_1h = None
            new_15m = None

            if len(df) >= 50:
                df['E20'] = ta.ema(df['close'], 20)
                df['E50'] = ta.ema(df['close'], 50)
                df['P20'] = df['E20'].shift(1)
                df['P50'] = df['E50'].shift(1)
                
                curr_daily_bullish = df['E20'].iloc[-1] > df['E50'].iloc[-1]

                if curr_daily_bullish:
                    crosses = df[(df['E20'] > df['E50']) & (df['P20'] <= df['P50'])]
                    
                    if not crosses.empty:
                        daily_cross_epoch = int(float(crosses['date'].iloc[-1]))
                        last_dt = datetime.fromtimestamp(daily_cross_epoch, IST).date()
                        days_active = (today_ist - last_dt).days
                        
                        if days_active <= LOOKBACK_DAYS:
                            new_active = "Yes"
                            new_date = last_dt.strftime('%Y-%m-%d')
                            
                            if new_date == db_daily_date:
                                new_1h = db_first_1h_time
                                new_15m = db_first_15m_time
                            
                            # --- DYNAMIC INTRADAY FETCH ---
                            fetch_days = min(days_active + 25, 95) 
                            from_dt_intra = (today_ist - timedelta(days=fetch_days)).strftime("%Y-%m-%d")
                            to_dt_intra = today_ist.strftime("%Y-%m-%d")
                            
                            if not new_1h:
                                res_60 = fetch_safe(fyers, {"symbol": symbol, "resolution": "60", "date_format": "1",
                                                             "range_from": from_dt_intra, "range_to": to_dt_intra, "cont_flag": "1"})
                                if isinstance(res_60, dict) and "candles" in res_60 and len(res_60["candles"]) >= 50:
                                    df60 = pd.DataFrame(res_60['candles'], columns=['date','open','high','low','close','vol'])
                                    df60['E20'], df60['E50'] = ta.ema(df60['close'], 20), ta.ema(df60['close'], 50)
                                    df60['P20'], df60['P50'] = df60['E20'].shift(1), df60['E50'].shift(1)
                                    
                                    c_60 = df60[(df60['E20'] < df60['E50']) & (df60['P20'] >= df60['P50'])]
                                    c_60 = c_60[c_60['date'] >= daily_cross_epoch]
                                    if not c_60.empty:
                                        epoch_60 = int(float(c_60['date'].iloc[0]))
                                        new_1h = datetime.fromtimestamp(epoch_60, IST).strftime('%Y-%m-%d %H:%M')
                                
                            if not new_15m:
                                res_15 = fetch_safe(fyers, {"symbol": symbol, "resolution": "15", "date_format": "1",
                                                             "range_from": from_dt_intra, "range_to": to_dt_intra, "cont_flag": "1"})
                                if isinstance(res_15, dict) and "candles" in res_15 and len(res_15["candles"]) >= 50:
                                    df15 = pd.DataFrame(res_15['candles'], columns=['date','open','high','low','close','vol'])
                                    df15['E20'], df15['E50'] = ta.ema(df15['close'], 20), ta.ema(df15['close'], 50)
                                    df15['P20'], df15['P50'] = df15['E20'].shift(1), df15['E50'].shift(1)
                                    
                                    c_15 = df15[(df15['E20'] < df15['E50']) & (df15['P20'] >= df15['P50'])]
                                    c_15 = c_15[c_15['date'] >= daily_cross_epoch]
                                    if not c_15.empty:
                                        epoch_15 = int(float(c_15['date'].iloc[0]))
                                        new_15m = datetime.fromtimestamp(epoch_15, IST).strftime('%Y-%m-%d %H:%M')

            # --- 3. DATABASE UPDATE ---
            cursor.execute("""
                UPDATE stocks 
                SET rs_score=%s, daily_cross_active=%s, daily_cross_date=%s, first_1h_cross_time=%s, first_15m_cross_time=%s 
                WHERE id=%s
            """, (rs_val, new_active, new_date, new_1h, new_15m, stock_id))
            
            if new_active == "Yes":
                tqdm.write(f"🎯 SAVED {symbol} -> Daily: {new_date} | 1H: {new_1h} | 15M: {new_15m}")
                
            if stock_id % 100 == 0: conn.commit()

        except Exception as e:
            tqdm.write(f"❌ Error on {symbol}: {e}")
            # 🛡️ THE FIX 2: Rollback the transaction block so the next stock doesn't instantly fail!
            conn.rollback()
            
        finally:
            time.sleep(0.25) 

    conn.commit()
    cursor.close()
    conn.close()
    print("✅ Limit-Proof Cloud Scan Complete. Database updated!")

if __name__ == "__main__":
    run_daily_scan()