import pandas as pd
import pandas_ta_classic as ta
from fyers_apiv3 import fyersModel
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
today = datetime.now(IST).date()

with open('access_token.txt') as f:
    token = f.read().strip()
fyers = fyersModel.FyersModel(client_id='QTKF8KZDM9-100', is_async=False, token=token, log_path='')

symbol = 'NSE:ADANIPORTS-EQ'
daily_cross_date = '2026-04-17'

# Step 1: Confirm daily cross on 2026-04-17
print("=== DAILY CANDLES ===")
res_d = fyers.history({'symbol': symbol, 'resolution': '1D', 'date_format': '1',
                       'range_from': (today - timedelta(days=364)).strftime('%Y-%m-%d'),
                       'range_to': today.strftime('%Y-%m-%d'), 'cont_flag': '1'})
df = pd.DataFrame(res_d['candles'], columns=['date','open','high','low','close','vol'])
df['dt'] = pd.to_datetime(df['date'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')
df['E20'] = ta.ema(df['close'], 20)
df['E50'] = ta.ema(df['close'], 50)
df['P20'] = df['E20'].shift(1)
df['P50'] = df['E50'].shift(1)

crosses = df[(df['E20'] > df['E50']) & (df['P20'] <= df['P50'])]
print(f"Daily cross dates found: {[str(r.date()) for r in crosses['dt']]}")
print(f"Latest daily cross: {crosses['dt'].iloc[-1].date() if not crosses.empty else 'None'}")
print(f"Current daily: E20={df['E20'].iloc[-1]:.2f}, E50={df['E50'].iloc[-1]:.2f}, Bullish={df['E20'].iloc[-1] > df['E50'].iloc[-1]}")

# Step 2: Get the epoch for the daily cross
daily_cross_epoch = int(datetime.strptime(daily_cross_date, '%Y-%m-%d').replace(tzinfo=IST).timestamp())
print(f"\nDaily cross epoch: {daily_cross_epoch} ({daily_cross_date})")

# Step 3: Fetch 15M data and find bearish cross AFTER daily cross
cross_obj = datetime.strptime(daily_cross_date, '%Y-%m-%d').date()
days_active = (today - cross_obj).days
fetch_days = min(days_active + 25, 95)
from_dt = (today - timedelta(days=fetch_days)).strftime('%Y-%m-%d')

print(f"\n=== 15M CANDLES (from {from_dt} to {today}) ===")
res_15 = fyers.history({'symbol': symbol, 'resolution': '15', 'date_format': '1',
                        'range_from': from_dt, 'range_to': today.strftime('%Y-%m-%d'), 'cont_flag': '1'})
df15 = pd.DataFrame(res_15['candles'], columns=['date','open','high','low','close','vol'])
df15['dt'] = pd.to_datetime(df15['date'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')
df15['E20'] = ta.ema(df15['close'], 20)
df15['E50'] = ta.ema(df15['close'], 50)
df15['P20'] = df15['E20'].shift(1)
df15['P50'] = df15['E50'].shift(1)

print(f"Total 15M candles: {len(df15)}")

# Show EMA values around the reported cross time
print("\n=== 15M EMA values around 2026-04-22 09:45 - 10:15 ===")
window = df15[(df15['dt'] >= '2026-04-22 09:30') & (df15['dt'] <= '2026-04-22 10:30')]
print(window[['dt','close','E20','E50','P20','P50']].to_string(index=False))

# Find all bearish crosses after daily cross epoch
c_15 = df15[(df15['E20'] < df15['E50']) & (df15['P20'] >= df15['P50'])]
c_15_after = c_15[c_15['date'] >= daily_cross_epoch]
print(f"\n=== ALL 15M BEARISH CROSSES AFTER {daily_cross_date} ===")
if not c_15_after.empty:
    for _, row in c_15_after.iterrows():
        print(f"  {row['dt']}  close={row['close']:.2f}  E20={row['E20']:.2f}  E50={row['E50']:.2f}  P20={row['P20']:.2f}  P50={row['P50']:.2f}")
else:
    print("  None found")

# Also show 1H crosses
print(f"\n=== 1H CANDLES (from {from_dt} to {today}) ===")
res_60 = fyers.history({'symbol': symbol, 'resolution': '60', 'date_format': '1',
                        'range_from': from_dt, 'range_to': today.strftime('%Y-%m-%d'), 'cont_flag': '1'})
df60 = pd.DataFrame(res_60['candles'], columns=['date','open','high','low','close','vol'])
df60['dt'] = pd.to_datetime(df60['date'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')
df60['E20'] = ta.ema(df60['close'], 20)
df60['E50'] = ta.ema(df60['close'], 50)
df60['P20'] = df60['E20'].shift(1)
df60['P50'] = df60['E50'].shift(1)

c_60 = df60[(df60['E20'] < df60['E50']) & (df60['P20'] >= df60['P50'])]
c_60_after = c_60[c_60['date'] >= daily_cross_epoch]
print(f"Total 1H candles: {len(df60)}")
print(f"\n=== ALL 1H BEARISH CROSSES AFTER {daily_cross_date} ===")
if not c_60_after.empty:
    for _, row in c_60_after.iterrows():
        print(f"  {row['dt']}  close={row['close']:.2f}  E20={row['E20']:.2f}  E50={row['E50']:.2f}  P20={row['P20']:.2f}  P50={row['P50']:.2f}")
else:
    print("  None found")
