## Testing Protocol (do not edit)
- Test backend first via `deep_testing_backend_v2` after any backend change.
- Test frontend via `auto_frontend_testing_agent` only after user confirmation OR when explicit bug fix requires visual verification.
- Read this file before invoking any testing agent, and record results below.

## Incorporate User Feedback
- Always read and address user reports first. Cite the exact user complaint in the bug entry.
- Do not repeat testing on items already reported PASS.

---

## user_problem_statement
"SEE ACCURACY TRACKER TAKES ONLY TRADE BUT ITS NOT HIT TARGET NOR STOP LOSS WIN RATE 0 ITS NOT CHECKING APP PERFORMANCE. NOT SHOW APP ACCURACY ITS SHOULD CHECK AUTOMATICALLY" — screenshot shows 10 open trades, 0 wins/losses, 0% win rate. User wants the tracker to automatically check TP/SL hits in the background.

## Bug Fix + Enhancement — Accuracy Tracker auto-check
**Backend files:** `/app/backend/server.py`
**Frontend files:** `/app/frontend/src/api.js`, `/app/frontend/src/tradeHistory.js`, `/app/frontend/src/App.js`

**Root causes:**
1. Outcome check was manual-only (required clicking "Auto-check Open Trades" button every time).
2. The old check compared TP/SL only against the CURRENT live price — completely missing TP or SL touches that had already happened (if price bounced back to entry, the trade stayed OPEN forever).
3. Live-price fetch was from browser to Yahoo (CORS-fragile).

**Fixes:**
1. New backend endpoint `POST /api/check-trades` — takes a batch of open trades and, for each, fetches candle history since the trade's `created_at` and walks bar-by-bar checking if the high touched TP1 or the low touched SL (LONG); mirror for SHORT. Returns WIN / LOSS / OPEN + the close price and closed_at timestamp. Uses appropriate interval (1m up to 5d age, 5m up to 25d, 15m up to 55d, 1h beyond).
2. New frontend helper `checkOpenTradesViaBackend(checkTrades)` that posts open trades and applies resolutions to localStorage.
3. **Global background auto-checker in App.js** runs every 45 s regardless of active tab AND on window focus. Emits `tredways:trades-resolved` CustomEvent for any UI listener.
4. `AccuracyScreen` now listens to that event, refreshes the trade list every 15 s, shows "Last check: HH:MM:SS", and the "Auto-check Open Trades" button becomes a manual force-refresh.

## Test Instructions for deep_testing_backend_v2
- `POST /api/check-trades` with a body like:
  ```json
  {"trades":[
    {"id":"t1","pair":"BTCUSD","signal_type":"LONG","entry":58000,"sl":57500,"tp1":59000,"created_at":"2026-06-30T00:00:00Z"},
    {"id":"t2","pair":"RELIANCE","signal_type":"LONG","entry":1500,"sl":1480,"tp1":1520,"created_at":"2026-06-29T00:00:00Z"},
    {"id":"t3","pair":"GOLD","signal_type":"SHORT","entry":4200,"sl":4230,"tp1":4160,"created_at":"2026-06-30T00:00:00Z"},
    {"id":"t4","pair":"EURUSD","signal_type":"LONG","entry":1.1000,"sl":1.0950,"tp1":1.1100,"created_at":"2026-06-30T00:00:00Z"}
  ]}
  ```
  Expected: HTTP 200 with `{checked, resolved, results: [{id, outcome ∈ WIN|LOSS|OPEN, close_price, closed_at}]}`. At least one should resolve (BTC has moved enough).
- Test edge cases:
  - Empty trades list → `checked:0, resolved:0, results:[]`.
  - Invalid pair (`"pair":"XXXNONE"`) → OPEN outcome, no error.
  - Missing `created_at` (should default to using most recent candles) → returns without crashing.
- Verify all other existing endpoints still work: `/api/health`, `/api/opportunities`, `/api/smc-analyze`, `/api/chart-data`, `/api/analyze`, `/api/analyze-forex`.

## Communication Log

### agent → main
- Added `POST /api/check-trades` (walks candle history for proper TP/SL hit detection) + global 45s background auto-checker in App.js + AccuracyScreen event listener.
- Manual verification: curl on BTC LONG with entry $58k → resolved as WIN @ $59k.
- Ready for automated backend testing.


