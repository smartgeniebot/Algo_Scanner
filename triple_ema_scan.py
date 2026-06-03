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
    State machine: find 1st and 2nd base signals after EMA50 crosses above SMA200.

    Step 1 : EMA50 crosses above SMA200  — macro uptrend anchor (once only)
    Base N  : after step 1 (or previous base signal):
                a) EMA20 crosses below EMA50  — pullback
                b) EMA9  crosses above EMA20  — re-entry signal ← base signal date

    Returns (first_base_date, second_base_date) as YYYY-MM-DD strings.
    Either can be None if that base has not yet occurred within the data window.
    Returns None entirely if step 1 has not occurred.
    """
    if len(df) < 210:
        return None

    df = df.copy().reset_index(drop=True)
    df['E9']   = ta.ema(df['close'], 9)
    df['E20']  = ta.ema(df['close'], 20)
    df['E50']  = ta.ema(df['close'], 50)
    df['S200'] = ta.sma(df['close'], 200)

    df = df.dropna(subset=['E9', 'E20', 'E50', 'S200']).reset_index(drop=True)
    if len(df) < 5:
        return None

    df['pE9']   = df['E9'].shift(1)
    df['pE20']  = df['E20'].shift(1)
    df['pE50']  = df['E50'].shift(1)
    df['pS200'] = df['S200'].shift(1)
    df = df.dropna(subset=['pE9', 'pE20', 'pE50', 'pS200']).reset_index(drop=True)

    # Determine starting state from where we are in the cycle at bar 0:
    #
    #  E50 < S200                           => state 0: waiting for macro uptrend
    #  E50 > S200, E20 > E50, E9 <= E20    => state 1: uptrend established, no base yet
    #  E50 > S200, E20 > E50, E9 > E20     => 1st base completed before window (EMA9 still above
    #                                          EMA20); mark with 'prior', next pullback is 2nd base
    #  E50 > S200, E20 < E50, E9 < E20     => state 2: mid-pullback, waiting for EMA9 re-entry
    #  E50 > S200, E20 < E50, E9 > E20     => pullback done, EMA9 still above; wait for next pullback
    first = df.iloc[0]
    if first['E50'] <= first['S200']:
        state = 0
        bases_found = []
    elif first['E20'] >= first['E50']:
        if first['E9'] > first['E20']:
            # 1st base completed before our data window
            state = 1
            bases_found = ['prior']
        else:
            state = 1
            bases_found = []
    else:
        # E50 > S200, E20 < E50
        state = 2 if first['E9'] < first['E20'] else 1
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

    real_bases = [b for b in bases_found if b != 'prior']
    if not real_bases:
        return None

    if 'prior' in bases_found:
        # 1st base was before the data window; real_bases[0] is the 2nd base
        return (None, real_bases[0])

    first  = real_bases[0]
    second = real_bases[1] if len(real_bases) > 1 else None
    return (first, second)


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
            range_from = (today_ist - timedelta(days=364)).strftime("%Y-%m-%d")
            range_to   = today_ist.strftime("%Y-%m-%d")

            res = fetch_safe(fyers, {"symbol": symbol, "resolution": "1D", "date_format": "1",
                                     "range_from": range_from, "range_to": range_to, "cont_flag": "1"})

            if not isinstance(res, dict) or "candles" not in res or not res["candles"]:
                ticker_base    = symbol.rsplit("-", 1)[0]
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
