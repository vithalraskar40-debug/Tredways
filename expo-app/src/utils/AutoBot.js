import Config from '../config';
import { getOpenTrades, saveTrade } from './tradeHistory';
import { checkOpenTrades } from './outcomeChecker';

const API_URL = Config.API_URL;
let autoBotInterval = null;

// The pairs and modes to track
const TARGETS = [
  { pair: 'BTCUSD', mode: 'SCALP' },
  { pair: 'BTCUSD', mode: 'SWING' },
  { pair: 'GOLD', mode: 'SCALP' },
  { pair: 'GOLD', mode: 'SWING' }
];

export async function runAutoBotCycle() {
  try {
    // 1. Resolve existing open trades
    await checkOpenTrades();

    // 2. Fetch new trades if no open trade exists for a target
    const openTrades = getOpenTrades();

    for (const target of TARGETS) {
      // Check if we already have an open trade for this exact pair and strategy
      const hasOpen = openTrades.some(
        t => t.pair.replace(/[^A-Z]/g, '') === target.pair.replace(/[^A-Z]/g, '') &&
             t.strategy === target.mode
      );

      if (!hasOpen) {
        // Fetch new signal
        const endpoint = target.mode === 'SCALP' ? '/api/v1/analyze-forex-scalp' : '/api/v1/analyze-forex';
        const res = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pair: target.pair, mode: target.mode, dataSource: 'REALTIME' })
        });

        if (res.ok) {
          const signal = await res.json();
          if (signal && signal.state === 'TRADE') {
            console.log(`[AutoBot] Found new TRADE for ${target.pair} ${target.mode}`);
            saveTrade({ ...signal, is_auto: true, strategy: target.mode, pair: target.pair });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[AutoBot] Cycle failed', err);
  }
}

export function startAutoBot(intervalMs = 60000) {
  if (autoBotInterval) return;
  console.log(`[AutoBot] Started tracking (interval: ${intervalMs}ms)`);
  
  // Run immediately, then on interval
  runAutoBotCycle();
  autoBotInterval = setInterval(runAutoBotCycle, intervalMs);
}

export function stopAutoBot() {
  if (autoBotInterval) {
    clearInterval(autoBotInterval);
    autoBotInterval = null;
    console.log('[AutoBot] Stopped');
  }
}

export function isAutoBotRunning() {
  return autoBotInterval !== null;
}
