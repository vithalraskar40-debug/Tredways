import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SMCChart from './SMCChart';
import OpportunityTicker from './OpportunityTicker';
import { analyzeStock, analyzeForex, getHealth, getScanner } from './api';
import {
  saveTrade, getAllTrades, updateTradeOutcome, clearAllTrades,
  computeStats, checkOpenTradesLive, hasSimilarOpenTrade,
} from './tradeHistory';

const TABS = [
  { id: 'STOCKS', label: 'INDIAN STOCKS' },
  { id: 'FOREX',  label: 'FOREX / CRYPTO' },
  { id: 'CONFIRM', label: 'CONFIRM TRADE' },
  { id: 'ACCURACY', label: 'ACCURACY TRACKER' },
  { id: 'SCANNER', label: 'SCANNER' },
];

export default function App() {
  const [tab, setTab] = useState('STOCKS');
  const [nodeStatus, setNodeStatus] = useState('unknown');

  // Cross-screen state
  const [pair, setPair] = useState('');
  const [ticker, setTicker] = useState('');
  const [signal, setSignal] = useState(null);            // current backend signal (Stocks/Forex)
  const [chartSignal, setChartSignal] = useState(null);  // signal emitted by chart (SMC engine)
  const stabilityRef = useRef({ lastType: null, count: 0 });

  useEffect(() => {
    getHealth().then(h => setNodeStatus(h.node_backend)).catch(() => setNodeStatus('down'));
  }, []);

  // Signal debounce/hysteresis — prevents flip-flop between LONG/SHORT on every poll.
  // Only accept a new direction after it repeats for at least 2 consecutive analyses.
  const acceptSignal = useCallback((s) => {
    if (!s || !s.signal_type) { setSignal(s); return; }
    const type = s.signal_type;
    const st = stabilityRef.current;
    if (st.lastType === type) st.count += 1;
    else { st.lastType = type; st.count = 1; }
    if (type === 'NEUTRAL' || st.count >= 2) {
      setSignal(s);
      // 🤖 AUTO-LOG: if the stable signal is a TRADE, log it to the Accuracy Tracker
      // (deduped by pair+direction+entry so we don't log the same setup repeatedly).
      const isTrade = s.state === 'TRADE' || s.status_label === 'TRADE';
      if (isTrade && s.entry != null && s.sl != null && (s.tp1 != null || s.tp != null)) {
        if (!hasSimilarOpenTrade({ pair: s.pair || s.ticker, signal_type: type, entry: s.entry })) {
          saveTrade(s, { source: 'AUTO' });
        }
      }
    } else {
      // Keep old signal but update price/status labels
      setSignal(prev => prev ? { ...prev, current_price: s.current_price, reason_summary: prev.reason_summary } : s);
    }
  }, []);

  // 🤖 Auto-log signals emitted by the ChartWithZones SMC engine.
  const acceptChartSignal = useCallback((s) => {
    setChartSignal(s);
    if (!s) return;
    if (s.entry != null && s.sl != null && (s.tp1 != null)) {
      if (!hasSimilarOpenTrade({ pair: s.pair, signal_type: s.signal_type, entry: s.entry })) {
        saveTrade({
          ...s,
          strategy: 'SMC',
          mode: 'SMC',
        }, { source: 'CHART_AUTO' });
      }
    }
  }, []);

  return (
    <div className="app" data-testid="app-root">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          Tredways <span className="pro">SMC</span>
        </div>
        <div className="status-pill" data-testid="node-status">
          <span className="live-dot" /> Engine {nodeStatus.toUpperCase()}
        </div>
      </div>

      <OpportunityTicker onPick={(o) => {
        const isFx = /USD|EUR|GBP|JPY|AUD|GOLD|XAU|BTC|ETH|SOL|XRP/.test(o.symbol);
        if (isFx) {
          setPair(o.symbol);
          setTab('FOREX');
        } else {
          setTicker(o.symbol);
          setTab('STOCKS');
        }
      }} />

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="content">
        {tab === 'STOCKS'   && <StocksScreen pair={ticker} setPair={setTicker} signal={signal} setSignal={acceptSignal} setChartSignal={acceptChartSignal} goToConfirm={() => setTab('CONFIRM')} />}
        {tab === 'FOREX'    && <ForexScreen  pair={pair} setPair={setPair} signal={signal} setSignal={acceptSignal} setChartSignal={acceptChartSignal} goToConfirm={() => setTab('CONFIRM')} />}
        {tab === 'CONFIRM'  && <ConfirmScreen signal={chartSignal || signal} />}
        {tab === 'ACCURACY' && <AccuracyScreen />}
        {tab === 'SCANNER'  && <ScannerScreen />}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   STOCKS SCREEN — Indian stocks / indices
   ──────────────────────────────────────────────────────────── */
function StocksScreen({ pair, setPair, signal, setSignal, setChartSignal, goToConfirm }) {
  const [mode, setMode] = useState('STRICT');
  const [ds, setDs] = useState('REALTIME');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runAnalyze = useCallback(async (silent = false) => {
    if (!pair) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await analyzeStock(pair.toUpperCase().trim(), mode, ds);
      setSignal(data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [pair, mode, ds, setSignal]);

  // Auto-refresh every 8s (silent, only updates via hysteresis)
  useEffect(() => {
    if (!signal) return;
    const t = setInterval(() => runAnalyze(true), 8000);
    return () => clearInterval(t);
  }, [signal, runAnalyze]);

  return (
    <div className="layout">
      <div>
        <div className="card">
          <div className="card-title">Analyze Indian Stock</div>
          <input
            className="input"
            placeholder="e.g. RELIANCE, TCS, NIFTY, BANKNIFTY"
            value={pair}
            onChange={e => setPair(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runAnalyze(false)}
            data-testid="stock-ticker-input"
          />
          <div className="mode-row" role="tablist">
            {['STRICT', 'AGGRESSIVE', 'SCALP'].map(m => (
              <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)} data-testid={`mode-${m}`}>{m}</button>
            ))}
          </div>
          <div className="chip-row">
            {['REALTIME', 'YAHOO'].map(x => (
              <button key={x} className={`chip ${ds === x ? 'active' : ''}`} onClick={() => setDs(x)} data-testid={`ds-${x}`}>{x}</button>
            ))}
          </div>
          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={loading || !pair}
            onClick={() => runAnalyze(false)}
            data-testid="analyze-stock-btn"
          >{loading ? 'ANALYZING…' : `ANALYZE ${mode}`}</button>
          {error && <div className="reason-row" style={{ color: '#f87171', marginTop: 10 }}>{error}</div>}
        </div>

        <SignalCard signal={signal} onExecute={goToConfirm} />
      </div>

      <div>
        {pair
          ? <SMCChart pair={pair} onSignal={setChartSignal} />
          : <div className="empty"><div className="ico">📊</div><div className="t">No stock selected</div><div className="s">Enter a ticker like RELIANCE, TCS, NIFTY to see the SMC chart with Accumulation, Manipulation and Distribution zones.</div></div>
        }
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   FOREX SCREEN
   ──────────────────────────────────────────────────────────── */
function ForexScreen({ pair, setPair, signal, setSignal, setChartSignal, goToConfirm }) {
  const [mode, setMode] = useState('STRICT');
  const [ds, setDs] = useState('REALTIME');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runAnalyze = useCallback(async (silent = false) => {
    if (!pair) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await analyzeForex(pair.toUpperCase().trim(), mode, ds);
      setSignal(data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [pair, mode, ds, setSignal]);

  useEffect(() => {
    if (!signal) return;
    const t = setInterval(() => runAnalyze(true), 8000);
    return () => clearInterval(t);
  }, [signal, runAnalyze]);

  return (
    <div className="layout">
      <div>
        <div className="card">
          <div className="card-title">Analyze Forex / Crypto / Gold</div>
          <input
            className="input"
            placeholder="e.g. EURUSD, GBPUSD, XAUUSD, BTCUSD"
            value={pair}
            onChange={e => setPair(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runAnalyze(false)}
            data-testid="forex-pair-input"
          />
          <div className="mode-row">
            {['STRICT', 'SCALP'].map(m => (
              <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)} data-testid={`fx-mode-${m}`}>{m}</button>
            ))}
          </div>
          <div className="chip-row">
            {['REALTIME', 'YAHOO'].map(x => (
              <button key={x} className={`chip ${ds === x ? 'active' : ''}`} onClick={() => setDs(x)} data-testid={`fx-ds-${x}`}>{x}</button>
            ))}
          </div>
          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={loading || !pair}
            onClick={() => runAnalyze(false)}
            data-testid="analyze-forex-btn"
          >{loading ? 'ANALYZING…' : `ANALYZE ${mode}`}</button>
          {error && <div className="reason-row" style={{ color: '#f87171', marginTop: 10 }}>{error}</div>}
        </div>

        <SignalCard signal={signal} onExecute={goToConfirm} />
      </div>

      <div>
        {pair
          ? <SMCChart pair={pair} onSignal={setChartSignal} />
          : <div className="empty"><div className="ico">💱</div><div className="t">No pair selected</div><div className="s">Enter EURUSD, XAUUSD (Gold), BTCUSD to see the Liquidity Grab & Retest setup overlay.</div></div>
        }
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Reusable Signal Card
   ──────────────────────────────────────────────────────────── */
function SignalCard({ signal, onExecute }) {
  if (!signal) return null;
  const t = signal.signal_type || 'WAIT';
  const isTrade = signal.state === 'TRADE' || signal.status_label === 'TRADE';
  return (
    <div className="signal card" data-testid="signal-card">
      <div className="signal-head">
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}>
            {(signal.pair || signal.ticker || '').toUpperCase()}
          </div>
          <div className="small">{signal.reason_summary || signal.entry_type || '—'}</div>
        </div>
        <span className={`badge ${t}`}>{t}</span>
      </div>
      <div className="signal-body">
        {isTrade ? (
          <>
            <div className="level-grid">
              <div className="level entry"><div className="lbl">ENTRY</div><div className="val mono">{fmt(signal.entry)}</div></div>
              <div className="level sl"><div className="lbl">SL</div><div className="val mono" style={{ color: 'var(--short)' }}>{fmt(signal.sl)}</div></div>
              <div className="level tp"><div className="lbl">TP1</div><div className="val mono" style={{ color: 'var(--long)' }}>{fmt(signal.tp1 ?? signal.tp)}</div></div>
              {signal.tp2 != null && <div className="level tp"><div className="lbl">TP2</div><div className="val mono" style={{ color: 'var(--long)' }}>{fmt(signal.tp2)}</div></div>}
              {signal.tp3 != null && <div className="level tp"><div className="lbl">TP3</div><div className="val mono" style={{ color: 'var(--long)' }}>{fmt(signal.tp3)}</div></div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 12 }}>
              <div className="small">
                Grade: <b style={{ color: 'var(--accent)' }}>{signal.grade || signal.confidence_text || '—'}</b>{' '}
                R:R {signal.rr_ratio || '—'}
              </div>
              <button className="btn primary" onClick={onExecute} data-testid="goto-confirm-btn">CONFIRM TRADE →</button>
            </div>
          </>
        ) : (
          <div className="reason-row">
            {signal.reason_summary || 'Waiting for setup…'} · Price {fmt(signal.current_price)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   CONFIRM SCREEN
   ──────────────────────────────────────────────────────────── */
function ConfirmScreen({ signal }) {
  const [note, setNote] = useState('');
  const [logged, setLogged] = useState(false);

  const isReady = signal && signal.entry != null && signal.sl != null && (signal.tp1 != null || signal.tp != null);
  const t = signal?.signal_type || signal?.direction || 'WAIT';
  const isLong = t === 'LONG';

  const risk = isReady ? Math.abs(signal.entry - signal.sl) : 0;
  const reward = isReady ? Math.abs((signal.tp3 ?? signal.tp2 ?? signal.tp1 ?? signal.tp) - signal.entry) : 0;
  const rr = risk > 0 ? (reward / risk).toFixed(2) : '—';

  const handleExecute = () => {
    if (!isReady) return;
    saveTrade(signal, { source: signal.source || 'MANUAL' });
    setLogged(true);
    setTimeout(() => setLogged(false), 3000);
  };

  if (!isReady) {
    return (
      <div className="empty" data-testid="confirm-empty">
        <div className="ico">⚠️</div>
        <div className="t">No confirmed setup</div>
        <div className="s">
          Open the STOCKS or FOREX tab, enter a symbol, and wait for the ChartWithZones engine to detect a
          Liquidity Grab & Retest setup. When confirmed, come back here to execute.
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="confirm-card" style={{ maxWidth: 700, margin: '0 auto' }}>
      <div className="card-title">Trade Execution · {(signal.pair || '').toUpperCase()}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span className={`badge ${t}`}>{isLong ? '▲ ' : '▼ '}{t}</span>
        <span className="small">
          Source: {signal.source === 'CHART' ? '📊 CHART · SMC Engine' : '🔗 API Signal'}
          {signal.phase && <> · Phase: <b>{signal.phase}</b></>}
          {signal.retest_confirmed && <> · <span style={{ color: 'var(--long)' }}>RETEST CONFIRMED</span></>}
        </span>
      </div>

      <div className="level-grid">
        <div className="level entry"><div className="lbl">ENTRY</div><div className="val mono">{fmt(signal.entry)}</div></div>
        <div className="level sl"><div className="lbl">SL</div><div className="val mono" style={{ color: 'var(--short)' }}>{fmt(signal.sl)}</div></div>
        <div className="level tp"><div className="lbl">TP1</div><div className="val mono" style={{ color: 'var(--long)' }}>{fmt(signal.tp1 ?? signal.tp)}</div></div>
        {signal.tp2 != null && <div className="level tp"><div className="lbl">TP2</div><div className="val mono" style={{ color: 'var(--long)' }}>{fmt(signal.tp2)}</div></div>}
        {signal.tp3 != null && <div className="level tp"><div className="lbl">TP3</div><div className="val mono" style={{ color: 'var(--long)' }}>{fmt(signal.tp3)}</div></div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
        <div className="stat"><div className="k">RISK</div><div className="v short">{fmt(risk)}</div></div>
        <div className="stat"><div className="k">REWARD</div><div className="v long">{fmt(reward)}</div></div>
        <div className="stat"><div className="k">R:R</div><div className="v amber">1:{rr}</div></div>
      </div>

      {signal.reasons?.length ? (
        <div style={{ marginTop: 16 }}>
          <div className="card-title">Setup Confluences</div>
          {signal.reasons.map((r, i) => (
            <div key={i} className="small" style={{ padding: '4px 0' }}>✓ {r}</div>
          ))}
        </div>
      ) : null}

      <textarea
        className="input"
        placeholder="Trade notes (optional)…"
        rows={2}
        style={{ marginTop: 12, resize: 'vertical' }}
        value={note}
        onChange={e => setNote(e.target.value)}
        data-testid="confirm-note"
      />

      <button
        className={`btn ${isLong ? 'long' : 'short'}`}
        style={{ width: '100%', marginTop: 12, padding: '16px' }}
        onClick={handleExecute}
        data-testid="execute-trade-btn"
      >
        {isLong ? '▲ EXECUTE BUY & LOG TO TRACKER' : '▼ EXECUTE SELL & LOG TO TRACKER'}
      </button>

      {logged && (
        <div className="reason-row" style={{ background: 'rgba(34,197,94,.10)', borderColor: 'rgba(34,197,94,.4)', color: 'var(--long)', marginTop: 12 }}>
          ✓ Trade logged to Accuracy Tracker. Check the ACCURACY tab.
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   ACCURACY TRACKER  — NO auto-trade; only manual confirms
   ──────────────────────────────────────────────────────────── */
function AccuracyScreen() {
  const [trades, setTrades] = useState([]);
  const [strategyFilter, setStrategyFilter] = useState('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState('ALL');
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState(null);

  const reload = useCallback(() => setTrades(getAllTrades()), []);
  useEffect(reload, [reload]);

  const stats = useMemo(() => computeStats(trades, strategyFilter), [trades, strategyFilter]);

  const filtered = trades.filter(t => {
    if (strategyFilter !== 'ALL' && t.strategy !== strategyFilter) return false;
    if (outcomeFilter === 'ALL') return true;
    if (outcomeFilter === 'OPEN') return t.outcome === 'OPEN';
    if (outcomeFilter === 'WIN')  return t.outcome === 'WIN'  || t.outcome === 'MANUAL_WIN';
    if (outcomeFilter === 'LOSS') return t.outcome === 'LOSS' || t.outcome === 'MANUAL_LOSS';
    return true;
  });

  const checkOutcomes = async () => {
    setChecking(true);
    try {
      const resolved = await checkOpenTradesLive(async (p) => {
        try {
          const clean = p.toUpperCase().replace(/[-/_]/g, '');
          const isCrypto = /BTC|ETH|SOL|XRP|DOGE|BNB/.test(clean);
          const isGold = /GOLD|XAU/.test(clean);
          let yf;
          if (isGold) yf = 'GC=F';
          else if (isCrypto) yf = clean.replace('USD', '') + '-USD';
          else if (clean.length === 6) yf = clean + '=X';
          else yf = clean + '.NS';
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yf}?interval=1m&range=1d`;
          const r = await fetch(url);
          const j = await r.json();
          return j?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
        } catch { return null; }
      });
      reload();
      setMsg(resolved.length
        ? resolved.map(r => `${r.pair}: ${r.outcome} @ ${fmt(r.closePrice)}`).join(' · ')
        : 'No open trades hit their TP or SL yet.');
    } finally {
      setChecking(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  const setManual = (id, outcome) => { updateTradeOutcome(id, outcome); reload(); };
  const clearAll = () => {
    if (window.confirm('Delete entire trade history?')) { clearAllTrades(); reload(); }
  };

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Accuracy Tracker</div>
            <div className="small">
              🤖 <b style={{ color: 'var(--accent)' }}>Auto-logging is ACTIVE.</b> Every BUY / SELL signal from the analyze
              engine (Stocks + Forex) and the SMC chart engine is logged here automatically so you can
              measure the app&apos;s accuracy and profit (in R multiples). Duplicate setups are deduped.
            </div>
          </div>
          <button className="btn ghost" onClick={clearAll} data-testid="clear-history-btn">🗑 Clear</button>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="empty" data-testid="accuracy-empty">
          <div className="ico">📭</div>
          <div className="t">Waiting for the first signal…</div>
          <div className="s">The tracker auto-logs each BUY / SELL signal as soon as the analyze engine or the SMC chart confirms one. Open STOCKS or FOREX and start an analysis.</div>
        </div>
      ) : (
        <>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className={`win-circle ${stats.winRate >= 60 ? 'good' : stats.winRate < 45 ? 'bad' : ''}`}>
              <div className="pct" data-testid="win-rate">{stats.winRate}%</div>
              <div className="lbl">WIN RATE · {stats.total} trades</div>
            </div>
            <div className="stat-grid">
              <div className="stat"><div className="k">WINS</div><div className="v long" data-testid="stat-wins">{stats.wins}</div></div>
              <div className="stat"><div className="k">LOSSES</div><div className="v short" data-testid="stat-losses">{stats.losses}</div></div>
              <div className="stat"><div className="k">OPEN</div><div className="v amber">{stats.open}</div></div>
              <div className="stat"><div className="k">AVG R:R</div><div className="v amber">{stats.avgRR}</div></div>
              <div className="stat"><div className="k">PROFIT (R)</div><div className={`v ${Number(stats.profitR) >= 0 ? 'long' : 'short'}`} data-testid="stat-profit">{Number(stats.profitR) >= 0 ? '+' : ''}{stats.profitR}R</div></div>
            </div>

            <button className="btn primary" style={{ marginTop: 16, width: '100%' }} disabled={checking} onClick={checkOutcomes} data-testid="check-outcomes-btn">
              {checking ? '⏳ Checking live prices…' : '🔍 Auto-check Open Trades'}
            </button>
            {msg && <div className="reason-row" style={{ marginTop: 12 }}>{msg}</div>}
          </div>

          <div className="card">
            <div className="chip-row">
              <span className="small" style={{ alignSelf: 'center', marginRight: 6 }}>Strategy:</span>
              {['ALL', 'SCALP', 'SWING', 'STRICT', 'AGGRESSIVE'].map(f => (
                <button key={f} className={`chip ${strategyFilter === f ? 'active' : ''}`} onClick={() => setStrategyFilter(f)}>{f}</button>
              ))}
            </div>
            <div className="chip-row">
              <span className="small" style={{ alignSelf: 'center', marginRight: 6 }}>Outcome:</span>
              {['ALL', 'OPEN', 'WIN', 'LOSS'].map(f => (
                <button key={f} className={`chip ${outcomeFilter === f ? 'active' : ''}`} onClick={() => setOutcomeFilter(f)}>{f}</button>
              ))}
            </div>

            <div style={{ marginTop: 8 }}>
              {filtered.map(t => (
                <div key={t.id} className="trade-row" data-testid={`trade-${t.id}`}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{t.pair}</div>
                    <span className={`badge ${t.signal_type}`} style={{ fontSize: 10, padding: '2px 6px' }}>{t.signal_type === 'LONG' ? '▲' : '▼'} {t.strategy}</span>
                  </div>
                  <div className="small mono">
                    E {fmt(t.entry)} · TP {fmt(t.tp1)} · SL {fmt(t.sl)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`trade-outcome ${t.outcome}`}>{outcomeLabel(t.outcome)}</span>
                    {t.outcome === 'OPEN' && (
                      <>
                        <button className="chip" style={{ color: 'var(--long)' }} onClick={() => setManual(t.id, 'MANUAL_WIN')} data-testid={`win-${t.id}`}>W</button>
                        <button className="chip" style={{ color: 'var(--short)' }} onClick={() => setManual(t.id, 'MANUAL_LOSS')} data-testid={`loss-${t.id}`}>L</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {!filtered.length && <div className="small" style={{ textAlign: 'center', padding: 20 }}>No trades match this filter.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   SCANNER (NIFTY 50 subset)
   ──────────────────────────────────────────────────────────── */
function ScannerScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true); setError(null);
    try { setRows(await getScanner()); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>NIFTY 50 Scanner</div>
          <div className="small">Scan the top NSE stocks for SMC setups.</div>
        </div>
        <button className="btn primary" onClick={run} disabled={loading} data-testid="scan-btn">{loading ? 'SCANNING…' : 'RUN SCAN'}</button>
      </div>
      {error && <div className="card"><div className="reason-row" style={{ color: '#f87171' }}>{error}</div></div>}
      {rows.map((s, i) => (
        <div key={s.ticker + i} className="card">
          <SignalCard signal={s} onExecute={() => {}} />
        </div>
      ))}
    </div>
  );
}

/* ── utils ── */
function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  if (Math.abs(n) < 1) return n.toFixed(5);
  if (Math.abs(n) < 100) return n.toFixed(4);
  if (Math.abs(n) < 10000) return n.toFixed(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function outcomeLabel(o) {
  if (o === 'WIN' || o === 'MANUAL_WIN') return '✓ WIN';
  if (o === 'LOSS' || o === 'MANUAL_LOSS') return '✗ LOSS';
  return '● OPEN';
}
