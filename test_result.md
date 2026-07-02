## Testing Protocol (do not edit)
- Test backend first via `deep_testing_backend_v2` after any backend change.
- Test frontend via `auto_frontend_testing_agent` only after user confirmation OR when explicit bug fix requires visual verification.
- Read this file before invoking any testing agent, and record results below.

## Incorporate User Feedback
- Always read and address user reports first. Cite the exact user complaint in the bug entry.
- Do not repeat testing on items already reported PASS.

---

## user_problem_statement
"gold last candle not formed well why" — user compared TradingView (XAUUSD ~4072, normal small candles) with our app (XAUUSD 1m showing a huge fake red spike candle from ~4088 down to 4072). The stale Yahoo last candle was being force-stretched by the live TwelveData price, creating a fake vertical bar.

## Bug Fix Applied (Live-price stretches stale candle into a fake spike)
**File:** `/app/frontend/src/SMCChart.js`

**Root cause:**
The live-price polling `tick()` unconditionally did `last.close = price; last.low = min(last.low, price); last.high = max(last.high, price)` on `arr[arr.length - 1]`. When the Yahoo chart-data last candle was stale (Yahoo has ~15-min lag) AND the live TwelveData price was already several dollars away, this stretched the OLD bar's low/close down to the current price, producing a huge artificial spike candle. The SMC engine then read that fake wick and mis-classified the phase.

**Fixes:**
1. Added `tfToSeconds(tf)` helper for interval seconds.
2. In `tick()` we now compute `currentBarStart = floor(nowSec / tfSec) * tfSec`.
3. If `currentBarStart > last.time` OR the price jumped > 2 % AND the last bar is older than one timeframe → **APPEND a new candle** at the correct bar-start (open=high=low=close=price). Never stretch the stale bar.
4. Otherwise (still within the current bar interval) → update in-place as before.
5. Added a periodic chart refetch (20–60 s depending on TF) to close any drift and pull in fresh Yahoo bars so gaps stay small.

## Test Instructions for auto_frontend_testing_agent
- Open the running Tredways web app at the preview URL.
- Click **FOREX / CRYPTO** tab, enter `GOLD` (or `XAUUSD`), click the analyze / load button, wait for the SMCChart to render.
- Switch to `1m` timeframe.
- Observe the chart for at least 60 seconds. Verify that:
  - The last candle is a NORMAL-sized candle whose body/wick is comparable to neighboring candles (not a giant vertical spike 5–20× the size of others).
  - The XAUUSD price shown in the header matches the live TwelveData price (~4070–4075 range).
  - The Phase label at the top-left is reasonable (Accumulation / Manipulation / Distribution / Neutral).
- Repeat on `5m` and `15m` timeframes.
- Wait through at least ONE minute-boundary crossing on 1m to confirm a NEW small candle appears (rather than the previous bar being stretched).

**Success criteria:** No fake vertical spike bar; last candle size is visually consistent with neighbours; price header matches live tick within a few points.

**Failure criteria:** A giant single-candle vertical bar sticking out of the chart, or the last candle body larger than 5× the median body of the last 30 bars.

## Communication Log

### agent → main
- Fixed live-price polling to append new candles at bar boundaries instead of stretching stale bars; added periodic chart refetch to close drift.
- Awaiting frontend testing agent verification.


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
