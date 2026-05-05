# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Algo_Scanner is a stock screening and technical analysis platform for NSE (Indian market) stocks. It identifies daily uptrend crossovers (EMA20 > EMA50) and intraday pullback opportunities via the Fyers API, stores results in Neon (PostgreSQL cloud), and serves them through a FastAPI + React dashboard.

Two GitHub Actions workflows run on IST market hours:
- **market_engine.yml** — daily end-of-day scan (`manual_scan.py`)
- **intraday_engine.yml** — hourly pullback detection (`intraday_pulse.py`)

## Commands

### Backend
```bash
pip install -r requirements.txt
python auth.py          # Authenticate with Fyers API; writes access_token.txt
python main.py          # Start FastAPI server on port 8000
python manual_scan.py   # Run daily EMA crossover scan manually
python intraday_pulse.py  # Run pullback detection scan manually
python migrate_db.py    # Migrate local SQLite data to Neon PostgreSQL
```

### Frontend
```bash
cd frontend
npm install
npm run dev      # Vite dev server
npm run build    # Production build
npm run lint     # ESLint
```

## Architecture

### Data Flow
```
Fyers API → manual_scan.py → Neon PostgreSQL → FastAPI (main.py) → React Frontend
                ↑
         intraday_pulse.py (reads only stocks with active daily uptrends)
```

### Backend Modules

| File | Role |
|------|------|
| `auth.py` | Multi-step Fyers login using TOTP (pyotp); generates and saves access token |
| `config.py` | Credential loading; reads from env vars with local fallback |
| `manual_scan.py` | Fetches 45 days OHLCV, computes EMA20/EMA50 crossovers on daily timeframe, scrapes Screener.in for fundamentals, writes results to Neon |
| `intraday_pulse.py` | Monitors active-uptrend stocks only; detects 1H/15M pullbacks (EMA20 < EMA50 intraday); caches results to minimize API calls |
| `main.py` | FastAPI server: stock filter queries, sector/industry heatmaps, GitHub Actions workflow trigger |

### Frontend Components (`frontend/src/`)

| File | Role |
|------|------|
| `App.jsx` | Central state (filters, stocks, theme); tabs for Scanner/Sectors/Industries; CSV export; manual scan trigger |
| `SectorHeatmap.jsx` | Sector-level RS score visualization; expandable to industries |
| `IndustryHeatmap.jsx` | Industry-level performance; drilldown triggers scanner |
| `StockScanner.jsx` | Legacy; stock table display with universal search |

### API Endpoints (`main.py`)
- `GET /api/filters` — sector/industry hierarchy for filter UI
- `POST /api/stocks` — filtered stock results
- `GET /api/sector-heatmap` — RS scores aggregated by sector
- `GET /api/industry-heatmap` — RS scores aggregated by industry
- `POST /api/trigger-scan` — dispatches GitHub Actions workflow

### Database
- **Production:** Neon PostgreSQL (connection string in `NEON_URL` env var)
- **Local:** SQLite (`scanner_vault.db`) used as fallback/migration source

### Key Environment Variables
```
FYERS_ID, TOTP_KEY, PIN, CLIENT_ID, SECRET_KEY   # Fyers auth
NEON_URL                                           # PostgreSQL connection string
GITHUB_TOKEN, GITHUB_REPO, GITHUB_WORKFLOW         # Workflow trigger
```

For local development, set `NEON_URL` in your environment or update `config.py`. Fyers credentials can be stored in `access_token.txt` after running `auth.py`.

## Technical Analysis Logic

- **Daily uptrend:** EMA20 crosses above EMA50 on daily candles → stored as `daily_cross_active = True`
- **Intraday pullback:** After daily uptrend is established, EMA20 drops below EMA50 on 1H or 15M → signals a pullback entry opportunity
- **Fundamental filter:** Screener.in scraping flags stocks as high-growth or moderate-growth based on ROCE criteria
- **Rate limiting:** Fyers API triggers a 45-second cooldown when rate-limited; both scan scripts handle this automatically
