// ─── outcomeChecker.js ───────────────────────────────────────────────────────
// Checks open trades against live Yahoo Finance prices to auto-resolve WIN/LOSS.
// ─────────────────────────────────────────────────────────────────────────────

import Config from '../config';
import { getAllTrades, updateTradeOutcome } from './tradeHistory';

const API_URL = Config.API_URL;

/**
 * Fetch the current live price for a given forex/crypto pair via the node backend.
 * Returns null on failure.
 */
export async function fetchLivePrice(pair) {
  try {
    const cleanPair = pair.toUpperCase().replace(/[-/_]/g, '');

    // Try Yahoo Finance endpoint (same as TradeZonesChart)
    const isCrypto = /BTC|ETH|SOL|XRP|DOGE|BNB/.test(cleanPair);
    const yahooSym = isCrypto ? `${cleanPair}-USD` : `${cleanPair}=X`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1m&range=1d`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

/**
 * Check all OPEN trades and auto-resolve those that have hit TP1 or SL.
 * Returns array of resolved trade objects { id, outcome, closePrice }.
 */
export async function checkOpenTrades() {
  const trades = getAllTrades();
  const open   = trades.filter(t => t.outcome === 'OPEN');
  if (open.length === 0) return [];

  const resolved = [];

  // Group by pair to minimize fetches
  const byPair = {};
  for (const t of open) {
    if (!byPair[t.pair]) byPair[t.pair] = [];
    byPair[t.pair].push(t);
  }

  for (const [pair, pairTrades] of Object.entries(byPair)) {
    const livePrice = await fetchLivePrice(pair);
    if (livePrice == null) continue;

    for (const trade of pairTrades) {
      const { entry, sl, tp1 } = trade;
      if (!entry || !sl || !tp1) continue;

      const isLong = trade.signal_type === 'LONG';

      let outcome = null;

      if (isLong) {
        if (livePrice >= tp1) outcome = 'WIN';
        else if (livePrice <= sl) outcome = 'LOSS';
      } else {
        // SHORT: price moves down = win, price moves up = loss
        if (livePrice <= tp1) outcome = 'WIN';
        else if (livePrice >= sl) outcome = 'LOSS';
      }

      if (outcome) {
        updateTradeOutcome(trade.id, outcome, livePrice);
        resolved.push({ id: trade.id, pair, outcome, closePrice: livePrice });
      }
    }
  }

  return resolved;
}
