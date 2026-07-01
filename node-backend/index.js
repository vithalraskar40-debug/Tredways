'use strict';

const express = require('express');
require('dotenv').config();

const yahooFinance = new (require('yahoo-finance2').default)();
const { EMA, RSI, ATR, SMA } = require('technicalindicators');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const scalping = require('./scalping');
const { notifications, formatNotificationForApp } = require('./notifications');

// Forex module state — populated after registerForexRoutes() is called below
let forexState = null;
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8002;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ────────────────────────────────────────────────────────────────
// HEALTH + STATS
// ────────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => {
  const apiCallCount = forexState ? forexState.apiCallCount() : 0;
  const requestQueue = forexState ? forexState.requestQueue : {};
  const rateLimitWarning = forexState ? forexState.rateLimitWarning() : null;
  res.json({
    status: 'online',
    time: new Date().toISOString(),
    apiUsage: {
      totalCalls: apiCallCount,
      pendingRequests: Object.keys(requestQueue).length,
      warning: rateLimitWarning,
      rateStatus: apiCallCount > 800 ? '⚠️ APPROACHING LIMIT' : '✅ OK',
    },
  });
});

app.get('/api/v1/stats', (req, res) => {
  const tdCache = forexState ? forexState.tdCache : {};
  const requestQueue = forexState ? forexState.requestQueue : {};
  const apiCallCount = forexState ? forexState.apiCallCount() : 0;
  const rateLimitWarning = forexState ? forexState.rateLimitWarning() : null;
  res.json({
    server: 'Tredways Engine v2',
    apiCalls: {
      total: apiCallCount,
      limit: 1000,
      remaining: Math.max(0, 1000 - apiCallCount),
      percentUsed: Math.round((apiCallCount / 1000) * 100),
    },
    cache: {
      entries: Object.keys(tdCache).length,
      sizeKB: Math.round(Object.values(tdCache).reduce((s, v) => s + JSON.stringify(v).length, 0) / 1024),
      expirySeconds: 30,
    },
    requests: {
      pending: Object.keys(requestQueue).length,
      inFlight: Object.keys(requestQueue),
    },
    warning: rateLimitWarning,
  });
});

// ────────────────────────────────────────────────────────────────
// FILE UPLOAD
// ────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

app.post('/api/v1/upload-chart', upload.single('chart'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename });
});

// ────────────────────────────────────────────────────────────────
// Angel Broking helpers — stubbed for now (require live SmartAPI auth).
// Returning null lets the code fall back to Yahoo/TwelveData cleanly.
// ────────────────────────────────────────────────────────────────
async function fetchAngelAuth() {
  return null;
}
async function fetchAngelLive(_symbol) {
  return null;
}
const wsConnected = false;
const livePriceCache = {};

// ────────────────────────────────────────────────────────────────
// SMC / SMART-MONEY PRIMITIVES (used by stock signal engine)
// ────────────────────────────────────────────────────────────────
function getSwings(quotes) {
  const swings = [];
  for (let i = 2; i < quotes.length - 2; i++) {
    if (
      quotes[i].high > quotes[i - 1].high &&
      quotes[i].high > quotes[i + 1].high &&
      quotes[i].high > quotes[i - 2].high &&
      quotes[i].high > quotes[i + 2].high
    ) {
      swings.push({ type: 'HIGH', price: quotes[i].high, i });
    }
    if (
      quotes[i].low < quotes[i - 1].low &&
      quotes[i].low < quotes[i + 1].low &&
      quotes[i].low < quotes[i - 2].low &&
      quotes[i].low < quotes[i + 2].low
    ) {
      swings.push({ type: 'LOW', price: quotes[i].low, i });
    }
  }
  return swings;
}

function findZones(quotes, atr) {
  for (let i = quotes.length - 21; i >= 5; i--) {
    const nextMove = Math.abs(quotes[i + 1].close - quotes[i].close);
    if (nextMove > atr * 2) {
      return { demand: quotes[i].low, supply: quotes[i].high };
    }
  }
  return {
    demand: Math.min(...quotes.slice(-20).map(q => q.low)),
    supply: Math.max(...quotes.slice(-20).map(q => q.high)),
  };
}