### testing_agent → main (2025-07-01)
- ✅ **BUG FIX VERIFIED - PASS**
- Tested GOLD (15m, 1h), BTCUSD (15m), RELIANCE (15m, 1h)
- **Support TL (green dashed)** and **Resistance TL (red dashed)** diagonal trendlines are now visible on ALL tested symbols/timeframes
- Candles, EMA 20 (amber), EMA 50 (cyan), and volume histogram all rendering correctly
- Legend shows "Support TL" and "Resistance TL" entries
- Trendlines extend from swing points to right edge of chart as expected
- No console errors, all API calls returning 200 OK
- Fix is working as intended across Indian Stocks and Forex/Crypto tabs


### testing_agent → main (2025-07-02 - SMC Bug Fix + Opportunities Endpoint)
- ✅ **ALL BACKEND TESTS PASSED**

**1. Health Check ✅**
- GET /api/health returns {"python":"ok","node_backend":"ok"}

**2. Chart Data Endpoint ✅**
- Tested GOLD (1h, 15m), RELIANCE (15m), BTCUSD (1h)
- All return HTTP 200 with correct structure: candles (≥60), live_price, pair, timeframe

**3. SMC Analysis - BUG FIX VERIFIED ✅**
- **CRITICAL: Found 3 non-NONE directions across test cases (bug fix working!)**
  - GOLD 15m: LONG grade A (entry: 4028.27, sl: 3989.59, tp1: 4086.30, rr: 2.5)
    - Reasons: "Short-term BOS up (broke recent lower high)", "Liquidity grabbed below prior swing low", "Closed back above the grabbed level (trap)"
    - Validation: sl ≠ entry ✓, tp1 > entry ✓, sl < entry ✓
  - BTCUSD 1h: LONG grade A (entry: 58294.85, sl: 57595.86, tp1: 59343.33, rr: 2.5)
  - RELIANCE 1h: LONG grade B
- Tested: GOLD (1h, 15m), BTCUSD (1h, 15m), EURUSD (1h, 15m), RELIANCE (1h, 15m)
- All required fields present: atr, current_phase, zones, liquidity_grab, pair, timeframe, last_price, candles_count
- Direction validation: All are LONG/SHORT/NONE ✓
- Grade validation: All are A+/A/B/AVOID ✓
- Entry/SL/TP validation: All correct for direction ✓

**4. Opportunities Endpoint (NEW) ✅**
- GET /api/opportunities (default): Returns HTTP 200 with count and opportunities array
- GET /api/opportunities?symbols=GOLD,BTCUSD,EURUSD&timeframes=1h,15m&min_grade=B: Returns 2 opportunities
- All required fields present: symbol, timeframe, direction, grade, entry, sl, tp1, tp2, tp3, rr, current_price, phase, retest, reasons, grab_price, bos_price, atr
- Direction filtering: Only LONG/SHORT returned (no NONE) ✓
- Grade filtering: min_grade=A+ returns 0 (subset of B) ✓
- Response time: < 90 seconds ✓

**5. Proxy Endpoints ✅**
- POST /api/analyze (RELIANCE): HTTP 200 with valid JSON
- POST /api/analyze-forex (EURUSD): HTTP 200 with valid JSON
- GET /api/scanner: HTTP 200 with array response

**Summary:**
- The SMC engine bug fix is working correctly - now detects bullish liquidity-grab setups that were previously missed
- The new /api/opportunities endpoint is fully functional and returns properly structured data
- All existing endpoints continue to work correctly
- No 5xx errors encountered
- All pass criteria met


### testing_agent → main (2025-07-02 - Giant Spike Candle Bug Fix Verification)
- ✅ **BUG FIX VERIFIED - PASS**

**Bug Fixed:** Live-price polling was stretching stale Yahoo candles to match TwelveData live price, creating fake giant vertical spike candles (e.g., XAUUSD 1m showing 15+ point tall red bar when neighbors were 0.5-1 point tall).

**Testing Performed:**
1. **GOLD (XAUUSD) - 1m timeframe (90-second observation):**
   - ✅ Observed for 90+ seconds across minute boundary
   - ✅ Price updated smoothly: 4087.10 → 4086.70 → 4086.60 → 4086.10 → 4085.00
   - ✅ NO giant spike candles observed
   - ✅ All candles normal-sized and comparable to neighbors
   - ✅ Header price (Yahoo GC=F) aligned with chart
   - ✅ New candles appeared at boundaries (not stretched)

