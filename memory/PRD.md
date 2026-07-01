# Tredways — SMC Trading Terminal

**Original Problem Statement (verbatim)**  
> check my project and run project and remove test files unnecessary files and improve code standard, check logic of stock (India stock) if required repaired logic and same for forex. i want super smart app. please keep both backend. Accuracy Tracker not take trade automatically when signal buy sell to track for accuracy in stock and forex, accuracy check our app performance and check how much profit app is giving, is attached image strategy implemented? if not then implement, check chart ui candle size is not small its big, buy sell and long short fluctuating not steady check logic, tradeconfirm not received signal from chartwithzone.

## Architecture

| Service | Path | Port | Role |
| --- | --- | --- | --- |
| **frontend** (React web) | `/app/frontend` | 3000 | SMC Trading Terminal UI |
| **backend** (Python FastAPI) | `/app/backend` | 8001 | `/api` prefix, SMC engine + proxy to Node |
| **node-backend** (Node.js) | `/app/node-backend` | 8002 | Live data engine (Yahoo, TwelveData, Angel) |
| **expo-app** (React Native + Expo) | `/app/expo-app` | — | Mobile source (kept for APK builds) |

All external calls flow through `/api/*` on port 8001 (Kubernetes ingress requirement).

## What's Been Implemented (2026-01-01)

### Backend
- **New Python SMC engine** (`backend/smc_engine.py`) implementing the two reference images:
  - **Accumulation / Manipulation / Distribution** phase detection
  - **Liquidity Grab & Retest** setup (both bullish and bearish) with BOS + failed-LL confirmation + retest zone → emits graded A/A+ signal with entry/SL/TP1/TP2/TP3
  - Bonus: **FVG** (Fair Value Gap) and **Order Block** detection
- Yahoo v8 chart API fetcher (replaced buggy `yfinance` library) that handles Indian stocks (`.NS`), forex (`=X`), crypto (`-USD`), gold (`GC=F`) and NSE indices (`^NSEI`, `^NSEBANK`).
- `/api/smc-analyze` — full SMC analysis
- `/api/chart-data` — normalized candles for the chart
- `/api/analyze`, `/api/analyze-forex`, `/api/analyze-forex-scalp`, `/api/angel-price`, `/api/scanner`, `/api/stats`, `/api/health` — proxies to Node

### Node backend (repaired)
- **Fixed compile-time bugs** — undefined `apiCallCount`, `fetchAngelAuth`, `fetchAngelLive` references that would crash the stock signal engine mid-request.
- Cleaned the file down from 1943 lines to ~430 focused lines.
- Angel WebSocket removed (was not authenticated) — Yahoo/TwelveData used for live prices.

### Frontend (new, from scratch)
- Clean React 18 web app with **TradingView-style candlestick chart** using `lightweight-charts`.
- **Candle size fix** — barSpacing 6 (thin candles), minBarSpacing 2, showing 300 candles per view.
- **Signal stability fix** — new hysteresis logic in App.js (`stabilityRef`): a new LONG/SHORT direction must repeat for 2 consecutive polls before replacing the last emitted signal. Prevents the flicker between buy/sell.
- **TradeConfirm receives ChartWithZones signal** — `SMCChart` component calls `onSignal(...)` when a Liquidity Grab & Retest setup is confirmed by the SMC engine; that signal flows into `chartSignal` state in `App.js` and is passed to `ConfirmScreen`. Previously the mobile app never wired this bridge.
- **AutoBot restored (2026-01-01, revised)** — Per user's clarification, the Accuracy Tracker **auto-logs every BUY / SELL signal** as soon as the analyze engine (Stocks + Forex) or the SMC chart engine confirms one. Deduped by pair + direction + entry-within-0.3%. This lets the user measure the app's overall accuracy and profit (R multiples) hands-off.
- **Profit tracking** — Accuracy Tracker shows Profit (R multiples) in addition to win rate.

### Design
- Dark trading terminal aesthetic. Sora + JetBrains Mono fonts. Deep-space navy + electric amber accent (no purple gradients / AI-slop patterns). All buttons/inputs have distinct hover/focus states.

## Files Removed / Cleaned
- 30+ `test_*.js` files in `node-backend/`
- `node-backend/{debug_gold,verify_gold*,debug.log,error.log}.js`
- Node `.venv/` Windows binaries (`node_trendway.exe`, `.bat`, `.vbs`, `CreateShortcut.vbs`)
- 20+ Markdown reports in the repo root (`NIFTY50_PRICE_LAG_FIXED.md`, etc.)
- Backend `test_chart_route.py`, `pytest.ini`
- Frontend scaffold (React + shadcn) — replaced with a purpose-built app

## Next Action Items

- Wire real Angel SmartAPI auth (TOTP) if the user provides valid credentials — currently we fall back to Yahoo (15-20 min lag) for Indian stock live prices.
- Add a live WebSocket price stream for BTC / EUR / GOLD → drives the chart's last-candle live tick.
- Persist trade history to MongoDB via `/api/trades` (currently localStorage only).
- Backtest module: run the SMC strategy over 1y of historical data and report per-symbol win rate.

## Prioritized Backlog

- **P0** — none (all critical user requests resolved).
- **P1** — Angel SmartAPI live-price integration; backtesting module.
- **P2** — Options chain integration for OI writer strategy; Telegram alerts for A+ setups.

## Business Enhancement (Revenue)
Add a **Pro tier** subscription that unlocks: (a) NIFTY 500 scanner (vs current NIFTY 15), (b) email/Telegram A+ signal alerts, (c) exportable trade journal PDF for tax filing. Stripe or Razorpay integration.