function detectBOS(swings, quotes) {
  const highs = swings.filter(s => s.type === 'HIGH');
  const lows = swings.filter(s => s.type === 'LOW');
  if (highs.length < 2 || lows.length < 2) return { bos: false, type: 'NONE' };

  const latest = quotes.at(-1);
  const prevHigh = highs[highs.length - 2].price;
  const prevLow = lows[lows.length - 2].price;
  if (latest.close > prevHigh) return { bos: true, type: 'BULLISH' };
  if (latest.close < prevLow) return { bos: true, type: 'BEARISH' };
  return { bos: false, type: 'NONE' };
}

function detectVolumeSpike(quotes) {
  const latest = quotes.at(-1);
  const avgVolume = quotes.slice(-21, -1).reduce((a, q) => a + (q.volume || 0), 0) / 20;
  const spikeRatio = avgVolume > 0 ? latest.volume / avgVolume : 0;
  return { spike: spikeRatio > 1.3, ratio: +spikeRatio.toFixed(2), avgVolume: Math.round(avgVolume), currentVolume: latest.volume };
}

function calculateSmartVWAP(quotes) {
  const today = new Date().toISOString().split('T')[0];
  const sessionQuotes = quotes.filter(q => new Date(q.date).toISOString().split('T')[0] === today);
  let totalPV = 0, totalV = 0;
  sessionQuotes.forEach(q => {
    const tp = (q.high + q.low + q.close) / 3;
    totalPV += tp * (q.volume || 0);
    totalV += q.volume || 0;
  });
  if (totalV === 0) {
    const fw = sessionQuotes.slice(-60);
    if (!fw.length) return 0;
    return +(fw.reduce((s, c) => s + ((c.high + c.low + c.close) / 3), 0) / fw.length).toFixed(2);
  }
  return +(totalPV / totalV).toFixed(2);
}

async function calculateRelativeStrength(stockChange) {
  try {
    const nifty = await yahooFinance.chart('^NSEI', {
      period1: Math.floor(Date.now() / 1000) - 86400 * 5,
      interval: '1d',
    });
    const q = nifty.quotes.filter(x => x.close);
    if (q.length < 2) return 0;
    const niftyChange = ((q.at(-1).close - q.at(-2).close) / q.at(-2).close) * 100;
    return +(stockChange - niftyChange).toFixed(2);
  } catch {
    return 0;
  }
}

function detectCompression(quotes, atr) {
  const recentRanges = quotes.slice(-10).map(q => q.high - q.low);
  const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
  return { compression: avgRange < atr * 0.7, avgRange: +avgRange.toFixed(2) };
}

function detectLiquiditySweep(quotes) {
  const prev = quotes.at(-2);
  const latest = quotes.at(-1);
  return {
    bullishSweep: latest.low < prev.low && latest.close > prev.close,
    bearishSweep: latest.high > prev.high && latest.close < prev.close,
  };
}

function detectDisplacement(quotes) {
  const latest = quotes.at(-1);
  const body = Math.abs(latest.close - latest.open);
  const range = latest.high - latest.low;
  return {
    displacement: range > 0 && body / range > 0.7,
    bodyRatio: range > 0 ? +(body / range).toFixed(2) : 0,
  };
}

function calculatePositionSize({ capital, riskPercent, entry, sl }) {
  const riskAmount = capital * (riskPercent / 100);
  const perShareRisk = Math.abs(entry - sl);
  const quantity = perShareRisk > 0 ? Math.floor(riskAmount / perShareRisk) : 0;
  return { quantity, riskAmount, perShareRisk };
}

