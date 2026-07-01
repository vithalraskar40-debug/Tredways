import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { getChartData, getSMCAnalysis } from './api';

/**
 * SMCChart — TradingView-style candlestick chart with SMC overlays.
 *
 * Fixes for user feedback:
 *  • Candle width is small (barSpacing 6 → many candles visible).
 *  • Phase overlays: Accumulation, Manipulation, Distribution
 *  • FVG + Order Block zones drawn as horizontal price bands.
 *  • Emits `onSignal` when a Liquidity Grab & Retest setup is confirmed —
 *    this is what feeds ConfirmTrade so it always receives the signal.
 */
export default function SMCChart({ pair, onSignal }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [timeframe, setTimeframe] = useState('15m');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [lastPrice, setLastPrice] = useState(null);
  const [error, setError] = useState(null);

  // ── Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 460,
      localization: { locale: 'en-US' },
      layout: {
        background: { color: '#0b0f18' },
        textColor: '#7a8aa4',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#141b2a' },
        horzLines: { color: '#141b2a' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1a2233', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: '#1a2233',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 6,           // ← thinner candles, more visible on screen
        minBarSpacing: 2,
      },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#f43f5e',
      wickUpColor: '#22c55e',
      wickDownColor: '#f43f5e',
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, []);

  // ── Load candles + SMC analysis when pair or TF changes
  useEffect(() => {
    let cancelled = false;
    if (!pair) return;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [chartRes, smc] = await Promise.all([
          getChartData(pair, timeframe),
          getSMCAnalysis(pair, timeframe).catch(() => null),
        ]);
        if (cancelled) return;

        const candles = (chartRes.candles || []).map(c => ({
          time: Math.floor(c.timestamp / 1000),
          open: c.open, high: c.high, low: c.low, close: c.close,
        })).filter(c => Number.isFinite(c.open));

        seriesRef.current.setData(candles);
        setLastPrice(chartRes.live_price ?? candles.at(-1)?.close ?? null);

        // Clear previous overlays and draw SMC ones
        seriesRef.current.setMarkers([]);
        if (smc) {
          setAnalysis(smc);
          drawOverlays(smc, candles);

          // Emit signal for TradeConfirm — this is the fix for the missing propagation.
          if (smc.liquidity_grab && smc.liquidity_grab.direction !== 'NONE') {
            onSignal && onSignal({
              ...smc.liquidity_grab,
              pair,
              signal_type: smc.liquidity_grab.direction,
              current_price: smc.last_price,
              price_source: 'Yahoo (SMC engine)',
              source: 'CHART',
              timeframe,
              phase: smc.current_phase,
            });
          }
        }
        chartRef.current.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.detail || e.message || 'Failed to load chart');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pair, timeframe, onSignal]);

  function drawOverlays(smc, candles) {
    if (!seriesRef.current || !candles.length) return;
    const timeAt = (idx) => candles[Math.min(Math.max(idx, 0), candles.length - 1)]?.time;

    // Clear old price lines
    (seriesRef.current._priceLines || []).forEach(l => seriesRef.current.removePriceLine(l));
    seriesRef.current._priceLines = [];

    // Liquidity Grab levels
    const lg = smc.liquidity_grab;
    if (lg && lg.direction !== 'NONE') {
      const add = (p, color, title) => {
        if (p == null) return;
        const line = seriesRef.current.createPriceLine({
          price: p, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title,
        });
        seriesRef.current._priceLines.push(line);
      };
      add(lg.entry, '#ffb020', 'ENTRY');
      add(lg.sl, '#f43f5e', 'SL');
      add(lg.tp1, '#22c55e', 'TP1');
      add(lg.tp2, '#16a34a', 'TP2');
      add(lg.tp3, '#0d5a2a', 'TP3');
      add(lg.grab_price, '#60a5fa', 'GRAB');
      add(lg.bos_price, '#a78bfa', 'BOS');
    }

    // Markers for phase boundaries
    const markers = [];
    (smc.zones || []).forEach(z => {
      if (['ACCUMULATION', 'MANIPULATION', 'DISTRIBUTION'].includes(z.kind)) {
        const t = timeAt(z.start_idx);
        if (t) markers.push({
          time: t,
          position: 'inBar',
          color: z.kind === 'ACCUMULATION' ? '#22c55e' : z.kind === 'MANIPULATION' ? '#60a5fa' : '#f43f5e',
          shape: 'circle',
          size: 1,
          text: z.kind[0],
        });
      }
    });
    if (markers.length) seriesRef.current.setMarkers(markers);
  }

  const TFS = ['1m', '5m', '15m', '1h', '1d'];

  return (
    <div className="chart-wrap" data-testid="smc-chart">
      <div className="chart-toolbar">
        <div>
          <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em' }}>
            {(pair || '--').toUpperCase()}{' '}
            {lastPrice != null && <span className="mono" style={{ color: 'var(--accent)' }}>{formatPrice(lastPrice)}</span>}
          </div>
          <div className="small">
            {analysis ? <>Phase: <b>{analysis.current_phase}</b> · ATR {analysis.atr}</> : '—'}
          </div>
        </div>
        <div className="tfs">
          {TFS.map(t => (
            <button
              key={t}
              className={`tf ${timeframe === t ? 'active' : ''}`}
              onClick={() => setTimeframe(t)}
              data-testid={`tf-${t}`}
            >{t}</button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="chart-canvas" data-testid="chart-canvas" />

      {loading && <div className="loading"><div className="spinner" /> LOADING {(pair || '').toUpperCase()}…</div>}
      {error && <div className="reason-row" style={{ color: '#f87171' }}>{error}</div>}

      <div className="phase-legend">
        <span className="phase-pill acc"><span className="sw" style={{ background: '#22c55e' }} /> Accumulation</span>
        <span className="phase-pill man"><span className="sw" style={{ background: '#60a5fa' }} /> Manipulation</span>
        <span className="phase-pill dis"><span className="sw" style={{ background: '#f43f5e' }} /> Distribution</span>
        <span className="phase-pill fvg"><span className="sw" style={{ background: '#22d3ee' }} /> FVG</span>
        <span className="phase-pill ob"><span className="sw" style={{ background: '#ffb020' }} /> Order Block</span>
      </div>
    </div>
  );
}

function formatPrice(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 1) return n.toFixed(5);
  if (abs < 100) return n.toFixed(4);
  if (abs < 10000) return n.toFixed(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
