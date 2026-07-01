const { EMA } = require('technicalindicators');

const SCALP_TIMEFRAME = '1m';
const SCALP_CANDLES_LIMIT = 200;
const RETEST_MAX_CANDLES = 5;   // how many candles after crossover to look for retest
const RETEST_TOLERANCE = 0.001; // fallback fixed tolerance (0.1%)

/**
 * Detect EMA9/EMA21 crossover, retest (pullback), and confirmation (bounce)
 * Returns { direction, entry, emaLevel, retestIdx, confirmationIdx, reason }
 * 
 * Logic:
 * 1. Crossover: EMA9 crosses EMA21
 * 2. Retest: Price pulls back to touch EMA (with adaptive tolerance for volatility)
 * 3. Confirmation: Next candle closes beyond EMA in original direction (= entry signal)
 * 4. Volume Check: Skip setup if current candle volume < 80% of average volume
 */
function detectEMACrossoverRetest(candles, opts = {}) {
  const { atr = 0, timeframeMinutes = 1, maxCandles: maxCandlesOpt, avgVolume = null } = opts;
  const closes = candles.map(c => c.close);
  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  
  if (ema9.length === 0 || ema21.length === 0) return null;
  
  // Align EMA arrays to the candles array so indexes map to candle indexes
  const ema9Full = new Array(candles.length).fill(null);
  const ema21Full = new Array(candles.length).fill(null);
  const offset9 = candles.length - ema9.length;
  const offset21 = candles.length - ema21.length;
  for (let k = 0; k < ema9.length; k++) ema9Full[offset9 + k] = ema9[k];
  for (let k = 0; k < ema21.length; k++) ema21Full[offset21 + k] = ema21[k];

  // determine max lookahead for retest
  const maxRetest = Number.isFinite(maxCandlesOpt)
    ? Math.max(1, maxCandlesOpt)
    : Math.max(1, Math.round(RETEST_MAX_CANDLES * Math.max(1, timeframeMinutes / 1)));

  // Loop backwards over candle indexes to find the MOST RECENT crossover first
  for (let i = candles.length - 1; i > 0; i--) {
    const prev9 = ema9Full[i - 1];
    const prev21 = ema21Full[i - 1];
    const cur9 = ema9Full[i];
    const cur21 = ema21Full[i];
    if (prev9 == null || prev21 == null || cur9 == null || cur21 == null) continue;
    
    // Bullish crossover: EMA9 crosses above EMA21
    if (prev9 <= prev21 && cur9 > cur21) {
      const crossoverIdx = i;
      const emaAtCrossover = cur9;
      
      // Look ahead for retest (price pulls back to EMA)
      for (let j = 1; j <= maxRetest; j++) {
        const retestIdx = crossoverIdx + j;
        if (retestIdx >= candles.length) break;
        
        const retestCandle = candles[retestIdx];
        const emaAtRetest = ema9Full[retestIdx];
        if (emaAtRetest == null) break;

        // IMPROVEMENT 2 & 3: Volume check + tightened tolerance for pro-level execution
        // Skip setup if volume too low (< 80% of average)
        if (avgVolume && retestCandle.volume && retestCandle.volume < avgVolume * 0.8) {
          continue;
        }

        // IMPROVEMENT 3: Tighter tolerance formula for 1m scalping (adaptive to volatility)
        // Changed from: Math.max(emaAtRetest * RETEST_TOLERANCE, atr * 0.15)
        // To: Math.min(atr * 0.08, emaAtRetest * 0.0005) - tighter on volatile instruments
        const adaptiveTolerance = atr && atr > 0 
          ? Math.min(atr * 0.08, emaAtRetest * 0.0005) 
          : emaAtRetest * 0.0005;

        // Retest condition: price touches/pierces EMA from above, then shows rejection (green close)
        const isRetest = retestCandle.low <= emaAtRetest + adaptiveTolerance && 
                         retestCandle.close > retestCandle.open && 
                         retestCandle.close >= emaAtRetest - adaptiveTolerance;

        if (isRetest) {
          // Now look for CONFIRMATION on next candle(s)
          // Confirmation = next candle closes ABOVE EMA with conviction (close > ema + buffer)
          for (let k = 1; k <= 2; k++) {
            const confirmIdx = retestIdx + k;
            if (confirmIdx >= candles.length) break;
            
            const confirmCandle = candles[confirmIdx];
            const emaAtConfirm = ema9Full[confirmIdx];
            if (emaAtConfirm == null) break;

            const confirmationBuffer = emaAtConfirm * 0.002; // 0.2% above EMA for confirmation
            
            // Confirmation: closes above EMA with conviction (green candle that beats EMA)
            if (confirmCandle.close > emaAtConfirm + confirmationBuffer && confirmCandle.close > confirmCandle.open) {
              return {
                direction: 'LONG',
                entry: Number(confirmCandle.close.toFixed(5)),
                entryAtIdx: confirmIdx,
                emaLevel: Number(emaAtConfirm.toFixed(5)),
                retestIdx,
                confirmationIdx: confirmIdx,
                reason: `Crossover at ${crossoverIdx}, Retest at ${retestIdx}, Confirmation at ${confirmIdx}`
              };
            }
          }
          // IMPROVEMENT 1: CRITICAL - Remove fallback entry (was lowering win rate)
          // Only return TRADE if confirmation candle exists. Otherwise continue looking or fail gracefully.
          return null;
        }
      }
    }
    
    // Bearish crossover: EMA9 crosses below EMA21
    if (prev9 >= prev21 && cur9 < cur21) {
      const crossoverIdx = i;
      const emaAtCrossover = cur9;
      
      // Look ahead for retest (price pulls back to EMA)
      for (let j = 1; j <= maxRetest; j++) {
        const retestIdx = crossoverIdx + j;
        if (retestIdx >= candles.length) break;
        
        const retestCandle = candles[retestIdx];
        const emaAtRetest = ema9Full[retestIdx];
        if (emaAtRetest == null) break;

        // IMPROVEMENT 2 & 3: Volume check + tightened tolerance for pro-level execution
        // Skip setup if volume too low (< 80% of average)
        if (avgVolume && retestCandle.volume && retestCandle.volume < avgVolume * 0.8) {
          continue;
        }

        // IMPROVEMENT 3: Tighter tolerance formula for 1m scalping (same as LONG)
        const adaptiveTolerance = atr && atr > 0 
          ? Math.min(atr * 0.08, emaAtRetest * 0.0005) 
          : emaAtRetest * 0.0005;

        // Retest condition: price touches/pierces EMA from below, then shows rejection (red close)
        const isRetest = retestCandle.high >= emaAtRetest - adaptiveTolerance && 
                         retestCandle.close < retestCandle.open && 
                         retestCandle.close <= emaAtRetest + adaptiveTolerance;

        if (isRetest) {
          // Now look for CONFIRMATION on next candle(s)
          // Confirmation = next candle closes BELOW EMA with conviction (close < ema - buffer)
          for (let k = 1; k <= 2; k++) {
            const confirmIdx = retestIdx + k;
            if (confirmIdx >= candles.length) break;
            
            const confirmCandle = candles[confirmIdx];
            const emaAtConfirm = ema9Full[confirmIdx];
            if (emaAtConfirm == null) break;

            const confirmationBuffer = emaAtConfirm * 0.002; // 0.2% below EMA for confirmation
            
            // Confirmation: closes below EMA with conviction (red candle that breaks EMA)
            if (confirmCandle.close < emaAtConfirm - confirmationBuffer && confirmCandle.close < confirmCandle.open) {
              return {
                direction: 'SHORT',
                entry: Number(confirmCandle.close.toFixed(5)),
                entryAtIdx: confirmIdx,
                emaLevel: Number(emaAtConfirm.toFixed(5)),
                retestIdx,
                confirmationIdx: confirmIdx,
                reason: `Crossover at ${crossoverIdx}, Retest at ${retestIdx}, Confirmation at ${confirmIdx}`
              };
            }
          }
          // IMPROVEMENT 1: CRITICAL - Remove fallback entry (same as LONG, only confirmed entries)
          return null;
        }
      }
    }
  }
  // IMPROVEMENT 6: News filter placeholder - integrate economic calendar API here later
  // TODO: Add news event check before returning TRADE
  // - Check for high-impact economic events in next 30 minutes
  // - Skip trades if major news is scheduled (especially for USD pairs)
  // Example: if (hasHighImpactNews(pair, windowMinutes=30)) return null;
  return null;
}

