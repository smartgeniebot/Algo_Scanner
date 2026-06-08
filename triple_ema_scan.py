import argparse
import pandas as pd
import pandas_ta_classic as ta
from datetime import datetime, timedelta, timezone
from tqdm import tqdm
import psycopg2
from psycopg2.extras import execute_values
from config import NEON_URL

IST = timezone(timedelta(hours=5, minutes=30))

def log_progress(cursor, conn, msg, job='first_daily_base'):
    print(msg)
    try:
        cursor.execute("INSERT INTO job_progress (job, line) VALUES (%s, %s)", (job, msg))
        conn.commit()
    except Exception:
        pass

def find_bases(df):
    """
    State machine over combined 2-year daily data:
      Cycle start : EMA50 crosses above SMA200
      Reset       : EMA50 drops below SMA200 at any point → back to state 0
      Base 1      : EMA20 < EMA50 pullback → EMA9 > EMA20 re-entry (EMA50 must be > SMA200)
      Base 2      : EMA20 < EMA50 pullback again → EMA9 > EMA20 re-entry (EMA50 must be > SMA200)
    Returns (first_base_date, second_base_date). second_base_date is None if not yet occurred.
    Returns None if no valid cycle completed.
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

    # States:
    #  0 - waiting for EMA50 to cross above SMA200 (cycle start)
    #  1 - waiting for EMA20 to cross below EMA50 (fresh crossover required, Base 1 pullback)
    #  2 - waiting for EMA9 to cross above EMA20 (Base 1 re-entry)
    #  3 - waiting for EMA20 to drop below EMA50 (Base 2 pullback; already-below also accepted)
    #  4 - waiting for EMA9 to cross above EMA20 (Base 2 re-entry)
    state = 0
    bases_found = []

    for i in range(len(df)):
        row = df.iloc[i]
        dt = datetime.fromtimestamp(int(float(row['date'])), IST).strftime('%Y-%m-%d')

        # Global reset: EMA50 drops below SMA200 at any active state → restart cycle
        if state > 0 and row['E50'] < row['S200']:
            state = 0
            bases_found = []
            continue

        if state == 0:
            # Cycle starts only on EMA50 crossing above SMA200
            if row['E50'] > row['S200'] and row['pE50'] <= row['pS200']:
                state = 1

        elif state == 1:
            # Base 1 pullback: require a fresh EMA20 crossover below EMA50
            if row['E20'] < row['E50'] and row['pE20'] >= row['pE50']:
                state = 2

        elif state == 2:
            # Base 1 re-entry: EMA9 crosses above EMA20; EMA50 must be above SMA200
            if row['E9'] > row['E20'] and row['pE9'] <= row['pE20'] and row['E50'] > row['S200']:
                bases_found.append(dt)
                # Always require a fresh EMA20 < EMA50 pullback before Base 2
                state = 3

        elif state == 3:
            # Base 2 pullback: require a fresh EMA20 crossover below EMA50
            if row['E20'] < row['E50'] and row['pE20'] >= row['pE50']:
                state = 4

        elif state == 4:
            # Base 2 re-entry: EMA9 crosses above EMA20; EMA50 must be above SMA200
            if row['E9'] > row['E20'] and row['pE9'] <= row['pE20'] and row['E50'] > row['S200']:
                bases_found.append(dt)
                break

    if not bases_found:
        return None

    return (bases_found[0], bases_found[1] if len(bases_found) > 1 else None)


def load_ohlcv_from_db(conn, symbol):
    """Load 2yr daily OHLCV from daily_ohlcv cache table. Returns DataFrame or None."""
    cur = conn.cursor()
    cur.execute("""
        SELECT date, open, high, low, close, vol
        FROM daily_ohlcv
        WHERE fyers_symbol = %s
        ORDER BY date ASC
    """, (symbol,))
    rows = cur.fetchall()
    cur.close()
    if not rows:
        return None
    df = pd.DataFrame(rows, columns=['date','open','high','low','close','vol'])
    return df


def check_cache_fresh(conn, cursor):
    """Verify daily_ohlcv was populated today. Returns False if table missing or stale."""
    try:
        today_ist = datetime.now(IST).date()
        today_epoch_start = int(datetime.combine(today_ist, datetime.min.time())
                                .replace(tzinfo=IST).timestamp())
        cursor.execute("SELECT COUNT(*) FROM daily_ohlcv WHERE date >= %s", (today_epoch_start,))
        count = cursor.fetchone()[0]
        return count > 0
    except Exception:
        conn.rollback()
        return False


def run_first_daily_base_scan(lookback_days=30):
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id SERIAL PRIMARY KEY, job TEXT NOT NULL,
            line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("DELETE FROM job_progress WHERE job = 'first_daily_base'")

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

    for col, coltype in [('first_base_date', 'TEXT'), ('second_base_date', 'TEXT'),
                         ('is_high_roce', 'BOOLEAN DEFAULT FALSE'),
                         ('is_moderate_growth', 'BOOLEAN DEFAULT FALSE')]:
        cursor.execute(f"ALTER TABLE first_daily_base ADD COLUMN IF NOT EXISTS {col} {coltype}")
    conn.commit()
    for col in ('step1_date', 'step2_date', 'signal_date'):
        cursor.execute(f"ALTER TABLE first_daily_base DROP COLUMN IF EXISTS {col}")
    conn.commit()

    log_progress(cursor, conn, f"🚀 1st Daily Base Scan Started (lookback={lookback_days} days)")

    today_ist = datetime.now(IST).date()
    cutoff_date = (today_ist - timedelta(days=lookback_days)).strftime('%Y-%m-%d')

    if not check_cache_fresh(conn, cursor):
        log_progress(cursor, conn, "❌ daily_ohlcv cache is not fresh for today — market_engine may not have run yet. Aborting.")
        cursor.close()
        conn.close()
        return

    cursor.execute("""
        SELECT fyers_symbol, stock_name, sector, industry, basic_industry, rs_score,
               is_high_roce, is_moderate_growth
        FROM stocks
        WHERE fyers_symbol IS NOT NULL
    """)
    stocks = cursor.fetchall()
    log_progress(cursor, conn, f"📊 Scanning {len(stocks)} stocks from daily_ohlcv cache | cutoff={cutoff_date}...")

    signals = []
    failed  = []

    for symbol, stock_name, sector, industry, basic_industry, rs_score, is_high_roce, is_moderate_growth in tqdm(stocks):
        try:
            df = load_ohlcv_from_db(conn, symbol)
            if df is None or len(df) < 210:
                failed.append(symbol)
                continue

            result = find_bases(df)

            if result is None:
                continue

            first_base, second_base = result

            most_recent = second_base if second_base else first_base
            if most_recent < cutoff_date:
                continue

            signals.append((symbol, stock_name, sector, industry, basic_industry, rs_score,
                            first_base, second_base, is_high_roce, is_moderate_growth))
            log_progress(cursor, conn,
                f"🎯 {symbol} → 1st Base: {first_base} | 2nd Base: {second_base or '--'}")

        except Exception as e:
            failed.append(symbol)
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                log_progress(cursor, conn, f"❌ Error on {symbol}: {e}")
            except Exception:
                pass

    try:
        cursor.close()
        conn.close()
    except Exception:
        pass
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    cursor.execute("DELETE FROM first_daily_base")
    if signals:
        execute_values(cursor, """
            INSERT INTO first_daily_base
                (fyers_symbol, stock_name, sector, industry, basic_industry, rs_score,
                 first_base_date, second_base_date, is_high_roce, is_moderate_growth, updated_at)
            VALUES %s
        """, [(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], datetime.now(IST)) for s in signals])
    conn.commit()

    log_progress(cursor, conn, f"✅ {len(signals)} signals | {len(failed)} failed | {len(stocks)} scanned")
    log_progress(cursor, conn, "🎉 1st Daily Base Scan Complete!")

    cursor.close()
    conn.close()


def find_weekly_base(df):
    """
    State machine for Early Weekly Base detection on daily OHLCV data:
      Cycle start : EMA50 crosses above SMA200 on daily
      Base signal : price Low drops below EMA40 for the first time after cycle start
    Returns the date string of the first pullback candle where Low < EMA40, or None.
    """
    if len(df) < 210:
        return None

    df = df.copy().reset_index(drop=True)
    df['E40']  = ta.ema(df['close'], 40)
    df['E50']  = ta.ema(df['close'], 50)
    df['S200'] = ta.sma(df['close'], 200)
    df['pE50']  = df['E50'].shift(1)
    df['pS200'] = df['S200'].shift(1)
    df = df.dropna(subset=['E40', 'E50', 'S200', 'pE50', 'pS200']).reset_index(drop=True)
    if len(df) < 5:
        return None

    in_cycle = False
    for i in range(len(df)):
        row = df.iloc[i]
        dt = datetime.fromtimestamp(int(float(row['date'])), IST).strftime('%Y-%m-%d')

        # Reset if EMA50 drops back below SMA200
        if in_cycle and row['E50'] < row['S200']:
            in_cycle = False
            continue

        if not in_cycle:
            if row['E50'] > row['S200'] and row['pE50'] <= row['pS200']:
                in_cycle = True
        else:
            # First pullback: candle Low drops below EMA40
            if row['low'] < row['E40']:
                return dt

    return None


def run_early_weekly_base_scan(lookback_days=30):
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    JOB = 'early_weekly_base'

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS job_progress (
            id SERIAL PRIMARY KEY, job TEXT NOT NULL,
            line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("DELETE FROM job_progress WHERE job = %s", (JOB,))

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS early_weekly_base (
            id               SERIAL PRIMARY KEY,
            fyers_symbol     TEXT UNIQUE NOT NULL,
            stock_name       TEXT,
            sector           TEXT,
            industry         TEXT,
            basic_industry   TEXT,
            rs_score         FLOAT,
            pullback_date    TEXT,
            is_high_roce     BOOLEAN DEFAULT FALSE,
            is_moderate_growth BOOLEAN DEFAULT FALSE,
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()

    log_progress(cursor, conn, f"🌿 Early Weekly Base Scan Started (lookback={lookback_days} days)", JOB)

    today_ist = datetime.now(IST).date()
    cutoff_date = (today_ist - timedelta(days=lookback_days)).strftime('%Y-%m-%d')

    if not check_cache_fresh(conn, cursor):
        log_progress(cursor, conn, "❌ daily_ohlcv cache is not fresh for today — market_engine may not have run yet. Aborting.", JOB)
        cursor.close()
        conn.close()
        return

    cursor.execute("""
        SELECT fyers_symbol, stock_name, sector, industry, basic_industry, rs_score,
               is_high_roce, is_moderate_growth
        FROM stocks
        WHERE fyers_symbol IS NOT NULL
    """)
    stocks = cursor.fetchall()
    log_progress(cursor, conn, f"📊 Scanning {len(stocks)} stocks from daily_ohlcv cache | cutoff={cutoff_date}...", JOB)

    signals = []
    failed  = []

    for symbol, stock_name, sector, industry, basic_industry, rs_score, is_high_roce, is_moderate_growth in tqdm(stocks):
        try:
            df = load_ohlcv_from_db(conn, symbol)
            if df is None or len(df) < 210:
                failed.append(symbol)
                continue

            pullback_date = find_weekly_base(df)

            if pullback_date is None or pullback_date < cutoff_date:
                continue

            signals.append((symbol, stock_name, sector, industry, basic_industry, rs_score,
                            pullback_date, is_high_roce, is_moderate_growth))
            log_progress(cursor, conn, f"🌿 {symbol} → Pullback: {pullback_date}", JOB)

        except Exception as e:
            failed.append(symbol)
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                log_progress(cursor, conn, f"❌ Error on {symbol}: {e}", JOB)
            except Exception:
                pass

    try:
        cursor.close()
        conn.close()
    except Exception:
        pass
    conn = psycopg2.connect(NEON_URL)
    cursor = conn.cursor()

    cursor.execute("DELETE FROM early_weekly_base")
    if signals:
        execute_values(cursor, """
            INSERT INTO early_weekly_base
                (fyers_symbol, stock_name, sector, industry, basic_industry, rs_score,
                 pullback_date, is_high_roce, is_moderate_growth, updated_at)
            VALUES %s
        """, [(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], datetime.now(IST)) for s in signals])
    conn.commit()

    log_progress(cursor, conn, f"✅ {len(signals)} signals | {len(failed)} no-data | {len(stocks)} scanned", JOB)
    log_progress(cursor, conn, "🎉 Early Weekly Base Scan Complete!", JOB)

    cursor.close()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--lookback-days', type=int, default=30)
    parser.add_argument('--mode', choices=['daily_base', 'weekly_base'], default='daily_base')
    args = parser.parse_args()

    if args.mode == 'weekly_base':
        run_early_weekly_base_scan(lookback_days=args.lookback_days)
    else:
        run_first_daily_base_scan(lookback_days=args.lookback_days)
