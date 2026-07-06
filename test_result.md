## Testing Protocol (do not edit)
- Test backend first via `deep_testing_backend_v2` after any backend change.
- Test frontend via `auto_frontend_testing_agent` only after user confirmation OR when explicit bug fix requires visual verification.
- Read this file before invoking any testing agent, and record results below.

## Incorporate User Feedback
- Always read and address user reports first. Cite the exact user complaint in the bug entry.
- Do not repeat testing on items already reported PASS.

---

## user_problem_statement
"why our candle long open close in gold only, clear button not working, any reason" — two bugs reported with screenshots: (1) GOLD 5m chart shows tall vertical bars in the middle (phantom / outlier candles that look like solid vertical stripes because of huge range compared to normal), and TradingView XAUUSD 5m shows a clean chart. (2) Clear button in the Accuracy Tracker doesn't work; screenshot shows the button squished vertically with distorted text.

## Bug Fix Applied
**Files:** `/app/frontend/src/SMCChart.js`, `/app/frontend/src/App.js`, `/app/frontend/src/index.css`

**Bug #1 — GOLD chart artifact candles:**
- `refetchChart` was completely WIPING our carefully-updated live-appended candles every 20-60s and replacing them with Yahoo's response. Combined with Yahoo GC=F futures having occasional huge weekend-rollover/thin-liquidity candles, this produced flicker + phantom tall vertical bars.
- FIX 1: Merge Yahoo's refetch response with any live-appended candles whose time > Yahoo's last candle time (preserve live tail). De-dup by time.
- FIX 2: Added `clipOutlierCandles()` helper that clips any candle whose range is > 8× the median range of the previous 60 candles (safeguard against phantom Yahoo GC=F rollover bars). Applied on both initial load AND refetch.

**Bug #2 — Clear button:**
- `window.confirm()` was unreliable / silently dismissed inside mobile / iframe / webview contexts.
- Parent flex layout squished the button into an unreadable vertical strip.
- FIX: Replaced `window.confirm()` with a custom in-app confirmation modal (`.clear-modal-backdrop` + `.clear-modal`). New `.btn.danger` variant (red, min-width 100px, `flex-shrink: 0`, `white-space: nowrap`). Button now shows the count of trades to delete: e.g., "🗑 Clear (10)". Disabled state when empty. Modal has Cancel / Delete-all buttons with focus and click-outside-to-cancel.

## Test Instructions for auto_frontend_testing_agent
Preview URL: https://edee4343-0206-46c8-839e-4dd0df51ee5d.preview.emergentagent.com

1. **Clear button test:**
   - Navigate to ACCURACY TRACKER tab.
   - Verify a red "🗑 Clear (N)" button is visible in the top-right of the Accuracy Tracker card (where N is the current trade count).
   - If N > 0: click the button. Verify a modal appears with title "Clear entire trade history?" and shows the trade count.
   - Click "Cancel" — modal closes, trades still there.
   - Click the button again → click "🗑 Delete all" → modal closes, trades list is now empty, message "✅ All trade history cleared." appears briefly.
   - Reload the page — verify trade list stays empty (i.e., localStorage was actually cleared).
   - When empty, verify the button shows "🗑 Clear" (no count) and is disabled (opacity ~0.4, cursor not-allowed).

2. **GOLD chart artifact test:**
   - Open FOREX / CRYPTO tab. Enter `GOLD` and click analyze.
   - Switch through timeframes 1m, 5m, 15m, 1h.
   - For each TF, verify:
     - No candle is dramatically larger (5-10×) than its neighbours. Specifically no "tall vertical stripe" candles in the middle of the chart.
     - Chart looks visually similar in overall shape to normal candle charts.
   - Wait 30 seconds and observe — the chart should remain stable (no flicker of huge candles appearing then disappearing).

## Pass criteria
- Clear button reliably opens the custom modal, Cancel works, Delete all clears trades AND localStorage.
- GOLD chart shows no dramatic outlier candles on any tested TF over a 30-second observation window.

## Fail criteria
- Clear button does not respond to clicks, OR uses window.confirm() which is silently dismissed, OR the "Delete all" doesn't actually clear localStorage.
- GOLD chart still shows visible vertical stripe / phantom candles on any tested TF.

## Communication Log

