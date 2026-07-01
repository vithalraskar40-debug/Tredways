// Trade history — stored in localStorage.
// Trades are ONLY logged when the user explicitly confirms via TradeConfirm.
// (AutoBot has been removed as per requirement.)

const KEY = 'TREDWAYS_TRADE_HISTORY_V2';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(t) { localStorage.setItem(KEY, JSON.stringify(t)); }

export function saveTrade(signal, extras = {}) {
  const trades = load();
  const trade = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    pair:       (signal.pair || signal.ticker || '').toUpperCase(),
    signal_type: signal.signal_type || (signal.direction || 'LONG'),
    strategy:    signal.mode || signal.strategy || 'SWING',
    entry:       Number(signal.entry),
    sl:          Number(signal.sl),
    tp1:         Number(signal.tp1 ?? signal.tp),
    tp2:         signal.tp2 != null ? Number(signal.tp2) : null,
    tp3:         signal.tp3 != null ? Number(signal.tp3) : null,
    grade:       signal.grade || signal.confidence_text || null,
    rr_ratio:    signal.rr_ratio || signal.rr || null,
    source:      extras.source || signal.entry_type || 'MANUAL',
    outcome:     'OPEN',
    close_price: null,
    closed_at:   null,
    created_at:  new Date().toISOString(),
  };
  trades.unshift(trade);
  save(trades);
  return trade;
}

export function getAllTrades() { return load(); }
export function getOpenTrades() { return load().filter(t => t.outcome === 'OPEN'); }

export function updateTradeOutcome(id, outcome, closePrice = null) {
  const trades = load();
  const i = trades.findIndex(t => t.id === id);
  if (i !== -1) {
    trades[i].outcome = outcome;
    trades[i].closed_at = new Date().toISOString();
    trades[i].close_price = closePrice;
    save(trades);
  }
}

export function clearAllTrades() { localStorage.removeItem(KEY); }

export function computeStats(trades, strategyFilter = 'ALL') {
  const filtered = strategyFilter === 'ALL' ? trades : trades.filter(t => t.strategy === strategyFilter);
  const closed = filtered.filter(t => t.outcome !== 'OPEN');
  const wins   = closed.filter(t => t.outcome === 'WIN' || t.outcome === 'MANUAL_WIN');
  const losses = closed.filter(t => t.outcome === 'LOSS' || t.outcome === 'MANUAL_LOSS');
  const open   = filtered.filter(t => t.outcome === 'OPEN');
  const winRate = closed.length ? Math.round((wins.length / closed.length) * 100) : 0;

  // Profit = sum of (R multiples for wins - losses)
  let profitR = 0;
  for (const t of wins) {
    if (t.entry && t.sl && t.tp1) {
      const risk = Math.abs(t.entry - t.sl);
      const reward = Math.abs(t.tp1 - t.entry);
      if (risk > 0) profitR += reward / risk;
    }
  }
  for (const _ of losses) profitR -= 1;

  // Streak
  let streak = 0, streakType = null;
  for (const t of closed) {
    const win = t.outcome === 'WIN' || t.outcome === 'MANUAL_WIN';
    if (streakType === null) { streakType = win ? 'WIN' : 'LOSS'; streak = 1; }
    else if ((win && streakType === 'WIN') || (!win && streakType === 'LOSS')) streak++;
    else break;
  }

  const rrs = wins.map(t => {
    if (!t.entry || !t.sl || !t.tp1) return null;
    const risk = Math.abs(t.entry - t.sl);
    const reward = Math.abs(t.tp1 - t.entry);
    return risk > 0 ? reward / risk : null;
  }).filter(v => v !== null);
  const avgRR = rrs.length ? (rrs.reduce((a, b) => a + b, 0) / rrs.length).toFixed(2) : '--';

  return {
    total: filtered.length,
    wins: wins.length,
    losses: losses.length,
    open: open.length,
    winRate,
    profitR: profitR.toFixed(2),
    streak,
    streakType,
    avgRR,
  };
}

// Check open trades against a live-price fetcher (called only on user click).
export async function checkOpenTradesLive(fetchLive) {
  const trades = getAllTrades();
  const open = trades.filter(t => t.outcome === 'OPEN');
  if (!open.length) return [];
  const resolved = [];
  const byPair = {};
  for (const t of open) (byPair[t.pair] ??= []).push(t);
  for (const [pair, arr] of Object.entries(byPair)) {
    const price = await fetchLive(pair);
    if (price == null) continue;
    for (const t of arr) {
      if (!t.entry || !t.sl || !t.tp1) continue;
      const isLong = t.signal_type === 'LONG';
      let outcome = null;
      if (isLong) {
        if (price >= t.tp1) outcome = 'WIN';
        else if (price <= t.sl) outcome = 'LOSS';
      } else {
        if (price <= t.tp1) outcome = 'WIN';
        else if (price >= t.sl) outcome = 'LOSS';
      }
      if (outcome) {
        updateTradeOutcome(t.id, outcome, price);
        resolved.push({ id: t.id, pair, outcome, closePrice: price });
      }
    }
  }
  return resolved;
}