async function runSmartMoneyEngine({ quotes, atr, price, closes, bosType, strongMove, niftyChange }) {
  const volumeSpike = detectVolumeSpike(quotes);
  const smartVWAP = calculateSmartVWAP(quotes);
  const aboveVWAP = smartVWAP > 0 ? price > smartVWAP : false;

  let stockChange = 0;
  if (closes.length >= 2) stockChange = ((closes.at(-1) - closes.at(-2)) / closes.at(-2)) * 100;
  const rsStrength = niftyChange !== null
    ? +(stockChange - niftyChange).toFixed(2)
    : await calculateRelativeStrength(stockChange);

  const compression = detectCompression(quotes, atr);
  const liquiditySweep = detectLiquiditySweep(quotes);

  let score = 0;
  if (volumeSpike.spike) score += 25;
  if (rsStrength > 1.5) score += 15;
  if ((bosType === 'BULLISH' && aboveVWAP) || (bosType === 'BEARISH' && !aboveVWAP)) score += 15;
  if (compression.compression) score += 15;
  if (bosType !== 'NONE') score += 15;
  if (strongMove) score += 10;
  if ((bosType === 'BULLISH' && liquiditySweep.bullishSweep) || (bosType === 'BEARISH' && liquiditySweep.bearishSweep)) score += 10;

  const label =
    score >= 85 ? 'A+' :
    score >= 75 ? 'A' :
    score >= 65 ? 'B+' :
    score >= 55 ? 'B' :
    score >= 45 ? 'C' :
    score >= 35 ? 'WATCH' : 'AVOID';

  return {
    score, label,
    volume_spike: volumeSpike.spike,
    volume_ratio: volumeSpike.ratio,
    current_volume: volumeSpike.currentVolume,
    average_volume: volumeSpike.avgVolume,
    relative_strength: rsStrength,
    above_vwap: aboveVWAP,
    vwap: smartVWAP,
    compression: compression.compression,
    avg_range: compression.avgRange,
    liquidity_sweep:
      (bosType === 'BULLISH' && liquiditySweep.bullishSweep) ||
      (bosType === 'BEARISH' && liquiditySweep.bearishSweep),
  };
}

function detectBreakoutTrap(quotes, atr) {
  if (!quotes || quotes.length < 3) return { isTrap: false, reason: 'Insufficient data' };
  const latest = quotes.at(-1);
  const prev = quotes.at(-2);
  const prev2 = quotes.at(-3);
  if (!latest || !prev) return { isTrap: false, reason: 'Invalid candles' };

  const recentVolumes = quotes.slice(-20).map(q => q.volume || 0).filter(v => v > 0);
  const avgVolume = recentVolumes.length ? recentVolumes.reduce((a, b) => a + b) / recentVolumes.length : 0;

  if (avgVolume > 0 && latest.volume < avgVolume * 1.3) {
    return { isTrap: true, reason: `WEAK VOLUME: ${(latest.volume / avgVolume).toFixed(1)}x avg (need >1.3x)` };
  }
  const breakoutSize = Math.abs(latest.close - latest.open);
  const breakoutRange = latest.high - latest.low;
  if (breakoutSize < atr * 1.5) return { isTrap: true, reason: `SMALL BREAKOUT: ${(breakoutSize / atr).toFixed(2)}x ATR` };
  const bodyRatio = breakoutRange > 0 ? breakoutSize / breakoutRange : 0;
  if (bodyRatio < 0.5) return { isTrap: true, reason: `WEAK CANDLE BODY: ${(bodyRatio * 100).toFixed(0)}%` };
  if (prev2) {
    const bull = latest.close > latest.open;
    if (bull && prev.close < prev.open && prev.close < latest.open) return { isTrap: true, reason: 'Immediate reversal after bullish breakout' };
    if (!bull && prev.close > prev.open && prev.close > latest.open) return { isTrap: true, reason: 'Immediate reversal after bearish breakout' };
  }
  return { isTrap: false, reason: 'Breakout is valid' };
}

