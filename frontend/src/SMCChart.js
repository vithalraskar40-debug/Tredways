import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { getChartData, getSMCAnalysis, API } from './api';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d'];

/**
 * SMCChart — TradingView-style candles + EMA(20/50) + volume + SMC overlays.
 *
 * Features requested:
 *  • Small candles (barSpacing 4, minBarSpacing 1)
 *  • 30m timeframe added
 *  • EMA20 / EMA50 trend lines
 *  • Support / Resistance horizontal lines (from recent swings)
 *  • Volume histogram (bottom pane)
 *  • Signal blocks: green box (entry → TP zone) + red box (SL zone) with R:R label
 *  • Fullscreen toggle
 *  • Zoom in / zoom out buttons
 *  • Live-price polling every 2 s (TwelveData WS for gold, REST for FX,
 *    Yahoo for stocks/crypto) → updates last candle in real time
 */
export default function SMCChart({ pair, onSignal }) {
  const wrapRef = useRef(null);
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volRef = useRef(null);
  const ema20Ref = useRef(null);
  const ema50Ref = useRef(null);
  const supportLineRef = useRef(null);
  const resistanceLineRef = useRef(null);
  const priceLinesRef = useRef([]);
  const overlayRef = useRef(null);
  const candlesDataRef = useRef([]);

  const [timeframe, setTimeframe] = useState('15m');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const analysisRef = useRef(null);
  const [lastPrice, setLastPrice] = useState(null);
  const [liveSource, setLiveSource] = useState('');
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeDef, setActiveDef] = useState(null);  // which legend definition popover is shown

  // Close popover on outside click / escape
  useEffect(() => {
    if (!activeDef) return;
    const onKey = (e) => { if (e.key === 'Escape') setActiveDef(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDef]);

  // ── Create chart once ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
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
      rightPriceScale: {
        borderColor: '#1a2233',
        scaleMargins: { top: 0.08, bottom: 0.22 },   // leave 22 % for volume
      },
      timeScale: {
        borderColor: '#1a2233',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 4,          // ← thin candles
        minBarSpacing: 1,
        rightOffset: 8,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    candleRef.current = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#f43f5e',
      wickUpColor: '#22c55e',
      wickDownColor: '#f43f5e',
      borderVisible: false,
    });

    ema20Ref.current = chart.addLineSeries({
      color: '#ffb020', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA 20',
    });
    ema50Ref.current = chart.addLineSeries({
      color: '#22d3ee', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA 50',
    });

    // Auto-drawn diagonal trendlines (support & resistance)
    supportLineRef.current = chart.addLineSeries({
      color: 'rgba(34,197,94,0.85)', lineWidth: 2, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false, title: 'Support',
      crosshairMarkerVisible: false,
    });
    resistanceLineRef.current = chart.addLineSeries({
      color: 'rgba(244,63,94,0.85)', lineWidth: 2, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false, title: 'Resistance',
      crosshairMarkerVisible: false,
    });

    volRef.current = chart.addHistogramSeries({
      priceScaleId: 'vol',
      color: '#26334a',
      priceFormat: { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        redrawOverlay();
      }
    });
    ro.observe(containerRef.current);

    // Redraw overlay boxes on any timescale/pan change
    chart.timeScale().subscribeVisibleTimeRangeChange(redrawOverlay);

    return () => { ro.disconnect(); chart.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load candles + SMC analysis when pair or TF changes ──────
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

        const rawCandles = (chartRes.candles || [])
          .map(c => ({
            time: Math.floor(c.timestamp / 1000),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
          }))
          .filter(c => Number.isFinite(c.open));
        const candles = clipOutlierCandles(rawCandles);

        candlesDataRef.current = candles;
        candleRef.current.setData(candles);

        // Volume series
        volRef.current.setData(candles.map(c => ({
          time: c.time,
          value: c.volume || 0,
          color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(244,63,94,0.35)',
        })));

        // EMA overlays
        drawEMA(candles, 20, ema20Ref.current);
        drawEMA(candles, 50, ema50Ref.current);

        // ALWAYS draw diagonal support / resistance trendlines from swings
        // (independent of SMC endpoint success)
        drawTrendlines(candles);

        setLastPrice(chartRes.live_price ?? candles.at(-1)?.close ?? null);

        // Clear previous overlays
        clearPriceLines();
        candleRef.current.setMarkers([]);

        if (smc) {
          setAnalysis(smc);
          analysisRef.current = smc;
          drawSMC(smc, candles);

          // Emit signal for TradeConfirm
          if (smc.liquidity_grab && smc.liquidity_grab.direction !== 'NONE') {
            onSignal && onSignal({
              ...smc.liquidity_grab,
              pair,
              signal_type: smc.liquidity_grab.direction,
              current_price: smc.last_price,
              price_source: 'SMC engine',
              source: 'CHART',
              timeframe,
              phase: smc.current_phase,
            });
          }
        }

        // Fit last 120 candles into view (not the whole 300 → keeps candles reasonably wide)
        const N = Math.min(120, candles.length);
        if (N > 0) {
          const from = candles[candles.length - N].time;
          const to   = candles[candles.length - 1].time + 60;
          chartRef.current.timeScale().setVisibleRange({ from, to });
        }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.detail || e.message || 'Failed to load chart');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, timeframe]);

  // ── Live-price polling (2 s) — safely append/update the last candle
  //    so a stale Yahoo bar isn't stretched to the live TwelveData price
  //    (which would produce a fake vertical spike candle).
  useEffect(() => {
    if (!pair) return;
    let cancelled = false;

    const tfSec = tfToSeconds(timeframe);
    const MAX_SANE_JUMP_PCT = 0.02;   // 2 % — anything more than this away from the last candle
                                       // close means the last candle is stale → append instead of stretch.

    const tick = async () => {
      try {
        const r = await fetch(`${API}/live-price?symbol=${encodeURIComponent(pair)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j.price) return;
        setLastPrice(j.price);
        setLiveSource(j.source || '');

        const arr = candlesDataRef.current;
        if (!arr.length || !candleRef.current) return;

        const nowSec = Math.floor(Date.now() / 1000);
        const currentBarStart = Math.floor(nowSec / tfSec) * tfSec;
        const last = arr[arr.length - 1];
        const price = +j.price;
        const jumpPct = last.close > 0 ? Math.abs(price - last.close) / last.close : 0;

        // Case 1: we're now in a NEW bar interval (last bar has closed).
        // Case 2: last bar is stale AND price jumped > 2 % — bar is way too old, create a new one.
        const needNewBar =
          currentBarStart > last.time ||
          (jumpPct > MAX_SANE_JUMP_PCT && (nowSec - last.time) > tfSec);

        if (needNewBar) {
          const barTime = Math.max(currentBarStart, last.time + tfSec);
          const newCandle = {
            time: barTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0,
          };
          arr.push(newCandle);
          candleRef.current.update(newCandle);
        } else if (currentBarStart === last.time || nowSec - last.time < tfSec) {
          // Update the current live bar
          const updated = { ...last };
          updated.close = price;
          updated.high = Math.max(updated.high, price);
          updated.low = Math.min(updated.low, price);
          arr[arr.length - 1] = updated;
          candleRef.current.update(updated);
        }
        // else: clock skew — do nothing
      } catch { /* ignore */ }
    };

    // Periodically refetch chart-data to close gaps and prevent long-term drift.
    // IMPORTANT: merge Yahoo's response with our live-appended bars instead of
    // wiping them (otherwise the chart flickers & mixes fresh live prices with
    // stale Yahoo data → produces artifact spike/doji patterns for GOLD).
    const refetchGuard = { id: null };
    const refetchChart = async () => {
      try {
        const chartRes = await getChartData(pair, timeframe);
        if (cancelled) return;
        const fresh = (chartRes.candles || [])
          .map(c => ({
            time: Math.floor((c.timestamp ?? Date.parse(c.datetime)) / 1000),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
          }))
          .filter(c => Number.isFinite(c.time) && Number.isFinite(c.open));
        if (fresh.length < 60) return;

        // Merge: keep any live-appended bars whose time > fresh's last time
        const freshLastTime = fresh[fresh.length - 1].time;
        const existing = candlesDataRef.current || [];
        const liveTail = existing.filter(c => c.time > freshLastTime);
        let merged = [...fresh, ...liveTail];

        // Dedup by time (keep the LAST entry per time key)
        const byTime = new Map();
        for (const c of merged) byTime.set(c.time, c);
        merged = Array.from(byTime.values()).sort((a, b) => a.time - b.time);

        // Outlier filter (same helper used on initial load)
        merged = clipOutlierCandles(merged);

        candlesDataRef.current = merged;
        candleRef.current && candleRef.current.setData(merged);
        if (volRef.current) {
          volRef.current.setData(merged.map(c => ({
            time: c.time,
            value: c.volume || 0,
            color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(244,63,94,0.35)',
          })));
        }
        drawEMA(merged, 20, ema20Ref.current);
        drawEMA(merged, 50, ema50Ref.current);
        drawTrendlines(merged);
      } catch { /* ignore */ }
    };

    tick();
    const id = setInterval(tick, 2000);
    // Refetch full chart every 45 s (or ½ × timeframe for shorter TFs) to close any drift
    const refetchMs = Math.max(20000, Math.min(60000, tfSec * 500));
    refetchGuard.id = setInterval(refetchChart, refetchMs);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (refetchGuard.id) clearInterval(refetchGuard.id);
    };
  }, [pair, timeframe]);

  // ── Helpers ─────────────────────────────────────────────────
  function clearPriceLines() {
    priceLinesRef.current.forEach(l => candleRef.current && candleRef.current.removePriceLine(l));
    priceLinesRef.current = [];
  }

  function drawEMA(candles, period, series) {
    if (!series || candles.length < period) return;
    const k = 2 / (period + 1);
    let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
    const out = [{ time: candles[period - 1].time, value: ema }];
    for (let i = period; i < candles.length; i++) {
      ema = candles[i].close * k + ema * (1 - k);
      out.push({ time: candles[i].time, value: ema });
    }
    series.setData(out);
  }

  // ── Auto trendline draw  (support: swing lows | resistance: swing highs)
  function detectSwings(candles, lookback = 3) {
    const highs = [], lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      let isHigh = true, isLow = true;
      for (let j = -lookback; j <= lookback; j++) {
        if (j === 0) continue;
        if (candles[i + j].high >= candles[i].high) isHigh = false;
        if (candles[i + j].low  <= candles[i].low)  isLow  = false;
      }
      if (isHigh) highs.push({ i, price: candles[i].high, time: candles[i].time });
      if (isLow)  lows.push({ i, price: candles[i].low,  time: candles[i].time });
    }
    return { highs, lows };
  }

  function bestTrendline(pivots) {
    if (!pivots || pivots.length < 2) return null;
    // Fallback: exactly 2 pivots → straight line through them
    if (pivots.length === 2) {
      const [A, B] = pivots;
      const dx = Math.max(1, B.i - A.i);
      return { A, B, slope: (B.price - A.price) / dx, touches: 2 };
    }
    const recent = pivots.slice(-10);
    let best = null;
    for (let a = 0; a < recent.length - 1; a++) {
      for (let b = a + 1; b < recent.length; b++) {
        const A = recent[a], B = recent[b];
        const dx = B.i - A.i;
        if (dx < 3) continue;
        const slope = (B.price - A.price) / dx;
        let touches = 0;
        const tol = Math.max(A.price * 0.006, 1);   // 0.6 % tolerance (loosened)
        for (const p of recent) {
          const expected = A.price + slope * (p.i - A.i);
          if (Math.abs(p.price - expected) <= tol) touches++;
        }
        if (!best || touches > best.touches) best = { A, B, slope, touches };
      }
    }
    // Final fallback → use last two pivots
    if (!best) {
      const A = recent[recent.length - 2];
      const B = recent[recent.length - 1];
      if (A && B) {
        const dx = Math.max(1, B.i - A.i);
        best = { A, B, slope: (B.price - A.price) / dx, touches: 2 };
      }
    }
    return best;
  }

  function drawTrendlines(candles) {
    const supS = supportLineRef.current;
    const resS = resistanceLineRef.current;
    if (!supS || !resS) return;
    supS.setData([]);
    resS.setData([]);
    if (candles.length < 15) return;
    // Try progressively tighter lookback to guarantee we find pivots
    let highs = [], lows = [];
    for (const lb of [3, 2, 1]) {
      const s = detectSwings(candles, lb);
      highs = s.highs; lows = s.lows;
      if (highs.length >= 2 && lows.length >= 2) break;
    }

    const lastIdx = candles.length - 1;
    const perBar = candles.length >= 2 ? (candles.at(-1).time - candles.at(-2).time) : 900;
    const rightExtendBars = 6; // extend line 6 bars past last candle for visibility

    const supp = bestTrendline(lows);
    if (supp) {
      const y2 = supp.A.price + supp.slope * (lastIdx + rightExtendBars - supp.A.i);
      supS.setData([
        { time: supp.A.time, value: supp.A.price },
        { time: candles[lastIdx].time + perBar * rightExtendBars, value: y2 },
      ]);
    }
    const res = bestTrendline(highs);
    if (res) {
      const y2 = res.A.price + res.slope * (lastIdx + rightExtendBars - res.A.i);
      resS.setData([
        { time: res.A.time, value: res.A.price },
        { time: candles[lastIdx].time + perBar * rightExtendBars, value: y2 },
      ]);
    }
  }

  function drawSMC(smc, candles) {
    const s = candleRef.current;
    if (!s || !candles.length) return;

    // Liquidity Grab / Retest — price lines
    const lg = smc.liquidity_grab;
    if (lg && lg.direction !== 'NONE') {
      const add = (p, color, title) => {
        if (p == null) return;
        priceLinesRef.current.push(s.createPriceLine({
          price: p, color, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title,
        }));
      };
      add(lg.entry, '#ffb020', 'ENTRY');
      add(lg.sl,    '#f43f5e', 'SL');
      add(lg.tp1,   '#22c55e', 'TP1');
      add(lg.tp2,   '#16a34a', 'TP2');
      add(lg.tp3,   '#0d5a2a', 'TP3');
      add(lg.grab_price, '#60a5fa', 'GRAB');
      add(lg.bos_price,  '#a78bfa', 'BOS');
    }

    // Support / resistance — from zone highs & lows
    (smc.zones || []).forEach(z => {
      if (['ACCUMULATION', 'DISTRIBUTION'].includes(z.kind)) {
        priceLinesRef.current.push(s.createPriceLine({
          price: z.top,    color: 'rgba(244,63,94,0.6)', lineWidth: 1, lineStyle: 2, title: `R (${z.kind[0]})`,
        }));
        priceLinesRef.current.push(s.createPriceLine({
          price: z.bottom, color: 'rgba(34,197,94,0.6)', lineWidth: 1, lineStyle: 2, title: `S (${z.kind[0]})`,
        }));
      }
    });

    // Phase markers
    const markers = [];
    (smc.zones || []).forEach(z => {
      if (['ACCUMULATION', 'MANIPULATION', 'DISTRIBUTION'].includes(z.kind)) {
        const t = candles[Math.min(z.start_idx, candles.length - 1)]?.time;
        if (t) markers.push({
          time: t, position: 'aboveBar',
          color: z.kind === 'ACCUMULATION' ? '#22c55e' : z.kind === 'MANIPULATION' ? '#60a5fa' : '#f43f5e',
          shape: 'circle', size: 1, text: z.kind[0],
        });
      }
    });
    // BOS marker on the last candle when we have a valid setup
    if (lg && lg.direction !== 'NONE') {
      markers.push({
        time: candles.at(-1).time,
        position: lg.direction === 'LONG' ? 'belowBar' : 'aboveBar',
        color: lg.direction === 'LONG' ? '#22c55e' : '#f43f5e',
        shape: lg.direction === 'LONG' ? 'arrowUp' : 'arrowDown',
        size: 2,
        text: `${lg.direction} ${lg.grade}`,
      });
    }
    if (markers.length) s.setMarkers(markers);

    // Auto-drawn diagonal trendlines (support & resistance) from swing highs/lows
    drawTrendlines(candles);

    // Trigger overlay redraw for zone-boxes
    setTimeout(redrawOverlay, 60);
  }

  // ── Signal Zone BOXES  (green = reward zone, red = risk zone) ─
  function redrawOverlay() {
    const chart = chartRef.current;
    const series = candleRef.current;
    const overlay = overlayRef.current;
    const smc = analysisRef.current;
    if (!chart || !series || !overlay || !smc) { if (overlay) overlay.innerHTML = ''; return; }
    const lg = smc.liquidity_grab;
    if (!lg || lg.direction === 'NONE' || lg.entry == null || lg.sl == null || lg.tp1 == null) {
      overlay.innerHTML = '';
      return;
    }
    const now = candlesDataRef.current.at(-1);
    if (!now) return;
    // Anchor the zone to the last 20 candles (visible on right side of chart)
    const arr = candlesDataRef.current;
    const startTime = arr[Math.max(0, arr.length - 20)].time;
    const perBar = arr.length >= 2 ? (arr[arr.length - 1].time - arr[arr.length - 2].time) : 900;
    const endTime = now.time + perBar * 8;

    const x1 = chart.timeScale().timeToCoordinate(startTime);
    const x2 = chart.timeScale().timeToCoordinate(endTime);
    if (x1 == null) return;
    // If endTime is past visible range, clamp to right edge
    const rightEdge = containerRef.current ? containerRef.current.clientWidth - 60 : 800;
    const xEnd = x2 == null ? rightEdge : Math.min(x2, rightEdge);

    const entryY = series.priceToCoordinate(lg.entry);
    const slY    = series.priceToCoordinate(lg.sl);
    const tpY    = series.priceToCoordinate(lg.tp3 ?? lg.tp2 ?? lg.tp1);
    if (entryY == null || slY == null || tpY == null) return;

    const risk = Math.abs(lg.entry - lg.sl);
    const reward = Math.abs((lg.tp3 ?? lg.tp2 ?? lg.tp1) - lg.entry);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '—';

    // Reward zone (green) — between entry and TP
    const rewardTop = Math.min(entryY, tpY);
    const rewardH = Math.abs(entryY - tpY);
    // Risk zone (red) — between entry and SL
    const riskTop = Math.min(entryY, slY);
    const riskH = Math.abs(entryY - slY);
    const w = Math.max(60, xEnd - x1);

    overlay.innerHTML = `
      <div class="zone-box reward" style="left:${x1}px; top:${rewardTop}px; width:${w}px; height:${rewardH}px">
        <div class="zone-lbl">TARGET · ${lg.direction} · R:R 1:${rr}</div>
      </div>
      <div class="zone-box risk" style="left:${x1}px; top:${riskTop}px; width:${w}px; height:${riskH}px">
        <div class="zone-lbl">STOP LOSS · Risk ${fmtPrice(risk)}</div>
      </div>
    `;
  }

  // Re-run overlay when analysis loads
  useEffect(() => { redrawOverlay(); }, [analysis]); // eslint-disable-line

  // ── Zoom controls ────────────────────────────────────────────
  const zoomIn  = useCallback(() => {
    const ts = chartRef.current?.timeScale(); if (!ts) return;
    const opts = ts.options();
    ts.applyOptions({ barSpacing: Math.min(30, (opts.barSpacing || 4) * 1.5) });
    setTimeout(redrawOverlay, 40);
  }, []);
  const zoomOut = useCallback(() => {
    const ts = chartRef.current?.timeScale(); if (!ts) return;
    const opts = ts.options();
    ts.applyOptions({ barSpacing: Math.max(1, (opts.barSpacing || 4) / 1.5) });
    setTimeout(redrawOverlay, 40);
  }, []);
  const fitAll = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
    setTimeout(redrawOverlay, 40);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen(f => !f);
    setTimeout(() => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        redrawOverlay();
      }
    }, 100);
  }, []);

  return (
    <div className={`chart-wrap ${fullscreen ? 'fullscreen' : ''}`} data-testid="smc-chart" ref={wrapRef}>
      <div className="chart-toolbar">
        <div>
          <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em' }}>
            {(pair || '--').toUpperCase()}{' '}
            {lastPrice != null && (
              <span className="mono" style={{ color: 'var(--accent)' }}>
                {fmtPrice(lastPrice)}
                {liveSource && <span className="small" style={{ marginLeft: 8 }}>· {liveSource}</span>}
              </span>
            )}
          </div>
          <div className="small">
            {analysis
              ? <>Phase: <b>{analysis.current_phase}</b> · ATR {analysis.atr}
                 {analysis.liquidity_grab?.direction !== 'NONE'
                   ? <> · Setup: <b style={{ color: analysis.liquidity_grab.direction === 'LONG' ? 'var(--long)' : 'var(--short)' }}>{analysis.liquidity_grab.direction} {analysis.liquidity_grab.grade}</b></>
                   : null}</>
              : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tfs">
            {TIMEFRAMES.map(t => (
              <button
                key={t}
                className={`tf ${timeframe === t ? 'active' : ''}`}
                onClick={() => setTimeframe(t)}
                data-testid={`tf-${t}`}
              >{t}</button>
            ))}
          </div>
          <button className="tf" onClick={zoomOut} title="Zoom out" data-testid="zoom-out">−</button>
          <button className="tf" onClick={zoomIn} title="Zoom in" data-testid="zoom-in">+</button>
          <button className="tf" onClick={fitAll} title="Fit all" data-testid="fit-all">⊡</button>
          <button className="tf" onClick={toggleFullscreen} title="Fullscreen" data-testid="fullscreen">
            {fullscreen ? '×' : '⛶'}
          </button>
        </div>
      </div>

      <div className="chart-inner">
        <div ref={containerRef} className="chart-canvas" data-testid="chart-canvas" />
        <div ref={overlayRef} className="zone-overlay" />
      </div>

      {loading && <div className="loading"><div className="spinner" /> LOADING {(pair || '').toUpperCase()}…</div>}
      {error && <div className="reason-row" style={{ color: '#f87171' }}>{error}</div>}

      <div className="phase-legend">
        {LEGEND_ITEMS.map((it) => (
          <button
            key={it.key}
            type="button"
            className={`phase-pill ${it.cls} ${activeDef === it.key ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setActiveDef(a => a === it.key ? null : it.key); }}
            data-testid={`legend-${it.key}`}
            title="Tap for definition"
          >
            <span className="sw" style={it.swatchStyle} /> {it.label}
            <span className="info-i">ⓘ</span>
          </button>
        ))}
      </div>

      {activeDef && (
        <div className="def-backdrop" onClick={() => setActiveDef(null)}>
          <div
            className={`def-popover ${LEGEND_DEFS[activeDef].tone}`}
            onClick={(e) => e.stopPropagation()}
            data-testid={`def-popover-${activeDef}`}
          >
            <div className="def-head">
              <span className="def-icon">{LEGEND_DEFS[activeDef].emoji}</span>
              <span className="def-title">{LEGEND_DEFS[activeDef].title}</span>
              <button className="def-close" onClick={() => setActiveDef(null)} aria-label="Close">×</button>
            </div>
            <div className="def-body">
              <p className="def-lead">{LEGEND_DEFS[activeDef].summary}</p>
              <ul className="def-list">
                {LEGEND_DEFS[activeDef].points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              {LEGEND_DEFS[activeDef].howToTrade && (
                <div className="def-trade">
                  <b>How the app uses it:</b> {LEGEND_DEFS[activeDef].howToTrade}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SMC glossary — shown in a popover when user clicks a legend pill ──
const LEGEND_ITEMS = [
  { key: 'acc',  cls: 'acc', label: 'Accumulation',  swatchStyle: { background: '#22c55e' } },
  { key: 'man',  cls: 'man', label: 'Manipulation',  swatchStyle: { background: '#60a5fa' } },
  { key: 'dis',  cls: 'dis', label: 'Distribution',  swatchStyle: { background: '#f43f5e' } },
  { key: 'ema20',cls: 'ob',  label: 'EMA 20',        swatchStyle: { background: '#ffb020' } },
  { key: 'ema50',cls: 'fvg', label: 'EMA 50',        swatchStyle: { background: '#22d3ee' } },
  { key: 'supp', cls: 'acc', label: 'Support TL',    swatchStyle: { background: 'rgba(34,197,94,0.85)', height: 2 } },
  { key: 'res',  cls: 'dis', label: 'Resistance TL', swatchStyle: { background: 'rgba(244,63,94,0.85)', height: 2 } },
];

const LEGEND_DEFS = {
  acc: {
    tone: 'good', emoji: '🟢', title: 'Accumulation',
    summary: 'Smart-money is quietly BUYING inside a tight sideways range at the bottom of a move. Retail sees "boring" price — big players see a discount.',
    points: [
      'Price consolidates in a range after a downtrend.',
      'Volume clusters at the lows (absorption of sell orders).',
      'Multiple false breakdowns below range — liquidity grabs.',
      'Ends with a Break of Structure (BOS) to the UPSIDE.',
    ],
    howToTrade: 'The app looks for a bullish liquidity grab below the accumulation low + BOS above the range high → LONG signal.',
  },
  man: {
    tone: 'info', emoji: '🔵', title: 'Manipulation (Liquidity Grab)',
    summary: 'A deliberate short-lived spike beyond a swing level to trigger retail stop-losses / breakout orders, then reversal in the opposite direction.',
    points: [
      'Price briefly spikes above the highs (stop-hunt) or below the lows.',
      'Reverses quickly — usually within 1–3 candles.',
      'Traps late breakout traders on the wrong side.',
      'This is where smart-money fills orders using retail liquidity.',
    ],
    howToTrade: 'Manipulation = the app\'s primary entry trigger. Grab-and-reverse candle → the app draws entry, SL beyond the wick, and TP toward the opposite range boundary.',
  },
  dis: {
    tone: 'bad', emoji: '🔴', title: 'Distribution',
    summary: 'Smart-money is quietly SELLING inside a tight sideways range at the top of a move. Retail buys the "breakout" — big players sell into it.',
    points: [
      'Price consolidates in a range after an uptrend.',
      'Multiple false breakouts above range highs — buy-side liquidity swept.',
      'Volume divergence: rising price + falling buy-volume.',
      'Ends with a Break of Structure (BOS) to the DOWNSIDE.',
    ],
    howToTrade: 'The app looks for a bearish liquidity grab above the distribution high + BOS below the range low → SHORT signal.',
  },
  ema20: {
    tone: 'accent', emoji: '📈', title: 'EMA 20 (short-term trend)',
    summary: 'The 20-period Exponential Moving Average — a fast-reacting line that shows short-term price momentum.',
    points: [
      'Price above EMA 20 = short-term bullish momentum.',
      'Price below EMA 20 = short-term bearish momentum.',
      'EMA 20 crossing above EMA 50 = bullish crossover ("golden cross" style).',
      'The app uses EMA slope for phase confirmation.',
    ],
  },
  ema50: {
    tone: 'accent2', emoji: '📉', title: 'EMA 50 (medium-term trend)',
    summary: 'The 50-period Exponential Moving Average — a slower line that captures the medium-term trend direction.',
    points: [
      'EMA 50 acts as dynamic support/resistance during trends.',
      'Price above EMA 50 = medium-term uptrend.',
      'Price below EMA 50 = medium-term downtrend.',
      'Combined with EMA 20 to gauge trend strength.',
    ],
  },
  supp: {
    tone: 'good', emoji: '🟢', title: 'Support Trendline (auto)',
    summary: 'Auto-drawn diagonal line connecting recent swing lows. Bullish structure — buyers step in at progressively higher prices.',
    points: [
      'A break BELOW this line = potential trend reversal or deeper correction.',
      'Bounces from this line = high-probability LONG entries.',
      'Steeper slope = stronger uptrend but also more fragile.',
    ],
  },
  res: {
    tone: 'bad', emoji: '🔴', title: 'Resistance Trendline (auto)',
    summary: 'Auto-drawn diagonal line connecting recent swing highs. Bearish structure — sellers step in at progressively lower prices.',
    points: [
      'A break ABOVE this line = potential trend reversal or bullish breakout.',
      'Rejections from this line = high-probability SHORT entries.',
      'Convergence with support = symmetrical triangle / breakout setup.',
    ],
  },
};

function fmtPrice(n) {
  if (n == null || !Number.isFinite(+n)) return '—';
  const v = +n;
  const abs = Math.abs(v);
  if (abs < 1) return v.toFixed(5);
  if (abs < 100) return v.toFixed(4);
  if (abs < 10000) return v.toFixed(2);
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function tfToSeconds(tf) {
  const map = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
  return map[tf] || 300;
}

/**
 * Clip outlier candles (Yahoo GC=F futures weekend-rollover gaps produce
 * $80-range phantom candles that trash the SMC engine and chart visuals).
 * Any candle whose range is > 8× the median of the previous 60 candles is
 * clipped down to a reasonable size around its body midpoint.
 */
function clipOutlierCandles(candles) {
  if (!candles || candles.length < 30) return candles;
  const ranges = candles.map(c => c.high - c.low).filter(r => r > 0).sort((a, b) => a - b);
  if (ranges.length < 20) return candles;
  const medRange = ranges[Math.floor(ranges.length / 2)];
  const cap = medRange * 8;
  return candles.map(c => {
    const rng = c.high - c.low;
    if (rng <= cap) return c;
    const mid = (c.open + c.close) / 2;
    return {
      ...c,
      high: Math.max(c.open, c.close, mid + cap / 2),
      low:  Math.min(c.open, c.close, mid - cap / 2),
    };
  });
}