### agent → main
- Fixed both bugs. GOLD chart: merged refetch with live-appended bars + outlier clipper (8× median range). Clear button: custom modal replacing window.confirm + red danger-style button with count.
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


### testing_agent → main (2025-07-06 - Bug Fix Verification: Clear Button + GOLD Chart Outliers)
- ✅ **BOTH BUG FIXES VERIFIED - ALL TESTS PASS**

**Bug #1 — Clear Button in ACCURACY TRACKER: ✅ PASS**

**Issue Fixed:**
- window.confirm() was silently blocked in mobile/iframe contexts
- Button was squished into unreadable vertical strip due to flex layout

**Testing Performed:**
1. **Button Visibility & Styling**: ✅ PASS
   - Button found with text "🗑 Clear (N)" where N = trade count
   - Button dimensions: 100px × 34px (meets min-width 100px requirement)
   - Button is NOT squished or distorted
   - Red danger styling applied correctly
   - flex-shrink: 0 and white-space: nowrap prevent squishing

2. **Custom Modal (NOT window.confirm)**: ✅ PASS
   - Clicking Clear button opens custom in-app modal
   - Modal centered on screen with backdrop
   - Title: "Clear entire trade history?"
   - Body: Shows trade count and "cannot be undone" warning
   - Two buttons: "Cancel" and "🗑 Delete all"
   - NO browser window.confirm popup used

3. **Cancel Functionality**: ✅ PASS
   - Cancel button closes modal
   - Trades list unchanged after Cancel
   - Modal can be re-opened

4. **Delete All Functionality**: ✅ PASS
   - "🗑 Delete all" button closes modal
   - Trades list becomes empty
   - Success message displayed: "✅ All trade history cleared."
   - localStorage actually cleared (not just UI state)

5. **Persistence After Reload**: ✅ PASS
   - Page reload → trades list still empty
   - localStorage.clear() was executed correctly
   - Data does not reappear

6. **Disabled State When Empty**: ✅ PASS
   - Button shows "🗑 Clear" (no count) when empty
   - Button is disabled (opacity 0.4, cursor not-allowed)
   - Button not clickable when disabled

**Bug #2 — GOLD Chart Outlier Candles: ✅ PASS**

**Issue Fixed:**
- Yahoo GC=F futures had occasional huge weekend-rollover/thin-liquidity candles
- refetchChart was wiping live-appended candles every 20-60s
- Combined effect: tall vertical stripe "phantom" candles (5-10× normal height)

**Fix Applied:**
- clipOutlierCandles() helper clips candles > 8× median range
- refetchChart now merges Yahoo response with live-appended bars (preserves live tail)
- Deduplication by time prevents duplicates

**Testing Performed:**
Tested GOLD on all timeframes: 1m, 5m, 15m, 1h

1. **1m Timeframe**: ✅ PASS
   - All candles normal-sized and uniform
   - No vertical stripe outliers visible
   - Chart shows proper LONG B setup with normal candle heights

2. **5m Timeframe**: ✅ PASS
   - All candles normal-sized
   - No tall vertical bars
   - Extended 30-second observation: NO flicker or giant candles appearing/disappearing
   - Chart remained stable throughout observation period

3. **15m Timeframe**: ✅ PASS
   - All candles normal-sized
   - No outlier vertical bars
   - Candle heights consistent with neighbors

4. **1h Timeframe**: ✅ PASS
   - All candles normal-sized
   - No vertical stripe candles
   - Chart shows clean accumulation phase

**Visual Verification:**
- All screenshots show clean candle charts
- EMA 20 (amber) and EMA 50 (cyan) rendering correctly
- Support/Resistance trendlines visible
- Volume histogram at bottom
- NO candles with 5-10× height of neighbors
- NO phantom vertical stripe bars
- Chart stable over time (no flicker)

**Pass Criteria Met:**
✅ Clear button visible with count, opens custom modal (not window.confirm)
✅ Cancel and Delete all both work correctly
✅ Delete all persists across reload (localStorage cleared)
✅ Button disabled when empty
✅ No outlier vertical stripe candles on any GOLD timeframe
✅ Chart stable over 30s observation on 5m (no flicker)

**Verdict: BOTH BUGS FIXED** — All functionality working as intended.
