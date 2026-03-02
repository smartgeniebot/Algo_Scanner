import sqlite3
import psycopg2
from psycopg2 import extras

# 🛑 Paste your exact Neon URL here (Keep it secret!)
NEON_URL = "postgresql://neondb_owner:npg_DIqZm0RfxT1u@ep-shiny-hall-a1z6dhn4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

def migrate_to_cloud():
    print("🚀 Connecting to Neon Cloud Database...")
    try:
        # 1. Connect to Neon (PostgreSQL)
        pg_conn = psycopg2.connect(NEON_URL)
        pg_cursor = pg_conn.cursor()

        # 2. Build the exact same table structure in the cloud
        print("🏗️ Building the database schema...")
        pg_cursor.execute("""
            CREATE TABLE IF NOT EXISTS stocks (
                id SERIAL PRIMARY KEY,
                stock_name TEXT,
                fyers_symbol TEXT,
                sector TEXT,
                industry TEXT,
                rs_score FLOAT,
                daily_cross_active TEXT,
                daily_cross_date TEXT,
                first_1h_cross_time TEXT,
                first_15m_cross_time TEXT
            )
        """)
        
        # Clear it just in case you run this script twice by accident
        pg_cursor.execute("TRUNCATE TABLE stocks RESTART IDENTITY;")
        pg_conn.commit()

        # 3. Connect to your local database
        print("📂 Reading local scanner_vault.db...")
        sl_conn = sqlite3.connect("scanner_vault.db")
        sl_cursor = sl_conn.cursor()
        
        # Fetch everything except the ID (Neon will auto-generate new IDs)
        sl_cursor.execute("""
            SELECT stock_name, fyers_symbol, sector, industry, rs_score, 
                   daily_cross_active, daily_cross_date, first_1h_cross_time, first_15m_cross_time 
            FROM stocks
        """)
        local_stocks = sl_cursor.fetchall()

        # 4. Teleport the data to the cloud
        print(f"☁️ Uploading {len(local_stocks)} stocks to Neon...")
        insert_query = """
            INSERT INTO stocks (stock_name, fyers_symbol, sector, industry, rs_score, 
                                daily_cross_active, daily_cross_date, first_1h_cross_time, first_15m_cross_time)
            VALUES %s
        """
        # execute_values is a special Psycopg2 command that uploads thousands of rows instantly
        psycopg2.extras.execute_values(pg_cursor, insert_query, local_stocks)
        
        pg_conn.commit()
        print("✅ Data Migration Complete! Your cloud brain is officially online and fully loaded.")

    except Exception as e:
        print(f"❌ Error: {e}")
        
    finally:
        if 'pg_conn' in locals():
            pg_cursor.close()
            pg_conn.close()
        if 'sl_conn' in locals():
            sl_conn.close()

if __name__ == "__main__":
    migrate_to_cloud()