/**
 * Calculate Target & Stop Loss based on ATR
 * 
 * For SCALP trading:
 * - SL = 0.7x ATR (tight, scalp-appropriate)
 * - TP1 = 1.5x ATR (1:1.5 RR for quick profit)
 * - TP2 = 2.5x ATR (1:2.5 RR for swing portion)
 */
function calculateTargetStop(entry, direction, atr, rr = 1.5) {
  const slDist = atr * 0.7;
  const tp1Dist = atr * 1.5;  // Quick scalp target
  const tp2Dist = atr * 2.5;  // Extended target
  
  if (direction === 'LONG') {
    return {
      entry: Number(entry.toFixed(5)),
      tp1: Number((entry + tp1Dist).toFixed(5)),
      tp2: Number((entry + tp2Dist).toFixed(5)),
      stop: Number((entry - slDist).toFixed(5)),
      atr: Number(atr.toFixed(5))
    };
  } else {
    return {
      entry: Number(entry.toFixed(5)),
      tp1: Number((entry - tp1Dist).toFixed(5)),
      tp2: Number((entry - tp2Dist).toFixed(5)),
      stop: Number((entry + slDist).toFixed(5)),
      atr: Number(atr.toFixed(5))
    };
  }
}

module.exports = {
  detectEMACrossoverRetest,
  calculateTargetStop,
  SCALP_TIMEFRAME,
  SCALP_CANDLES_LIMIT,
  RETEST_MAX_CANDLES,
  RETEST_TOLERANCE,
};
