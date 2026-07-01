'use strict';
// ─────────────────────────────────────────────
// FOREX ENGINE MODULE
// Handles: Forex, Crypto, Gold — SMC / ICT strategy
// Routes: /api/v1/analyze-forex, /api/v1/analyze-forex-scalp, /api/v1/chart-data
// ─────────────────────────────────────────────

/**
 * Register all forex-related routes on the Express app.
 * @param {import('express').Application} app
 * @param {{ fetch, EMA, RSI, ATR, SMA, scalping, yahooFinance }} deps
 * @returns {{ tdCache, apiCallCount, rateLimitWarning, requestQueue }}  shared state (used by /api/v1/stats in index.js)
 */
function registerForexRoutes(app, { fetch, EMA, RSI, ATR, SMA, scalping, yahooFinance }) {

  // ─────────────────────────────────────────────
  // PAIR MAP & SYMBOL RESOLVER
  // ─────────────────────────────────────────────
  const PAIR_MAP = {
    EURUSD: { yahoo: 'EURUSD=X', twelve: 'EUR/USD' },
    GBPUSD: { yahoo: 'GBPUSD=X', twelve: 'GBP/USD' },
    USDJPY: { yahoo: 'USDJPY=X', twelve: 'USD/JPY', jpy: true },
    AUDUSD: { yahoo: 'AUDUSD=X', twelve: 'AUD/USD' },
    USDCAD: { yahoo: 'USDCAD=X', twelve: 'USD/CAD' },
    NZDUSD: { yahoo: 'NZDUSD=X', twelve: 'NZD/USD' },
    USDCHF: { yahoo: 'USDCHF=X', twelve: 'USD/CHF' },
    XAUUSD: { yahoo: 'GC=F', twelve: 'XAU/USD', isGold: true },
    GOLD:   { yahoo: 'GC=F', twelve: 'XAU/USD', isGold: true },
    BTCUSD: { yahoo: 'BTC-USD', binance: 'BTCUSDT', isCrypto: true },
    BTC:    { yahoo: 'BTC-USD', binance: 'BTCUSDT', isCrypto: true },
    ETHUSD: { yahoo: 'ETH-USD', binance: 'ETHUSDT', isCrypto: true },
    ETH:    { yahoo: 'ETH-USD', binance: 'ETHUSDT', isCrypto: true },
    SOLUSD: { yahoo: 'SOL-USD', binance: 'SOLUSDT', isCrypto: true },
  };

  function resolveSymbol(pair) {
    const key = String(pair || '').toUpperCase().replace(/[-/_=X]/g, '');
    
    // Explicit crypto/gold logic moved here from the frontend
    const isCrypto = key === 'BTC' || key === 'ETH' || key === 'SOL' || /BTC|ETH|SOL|DOGE|XRP/.test(key);
    const isGold = key === 'GOLD' || key === 'XAUUSD' || key === 'XAU';

    if (PAIR_MAP[key]) {
      return { key, ...PAIR_MAP[key], isCrypto: PAIR_MAP[key].isCrypto || isCrypto, isGold: PAIR_MAP[key].isGold || isGold };
    }

    return {
      key,
      yahoo: isCrypto ? key.replace('USD', '') + '-USD' : key + '=X',
      twelve: key.length === 6 ? key.slice(0, 3) + '/' + key.slice(3) : null,
      binance: isCrypto ? key.replace('USD', '') + 'USDT' : null,
      isCrypto,
      isGold
    };
  }

  function digits(sym) {
    if (sym.isCrypto) return 2;
    if (sym.isGold)   return 2;
    if (sym.jpy)      return 3;
    return 5;
  }

  // ─────────────────────────────────────────────
  // CACHE & RATE LIMITING STATE
  // ─────────────────────────────────────────────
  const tdCache = {};
  const requestQueue = {};   // Track pending requests to avoid duplicate API calls
  let apiCallCount = 0;
  let rateLimitWarning = null;

  // Initialize TwelveData WebSocket for Gold Live Price
  const tdws = require('./twelvedata/websocket');
  tdws.connect((priceData) => {
    // Keep live price constantly updated in cache for 0 REST API hits
    const wsPrice = +priceData.price;
    console.log(`📡 [TwelveData WS Tick] XAU/USD: ${wsPrice}`);
    tdCache['td_live_XAU/USD'] = { time: Date.now(), data: wsPrice };
  });

  // 🔄 Background poller: refresh Gold live price from REST every 10 seconds
  // Fills the gap between 1-minute WS ticks (TwelveData free plan limitation)
  const GOLD_POLL_INTERVAL_MS = 10000;
  (async function pollGoldLivePrice() {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) return;
    async function fetchAndStore() {
      try {
        const r = await fetch(`https://api.twelvedata.com/price?symbol=XAU%2FUSD&apikey=${apiKey}`);
        const j = await r.json();
        if (j.price) {
          const freshPrice = +j.price;
          tdCache['td_live_XAU/USD'] = { time: Date.now(), data: freshPrice };
          console.log(`🔄 [Gold Poller] XAU/USD refreshed: ${freshPrice}`);
        }
      } catch (err) {
        // silent — WS cache will be used if available
      }
    }
    // Initial fetch, then poll every 10s
    await fetchAndStore();
    setInterval(fetchAndStore, GOLD_POLL_INTERVAL_MS);
  })();

  // ─────────────────────────────────────────────
  // DATA FETCHERS
  // ─────────────────────────────────────────────

  async function fetchBinance(symbol, interval, limit = 300) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Binance error: ' + JSON.stringify(data));
    return data.map(d => ({
      open: +d[1], high: +d[2], low: +d[3], close: +d[4],
      volume: +d[5], datetime: new Date(d[0]).toISOString(),
    }));
  }

  async function fetchBinanceLive(symbol) {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const j = await r.json();
    return j.price ? +j.price : null;
  }

  // ✅ REQUEST DEDUPLICATION: If same request is in-flight, return pending promise
  async function dedupedFetch(key, fetchFn) {
    if (requestQueue[key]) {
      console.log(`⚡ DEDUP: Returning cached promise for ${key}`);
      return requestQueue[key];
    }
    const promise = fetchFn().finally(() => {
      delete requestQueue[key]; // Clean up after request
    });
    requestQueue[key] = promise;
    return promise;
  }

  async function fetchTwelve(symbol, interval, outputsize = 300) {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) throw new Error('TWELVE_DATA_API_KEY missing');

    const cacheKey = `td_${symbol}_${interval}_${outputsize}`;

    // ✅ Check memory cache first (30 seconds)
    if (tdCache[cacheKey] && Date.now() - tdCache[cacheKey].time < 30000) {
      console.log(`📦 CACHE HIT: ${cacheKey} (age: ${Math.round((Date.now() - tdCache[cacheKey].time) / 1000)}s)`);
      return tdCache[cacheKey].data;
    }

    // ✅ Use deduplication to avoid duplicate in-flight requests
    return dedupedFetch(cacheKey, async () => {
      console.log(`🔄 API CALL: ${cacheKey}`);
      apiCallCount++;
      console.log(`📊 API Hit #${apiCallCount}`);

      // Rate limiting warning (free tier: ~1000/day = ~12/min)
      if (apiCallCount % 10 === 0) {
        rateLimitWarning = `⚠️ API USAGE: ${apiCallCount} calls today`;
        console.log(rateLimitWarning);
      }

      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${apiKey}`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data.values) throw new Error('TwelveData: ' + (data.message || 'no values'));

      const resData = data.values.map(d => ({
        open: +d.open, high: +d.high, low: +d.low, close: +d.close,
        volume: +(d.volume || 0), datetime: d.datetime + 'Z',
      })).reverse();

      tdCache[cacheKey] = { time: Date.now(), data: resData };
      return resData;
    });
  }

  async function fetchTwelveLive(symbol) {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) return null;

    const cacheKey = `td_live_${symbol}`;

    // ✅ Check memory cache first (5 seconds — poller refreshes every 10s)
    if (tdCache[cacheKey] && Date.now() - tdCache[cacheKey].time < 5000) {
      console.log(`📦 LIVE CACHE HIT: ${symbol} (${Number((Date.now() - tdCache[cacheKey].time) / 1000).toFixed(1)}s old)`);
      return tdCache[cacheKey].data;
    }

    // ✅ Use deduplication for live price requests
    return dedupedFetch(cacheKey, async () => {
      console.log(`🔄 LIVE API CALL: ${symbol}`);
      apiCallCount++;

      const r = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
      const j = await r.json();
      const resData = j.price ? +j.price : null;

      if (resData) tdCache[cacheKey] = { time: Date.now(), data: resData };
      return resData;
    });
  }

  async function fetchYahoo(yfSymbol, days, interval) {
    const res = await yahooFinance.chart(yfSymbol, {
      period1: Math.floor(Date.now() / 1000) - 86400 * days,
      interval,
    });
    if (!res?.quotes) throw new Error('Yahoo chart failed');
    return res.quotes.filter(q => q.close != null).map(q => ({
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
      datetime: q.date instanceof Date ? q.date.toISOString() : new Date(q.date).toISOString(),
    }));
  }

  async function fetchYahooLive(yfSymbol) {
    try {
      const q = await yahooFinance.quote(yfSymbol);
      return q?.regularMarketPrice ?? null;
    } catch { return null; }
  }

  // Try Angel Broking API for LIVE prices (faster than Yahoo)
  async function fetchAngelLive(symbol) {
    try {
      if (!process.env.ANGEL_API_KEY) return null;
      // Angel Broking LTP endpoint would go here
      // For now, skip - requires authentication
      return null;
    } catch { return null; }
  }

  // Returns { ltf, htf, livePrice, source }
  async function fetchCandles(sym, dataSource, mode) {
    const isScalp = mode === 'SCALP';
    let ltf, htf, live = null;
    let source = null;

    // Try TwelveData first ONLY for Gold
    if (sym.isGold) {
      try {
        const ltfInt = isScalp ? '1min' : '5min';
        const htfInt = isScalp ? '15min' : '1h';
        [ltf, htf, live] = await Promise.all([
          fetchTwelve(sym.twelve, ltfInt, 300),
          fetchTwelve(sym.twelve, htfInt, 300),
          fetchTwelveLive(sym.twelve),
        ]);
        source = 'REALTIME (TwelveData)';
        console.log(`✅ [TwelveData] ${sym.key} LIVE price: ${live} (symbol: ${sym.twelve})`);
      } catch (err) {
        console.log(`❌ [TwelveData FAILED] ${sym.key}: ${err.message} - Falling back to Yahoo`);
        ltf = null; htf = null; live = null;
      }
    }

    // Always use Binance when available (for Crypto)
    if (!ltf && sym.binance) {
      try {
        const [ltfInt, htfInt] =
          isScalp
            ? ['1m', '15m']   // Binance uses '1m' NOT '1min'
            : ['5m', '4h'];
        [ltf, htf, live] = await Promise.all([
          fetchBinance(sym.binance, ltfInt, 300),
          fetchBinance(sym.binance, htfInt, 300),
          fetchBinanceLive(sym.binance),
        ]);
        source = 'REALTIME (Binance)';
        console.log(`✅ [Binance] ${sym.key} LIVE price: ${live} (symbol: ${sym.binance})`);
      } catch (err) {
        console.log(`❌ [Binance FAILED] ${sym.key}: ${err.message} - Falling back to Yahoo`);
        ltf = null; htf = null; live = null;
      }
    }

    if (!ltf) {
      const [ltfDays, ltfInt] = isScalp ? [3, '2m'] : [5, '5m'];
      const [htfDays, htfInt] = isScalp ? [10, '15m'] : [180, '1h'];
      [ltf, htf, live] = await Promise.all([
        fetchYahoo(sym.yahoo, ltfDays, ltfInt),
        fetchYahoo(sym.yahoo, htfDays, htfInt),
        fetchYahooLive(sym.yahoo),
      ]);
      source = 'YAHOO (15-20 min lag)';
      console.log(`📊 [Yahoo FALLBACK] ${sym.key} price: ${live} (⚠️ 15-20 min delay expected)`);
    }

    // patch last candle with live tick (fixes "price not matching live")
    if (live && Number.isFinite(live)) {
      const lastL = ltf[ltf.length - 1];
      const lastH = htf.at(-1);

      if (lastL) {
        lastL.live = true;
        lastL.close = live;
        lastL.high = Math.max(lastL.high, live);
        lastL.low = Math.min(lastL.low, live);
      }

      if (lastH) {
        lastH.close = live;
        lastH.high = Math.max(lastH.high, live);
        lastH.low = Math.min(lastH.low, live);
      }
    }
    return { ltf, htf, livePrice: (live && Number.isFinite(live)) ? live : ltf.at(-1).close, source };
  }

  // ─────────────────────────────────────────────
  // SMC PRIMITIVES
  // ─────────────────────────────────────────────

  function findSwings(q, lb = 2) {
    const highs = [], lows = [];
    for (let i = lb; i < q.length - lb; i++) {
      let isH = true, isL = true;
      for (let j = 1; j <= lb; j++) {
        if (q[i - j].high >= q[i].high || q[i + j].high >= q[i].high) isH = false;
        if (q[i - j].low <= q[i].low || q[i + j].low <= q[i].low) isL = false;
      }
      if (isH) highs.push({ i, level: q[i].high });
      if (isL) lows.push({ i, level: q[i].low });
    }
    return { highs, lows };
  }

  function detectBOS(q, atr) {
    if (q.length < 12) {
      return { bos: false, type: 'NONE', level: null };
    }

    const { highs, lows } = findSwings(q, 2);

    const last = q.at(-1);
    const prev = q.at(-2);

    const body = Math.abs(last.close - last.open);
    const range = Math.max(last.high - last.low, 1e-9);

    const displacementBull =
      last.close > last.open &&
      body > range * 0.5 &&
      body > atr * 0.35 &&
      last.close > prev.high;

    const displacementBear =
      last.close < last.open &&
      body > range * 0.5 &&
      body > atr * 0.35 &&
      last.close < prev.low;

    const rH = highs.at(-1);
    const rL = lows.at(-1);

    if (rH && last.close > rH.level && displacementBull) {
      return { bos: true, type: 'BULLISH', level: rH.level };
    }

    if (rL && last.close < rL.level && displacementBear) {
      return { bos: true, type: 'BEARISH', level: rL.level };
    }

    return { bos: false, type: 'NONE', level: null };
  }

  function detectCHoCH(q, atr, htfTrend) {
    // CHoCH = break against HTF direction
    const b = detectBOS(q, atr);
    if (!b.bos) return { choch: false, type: 'NONE' };
    if (htfTrend === 'BULLISH' && b.type === 'BEARISH') return { choch: true, type: 'BEARISH', level: b.level };
    if (htfTrend === 'BEARISH' && b.type === 'BULLISH') return { choch: true, type: 'BULLISH', level: b.level };
    return { choch: false, type: 'NONE' };
  }

  function detectFVG(q, lookback = 30, atr = 0) {
    // Enhanced FVG detection: compute gaps, filter by min-gap/ATR, merge overlapping gaps
    const start = Math.max(2, q.length - lookback);
    const rawBull = [], rawBear = [];
    for (let i = start; i < q.length; i++) {
      const a = q[i - 2], c = q[i];
      if (!a || !c) continue;
      const gapBull = c.low - a.high;
      const gapBear = a.low - c.high;
      if (gapBull > (atr * 0.12 || 0.000001)) rawBull.push({ i, top: c.low, bottom: a.high, gap: gapBull, type: 'BULL' });
      if (gapBear > (atr * 0.12 || 0.000001)) rawBear.push({ i, top: a.low, bottom: c.high, gap: gapBear, type: 'BEAR' });
    }

    const mergeAndCompute = (arr) => {
      if (!arr.length) return [];
      arr.sort((A, B) => A.i - B.i);
      const merged = [];
      for (const g of arr) {
        const last = merged.at(-1);
        if (!last) { merged.push({ ...g }); continue; }
        const tol = Math.max(atr * 0.08, 1e-9);
        const overlap = !(g.bottom > last.top + tol || g.top < last.bottom - tol) || (g.i - last.i) <= 3;
        if (overlap) {
          last.top = Math.max(last.top, g.top);
          last.bottom = Math.min(last.bottom, g.bottom);
          last.gap = Math.max(last.gap || 0, g.gap || 0);
          last.i = Math.max(last.i, g.i);
        } else merged.push({ ...g });
      }

      return merged.map(g => {
        const gapSize = Math.max(g.top - g.bottom, 1e-9);
        const after = q.slice(g.i + 1);
        let deepest = g.type === 'BULL' ? g.top : g.bottom;
        for (const c of after) {
          if (g.type === 'BULL') deepest = Math.min(deepest, c.low);
          else deepest = Math.max(deepest, c.high);
        }
        const fillPct = g.type === 'BULL'
          ? Math.max(0, Math.min(1, (g.top - deepest) / gapSize))
          : Math.max(0, Math.min(1, (deepest - g.bottom) / gapSize));
        const strength = fillPct <= 0.5 ? 'STRONG' : fillPct <= 0.8 ? 'WEAK' : 'DEAD';
        return { ...g, gapSize, fillPct, strength };
      }).filter(g => g.strength !== 'DEAD');
    };

    const allBull = mergeAndCompute(rawBull);
    const allBear = mergeAndCompute(rawBear);
    return { bull: allBull.at(-1) || null, bear: allBear.at(-1) || null, allBull, allBear };
  }

  function detectOrderBlock(q, atr) {
    // Enhanced OB detection with tick-volume proxy for FX where volume may be missing
    for (let i = q.length - 4; i > 10; i--) {
      const obCandle = q[i];
      const impulse = q[i + 1];
      const body = Math.abs(impulse.close - impulse.open);
      const range = Math.max(impulse.high - impulse.low, 1e-9);
      const strongImpulse = body > range * 0.55 && body > atr * 0.7;
      if (!strongImpulse) continue;

      const tickProxy = (body / range) * Math.max(range / (atr || 1e-9), 1);
      const volumeOk = (typeof impulse.volume === 'number' && typeof obCandle.volume === 'number')
        ? (impulse.volume > obCandle.volume)
        : (tickProxy > 0.9);

      // BULLISH OB
      if (
        impulse.close > impulse.open &&
        obCandle.close < obCandle.open &&
        volumeOk &&
        impulse.close > obCandle.high
      ) {
        return { type: 'BULLISH', top: obCandle.high, bottom: obCandle.low, i, strength: tickProxy };
      }

      // BEARISH OB
      if (
        impulse.close < impulse.open &&
        obCandle.close > obCandle.open &&
        volumeOk &&
        impulse.close < obCandle.low
      ) {
        return { type: 'BEARISH', top: obCandle.high, bottom: obCandle.low, i, strength: tickProxy };
      }
    }
    return null;
  }

  function liquiditySweep(q, lb = 12) {
    const slice = q.slice(-lb, -1);
    const rH = Math.max(...slice.map(x => x.high));
    const rL = Math.min(...slice.map(x => x.low));
    const last = q.at(-1);
    return {
      sweepLow: last.low < rL && last.close > rL,
      sweepHigh: last.high > rH && last.close < rH,
      recentHigh: rH, recentLow: rL,
    };
  }

  function premiumDiscount(q, lb = 50) {
    const s = q.slice(-lb);
    const hi = Math.max(...s.map(x => x.high));
    const lo = Math.min(...s.map(x => x.low));
    const mid = (hi + lo) / 2;
    const price = q.at(-1).close;
    return { zone: price > mid ? 'PREMIUM' : 'DISCOUNT', hi, lo, mid };
  }

  function htfTrend(htfCloses, mode = 'STRICT') {
    const fastPeriod = mode === 'SCALP' ? 20 : 50;
    const slowPeriod = mode === 'SCALP' ? 100 : 200;

    if (htfCloses.length < slowPeriod + 20) {
      return { trend: 'RANGING', fast: null, slow: null };
    }

    const eFast = EMA.calculate({ period: fastPeriod, values: htfCloses });
    const eSlow = EMA.calculate({ period: slowPeriod, values: htfCloses });

    const fast = eFast.at(-1);
    const slow = eSlow.at(-1);
    const fastPrev = eFast.at(-5);
    const slowPrev = eSlow.at(-5);
    const price = htfCloses.at(-1);
    const fastSlope = fast - fastPrev;
    const slowSlope = slow - slowPrev;

    if (fast > slow && price > fast && fastSlope > 0 && slowSlope > 0) {
      return { trend: 'BULLISH', fast, slow };
    }

    if (fast < slow && price < fast && fastSlope < 0 && slowSlope < 0) {
      return { trend: 'BEARISH', fast, slow };
    }

    return { trend: 'RANGING', fast, slow };
  }

  function normConfidence(s) { return Math.min(Math.max(Math.round(s), 5), 95); }

  function activeFxSession() {
    const h = new Date().getUTCHours();
    return h >= 6 && h <= 21; // London open → NY close buffer
  }

  function positionSize(balance, riskPct, entry, sl, sym) {
    if (!balance || !riskPct || !entry || !sl) return null;
    const riskAmt = balance * (riskPct / 100);
    const pipSize = sym.jpy ? 0.01 : sym.isGold ? 0.1 : sym.isCrypto ? 1 : 0.0001;
    const pipDist = Math.abs(entry - sl) / pipSize;
    if (pipDist <= 0) return null;
    const valuePerPipPerLot = sym.isCrypto ? 1 : sym.isGold ? 1 : 10;
    const lots = riskAmt / (pipDist * valuePerPipPerLot);
    return {
      risk_amount: +riskAmt.toFixed(2),
      pip_distance: +pipDist.toFixed(1),
      suggested_lots: +lots.toFixed(3),
    };
  }

  function highImpactNewsTime() {
    return false; // Disabled temporarily for testing
  }

  // ─────────────────────────────────────────────
  // CORE STRATEGY (used by both SCALP & SWING)
  // ─────────────────────────────────────────────
  function buildSignal({ pair, sym, ltf, htf, livePrice, mode, balance, riskPct, priceSource, isKiteActive }) {
    const d = digits(sym);
    const analysisCandles = mode === 'SCALP' ? ltf : ltf.slice(0, -1);
    const closes = analysisCandles.map(x => x.close);
    const highs  = analysisCandles.map(x => x.high);
    const lows   = analysisCandles.map(x => x.low);
    const price  = livePrice;

    const ema9   = EMA.calculate({ period: 9,  values: closes });
    const ema21  = EMA.calculate({ period: 21, values: closes });
    const ema50  = EMA.calculate({ period: 50, values: closes });
    const rsiArr = RSI.calculate({ period: 14, values: closes });
    const atrArr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const atrMA  = SMA.calculate({ period: 10, values: atrArr });

    const emaF = ema9.at(-1), emaS = ema21.at(-1), emaM = ema50.at(-1);
    const rsi  = rsiArr.at(-1) ?? 50;
    const atr  = atrArr.at(-1) ?? 0;
    const expandingATR = atr > (atrMA.at(-1) || atr);

    // HTF trend
    const htfInfo = htfTrend(htf.map(x => x.close), mode);
    const trend   = htfInfo.trend;

    // Structure
    const bos   = detectBOS(analysisCandles, atr);
    const choch = detectCHoCH(analysisCandles, atr, trend);
    const fvg   = detectFVG(analysisCandles, 40, atr);
    const ob    = detectOrderBlock(analysisCandles, atr);
    const sweep = liquiditySweep(analysisCandles, mode === 'SCALP' ? 8 : 15);
    const pd    = premiumDiscount(analysisCandles, 50);

    // Candle quality (use prior closed candle, not the live in-progress one)
    const last  = analysisCandles.at(-1);
    const body  = Math.abs(last.close - last.open);
    const range = Math.max(last.high - last.low, 1e-9);
    const strongBull = last.close > last.open && body > range * 0.55 && body > atr * 0.3;
    const strongBear = last.close < last.open && body > range * 0.55 && body > atr * 0.3;

    // Momentum thresholds (relaxed for scalp/crypto)
    const rsiHi = mode === 'SCALP' ? 52 : sym.isCrypto ? 50 : sym.isGold ? 52 : 55;
    const rsiLo = mode === 'SCALP' ? 48 : sym.isCrypto ? 50 : sym.isGold ? 48 : 45;
    const bullMomo = rsi > rsiHi && emaF > emaS;
    const bearMomo = rsi < rsiLo && emaF < emaS;

    // Ranging filter
    const emaDist = Math.abs(emaF - emaS);
    const ranging = emaDist < atr * (mode === 'SCALP' ? 0.18 : 0.22);
    const strongTrend =
      trend !== 'RANGING' &&
      expandingATR &&
      emaDist > atr * 0.2;
    const marketState =
      bos.bos && expandingATR
        ? 'TRENDING'
        : ranging
          ? 'RANGING'
          : 'TRANSITION';

    // Entry archetypes
    const inBullFVG = fvg.bull && price >= fvg.bull.bottom && price <= fvg.bull.top;
    const inBearFVG = fvg.bear && price >= fvg.bear.bottom && price <= fvg.bear.top;
    const inBullOB  = ob?.type === 'BULLISH' && price >= ob.bottom && price <= ob.top;
    const inBearOB  = ob?.type === 'BEARISH' && price >= ob.bottom && price <= ob.top;

    const retraceBuy =
      bos.type === 'BULLISH' && bullMomo &&
      last.low <= emaF + atr * 0.35 && last.close > emaF;
    const retraceSell =
      bos.type === 'BEARISH' && bearMomo &&
      last.high >= emaF - atr * 0.35 && last.close < emaF;

    // CONFIRMATION LAYER
    const bullishConfirmation = bos.type === 'BULLISH' || choch.type === 'BULLISH' || sweep.sweepLow;
    const bearishConfirmation = bos.type === 'BEARISH' || choch.type === 'BEARISH' || sweep.sweepHigh;

    // ENTRY LAYER
    const bullishEntry = retraceBuy  || inBullFVG || inBullOB || strongBull;
    const bearishEntry = retraceSell || inBearFVG || inBearOB || strongBear;

    // FINAL SETUPS
    const institutionalLong  = inBullFVG || inBullOB || retraceBuy;
    const institutionalShort = inBearFVG || inBearOB || retraceSell;

    const longSetup =
      strongTrend &&
      trend === 'BULLISH' &&
      bullishConfirmation &&
      institutionalLong &&
      bullMomo &&
      pd.zone === 'DISCOUNT';

    const shortSetup =
      strongTrend &&
      trend === 'BEARISH' &&
      bearishConfirmation &&
      institutionalShort &&
      bearMomo &&
      pd.zone === 'PREMIUM';

    // Entry timing label
    const entryTiming =
      retraceBuy || retraceSell ? 'RETEST ENTRY'
        : sweep.sweepLow || sweep.sweepHigh ? 'SWEEP REVERSAL'
          : inBullFVG || inBearFVG ? 'FVG FILL'
            : inBullOB || inBearOB ? 'ORDER BLOCK'
              : bos.bos ? 'MOMENTUM ENTRY' : 'WAIT';

    const entryType =
      inBullFVG || inBearFVG ? 'FVG'
        : inBullOB || inBearOB ? 'ORDER BLOCK'
          : sweep.sweepLow || sweep.sweepHigh ? 'SWEEP REVERSAL'
            : retraceBuy || retraceSell ? 'RETEST'
              : 'BREAKOUT';

    // Modules report (for UI)
    const modules = {
      trend:      { status: trend !== 'RANGING' ? 'PASS' : 'FAIL', reason: `HTF ${trend}` },
      structure:  { status: bos.bos || choch.choch ? 'PASS' : 'FAIL', reason: choch.choch ? `CHoCH ${choch.type}` : (bos.type !== 'NONE' ? `BOS ${bos.type}` : 'No structure') },
      bos:        { status: bos.bos ? 'PASS' : 'FAIL', reason: bos.type !== 'NONE' ? `BOS ${bos.type} @ ${bos.level?.toFixed(d)}` : 'No BOS' },
      fvg:        { status: (fvg.bull || fvg.bear) ? 'PASS' : 'FAIL', reason: fvg.bull ? 'Bullish FVG' : fvg.bear ? 'Bearish FVG' : 'No FVG' },
      orderBlock: { status: ob ? 'PASS' : 'FAIL', reason: ob ? `${ob.type} OB` : 'No OB' },
      liquidity:  { status: (sweep.sweepLow || sweep.sweepHigh) ? 'PASS' : 'FAIL', reason: sweep.sweepLow ? 'Sweep low' : sweep.sweepHigh ? 'Sweep high' : 'No sweep' },
      zone:       { status: 'PASS', reason: `${pd.zone} zone` },
      momentum:   { status: bullMomo || bearMomo ? 'PASS' : 'FAIL', reason: `RSI ${rsi.toFixed(1)}` },
    };

    const metrics = {
      rsi: +rsi.toFixed(1),
      atr: +atr.toFixed(d),
      ema21: +emaS.toFixed(d),
      ema50: +emaM.toFixed(d),
      htf_trend: trend,
      pd_zone: pd.zone,
      expandingATR,
    };

    // ─── NO TRADE BRANCHES ───
    if (marketState !== 'TRENDING') {
      return {
        pair, mode,
        state: 'NO TRADE', status_label: 'WAIT', signal_type: 'NEUTRAL',
        bias: marketState,
        current_price: +price.toFixed(d),
        price_source: priceSource,
        kite_configured: isKiteActive,
        confidence: 25,
        reason_summary: marketState === 'RANGING'
          ? 'Market is ranging (EMA compression)'
          : 'Market lacks strong displacement',
        modules, metrics,
      };
    }

    if (!longSetup && !shortSetup) {
      return {
        pair, mode, state: 'NO TRADE', status_label: 'WAIT', signal_type: 'NEUTRAL',
        price_source: priceSource, kite_configured: isKiteActive,
        bias: trend, current_price: +price.toFixed(d),
        confidence: normConfidence(
          (trend !== 'RANGING' ? 20 : 0) +
          (bullMomo || bearMomo ? 20 : 0) +
          (bos.bos ? 10 : 0)
        ),
        entry_timing: 'WAIT',
        reason_summary: 'No high probability setup',
        modules, metrics,
      };
    }

    // ─── BUILD TRADE ───
    const isLong = !!longSetup;
    let entry, sl, tp1, tp2;

    if (isLong) {
      entry = retraceBuy ? emaF
        : inBullFVG ? (fvg.bull.bottom + fvg.bull.top) / 2
          : inBullOB ? ob.top
            : price;
      const slBase = Math.min(sweep.recentLow, ob?.bottom ?? sweep.recentLow, fvg.bull?.bottom ?? sweep.recentLow);
      sl = slBase - atr * 0.3;
      const risk = Math.max(entry - sl, atr * 0.5);
      tp1 = entry + risk * (mode === 'SCALP' ? 1.5 : 2.5);
      tp2 = entry + risk * (mode === 'SCALP' ? 2.5 : 5);
    } else {
      entry = retraceSell ? emaF
        : inBearFVG ? (fvg.bear.bottom + fvg.bear.top) / 2
          : inBearOB ? ob.bottom
            : price;
      const slBase = Math.max(sweep.recentHigh, ob?.top ?? sweep.recentHigh, fvg.bear?.top ?? sweep.recentHigh);
      sl = slBase + atr * 0.3;
      const risk = Math.max(sl - entry, atr * 0.5);
      tp1 = entry - risk * (mode === 'SCALP' ? 1.5 : 2.5);
      tp2 = entry - risk * (mode === 'SCALP' ? 2.5 : 5);
    }

    // Sanity guards
    if (isLong  && (sl >= entry || tp1 <= entry || tp2 <= tp1)) {
      return { pair, signal_type: 'ERROR', reasons: ['Invalid LONG structure'],  metrics };
    }
    if (!isLong && (sl <= entry || tp1 >= entry || tp2 >= tp1)) {
      return { pair, signal_type: 'ERROR', reasons: ['Invalid SHORT structure'], metrics };
    }

    const riskDistance = Math.max(Math.abs(entry - sl), atr * 0.3);
    const rr = Math.abs(tp2 - entry) / riskDistance;

    // Confidence scoring (multi-confluence)
    let score = 0;
    if (trend !== 'RANGING') score += 15;
    if (isLong  && pd.zone === 'DISCOUNT') score += 10;
    if (!isLong && pd.zone === 'PREMIUM')  score += 10;
    if ((bullMomo || bearMomo) && Math.abs(rsi - 50) > 5) score += 15;
    if (bos.bos && expandingATR) score += 20;
    if (choch.choch) score += 15;
    if (sweep.sweepLow || sweep.sweepHigh) score += 15;
    if (retraceBuy || retraceSell) score += 10;
    if (inBullFVG || inBearFVG) score += 5;
    if (inBullOB  || inBearOB)  score += 5;
    if (expandingATR) score += 5;
    if (marketState !== 'TRENDING') score -= 15;

    const confidence = normConfidence(score);
    const sizing = positionSize(balance, riskPct, entry, sl, sym);

    return {
      pair, mode, state: 'TRADE', status_label: 'TRADE',
      price_source: priceSource,
      kite_configured: isKiteActive,
      signal_type: isLong ? 'LONG' : 'SHORT',
      bias: trend,
      strategy: mode === 'SCALP' ? 'SCALP' : 'SWING',
      current_price: +price.toFixed(d),
      entry: +entry.toFixed(d),
      sl: +sl.toFixed(d),
      tp1: +tp1.toFixed(d),
      tp2: +tp2.toFixed(d),
      rr_ratio: `1:${rr.toFixed(1)}`,
      entry_type: entryType,
      entry_timing: entryTiming,
      confidence,
      reason_summary: `${isLong ? 'Bullish' : 'Bearish'} ${entryType} on ${trend} HTF`,
      risk_management: sizing,
      zones: {
        premium_discount: pd,
        fvg: { bull: fvg.bull, bear: fvg.bear },
        order_block: ob,
        sweep,
        bos: bos.level,
        choch: choch.choch ? { type: choch.type, level: choch.level } : null,
      },
      modules, metrics,
      last_candle_time: ltf.at(-1)?.datetime || 'N/A',
    };
  }

  // ─────────────────────────────────────────────
  // SIGNAL HANDLER (SWING + SCALP)
  // ─────────────────────────────────────────────
  async function handleSignal(req, res, defaultMode) {
    try {
      const { pair, mode = defaultMode, dataSource = 'YAHOO', balance, riskPct } = req.body;

      let priceSource = dataSource === 'REALTIME' ? 'REALTIME (Live)' : 'YAHOO (15-20 min lag)';
      let isKiteActive = false;

      const kiteKey = process.env.KITE_API_KEY;
      const kiteSecret = process.env.KITE_API_SECRET;
      if (kiteKey && kiteSecret && kiteKey !== 'YOUR_KITE_API_KEY' && kiteSecret !== 'YOUR_KITE_API_SECRET') {
        isKiteActive = true;
        if (dataSource === 'REALTIME') {
          priceSource = 'REALTIME (Kite API - Live)';
        }
      }

      const sym = resolveSymbol(pair);
      if (highImpactNewsTime() && !sym.isCrypto) {
        return res.json({
          pair, state: 'NO TRADE', status_label: 'WAIT', signal_type: 'NEUTRAL',
          reason_summary: 'High impact news volatility',
        });
      }

      // session gating (skip for crypto / realtime)
      if (!sym.isCrypto && dataSource !== 'REALTIME' && !activeFxSession()) {
        const { livePrice } = await fetchCandles(sym, dataSource, mode);
        return res.json({
          pair, state: 'NO TRADE', status_label: 'WAIT', signal_type: 'NEUTRAL',
          current_price: +livePrice.toFixed(digits(sym)),
          reason_summary: 'Outside active session',
        });
      }

      if (mode === 'SCALP') {
        const { ltf: fastCandles, htf: htfCandles } = await fetchCandles(sym, dataSource, mode);
        if (!fastCandles || fastCandles.length < 30) {
          return res.json({
            pair, mode: 'SCALP', state: 'NO TRADE', status_label: 'WAIT',
            reason_summary: 'Not enough fast data for scalping',
            scalpAvailable: false,
            current_price: fastCandles ? fastCandles.at(-1).close : null,
          });
        }

        const atrValsFast = ATR.calculate({
          period: 14,
          high:  fastCandles.map(c => c.high),
          low:   fastCandles.map(c => c.low),
          close: fastCandles.map(c => c.close),
        });
        const atrFast = atrValsFast.at(-1) || 0;

        const volumes = fastCandles.map(c => c.volume || 0).filter(v => v > 0);
        const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b) / volumes.length : null;

        const scalperResult = scalping.detectEMACrossoverRetest(fastCandles, { atr: atrFast, timeframeMinutes: 1, avgVolume });
        if (!scalperResult) {
          return res.json({
            pair, mode: 'SCALP', state: 'NO TRADE', status_label: 'WAIT',
            reason_summary: 'Waiting for EMA9/21 crossover + retest setup + confirmation',
            scalpAvailable: false,
            current_price: fastCandles.at(-1).close,
          });
        }

        // HTF Trend Check
        if (htfCandles && htfCandles.length >= 21) {
          const htfCloses = htfCandles.map(c => c.close);
          const htfEma9  = EMA.calculate({ period: 9,  values: htfCloses });
          const htfEma21 = EMA.calculate({ period: 21, values: htfCloses });

          if (htfEma9.length > 0 && htfEma21.length > 0) {
            const latestHtfEma9  = htfEma9.at(-1);
            const latestHtfEma21 = htfEma21.at(-1);

            if (scalperResult.direction === 'LONG' && latestHtfEma9 <= latestHtfEma21) {
              return res.json({
                pair, mode: 'SCALP', state: 'NO TRADE', status_label: 'WAIT',
                reason_summary: 'HTF (15m) EMA9 not above EMA21 - bearish bias, skip LONG',
                scalpAvailable: false,
                current_price: fastCandles.at(-1).close,
              });
            }
            if (scalperResult.direction === 'SHORT' && latestHtfEma9 >= latestHtfEma21) {
              return res.json({
                pair, mode: 'SCALP', state: 'NO TRADE', status_label: 'WAIT',
                reason_summary: 'HTF (15m) EMA9 not below EMA21 - bullish bias, skip SHORT',
                scalpAvailable: false,
                current_price: fastCandles.at(-1).close,
              });
            }
          }
        }

        // Daily Trend Check (EMA200)
        let dailyCandles = null;
        try {
          if (sym.binance) {
            dailyCandles = await fetchBinance(sym.binance, '1d', 250);
          } else if (!dailyCandles && sym.yahoo) {
            dailyCandles = await fetchYahoo(sym.yahoo, 365, '1d');
          }
        } catch (err) {
          console.log('Daily candles fetch failed for HTF trend:', err.message);
        }

        if (dailyCandles && dailyCandles.length >= 200) {
          const dailyCloses  = dailyCandles.map(c => c.close);
          const dailyEma200  = EMA.calculate({ period: 200, values: dailyCloses });

          if (dailyEma200.length > 0) {
            const latestDailyEma200 = dailyEma200.at(-1);
            const currentPrice = fastCandles.at(-1).close;

            if (scalperResult.direction === 'LONG' && currentPrice <= latestDailyEma200) {
              return res.json({
                pair, mode: 'SCALP', state: 'NO TRADE', status_label: 'WAIT',
                reason_summary: 'Daily trend bearish - price below EMA200, skip LONG',
                scalpAvailable: false,
                current_price: currentPrice,
              });
            }
            if (scalperResult.direction === 'SHORT' && currentPrice >= latestDailyEma200) {
              return res.json({
                pair, mode: 'SCALP', state: 'NO TRADE', status_label: 'WAIT',
                reason_summary: 'Daily trend bullish - price above EMA200, skip SHORT',
                scalpAvailable: false,
                current_price: currentPrice,
              });
            }
          }
        }

        const atrVals = ATR.calculate({
          period: 14,
          high:  fastCandles.map(c => c.high),
          low:   fastCandles.map(c => c.low),
          close: fastCandles.map(c => c.close),
        });
        const atr = atrVals.at(-1) || 0;
        const targetStop = scalping.calculateTargetStop(scalperResult.entry, scalperResult.direction, atr);
        const hasConfirmation = scalperResult.confirmationIdx > scalperResult.retestIdx;
        const entryType = hasConfirmation ? 'CONFIRMATION' : 'RETEST REJECTION';

        return res.json({
          pair,
          mode: 'SCALP',
          state: 'TRADE',
          status_label: 'TRADE',
          signal_type: scalperResult.direction,
          bias: scalperResult.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
          reason_summary: hasConfirmation
            ? `EMA9/21 Crossover + Retest + Confirmation: Enter on bounce from EMA at ${scalperResult.entry}`
            : `EMA9/21 Crossover + Retest: Enter on pullback rejection at ${scalperResult.entry}`,
          entry: scalperResult.entry,
          sl:    targetStop.stop,
          tp1:   targetStop.tp1,
          tp2:   targetStop.tp2,
          current_price: fastCandles.at(-1).close,
          entry_timing: hasConfirmation ? 'CONFIRMED' : 'READY',
          entry_type: entryType,
          metrics: {
            atr: Number(atr.toFixed(5)),
            ema9: scalperResult.emaLevel,
          },
          scalper_signal: {
            direction: scalperResult.direction,
            status_label: 'TRADE',
            action: scalperResult.direction === 'LONG' ? 'BUY' : 'SELL',
            entry: scalperResult.entry,
            target: targetStop.tp1,
            sl: targetStop.stop,
            reason_summary: scalperResult.reason,
            option_trade: 'N/A',
          },
          scalpAvailable: true,
        });
      }

      const { ltf, htf, livePrice, source: fetchedSource } = await fetchCandles(sym, dataSource, mode);
      if (ltf.length < 60) return res.json({ signal_type: 'ERROR', reasons: ['Insufficient data'] });
      const activePriceSource = isKiteActive && dataSource === 'REALTIME' ? priceSource : (fetchedSource || priceSource);
      const signal = buildSignal({ pair, sym, ltf, htf, livePrice, mode, balance, riskPct, priceSource: activePriceSource, isKiteActive });
      res.json(signal);
    } catch (err) {
      console.error(err);
      res.status(500).json({ signal_type: 'ERROR', reasons: [err.message] });
    }
  }

  // ─────────────────────────────────────────────
  // CHART DATA ENDPOINT (multi-TF with SMC overlays)
  // ─────────────────────────────────────────────
  app.post('/api/v1/chart-data', async (req, res) => {
    try {
      const { pair, timeframe = '15m', dataSource = 'YAHOO' } = req.body;
      const sym = resolveSymbol(pair);

      const tfBinance = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
      const tfTwelve  = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day' };
      const tfYahoo   = { '1m': { d: 5, i: '1m' }, '5m': { d: 10, i: '5m' }, '15m': { d: 30, i: '15m' }, '1h': { d: 90, i: '1h' }, '4h': { d: 365, i: '1d' }, '1d': { d: 365, i: '1d' } };

      let candles, live = null;
      if (dataSource === 'REALTIME' && sym.binance) {
        [candles, live] = await Promise.all([
          fetchBinance(sym.binance, tfBinance[timeframe] || '15m', 500),
          fetchBinanceLive(sym.binance),
        ]);
      } else if (dataSource === 'REALTIME' && sym.isGold && sym.twelve) {
        try {
          [candles, live] = await Promise.all([
            fetchTwelve(sym.twelve, tfTwelve[timeframe] || '15min', 500),
            fetchTwelveLive(sym.twelve),
          ]);
        } catch (err) {
          console.log(`[chart-data] TwelveData failed for ${sym.key}, falling back to Yahoo:`, err.message);
          candles = null; live = null;
        }
      }

      // Fall back to Yahoo if REALTIME failed or not requested
      if (!candles || !candles.length) {
        const m = tfYahoo[timeframe] || tfYahoo['15m'];
        [candles, live] = await Promise.all([
          fetchYahoo(sym.yahoo, m.d, m.i),
          fetchYahooLive(sym.yahoo),
        ]);
        if (!candles || candles.length === 0) {
          return res.status(500).json({ error: 'Failed to retrieve candle data' });
        }
      }

      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      const atr = (ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).at(-1)) || 0;

      const { highs: swH, lows: swL } = findSwings(candles, 3);
      const bos   = detectBOS(candles, atr);
      const choch = detectCHoCH(candles, atr, htfTrend(closes).trend);
      const fvg   = detectFVG(candles, 80);
      const ob    = detectOrderBlock(candles, atr);
      const sweep = liquiditySweep(candles, 20);
      const pd    = premiumDiscount(candles, 60);

      const buildTrendline = (pivots, kind) => {
        if (!pivots || pivots.length < 2) return null;
        const recent = pivots.slice(-15);
        let best = null;
        
        for (let a = 0; a < recent.length - 1; a++) {
          for (let b = a + 1; b < recent.length; b++) {
            const A = recent[a], B = recent[b];
            const dx = B.i - A.i;
            if (dx < 3) continue;
            const slope = (B.level - A.level) / dx;
            
            if (Math.abs(slope) / Math.max(A.level, 1) > 0.005) continue;
            if (kind === 'RES' && slope > 0 && slope / Math.max(A.level, 1) > 0.003) continue;
            if (kind === 'SUP' && slope < 0 && Math.abs(slope) / Math.max(A.level, 1) > 0.003) continue;
            
            let isBroken = false;
            let touches = 0;
            
            // Check ALL candles from A.i to the most recent candle
            for (let i = A.i; i < candles.length; i++) {
                const c = candles[i];
                const expected = A.level + slope * (i - A.i);
                
                // The trendline must not be broken anywhere after the first pivot
                if (i > A.i) {
                    if (kind === 'RES' && c.high > expected + atr * 0.2) { isBroken = true; break; }
                    if (kind === 'SUP' && c.low < expected - atr * 0.2) { isBroken = true; break; }
                }
                
                // Check touches
                if (i >= A.i) {
                    const priceExtremum = kind === 'RES' ? c.high : c.low;
                    const diff = Math.abs(priceExtremum - expected);
                    if (diff <= atr * 0.25) touches++;
                }
            }
            if (isBroken) continue;
            
            if (!best || touches > best.touches || (touches === best.touches && dx > best.dx)) {
              best = { A, B, touches, dx };
            }
          }
        }
        
        // Removed the forced fallback! If there's no valid unbroken trendline, return null.
        if (!best) return null;
        return [
          { time: candles[best.A.i].datetime, price: best.A.level },
          { time: candles[best.B.i].datetime, price: best.B.level },
        ];
      };

      const trendline = {
        resistance: buildTrendline(swH, 'RES'),
        support:    buildTrendline(swL, 'SUP'),
      };

      const recommended_source = sym.twelve && process.env.TWELVE_DATA_API_KEY ? 'REALTIME (TwelveData)'
        : sym.binance ? 'REALTIME (Binance)' : 'YAHOO';
      const data_parity = (dataSource === 'REALTIME' && (sym.twelve || sym.binance));

      res.json({
        pair, timeframe, source: dataSource,
        recommended_source,
        data_parity,
        candles,
        live_price: live ?? candles.at(-1).close,
        overlays: {
          swing_highs: swH,
          swing_lows:  swL,
          bos, choch,
          fvg_bull: fvg.allBull,
          fvg_bear: fvg.allBear,
          order_block: ob,
          liquidity: sweep,
          premium_discount: pd,
          trendline,
          fake_traps: candles.slice(-50).filter((c, i, arr) => {
            if (i < 5) return false;
            const lb = arr.slice(Math.max(0, i - 10), i);
            const rH = Math.max(...lb.map(x => x.high));
            const rL = Math.min(...lb.map(x => x.low));
            return (c.high > rH && c.close < rH) || (c.low < rL && c.close > rL);
          }).map(c => ({ time: c.datetime, high: c.high, low: c.low, close: c.close })),
        },
      });
    } catch (err) {
      console.error('chart-data error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────
  // FOREX SIGNAL ROUTES
  // ─────────────────────────────────────────────
  app.post('/api/v1/analyze-forex', (req, res) => handleSignal(req, res, 'STRICT'));
  app.post('/api/v1/analyze-forex-scalp', (req, res) => handleSignal({ ...req, body: { ...req.body, mode: 'SCALP' } }, res, 'SCALP'));

  // Return shared state for /api/v1/stats in index.js
  return { tdCache, apiCallCount: () => apiCallCount, rateLimitWarning: () => rateLimitWarning, requestQueue };
}

module.exports = registerForexRoutes;
