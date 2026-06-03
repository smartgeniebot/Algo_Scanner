import time
import pandas as pd
import pandas_ta_classic as ta
from fyers_apiv3 import fyersModel
from datetime import datetime, timedelta, timezone
from tqdm import tqdm
import psycopg2
from psycopg2.extras import execute_values
from config import NEON_URL

CLIENT_ID = "QTKF8KZDM9-100"
IST = timezone(timedelta(hours=5, minutes=30))

def log_progress(cursor, conn, msg):
    print(msg)
    try:
        cursor.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", ('first_daily_base', msg))
        conn.commit()
    except Exception:
        pass

def get_fyers():
    with open("access_token.txt", "r") as f:
        token = f.read().strip()
    return fyersModel.FyersModel(client_id=CLIENT_ID, is_async=False, token=token, log_path="")

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
        if attempt < 2:
            time.sleep(3)
    return res

def find_bases(df):
    """
    State machine over combined 2-year daily data:
      Step 1: EMA50 crosses above SMA200  — one-time anchor
      Base 1: first  EMA20 < EMA50  then  EMA9 > EMA20
      Base 2: next   EMA20 < EMA50  then  EMA9 > EMA20
    Returns (first_base_date, second_base_date). second_base_date is None if not yet occurred.
    Returns None if step 1 never fired.
    """
    if len(df) < 210:
        return None

    df = df.copy().reset_index(drop=True)
    df['E9']   = ta.ema(df['close'], 9)
    df['E20']  = ta.ema(df['close'], 20)
    df['E50']  = ta.ema(df['close'], 50)
    df['S200'] = ta.sma(df['close'], 200)
    df['pE9']   = df['E9'].shift(1)
    df['pE20']  = df['E20'].shift(1)
    df['pE50']  = df['E50'].shift(1)
    df['pS200'] = df['S200'].shift(1)
    df = df.dropna(subset=['E9','E20','E50','S200','pE9','pE20','pE50','pS200']).reset_index(drop=True)
    if len(df) < 5:
        return None

    state = 0
    bases_found = []

    for i in range(len(df)):
        row = df.iloc[i]
        dt = datetime.fromtimestamp(int(float(row['date'])), IST).strftime('%Y-%m-%d')

        if state == 0:
            if row['E50'] > row['S200'] and row['pE50'] <= row['pS200']:
                state = 1

        elif state == 1:
            if row['E20'] < row['E50'] and row['pE20'] >= row['pE50']:
                state = 2

        elif state == 2:
            if row['E9'] > row['E20'] and row['pE9'] <= row['pE20']:
                bases_found.append(dt)
                if len(bases_found) == 2:
                    break
                state = 1

    if not bases_found:
        return None

    return (bases_found[0], bases_found[1] if len(bases_found) > 1 else None)


