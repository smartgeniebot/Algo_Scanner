import time
import pandas as pd
import pandas_ta_classic as ta
from fyers_apiv3 import fyersModel
from datetime import date, datetime, timedelta, timezone
from tqdm import tqdm
import psycopg2
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

def find_first_daily_base(df):
    """
    State machine: find the FIRST occurrence of the 3-step sequence.

    Step 1: EMA50 crosses above SMA200  (macro uptrend established)
    Step 2: After step 1, EMA20 crosses below EMA50  (first pullback)
    Step 3: After step 2, EMA9 crosses above EMA20   (re-entry trigger) ← signal date

    Returns (step1_date, step2_date, step3_date) as YYYY-MM-DD strings, or None.
    """
    if len(df) < 210:
        return None

    df = df.copy().reset_index(drop=True)
    df['E9']  = ta.ema(df['close'], 9)
    df['E20'] = ta.ema(df['close'], 20)
    df['E50'] = ta.ema(df['close'], 50)
    df['S200'] = ta.sma(df['close'], 200)

    df = df.dropna(subset=['E9', 'E20', 'E50', 'S200']).reset_index(drop=True)
    if len(df) < 5:
        return None

    # Shift-1 for previous bar values
    df['pE9']  = df['E9'].shift(1)
    df['pE20'] = df['E20'].shift(1)
    df['pE50'] = df['E50'].shift(1)
    df['pS200'] = df['S200'].shift(1)
    df = df.dropna(subset=['pE9', 'pE20', 'pE50', 'pS200']).reset_index(drop=True)

    state = 0          # 0=waiting for step1, 1=waiting for step2, 2=waiting for step3
    step1_date = None
    step2_date = None

    for i in range(len(df)):
        row = df.iloc[i]
        dt = datetime.fromtimestamp(int(float(row['date'])), IST).strftime('%Y-%m-%d')

        if state == 0:
            # Step 1: EMA50 crosses above SMA200
            if row['E50'] > row['S200'] and row['pE50'] <= row['pS200']:
                step1_date = dt
                state = 1

        elif state == 1:
            # Step 2 (first occurrence after step 1): EMA20 crosses below EMA50
            if row['E20'] < row['E50'] and row['pE20'] >= row['pE50']:
                step2_date = dt
                state = 2

        elif state == 2:
            # Step 3 (first occurrence after step 2): EMA9 crosses above EMA20
            if row['E9'] > row['E20'] and row['pE9'] <= row['pE20']:
                step3_date = dt
                return (step1_date, step2_date, step3_date)

    return None


def run_first_daily_base_scan():
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    # Ensure tables exist
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id SERIAL PRIMARY KEY, job TEXT NOT NULL,
            line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("DELETE FROM job_progress WHERE job = 'first_daily_base'")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS first_daily_base (
            id              SERIAL PRIMARY KEY,
            fyers_symbol    TEXT UNIQUE NOT NULL,
            stock_name      TEXT,
            sector          TEXT,
            industry        TEXT,
            basic_industry  TEXT,
            rs_score        FLOAT,
            step1_date      TEXT,
            step2_date      TEXT,
            signal_date     TEXT,
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()

    log_progress(cursor, conn, "🚀 1st Daily Base Scan Started")

    fyers = get_fyers()
    today_ist = datetime.now(IST).date()
    cutoff_date = (today_ist - timedelta(days=14)).strftime('%Y-%m-%d')

    # Fetch all stocks with their metadata
    cursor.execute("""
        SELECT fyers_symbol, stock_name, sector, industry, basic_industry, rs_score
        FROM stocks
        WHERE fyers_symbol IS NOT NULL
    """)
    stocks = cursor.fetchall()
    log_progress(cursor, conn, f"📊 Scanning {len(stocks)} stocks for 1st Daily Base pattern...")

    SERIES_PRIORITY = ["EQ", "BE", "BZ", "BL", "BT", "SM", "ST"]
    signals = []
    failed = []

    for symbol, stock_name, sector, industry, basic_industry, rs_score in tqdm(stocks):
        try:
            range_from = (today_ist - timedelta(days=364)).strftime("%Y-%m-%d")
            range_to   = today_ist.strftime("%Y-%m-%d")

            res = fetch_safe(fyers, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                     "range_from": range_from, "range_to": range_to, "cont_flag": "1"})

            # Series fallback
            if not isinstance(res, dict) or "candles" not in res or not res["candles"]:
                ticker_base   = symbol.rsplit("-", 1)[0]
                current_series = symbol.rsplit("-", 1)[-1]
                for series in [s for s in SERIES_PRIORITY if s != current_series]:
                    candidate = f"{ticker_base}-{series}"
                    fallback  = fetch_safe(fyers, {"symbol": candidate, "resolution": "1D", "date_format": "1",
                                                   "range_from": range_from, "range_to": range_to, "cont_flag": "1"})
                    if isinstance(fallback, dict) and "candles" in fallback and fallback["candles"]:
                        res    = fallback
                        symbol = candidate
                        break
                else:
                    failed.append(symbol)
                    continue

            df = pd.DataFrame(res['candles'], columns=['date','open','high','low','close','vol'])
            result = find_first_daily_base(df)

            if result is None:
                continue

            step1_date, step2_date, signal_date = result

            # Only include if signal (step 3) is within last 14 days
            if signal_date < cutoff_date:
                continue

            signals.append((symbol, stock_name, sector, industry, basic_industry, rs_score,
                            step1_date, step2_date, signal_date))
            log_progress(cursor, conn, f"🎯 {symbol} → Step1: {step1_date} | Step2: {step2_date} | Signal: {signal_date}")

        except Exception as e:
            log_progress(cursor, conn, f"❌ Error on {symbol}: {e}")
            failed.append(symbol)
            try:
                conn.rollback()
            except Exception:
                pass

        finally:
            time.sleep(0.1)

    # Replace table contents with fresh signals
    cursor.execute("DELETE FROM first_daily_base")
    if signals:
        from psycopg2.extras import execute_values
        execute_values(cursor, """
            INSERT INTO first_daily_base
                (fyers_symbol, stock_name, sector, industry, basic_industry, rs_score,
                 step1_date, step2_date, signal_date, updated_at)
            VALUES %s
        """, [(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], datetime.now(IST)) for s in signals])
    conn.commit()

    total = len(stocks)
    log_progress(cursor, conn, f"✅ {len(signals)} signals found | {len(failed)} failed | {total} scanned")
    log_progress(cursor, conn, "🎉 1st Daily Base Scan Complete!")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    run_first_daily_base_scan()