2. **GOLD - 5m timeframe:**
   - ✅ Observed for 30 seconds
   - ✅ Normal-sized candles throughout
   - ✅ No vertical spike bars

3. **GOLD - 15m timeframe:**
   - ✅ Observed for 30 seconds
   - ✅ Normal-sized candles throughout
   - ✅ No vertical spike bars

4. **BTCUSD - 1m timeframe:**
   - ✅ Observed for 30 seconds
   - ✅ Normal-sized candles
   - ✅ No spike bars

5. **RELIANCE - 5m timeframe:**
   - ✅ Observed for 30 seconds
   - ✅ Normal-sized candles
   - ✅ No spike bars

**Technical Verification:**
- ✅ Fix correctly implements `tfToSeconds()` helper for timeframe intervals
- ✅ `tick()` function now calculates `currentBarStart` and appends new candles at bar boundaries
- ✅ Stale candles are NOT stretched when price jumps >2% or when new bar interval starts
- ✅ Periodic chart refetch (20-60s) prevents long-term drift
- ✅ EMA 20 (amber), EMA 50 (cyan), volume histogram all rendering correctly
- ✅ Support/Resistance trendlines visible
- ✅ No console errors related to chart rendering

**Pass Criteria Met:**
✅ Last candle size comparable to neighboring candles on all timeframes
✅ No giant vertical spike bars (5-20× height of neighbors)
✅ Header live price aligns with last candle close
✅ New candles appear at minute boundaries instead of stretching previous bar
✅ Tested across multiple symbols (GOLD, BTCUSD, RELIANCE) and timeframes (1m, 5m, 15m)

**Verdict: PASS** - The giant spike candle bug is fixed. Live-price polling now correctly appends new candles at bar boundaries instead of stretching stale bars.


### testing_agent → main (2025-07-06 - /api/check-trades Endpoint Testing)
- ✅ **ALL BACKEND TESTS PASSED**

**1. /api/check-trades Endpoint - NEW ✅**

**Test 1: Happy Path — Mixed Batch (4 trades) ✅**
- Tested with BTCUSD LONG, RELIANCE LONG, GOLD SHORT, EURUSD LONG
- HTTP 200 with correct response shape: `{checked: 4, resolved: 4, results: [...]}`
- All 4 trades resolved: 3 WIN, 1 LOSS
- Each result has required fields: `id`, `outcome`, `close_price`, `closed_at`
- IDs match input trades
- Outcomes are valid (WIN/LOSS/OPEN)
- **CRITICAL: All 4 trades resolved (exceeds requirement of at least 1)**

**Test 2: Empty Batch ✅**
- HTTP 200 with `{checked: 0, resolved: 0, results: []}`
- No crash, correct empty response

**Test 3: Invalid Symbol (XXXNONE) ✅**
- HTTP 200 with `outcome: "OPEN"`, `close_price: null`
- No crash, graceful handling of invalid symbol

**Test 4: Old Trade (10 days ago, 5m interval branch) ✅**
- NIFTY LONG trade from 10 days ago
- HTTP 200, resolved as WIN (TP hit at 24000)
- Correctly used 5m interval for 10-day-old trade
- No crash

**Test 5: Missing created_at ✅**
- RELIANCE LONG without created_at field
- HTTP 200, resolved as LOSS
- No crash, defaults to recent candles

**2. Regression Tests ✅**
- GET /api/health → 200 with `{"python":"ok","node_backend":"ok"}`
- GET /api/opportunities?symbols=GOLD,BTCUSD&timeframes=1h&min_grade=B → 200 with count: 0
- POST /api/smc-analyze (GOLD 1h) → 200 with valid response
- POST /api/chart-data (RELIANCE 15m) → 200 with valid response

**Summary:**
- All 6 test cases passed
- No 5xx errors encountered
- Response shapes match specification
- At least one trade resolved in happy path (actually all 4 resolved)
- Edge cases handled gracefully (empty batch, invalid symbol, missing created_at)
- All regression endpoints continue to work correctly
- The new /api/check-trades endpoint is fully functional and production-ready
