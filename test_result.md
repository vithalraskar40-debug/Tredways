## Testing Protocol (do not edit)
- Test backend first via `deep_testing_backend_v2` after any backend change.
- Test frontend via `auto_frontend_testing_agent` only after user confirmation OR when explicit bug fix requires visual verification.
- Read this file before invoking any testing agent, and record results below.

## Incorporate User Feedback
- Always read and address user reports first. Cite the exact user complaint in the bug entry.
- Do not repeat testing on items already reported PASS.

---

## user_problem_statement
"trendline draws are not visible on chart" — user attached a GOLD 1h SMCChart screenshot showing candles + EMAs + volume rendered fine, but no diagonal support/resistance dashed lines drawn on the chart.

## Bug Fix Applied (Tredways SMC — trendlines not drawing)
**File:** `/app/frontend/src/SMCChart.js`

**Root cause:**
1. `drawTrendlines(candles)` was only called inside `drawSMC(smc, candles)`, which runs only if `/api/smc-analyze` returns a valid payload. If SMC endpoint failed or partially returned, trendlines never drew even though EMAs did.
2. `bestTrendline()` required ≥ 3 pivots and touches ≥ 2 within 0.3% tolerance — too strict for many symbols.
3. `dx < 5` and lookback = 3 sometimes produced 0–1 valid pivots.

**Fixes:**
1. Call `drawTrendlines(candles)` unconditionally right after candles/EMAs are set, independent of SMC.
2. `bestTrendline` now accepts ≥ 2 pivots (falls back to a straight line through them), loosened tolerance to 0.6%, `dx ≥ 3`.
3. Progressive-lookback swing detection (3 → 2 → 1) so we always get at least 2 pivots.
4. Extend the trendline 6 bars past the last candle so it's visible on the right edge.

## Test Instructions for auto_frontend_testing_agent
- Open the running Tredways web app at the preview URL (frontend). Navigate to a tab that renders `SMCChart` (Indian Stocks → enter "RELIANCE" or Forex/Crypto → "GOLD" and confirm the chart loads).
- After the chart candles + EMA 20 + EMA 50 render, verify that at least ONE of `Support TL` (green dashed) or `Resistance TL` (red dashed) diagonal line is visible on the chart canvas.
- Try both `15m` and `1h` timeframes.
- Report PASS if trendlines are visible after candles load; FAIL with a screenshot otherwise.

## Communication Log

### agent → main
- Bug: trendlines not drawing on SMCChart (user reported via GOLD 1h screenshot).
- Fix: made drawTrendlines unconditional + loosened pivot detection + right-extended lines.
- Awaiting testing_agent verification.

### testing_agent → main (2025-07-01)
- ✅ **BUG FIX VERIFIED - PASS**
- Tested GOLD (15m, 1h), BTCUSD (15m), RELIANCE (15m, 1h)
- **Support TL (green dashed)** and **Resistance TL (red dashed)** diagonal trendlines are now visible on ALL tested symbols/timeframes
- Candles, EMA 20 (amber), EMA 50 (cyan), and volume histogram all rendering correctly
- Legend shows "Support TL" and "Resistance TL" entries
- Trendlines extend from swing points to right edge of chart as expected
- No console errors, all API calls returning 200 OK
- Fix is working as intended across Indian Stocks and Forex/Crypto tabs