// ────────────────────────────────────────────────────────────────
// STOCK SIGNAL ENGINE
// ────────────────────────────────────────────────────────────────
async function generateStockSignal(ticker, mode = 'STRICT', dataSource = 'YAHOO', niftyChange = null) {
  try {
    let priceSource = dataSource === 'REALTIME' ? 'REALTIME (Yahoo - 15-20 min lag)' : 'YAHOO (15-20 min lag)';
    let isKiteActive = false;

    let yfTicker = ticker.toUpperCase();
    if (yfTicker.includes('BANKNIFTY')) yfTicker = '^NSEBANK';
    else if (yfTicker.includes('NIFTY')) yfTicker = '^NSEI';
    else if (yfTicker.includes('SENSEX')) yfTicker = '^BSESN';
    else if (!yfTicker.includes('.') && !yfTicker.startsWith('^')) yfTicker += '.NS';

    const kiteKey = process.env.KITE_API_KEY;
    const kiteSecret = process.env.KITE_API_SECRET;
    if (kiteKey && kiteSecret && kiteKey !== 'YOUR_KITE_API_KEY' && kiteSecret !== 'YOUR_KITE_API_SECRET') {
      isKiteActive = true;
    }

    let htfRes, ltfRes;

    if (dataSource === 'REALTIME') {
      const ltfInterval = mode === 'SCALP' ? '1m' : '5m';
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=${ltfInterval}&range=5d`;
      const rt = await (await fetch(url)).json();
      if (!rt.chart || !rt.chart.result || !rt.chart.result.length) throw new Error('Realtime market data unavailable');
      const r = rt.chart.result[0];
      const q = r.indicators.quote[0];
      const realtimeQuotes = r.timestamp
        .map((t, i) => ({
          date: new Date(t * 1000),
          close: q.close[i], high: q.high[i], low: q.low[i], open: q.open[i], volume: q.volume[i],
        }))
        .filter(x => x.close != null && x.high != null && x.low != null);
      ltfRes = { quotes: realtimeQuotes };
      htfRes = await yahooFinance.chart(yfTicker, {
        period1: Math.floor(Date.now() / 1000) - 86400 * 500,
        interval: '1d',
      });

      // Optional live-price top-up via Yahoo quote (Angel stubbed)
      try {
        const quoteRes = await yahooFinance.quote(yfTicker);
        if (quoteRes && quoteRes.regularMarketPrice) {
          const lastQ = realtimeQuotes.at(-1);
          if (lastQ) lastQ.close = +quoteRes.regularMarketPrice.toFixed(2);
        }
      } catch { /* ignore */ }
    } else {
      [htfRes, ltfRes] = await Promise.all([
        yahooFinance.chart(yfTicker, { period1: Math.floor(Date.now() / 1000) - 86400 * 500, interval: '1d' }),
        yahooFinance.chart(yfTicker, { period1: Math.floor(Date.now() / 1000) - 86400 * 5, interval: mode === 'SCALP' ? '1m' : '5m' }),
      ]);
    }

    const lQ = ltfRes.quotes.filter(q => q.close != null && q.high != null && q.low != null);
    const hQ = htfRes.quotes.filter(q => q.close != null && q.high != null && q.low != null);
    if (lQ.length < 50) throw new Error('Insufficient data');

    const latest = lQ.at(-1);
    const price = latest.close;
    const closes = lQ.map(q => q.close);
    const highs = lQ.map(q => q.high);
    const lows = lQ.map(q => q.low);
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const htfCloses = hQ.map(q => q.close);
    const ema200H = htfCloses.length >= 200 ? EMA.calculate({ period: 200, values: htfCloses }) : [];
    const rsiArr = RSI.calculate({ period: 14, values: closes });
    const atrArr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const lRsi = rsiArr.at(-1) || 50;
    const atr = atrArr.at(-1) || 0;

    const marketRange = Math.max(...highs.slice(-20)) - Math.min(...lows.slice(-20));
    const rangingMarket = marketRange < atr * 8;
    const expandingATR = atr > (atrArr.at(-5) || atr);

    const displacement = detectDisplacement(lQ);
    const bullishMove = displacement.displacement && closes.at(-1) > closes.at(-2) && Math.abs(closes.at(-1) - closes.at(-2)) > atr * 1.2;
    const bearishMove = displacement.displacement && closes.at(-1) < closes.at(-2) && Math.abs(closes.at(-1) - closes.at(-2)) > atr * 1.2;
    if (!ema200H.length) throw new Error('Insufficient HTF data for EMA200');
    const ema200 = ema200H.at(-1);
    const current_price = +price.toFixed(2);

    const swings = getSwings(lQ);
    const bosData = detectBOS(swings, lQ);

    const ltfTrend = rangingMarket ? 'RANGING' : ema20.at(-1) > ema50.at(-1) ? 'BULLISH' : 'BEARISH';
    const htfEma20 = EMA.calculate({ period: 20, values: htfCloses });
    const htfEma50 = EMA.calculate({ period: 50, values: htfCloses });
    const trend = rangingMarket ? 'RANGING' : htfEma20.at(-1) > htfEma50.at(-1) ? 'BULLISH' : 'BEARISH';

    const structureUp = ema20.at(-1) > ema50.at(-1) && closes.at(-1) > ema20.at(-1);
    const structureDown = ema20.at(-1) < ema50.at(-1) && closes.at(-1) < ema20.at(-1);

    const smartMoney = await runSmartMoneyEngine({
      quotes: lQ, atr, price, closes,
      bosType: bosData.type,
      strongMove: bosData.type === 'BULLISH' ? bullishMove : bearishMove,
      niftyChange,
    });

    const zones = findZones(lQ, atr);
    const nearDemand = Math.abs(price - zones.demand) < atr;
    const nearSupply = Math.abs(price - zones.supply) < atr;

    let entry_type = null;
    if (smartMoney.score >= 50 && smartMoney.volume_spike) entry_type = 'SMART MONEY';
    else if (bosData.type !== 'NONE' && (nearDemand || nearSupply)) entry_type = 'CONFIRMATION';
    else if (bosData.type !== 'NONE') entry_type = 'BREAKOUT';
    else if (nearDemand || nearSupply) entry_type = 'EARLY';

    const trapCheckResult = bosData.type !== 'NONE' ? detectBreakoutTrap(lQ, atr) : { isTrap: false, reason: 'N/A' };

    let longCondition, shortCondition;
    if (mode === 'STRICT') {
      longCondition = !rangingMarket && expandingATR && trend === 'BULLISH' && structureUp && lRsi > 55 && smartMoney.above_vwap && smartMoney.score >= 35 && !trapCheckResult.isTrap && bosData.type === 'BULLISH' && smartMoney.volume_spike && bullishMove;
      shortCondition = !rangingMarket && expandingATR && trend === 'BEARISH' && structureDown && lRsi < 45 && !smartMoney.above_vwap && smartMoney.score >= 35 && !trapCheckResult.isTrap && bosData.type === 'BEARISH' && smartMoney.volume_spike && bearishMove;
    } else {
      longCondition = ltfTrend === 'BULLISH' && lRsi > 50 && !trapCheckResult.isTrap &&
        ((structureUp && bullishMove) || (bosData.type === 'BULLISH' && smartMoney.volume_spike));
      shortCondition = ltfTrend === 'BEARISH' && lRsi < 50 && !trapCheckResult.isTrap &&
        ((structureDown && bearishMove) || (bosData.type === 'BEARISH' && smartMoney.volume_spike));
    }

    let entry = null, sl = null, tp = null, status_label = 'WAIT', signal_type = 'NEUTRAL';
    if (smartMoney.score >= 30 && bosData.type !== 'NONE') status_label = 'WATCHLIST';

    if (longCondition) {
      entry = price;
      sl = zones.demand - atr;
      tp = price + Math.abs(price - sl) * 1.5;
      status_label = 'TRADE';
      signal_type = 'LONG';
    } else if (shortCondition) {
      entry = price;
      sl = zones.supply + atr;
      tp = price - Math.abs(sl - price) * 1.5;
      status_label = 'TRADE';
      signal_type = 'SHORT';
    }

    const maxRiskATR = atr * (mode === 'SCALP' ? 2 : 4);
    if (entry !== null && sl !== null && Math.abs(entry - sl) > maxRiskATR) {
      sl = signal_type === 'LONG' ? entry - maxRiskATR : entry + maxRiskATR;
    }

    if (!entry) {
      return {
        ticker, mode, status_label, entry_type: 'NONE',
        state: 'NO TRADE', signal_type: 'NEUTRAL', bias: trend,
        price_source: priceSource, kite_configured: isKiteActive,
        current_price,
        entry: null, sl: null, tp: null, tp1: null, tp2: null,
        confidence: 0, confidence_text: 'No trade',
        reason_summary: `Waiting: BOS=${bosData.bos ? bosData.type : 'NO_BREAK'}, Zone=${nearDemand ? 'Demand' : nearSupply ? 'Supply' : 'None'}${trapCheckResult.isTrap ? ' | ⚠️ TRAP: ' + trapCheckResult.reason : ''}`,
        trap_detection: trapCheckResult.isTrap ? trapCheckResult : null,
        metrics: { rsi: +lRsi.toFixed(1), atr: +atr.toFixed(2), ema200: +ema200.toFixed(2) },
        modules: {
          trend: { status: 'PASS', reason: trend },
          structure: { status: structureUp ? 'PASS' : 'FAIL', reason: structureUp ? 'HH/HL' : 'LH/LL' },
          bos: { status: bosData.type !== 'NONE' ? 'PASS' : 'FAIL', reason: bosData.type || 'No BOS' },
          zone: { status: (nearDemand || nearSupply) ? 'PASS' : 'FAIL', reason: (nearDemand || nearSupply) ? 'Zone touched' : 'Not in zone' },
          momentum: { status: lRsi > 50 ? 'PASS' : 'FAIL', reason: `RSI ${lRsi}` },
        },
        market_state: trend,
        smart_money: smartMoney,
      };
    }

    const sizing = calculatePositionSize({ capital: 100000, riskPercent: 1, entry, sl });
    const risk = Math.abs(entry - sl);
    return {
      ticker, mode, status_label, state: 'TRADE',
      entry_type, signal_type, bias: trend,
      price_source: priceSource, kite_configured: isKiteActive,
      current_price,
      entry: +entry.toFixed(2), sl: +sl.toFixed(2), tp: +tp.toFixed(2),
      position_size: sizing.quantity,
      risk_amount: sizing.riskAmount,
      tp1: +(signal_type === 'LONG' ? entry + risk * 1 : entry - risk * 1).toFixed(2),
      tp2: +(signal_type === 'LONG' ? entry + risk * 1.5 : entry - risk * 1.5).toFixed(2),
      tp3: +(signal_type === 'LONG' ? entry + risk * 2.5 : entry - risk * 2.5).toFixed(2),
      rr_ratio: `1:${((Math.abs(tp - entry)) / risk).toFixed(1)}`,
      confidence: +(smartMoney.score / 100).toFixed(2),
      confidence_text: smartMoney.label,
      grade: smartMoney.label,
      reason_summary: `${signal_type} opportunity near key zone`,
      trap_detection: { isTrap: false, reason: 'Passed trap checks' },
      metrics: { rsi: +lRsi.toFixed(1), atr: +atr.toFixed(2), ema200: +ema200.toFixed(2) },
      modules: {
        trend: { status: 'PASS', reason: trend },
        structure: { status: 'PASS', reason: 'EMA aligned' },
        bos: { status: bosData.type !== 'NONE' ? 'PASS' : 'FAIL', reason: bosData.type },
        zone: { status: (nearDemand || nearSupply) ? 'PASS' : 'FAIL', reason: 'Zone check' },
        momentum: { status: 'PASS', reason: 'RSI ok' },
      },
      market_state: trend,
      smart_money: smartMoney,
    };
  } catch (err) {
    return {
      ticker, status_label: 'ERROR', signal_type: 'ERROR',
      current_price: null, entry: null, sl: null, tp: null, tp1: null, tp2: null,
      reason_summary: err.message,
    };
  }
}

app.post('/api/v1/analyze', async (req, res) => {
  const { ticker, mode, dataSource } = req.body || {};
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  const signal = await generateStockSignal(ticker, mode || 'STRICT', dataSource || 'YAHOO');
  res.json(signal);
});

// Direct Yahoo v8 quote fetcher — more reliable than yahoo-finance2 library.
async function yahooV8Quote(yfSym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=1m&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// LIVE PRICE  — polled every ~2s by the frontend chart
// Uses TwelveData WS cache for XAU/USD, TwelveData REST for FX,
// Yahoo v8 for everything else.
// ────────────────────────────────────────────────────────────────
app.get('/api/v1/live-price', async (req, res) => {
  const raw = String(req.query.symbol || req.query.pair || '').toUpperCase().replace(/[-/_]/g, '');
  if (!raw) return res.status(400).json({ error: 'symbol required' });
  try {
    // 1) Gold — TwelveData WS cache first (0 API calls)
    if (/^(GOLD|XAU|XAUUSD)$/.test(raw)) {
      const cache = forexState && forexState.tdCache && forexState.tdCache['td_live_XAU/USD'];
      if (cache && Date.now() - cache.time < 60000) {
        return res.json({ symbol: 'XAU/USD', price: cache.data, source: 'TwelveData WS', ts: cache.time });
      }
      // Fallback: Yahoo GC=F
      const p = await yahooV8Quote('GC=F');
      if (p != null) return res.json({ symbol: 'GOLD', price: +p, source: 'Yahoo GC=F', ts: Date.now() });
    }
    // 2) Forex 6-letter pairs — TwelveData REST first, then Yahoo v8
    if (/^[A-Z]{6}$/.test(raw) && !/^(BTC|ETH|SOL|XRP|DOGE|BNB)/.test(raw)) {
      const apiKey = process.env.TWELVE_DATA_API_KEY;
      if (apiKey) {
        try {
          const sym = raw.slice(0, 3) + '/' + raw.slice(3);
          const r = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(sym)}&apikey=${apiKey}`);
          const j = await r.json();
          if (j && j.price) return res.json({ symbol: sym, price: +j.price, source: 'TwelveData REST', ts: Date.now() });
        } catch { /* fall through */ }
      }
      const p = await yahooV8Quote(raw + '=X');
      if (p != null) return res.json({ symbol: raw, price: +p, source: 'Yahoo FX', ts: Date.now() });
    }
    // 3) Everything else — Yahoo v8
    let yf = raw;
    if (/^(BTC|ETH|SOL|XRP|DOGE|BNB)/.test(raw)) yf = raw.replace('USD', '') + '-USD';
    else if (raw === 'NIFTY' || raw === 'NIFTY50') yf = '^NSEI';
    else if (raw === 'BANKNIFTY') yf = '^NSEBANK';
    else if (raw === 'SENSEX') yf = '^BSESN';
    else if (!yf.includes('.') && !yf.startsWith('^')) yf += '.NS';
    const p = await yahooV8Quote(yf);
    if (p != null) return res.json({ symbol: raw, price: +p, source: 'Yahoo', ts: Date.now() });
    res.status(404).json({ error: 'price not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/v1/angel-price', async (req, res) => {
  const { ticker } = req.body || {};
  if (!ticker) return res.status(400).json({ error: 'Ticker is required' });
  try {
    // Angel SmartAPI auth is not wired; fall back to Yahoo live quote for now.
    let yfTicker = ticker.toUpperCase();
    if (yfTicker.includes('BANKNIFTY')) yfTicker = '^NSEBANK';
    else if (yfTicker.includes('NIFTY')) yfTicker = '^NSEI';
    else if (yfTicker.includes('SENSEX')) yfTicker = '^BSESN';
    else if (!yfTicker.includes('.') && !yfTicker.startsWith('^')) yfTicker += '.NS';
    const q = await yahooFinance.quote(yfTicker);
    if (!q || !q.regularMarketPrice) return res.status(404).json({ status: 'error', message: 'Price not found' });
    res.json({
      status: 'success',
      ticker: ticker.toUpperCase(),
      price: q.regularMarketPrice,
      timestamp: new Date().toISOString(),
      source: 'Yahoo (Angel stub)',
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
// SCANNER (NIFTY 50 subset)
// ────────────────────────────────────────────────────────────────
const nifty50 = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'TCS',
  'INFY', 'AXISBANK', 'ITC', 'LT', 'BAJFINANCE',
  'KOTAKBANK', 'HINDUNILVR', 'MARUTI', 'TITAN', 'ASIANPAINT',
];

app.get('/api/v1/scanner', async (req, res) => {
  try {
    const nifty = await yahooFinance.chart('^NSEI', {
      period1: Math.floor(Date.now() / 1000) - 86400 * 5,
      interval: '1d',
    });
    const q = nifty.quotes.filter(x => x.close);
    const niftyChange = q.length >= 2 ? ((q.at(-1).close - q.at(-2).close) / q.at(-2).close) * 100 : 0;
    const scans = [];
    for (const stock of nifty50) {
      try {
        const signal = await generateStockSignal(stock, 'AGGRESSIVE', 'REALTIME', niftyChange);
        scans.push(signal);
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.log(`${stock} failed`, e.message);
      }
    }
    const results = scans.filter(s => s.status_label === 'TRADE' || s.status_label === 'WATCHLIST');
    results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
// FOREX ENGINE — routes registered by forex.js
// ────────────────────────────────────────────────────────────────
forexState = require('./forex')(app, { fetch, EMA, RSI, ATR, SMA, scalping, yahooFinance });

// Error handler
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON payload' });
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Tredways Engine v2 LIVE on :${port}`);
  console.log('📡 Stock: /api/v1/analyze /api/v1/scanner /api/v1/angel-price');
  console.log('📡 Forex: /api/v1/analyze-forex /api/v1/analyze-forex-scalp /api/v1/chart-data');
  console.log('📡 Util:  /ping /api/v1/stats /api/v1/upload-chart');
});