def run_first_daily_base_scan():
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id SERIAL PRIMARY KEY, job TEXT NOT NULL,
            line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("DELETE FROM job_progress WHERE job = 'first_daily_base'")

    # Create table if it doesn't exist yet
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS first_daily_base (
            id               SERIAL PRIMARY KEY,
            fyers_symbol     TEXT UNIQUE NOT NULL,
            stock_name       TEXT,
            sector           TEXT,
            industry         TEXT,
            basic_industry   TEXT,
            rs_score         FLOAT,
            first_base_date  TEXT,
            second_base_date TEXT,
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()

    # Migrate old schema: add new columns, drop old ones
    for col in ('first_base_date', 'second_base_date'):
        cursor.execute(f"ALTER TABLE first_daily_base ADD COLUMN IF NOT EXISTS {col} TEXT")
    conn.commit()
    for col in ('step1_date', 'step2_date', 'signal_date'):
        cursor.execute(f"ALTER TABLE first_daily_base DROP COLUMN IF EXISTS {col}")
    conn.commit()

    log_progress(cursor, conn, "🚀 1st Daily Base Scan Started")

    fyers = get_fyers()
    today_ist = datetime.now(IST).date()
    cutoff_date = (today_ist - timedelta(days=30)).strftime('%Y-%m-%d')

    cursor.execute("""
        SELECT fyers_symbol, stock_name, sector, industry, basic_industry, rs_score
        FROM stocks
        WHERE fyers_symbol IS NOT NULL
    """)
    stocks = cursor.fetchall()
    log_progress(cursor, conn, f"📊 Scanning {len(stocks)} stocks | cutoff={cutoff_date}...")

    SERIES_PRIORITY = ["EQ", "BE", "BZ", "BL", "BT", "SM", "ST"]
    signals = []
    failed  = []

    for symbol, stock_name, sector, industry, basic_industry, rs_score in tqdm(stocks):
        try:
            # Two fetches: warmup batch (days 730-365) + signal batch (last 364 days)
            # Combined gives ~500 bars so SMA200 warmup (200 bars) leaves ~300 usable bars
            warmup_from = (today_ist - timedelta(days=730)).strftime("%Y-%m-%d")
            warmup_to   = (today_ist - timedelta(days=365)).strftime("%Y-%m-%d")
            main_from   = (today_ist - timedelta(days=364)).strftime("%Y-%m-%d")
            main_to     = today_ist.strftime("%Y-%m-%d")

            res_w = fetch_safe(fyers, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                       "range_from": warmup_from, "range_to": warmup_to, "cont_flag": "1"})
            res_m = fetch_safe(fyers, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                       "range_from": main_from, "range_to": main_to, "cont_flag": "1"})

            # Series fallback if main fetch failed
            if not isinstance(res_m, dict) or "candles" not in res_m or not res_m["candles"]:
                ticker_base    = symbol.rsplit("-", 1)[0]
                current_series = symbol.rsplit("-", 1)[-1]
                for series in [s for s in SERIES_PRIORITY if s != current_series]:
                    candidate = f"{ticker_base}-{series}"
                    fb_w = fetch_safe(fyers, {"symbol": candidate, "resolution": "1D", "date_format": "1",
                                              "range_from": warmup_from, "range_to": warmup_to, "cont_flag": "1"})
                    fb_m = fetch_safe(fyers, {"symbol": candidate, "resolution": "1D", "date_format": "1",
                                              "range_from": main_from, "range_to": main_to, "cont_flag": "1"})
                    if isinstance(fb_m, dict) and "candles" in fb_m and fb_m["candles"]:
                        res_w  = fb_w
                        res_m  = fb_m
                        symbol = candidate
                        break
                else:
                    failed.append(symbol)
                    continue

            frames = []
            if isinstance(res_w, dict) and "candles" in res_w and res_w["candles"]:
                frames.append(pd.DataFrame(res_w['candles'], columns=['date','open','high','low','close','vol']))
            if isinstance(res_m, dict) and "candles" in res_m and res_m["candles"]:
                frames.append(pd.DataFrame(res_m['candles'], columns=['date','open','high','low','close','vol']))
            if not frames:
                failed.append(symbol)
                continue

            df = pd.concat(frames).drop_duplicates(subset='date').sort_values('date').reset_index(drop=True)
            result = find_bases(df)

            if result is None:
                continue

            first_base, second_base = result

            # Include if either base signal is within the last 30 days
            most_recent = second_base if second_base else first_base
            if most_recent < cutoff_date:
                continue

            signals.append((symbol, stock_name, sector, industry, basic_industry, rs_score,
                            first_base, second_base))
            log_progress(cursor, conn,
                f"🎯 {symbol} → 1st Base: {first_base} | 2nd Base: {second_base or '--'}")

        except Exception as e:
            log_progress(cursor, conn, f"❌ Error on {symbol}: {e}")
            failed.append(symbol)
            try:
                conn.rollback()
            except Exception:
                pass

        finally:
            time.sleep(0.1)

    cursor.execute("DELETE FROM first_daily_base")
    if signals:
        execute_values(cursor, """
            INSERT INTO first_daily_base
                (fyers_symbol, stock_name, sector, industry, basic_industry, rs_score,
                 first_base_date, second_base_date, updated_at)
            VALUES %s
        """, [(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], datetime.now(IST)) for s in signals])
    conn.commit()

    log_progress(cursor, conn, f"✅ {len(signals)} signals | {len(failed)} failed | {len(stocks)} scanned")
    log_progress(cursor, conn, "🎉 1st Daily Base Scan Complete!")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    run_first_daily_base_scan()
