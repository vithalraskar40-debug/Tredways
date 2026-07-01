import { useEffect, useRef, useState } from 'react';
import { getOpportunities } from './api';

/**
 * OpportunityTicker — horizontally-scrolling live strip of every SMC setup
 * (A+, A, B) the engine sees across the default watchlist. Polls every 25 s.
 *
 * Click a card → jumps to the corresponding tab (Forex or Stocks) with that
 * symbol pre-loaded so the user can eyeball the chart before confirming.
 */
export default function OpportunityTicker({ onPick }) {
  const [opps, setOpps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [minGrade, setMinGrade] = useState('B');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchOnce = async (grade) => {
    try {
      setLoading(true);
      const d = await getOpportunities(grade || minGrade);
      setOpps(d.opportunities || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'scan failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOnce(minGrade);
    if (paused) return;
    timerRef.current = setInterval(() => fetchOnce(minGrade), 25000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minGrade, paused]);

  const isFxLike = (s) => /USD|EUR|GBP|JPY|AUD|GOLD|XAU|BTC|ETH|SOL|XRP/.test(s);

  const gradeColor = (g) => g === 'A+' ? '#22c55e' : g === 'A' ? '#84cc16' : '#ffb020';

  return (
    <div className="opp-ticker" data-testid="opportunity-ticker">
      <div className="opp-head">
        <div className="opp-title">
          <span className="pulse-dot" />
          <b>LIVE OPPORTUNITIES</b>
          <span className="opp-count">{opps.length}</span>
        </div>
        <div className="opp-controls">
          {['A+', 'A', 'B'].map(g => (
            <button
              key={g}
              className={`opp-grade-btn ${minGrade === g ? 'active' : ''}`}
              onClick={() => setMinGrade(g)}
              data-testid={`opp-min-${g}`}
              title={`Show ${g}+ grade setups`}
            >≥{g}</button>
          ))}
          <button
            className="opp-grade-btn"
            onClick={() => setPaused(p => !p)}
            data-testid="opp-pause"
            title={paused ? 'Resume auto-scan' : 'Pause auto-scan'}
          >{paused ? '▶' : '⏸'}</button>
          <button
            className="opp-grade-btn"
            onClick={() => fetchOnce()}
            data-testid="opp-refresh"
            title="Refresh now"
          >⟳</button>
        </div>
      </div>

      <div className="opp-strip">
        {loading && opps.length === 0 && (
          <div className="opp-empty">Scanning watchlist…</div>
        )}
        {!loading && opps.length === 0 && !error && (
          <div className="opp-empty">No setups right now — engine is watching.</div>
        )}
        {error && <div className="opp-empty err">Scan error: {error}</div>}

        {opps.map((o, i) => {
          const isLong = o.direction === 'LONG';
          return (
            <button
              key={`${o.symbol}-${o.timeframe}-${i}`}
              className={`opp-card ${isLong ? 'long' : 'short'}`}
              onClick={() => onPick && onPick(o)}
              data-testid={`opp-card-${o.symbol}-${o.timeframe}`}
              title={o.reasons?.join(' · ')}
            >
              <div className="opp-row1">
                <span className="opp-sym">{o.symbol}</span>
                <span className="opp-tf">{o.timeframe}</span>
                <span
                  className="opp-grade"
                  style={{ background: gradeColor(o.grade) }}
                >{o.grade}</span>
              </div>
              <div className="opp-row2">
                <span className={`opp-dir ${isLong ? 'long' : 'short'}`}>
                  {isLong ? '▲ LONG' : '▼ SHORT'}
                </span>
                <span className="opp-rr">R:R 1:{o.rr}</span>
              </div>
              <div className="opp-row3">
                <span className="opp-lbl">Entry</span> <b>{fmt(o.entry)}</b>
                <span className="opp-sep">·</span>
                <span className="opp-lbl">SL</span> <b style={{ color: '#f43f5e' }}>{fmt(o.sl)}</b>
                <span className="opp-sep">·</span>
                <span className="opp-lbl">TP</span> <b style={{ color: '#22c55e' }}>{fmt(o.tp2)}</b>
              </div>
              <div className="opp-row4">
                <span className="opp-lbl">Now</span> <b>{fmt(o.current_price)}</b>
                {o.retest && <span className="opp-retest">RETEST ✓</span>}
                <span className="opp-phase">{o.phase}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fmt(n) {
  if (n == null || !Number.isFinite(+n)) return '—';
  const v = +n;
  const abs = Math.abs(v);
  if (abs < 1) return v.toFixed(5);
  if (abs < 100) return v.toFixed(4);
  if (abs < 10000) return v.toFixed(2);
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
