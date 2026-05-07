from fyers_apiv3 import fyersModel
from datetime import datetime, timedelta, timezone
import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()

with open('access_token.txt') as f:
    token = f.read().strip()
fyers = fyersModel.FyersModel(client_id='QTKF8KZDM9-100', is_async=False, token=token, log_path='')

print("--- 1W resolution range test ---")
for days in [365, 366, 500, 700, 730, 1000, 1500, 2000, 2500, 3000]:
    range_from = (today - timedelta(days=days)).strftime('%Y-%m-%d')
    res = fyers.history({'symbol': 'NSE:RELIANCE-EQ', 'resolution': '1W', 'date_format': '1',
                         'range_from': range_from, 'range_to': today.strftime('%Y-%m-%d'), 'cont_flag': '1'})
    candles = res.get('candles') or []
    msg = res.get('message', '') or res.get('data', {})
    status = f"{len(candles)} weekly candles" if candles else f"ERROR: {msg}"
    print(f"days={days:>5}  range_from={range_from}  -> {status}")
