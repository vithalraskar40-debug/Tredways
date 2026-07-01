// ─── tradeHistory.js ─────────────────────────────────────────────────────────
// Stores trade signals with their outcome (OPEN / WIN / LOSS / MANUAL_WIN / MANUAL_LOSS)
// Uses localStorage (available on Expo Web).
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'TRENDWAY_TRADE_HISTORY';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(trades) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch {}
}

/** Save a new trade signal. Returns the stored trade object with a generated id. */
export function saveTrade(signal) {
  const trades = load();
  const trade = {
    id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    pair:        (signal.pair || '').toUpperCase(),
    signal_type: signal.signal_type || 'LONG',   // LONG | SHORT
    strategy:    signal.strategy || 'SWING',     // SCALP | SWING
    is_auto:     signal.is_auto || false,        // true if AutoBot took it
    entry:       signal.entry,
    sl:          signal.sl,
    tp1:         signal.tp1,
    tp2:         signal.tp2,
    tp3:         signal.tp3,
    grade:       signal.grade || null,
    rr_ratio:    signal.rr_ratio || null,
    entry_type:  signal.entry_type || null,
    outcome:     'OPEN',           // OPEN | WIN | LOSS | MANUAL_WIN | MANUAL_LOSS
    closed_at:   null,
    close_price: null,
    created_at:  new Date().toISOString(),
  };
  trades.unshift(trade);
  save(trades);
  return trade;
}

/** Update a trade's outcome by id */
export function updateTradeOutcome(id, outcome, closePrice = null) {
  const trades = load();
  const idx = trades.findIndex(t => t.id === id);
  if (idx !== -1) {
    trades[idx].outcome     = outcome;
    trades[idx].closed_at   = new Date().toISOString();
    trades[idx].close_price = closePrice;
    save(trades);
  }
}

/** Get all trades (newest first) */
export function getAllTrades() {
  return load();
}

/** Get all OPEN trades */
export function getOpenTrades() {
  return load().filter(t => t.outcome === 'OPEN');
}

/** Clear all trades */
export function clearAllTrades() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Compute summary stats */
export function computeStats(trades, filterStrategy = 'ALL') {
  let filteredTrades = trades;
  if (filterStrategy !== 'ALL') {
    filteredTrades = trades.filter(t => t.strategy === filterStrategy);
  }

  const closed  = filteredTrades.filter(t => t.outcome !== 'OPEN');
  const wins    = closed.filter(t => t.outcome === 'WIN' || t.outcome === 'MANUAL_WIN');
  const losses  = closed.filter(t => t.outcome === 'LOSS' || t.outcome === 'MANUAL_LOSS');
  const open    = filteredTrades.filter(t => t.outcome === 'OPEN');

  const winRate = closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0;

  // Streak: count from newest closed trade
  let streak = 0;
  let streakType = null;
  for (const t of closed) {
    const isWin = t.outcome === 'WIN' || t.outcome === 'MANUAL_WIN';
    if (streakType === null) {
      streakType = isWin ? 'WIN' : 'LOSS';
      streak = 1;
    } else if ((isWin && streakType === 'WIN') || (!isWin && streakType === 'LOSS')) {
      streak++;
    } else {
      break;
    }
  }

  // Avg R:R
  const rrValues = wins
    .map(t => {
      if (t.entry && t.sl && t.tp1) {
        const risk   = Math.abs(t.entry - t.sl);
        const reward = Math.abs(t.tp1 - t.entry);
        return risk > 0 ? reward / risk : null;
      }
      return null;
    })
    .filter(v => v !== null);

  const avgRR = rrValues.length > 0
    ? (rrValues.reduce((a, b) => a + b, 0) / rrValues.length).toFixed(2)
    : '--';

  return { total: filteredTrades.length, wins: wins.length, losses: losses.length, open: open.length, winRate, streak, streakType, avgRR };
}
