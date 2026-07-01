
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, Dimensions, TouchableOpacity,
  StyleSheet, ActivityIndicator, Modal, useWindowDimensions,
} from 'react-native';
import Svg, { Line, Rect, Text as SvgText, Circle, Polyline } from 'react-native-svg';
import { COLORS } from '../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const PRICE_H = 260, VOL_H = 38, RSI_H = 56;
const CHART_H = PRICE_H + VOL_H + RSI_H;
const RIGHT_AXIS_W = 60;
const CHART_W = SCREEN_W - 40 - RIGHT_AXIS_W;
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const API_URL = 'http://localhost:3000';
// v6.1 FIX #7: safer HTF map â€” 1d â†’ 4h (broad Binance compatibility)
const HTF_MAP = {
  '1m': '15m',
  '5m': '1h',
  '15m': '4h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
};

const DEFAULT_TOGGLES = {
  ema: true, rsi: true, vol: true, fvg: true, zones: true, session: true,
  bos: true, sweep: true, ob: true, eql: true, premium: true, tl: true, mss: true,
  dol: true, pools: true, regime: true,
};

// Weighted score â€” HTF/BOS/Displacement/MSS = 2; Regime = 1.5; others = 1
const WEIGHTS = {
  'HTF aligned': 2, 'BOS/CHoCH': 2, 'MSS': 2, 'Displacement': 2,
  'Liquidity Sweep': 1, 'FVG/OB confluence': 1, 'EMA stack': 1,
  'RSI Divergence': 1, 'Vol spike': 1, 'Premium/Discount': 1,
  'Session (LDN/NY)': 1, 'Vol Regime OK': 1.5, 'DOL aligned': 1.5,
};

// utility: min/max without spread (v6.1 FIX #4)
function minMaxArr(arr) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn, max: mx };
}
function maxArr(arr, seed = -Infinity) {
  let mx = seed;
  for (let i = 0; i < arr.length; i++) if (arr[i] > mx) mx = arr[i];
  return mx;
}
function minArr(arr, seed = Infinity) {
  let mn = seed;
  for (let i = 0; i < arr.length; i++) if (arr[i] < mn) mn = arr[i];
  return mn;
}

const ChartWithZones = ({ pair, timeframe = '15m', signal, dataSource = 'YAHOO' }) => {
  const [candles, setCandles] = useState([]);
  const [htfCandles, setHtfCandles] = useState([]);
  const [livePrice, setLivePrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTf, setActiveTf] = useState(timeframe);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stickySignal, setStickySignal] = useState(null);
  const [toggles, setToggles] = useState(DEFAULT_TOGGLES);
  // v6.1 FIX #16: locked signal to prevent flicker
  const [lockedSignal, setLockedSignal] = useState(null);
  const [viewN, setViewN] = useState(55); // Default to 55 candles for clear, large display

  const { width: WIN_W, height: WIN_H } = useWindowDimensions();
  const fullscreenChartSize = {
    width: Math.max(WIN_W - 30, 320),
    height: Math.max(WIN_H - 180, 420),
  };

  const handleZoomIn = () => setViewN(v => Math.max(25, v - 10));
  const handleZoomOut = () => setViewN(v => Math.min(180, v + 10));

useEffect(() => { setStickySignal(null); setLockedSignal(null); }, [pair, activeTf]);
  useEffect(() => {
    if (signal?.status_label === 'TRADE' && signal?.pair === pair) setStickySignal(signal);
  }, [signal, pair]);
  useEffect(() => { fetchChart(); /* eslint-disable-next-line */ }, [pair, activeTf, dataSource]);

  useEffect(() => {
    if (signal?.current_price && signal?.pair?.toUpperCase() === pair?.toUpperCase()) {
      setLivePrice(signal.current_price);
    }
  }, [signal?.current_price, signal?.pair, pair]);

  const fetchChart = async () => {
    if (!pair) return;
    setLoading(true);
    try {
      const cleanPair = pair.toUpperCase().replace(/[-/_]/g, '');
      const isCrypto = /BTC|ETH|SOL|XRP|DOGE/.test(cleanPair);
      const htfTf = HTF_MAP[activeTf] || '4h';
      let arr = [], htf = [], live = null;

      if (isCrypto && dataSource === 'REALTIME') {
        const sym = cleanPair.replace('USD', '') + 'USDT';
        const [k, kh, p] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${activeTf}&limit=500`).then(r => r.json()),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${htfTf}&limit=200`).then(r => r.json()),
          fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`).then(r => r.json()),
        ]);
        const mapK = d => ({ time: new Date(d[0]).toISOString(), open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] });
        arr = k.map(mapK); htf = kh.map(mapK);
        live = p.price ? +p.price : null;
      } else {
        const [res, resH] = await Promise.all([
          fetch(`${API_URL}/api/v1/chart-data`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pair, timeframe: activeTf, dataSource, limit: 500 }),
          }).then(r => r.json()),
          fetch(`${API_URL}/api/v1/chart-data`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pair, timeframe: htfTf, dataSource, limit: 200 }),
          }).then(r => r.json()).catch(() => ({ candles: [] })),
        ]);
        const mapC = c => ({ time: c.datetime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 });
        arr = (res.candles || []).map(mapC);
        htf = (resH.candles || []).map(mapC);
        live = res.live_price ?? arr[arr.length - 1]?.close ?? null;
      }

      if (live && arr.length) {
        const tfMs = {
          '1m': 60000,
          '5m': 300000,
          '15m': 900000,
          '1h': 3600000,
          '4h': 14400000,
          '1d': 86400000,
        }[activeTf] || 900000;

        const l = arr[arr.length - 1];
        const lastTime = l.time ? new Date(l.time).getTime() : 0;
        const nowTime = Date.now();

     if (lastTime > 0 && nowTime - lastTime >= tfMs) {
  // Yahoo is delayed → fill the gap with flat candles up to "now",
  // then append the live candle so the latest bar is always at the right edge.
  const gaps = Math.min(
    Math.floor((nowTime - lastTime) / tfMs),
    50 // safety cap
  );
  let prevClose = l.close;
  for (let g = 1; g < gaps; g++) {
    arr.push({
      time: new Date(lastTime + g * tfMs).toISOString(),
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
    });
  }
  arr.push({
    time: new Date(lastTime + gaps * tfMs).toISOString(),
    open: prevClose,
    high: Math.max(prevClose, live),
    low: Math.min(prevClose, live),
    close: live,
    volume: 0,
  });
} else {
  // Standard patch for the still-active candle
  l.close = live;
  l.high = Math.max(l.high, live);
  l.low = Math.min(l.low, live);
}
      }
      // v6.1 FIX #7: fall back to base TF if HTF empty
      if (!htf.length) htf = arr;

      setCandles(arr.slice(-500));
      setHtfCandles(htf.slice(-200));
      setLivePrice(live);
    } catch (e) { console.warn('chart fetch err', e); setCandles([]); }
    finally { setLoading(false); }
  };

  const dec = useMemo(() => {
    const p = livePrice ?? candles[candles.length - 1]?.close ?? 0;
    if (!p) return 5; if (p > 1000) return 2; if (p > 50) return 3; return 5;
  }, [livePrice, candles]);
  const fmt = v => (typeof v === 'number' && !isNaN(v) ? v.toFixed(dec) : '--');

  const overlaysFull = useMemo(() => computeOverlays(candles), [candles]);
  const htfBias = useMemo(() => computeHtfBias(htfCandles), [htfCandles]);
  const viewStart = Math.max(0, candles.length - viewN);
  const viewCandles = candles.slice(viewStart);
  const overlays = useMemo(
    () => sliceOverlays(overlaysFull, viewStart, viewCandles.length),
    [overlaysFull, viewStart, viewCandles.length],
  );

  const autoSignal = useMemo(
    () => buildAutoSignal(viewCandles, overlays, livePrice, htfBias),
    [viewCandles, overlays, livePrice, htfBias],
  );

  // v6.1 FIX #16: lock signal — only replace if better
  // FIX: prevent LONG/SHORT alternation.
  // A direction FLIP must be much stronger than the current locked signal,
  // AND must be backed by a fresh MSS in the new direction.
  useEffect(() => {
  if (!autoSignal || autoSignal.status_label !== 'TRADE') return;
  if (!lockedSignal) { setLockedSignal(autoSignal); return; }

  const newHasMss = autoSignal.reasons.find(r => r.label === 'MSS')?.ok;
  const oldHasMss = lockedSignal.reasons?.find(r => r.label === 'MSS')?.ok;
  const sameDir   = autoSignal.signal_type === lockedSignal.signal_type;

  let better = false;
  if (sameDir) {
    // Same direction → refresh on any meaningful improvement
    better =
      autoSignal.score > lockedSignal.score + 0.5 ||
      (newHasMss && !oldHasMss);
  } else {
    // Direction flip → require a NEW MSS in the new direction
    // AND a clearly stronger score (≥ +2 over the locked one).
    better = !!newHasMss && autoSignal.score >= lockedSignal.score + 2;
  }

  if (better) setLockedSignal(autoSignal);
}, [autoSignal, lockedSignal]);
  const externalDraw = signal?.status_label === 'TRADE' ? signal : stickySignal;
  const drawSignal = externalDraw
    || (lockedSignal?.status_label === 'TRADE' ? lockedSignal : null)
    || (autoSignal?.status_label === 'TRADE' ? autoSignal : null);

  // v6.1 FIX #3+#4: build yDomain without flatMap/spread
  const yDomain = useMemo(() => {
    if (!viewCandles.length) return { min: 0, max: 1 };
    const vals = [];
    for (let i = 0; i < viewCandles.length; i++) {
      const c = viewCandles[i];
      vals.push(c.high, c.low);
    }
    const { min, max } = minMaxArr(vals);
    const pad = (max - min) * 0.10 || 1;
    return { min: min - pad, max: max + pad };
  }, [viewCandles]);

  const renderSvg = (w, h) => {
    const rightW = 60, chartW = w - rightW;
    const priceH = h * (PRICE_H / CHART_H);
    const volH = h * (VOL_H / CHART_H);
    const rsiH = h * (RSI_H / CHART_H);
    const volTop = priceH, rsiTop = priceH + volH;
const rightBuffer = 1.5;
const xStep = viewCandles.length ? chartW / (viewCandles.length + rightBuffer) : 1;
    const yScale = v => priceH - ((v - yDomain.min) / Math.max(yDomain.max - yDomain.min, 0.0001)) * priceH;
    const xPos = i => i * xStep;
    const lastX = xPos(viewCandles.length - 1);

    // v6.1 FIX #4: max vol without spread
    let maxVol = 1;
    for (let i = 0; i < viewCandles.length; i++) {
      const v = viewCandles[i].volume || 0;
      if (v > maxVol) maxVol = v;
    }
    const vScale = v => volTop + (volH - (v / maxVol) * (volH - 4));
    const rScale = v => rsiTop + 6 + (1 - v / 100) * (rsiH - 12);

    // v6.1 FIX #4: range hi/lo without spread
    let rangeHi = -Infinity, rangeLo = Infinity;
    for (let i = 0; i < viewCandles.length; i++) {
      const c = viewCandles[i];
      if (c.high > rangeHi) rangeHi = c.high;
      if (c.low < rangeLo) rangeLo = c.low;
    }
    const eq = (rangeHi + rangeLo) / 2;

    // v6.1 FIX #10: build RSI points safely
    const rsiPoints = [];
    if (toggles.rsi) {
      for (let i = 0; i < overlays.rsi.length; i++) {
        const v = overlays.rsi[i];
        if (v != null && Number.isFinite(v)) {
          rsiPoints.push(`${xPos(i) + xStep / 2},${rScale(v)}`);
        }
      }
    }

    // v6.1 FIX #10: build volAvg points safely
    const volAvgPoints = [];
    if (toggles.vol) {
      for (let i = 0; i < overlays.volAvg.length; i++) {
        const v = overlays.volAvg[i];
        if (v != null && Number.isFinite(v)) {
          volAvgPoints.push(`${xPos(i) + xStep / 2},${vScale(v)}`);
        }
      }
    }

    // Dynamic grid lines for premium TradingView aesthetic
    const gridLines = [];
    // Horizontal lines at 25%, 50%, 75% height
    for (let p of [0.25, 0.5, 0.75]) {
      gridLines.push(
        <Line key={`hgrid-${p}`} x1={0} y1={priceH * p} x2={chartW} y2={priceH * p} stroke="rgba(255,255,255,0.06)" strokeWidth={0.7} />
      );
    }
    // Vertical grid lines every 12 candles
    for (let i = 12; i < viewCandles.length; i += 12) {
      const x = xPos(i) + xStep / 2;
      gridLines.push(
        <Line key={`vgrid-${i}`} x1={x} y1={0} x2={x} y2={priceH} stroke="rgba(255,255,255,0.06)" strokeWidth={0.7} />
      );
    }

    return (
      <View style={{ flexDirection: 'row', height: h }}>
        <Svg width={chartW} height={h}>
          {gridLines}
          {toggles.session && overlays.sessions.map((s, i) => (
            <Rect key={`ses${i}`} x={xPos(s.from)} y={0}
              width={Math.max((s.to - s.from + 1) * xStep, 1)} height={priceH}
              fill={s.kind === 'LDN' ? 'rgba(96,165,250,0.04)' : 'rgba(244,114,182,0.04)'} />
          ))}
          {toggles.premium && (
            <>
              <Rect x={0} y={yScale(rangeHi)} width={chartW} height={Math.max(yScale(eq) - yScale(rangeHi), 1)} fill="rgba(255,82,82,0.04)" />
              <Rect x={0} y={yScale(eq)} width={chartW} height={Math.max(yScale(rangeLo) - yScale(eq), 1)} fill="rgba(0,230,118,0.04)" />
              <Line x1={0} y1={yScale(eq)} x2={chartW} y2={yScale(eq)} stroke="#888" strokeWidth={0.6} strokeDasharray="6,4" />
              <SvgText x={4} y={yScale(eq) - 3} fontSize={8} fill="#888">EQ</SvgText>
            </>
          )}
          {toggles.zones && overlays.demand.map((z, i) => (
            <Rect key={`d${i}`} x={xPos(z.fromIdx)} y={yScale(z.top)} width={chartW - xPos(z.fromIdx)}
              height={Math.max(yScale(z.bottom) - yScale(z.top), 1)} fill="rgba(0,230,118,0.10)"
              stroke="#00E676" strokeWidth={0.5} strokeDasharray="3,3" />
          ))}
          {toggles.zones && overlays.supply.map((z, i) => (
            <Rect key={`s${i}`} x={xPos(z.fromIdx)} y={yScale(z.top)} width={chartW - xPos(z.fromIdx)}
              height={Math.max(yScale(z.bottom) - yScale(z.top), 1)} fill="rgba(255,82,82,0.10)"
              stroke="#FF5252" strokeWidth={0.5} strokeDasharray="3,3" />
          ))}
          {toggles.ob && overlays.orderBlocks.map((o, i) => (
            <Rect key={`ob${i}`} x={xPos(o.fromIdx)} y={yScale(o.top)} width={chartW - xPos(o.fromIdx)}
              height={Math.max(yScale(o.bottom) - yScale(o.top), 1)}
              fill={o.dir === 'BULL' ? 'rgba(34,211,238,0.10)' : 'rgba(251,146,60,0.10)'}
              stroke={o.dir === 'BULL' ? '#22d3ee' : '#fb923c'} strokeWidth={0.8} />
          ))}
          {toggles.fvg && overlays.fvg.map((g, i) => {
            const baseAlpha = g.strength === 'STRONG' ? 0.18 : 0.08;
            const col = g.type === 'BULL'
              ? `rgba(96,165,250,${baseAlpha})`
              : `rgba(244,114,182,${baseAlpha})`;
            return (
              <React.Fragment key={`f${i}`}>
                <Rect x={xPos(g.fromIdx)} y={yScale(g.top)} width={chartW - xPos(g.fromIdx)}
                  height={Math.max(yScale(g.bottom) - yScale(g.top), 1)} fill={col} />
                {g.fillPct > 0 && (
                  <SvgText x={xPos(g.fromIdx) + 2} y={yScale(g.top) + 9} fontSize={7}
                    fill={g.type === 'BULL' ? '#60a5fa' : '#f472b6'}>
                    {`${Math.round(g.fillPct * 100)}%`}
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}
          {toggles.tl && overlays.resistanceLine && (
            <Line x1={xPos(overlays.resistanceLine.x1)} y1={yScale(overlays.resistanceLine.y1)}
              x2={lastX} y2={yScale(overlays.resistanceLine.y2Projected)} stroke="#FF5252" strokeWidth={1.5} />
          )}
          {toggles.tl && overlays.supportLine && (
            <Line x1={xPos(overlays.supportLine.x1)} y1={yScale(overlays.supportLine.y1)}
              x2={lastX} y2={yScale(overlays.supportLine.y2Projected)} stroke="#00E676" strokeWidth={1.5} />
          )}
          {/* v6.1 FIX #2: EMA aligned with candle center */}
          {toggles.ema && overlays.ema && (
            <>
              {emaPath(overlays.ema.ema20, xPos, yScale, '#FFD600', xStep / 2)}
              {emaPath(overlays.ema.ema50, xPos, yScale, '#60a5fa', xStep / 2)}
              {emaPath(overlays.ema.ema200, xPos, yScale, '#f472b6', xStep / 2)}
            </>
          )}
          {toggles.pools && overlays.liquidityPools.map((p, i) => (
            <React.Fragment key={`lp${i}`}>
              <Line x1={xPos(p.from)} y1={yScale(p.level)} x2={chartW} y2={yScale(p.level)}
                stroke={p.side === 'HIGH' ? '#ef4444' : '#10b981'} strokeWidth={p.touches >= 3 ? 1.4 : 1}
                strokeDasharray="4,3" opacity={0.85} />
              <SvgText x={chartW - 60} y={yScale(p.level) - 3} fontSize={8}
                fill={p.side === 'HIGH' ? '#ef4444' : '#10b981'} fontWeight="bold">
                {`LP·${p.touches}T`}
              </SvgText>
            </React.Fragment>
          ))}
          {toggles.eql && overlays.eqHighs.map((p, i) => (
            <React.Fragment key={`eh${i}`}>
              <Line x1={xPos(p.from)} y1={yScale(p.level)} x2={xPos(p.to)} y2={yScale(p.level)}
                stroke="#FF5252" strokeWidth={1} strokeDasharray="1,2" />
              <SvgText x={xPos(p.to) + 3} y={yScale(p.level) - 2} fontSize={8} fill="#FF5252">EQH</SvgText>
            </React.Fragment>
          ))}
          {toggles.eql && overlays.eqLows.map((p, i) => (
            <React.Fragment key={`el${i}`}>
              <Line x1={xPos(p.from)} y1={yScale(p.level)} x2={xPos(p.to)} y2={yScale(p.level)}
                stroke="#00E676" strokeWidth={1} strokeDasharray="1,2" />
              <SvgText x={xPos(p.to) + 3} y={yScale(p.level) + 8} fontSize={8} fill="#00E676">EQL</SvgText>
            </React.Fragment>
          ))}
          {overlays.swingHighs.map((p, i) => <Circle key={`sh${i}`} cx={xPos(p.i)} cy={yScale(p.level)} r={2.2} fill="#FF5252" />)}
          {overlays.swingLows.map((p, i) => <Circle key={`sl${i}`} cx={xPos(p.i)} cy={yScale(p.level)} r={2.2} fill="#00E676" />)}
          {viewCandles.map((c, i) => {
            const x = xPos(i);
            const isLast = i === viewCandles.length - 1;
            const close = isLast && livePrice ? livePrice : c.close;
            const high = isLast && livePrice ? Math.max(c.high, livePrice) : c.high;
            const low = isLast && livePrice ? Math.min(c.low, livePrice) : c.low;
            const up = close >= c.open;
            const color = up ? '#00E676' : '#FF5252';
            const isDisp = overlays.displacement[i];
            const bodyTop = yScale(Math.max(c.open, close));
            const bodyH = Math.max(Math.abs(yScale(c.open) - yScale(close)), 1);
            return (
              <React.Fragment key={i}>
                <Rect x={x + 1} y={bodyTop} width={Math.max(xStep - 2, 1)} height={bodyH} fill={color}
                  stroke={isDisp ? '#ffffff' : 'none'} strokeWidth={isDisp ? 1 : 0} />
                <Line x1={x + xStep / 2} y1={yScale(high)} x2={x + xStep / 2} y2={yScale(low)} stroke={color} strokeWidth={1.8} />
              </React.Fragment>
            );
          })}
          {toggles.bos && overlays.bos.map((b, i) => {
            const color = b.dir === 'BULL' ? '#00E676' : '#FF5252';
            const label = b.mss ? 'MSS' : b.choch ? 'CHoCH' : b.external ? 'BOS' : 'iBOS';
            return (
              <React.Fragment key={`b${i}`}>
                <Line x1={xPos(b.fromI)} y1={yScale(b.level)} x2={xPos(b.i)} y2={yScale(b.level)}
                  stroke={color} strokeWidth={b.mss ? 1.5 : 1} strokeDasharray="2,2" />
                <SvgText x={xPos(b.i) + 2} y={yScale(b.level) - 3} fontSize={9} fill={color} fontWeight="bold">{label}</SvgText>
              </React.Fragment>
            );
          })}
          {toggles.sweep && overlays.sweeps.map((s, i) => (
            <React.Fragment key={`sw${i}`}>
              <Circle cx={xPos(s.i) + xStep / 2} cy={yScale(s.level)} r={3.5}
                fill="none" stroke={s.dir === 'BULL' ? '#00E676' : '#FF5252'} strokeWidth={1.5} />
              <SvgText x={xPos(s.i) + xStep / 2 + 5} y={yScale(s.level) + (s.dir === 'BULL' ? 12 : -6)}
                fontSize={8} fill={s.dir === 'BULL' ? '#00E676' : '#FF5252'} fontWeight="bold">SWP</SvgText>
            </React.Fragment>
          ))}
          {toggles.rsi && overlays.divergences.map((d, i) => (
            <Circle key={`dv${i}`} cx={xPos(d.i) + xStep / 2} cy={yScale(d.price)} r={3}
              fill={d.type === 'BULL' ? '#22d3ee' : '#fb923c'} />
          ))}
          {toggles.dol && overlays.dolTargets.map((t, i) => {
            const col = t.side === 'HIGH' ? '#f59e0b' : '#a78bfa';
            const y = yScale(t.level);
            return (
              <React.Fragment key={`dol${i}`}>
                <Line x1={lastX - 20} y1={y} x2={chartW} y2={y}
                  stroke={col} strokeWidth={1.3} strokeDasharray="6,3" opacity={0.6 + t.confidence * 0.4} />
                <SvgText x={chartW - 90} y={y - 3} fontSize={9} fill={col} fontWeight="bold">
                  {`→ ${t.kind} (${Math.round(t.confidence * 100)}%)`}
                </SvgText>
              </React.Fragment>
            );
          })}
          {toggles.dol && overlays.inducement && overlays.inducement.map((ind, i) => (
            <React.Fragment key={`ind${i}`}>
              <Circle cx={xPos(ind.i) + xStep / 2} cy={yScale(ind.level)} r={4}
                fill="none" stroke="#fde047" strokeWidth={1.2} strokeDasharray="2,2" />
              <SvgText x={xPos(ind.i) + xStep / 2 + 6} y={yScale(ind.level) + (ind.side === 'HIGH' ? -5 : 11)}
                fontSize={8} fill="#fde047" fontWeight="bold">IND</SvgText>
            </React.Fragment>
          ))}
          {drawSignal?.status_label === 'TRADE' && (
            <>
              {drawTradeLine(drawSignal.entry, '#FFD600', 'ENTRY', yScale, chartW)}
              {drawTradeLine(drawSignal.sl, '#FF5252', 'SL', yScale, chartW)}
              {drawTradeLine(drawSignal.tp1, '#00E676', 'TP1', yScale, chartW)}
              {drawTradeLine(drawSignal.tp2, '#4ade80', 'TP2', yScale, chartW)}
            </>
          )}
          {livePrice && axisTag(livePrice, '#60a5fa', '•', yScale, rightW)}
          {livePrice && <Line x1={0} y1={yScale(livePrice)} x2={chartW} y2={yScale(livePrice)}
            stroke="#60a5fa" strokeWidth={1} strokeDasharray="4,4" />}

          <Line x1={0} y1={volTop} x2={chartW} y2={volTop} stroke="#222" strokeWidth={0.5} />
          {toggles.vol && viewCandles.map((c, i) => {
            const v = c.volume || 0, x = xPos(i);
            const yTop = vScale(v), barH = Math.max((volTop + volH) - yTop, 1);
            const avg = overlays.volAvg[i] || 0;
            const spike = avg && v > avg * 1.6;
            const up = c.close >= c.open;
            const fill = spike ? (up ? '#00E676' : '#FF5252')
              : (up ? 'rgba(0,230,118,0.45)' : 'rgba(255,82,82,0.45)');
            return <Rect key={`v${i}`} x={x + 1} y={yTop} width={Math.max(xStep - 2, 1)} height={barH} fill={fill} />;
          })}
          {toggles.vol && volAvgPoints.length > 1 && (
            <Polyline fill="none" stroke="#fbbf24" strokeWidth={1} points={volAvgPoints.join(' ')} />
          )}
          <Line x1={0} y1={rsiTop} x2={chartW} y2={rsiTop} stroke="#222" strokeWidth={0.5} />
          {toggles.rsi && rsiPoints.length > 1 && (
            <>
              <Line x1={0} y1={rScale(70)} x2={chartW} y2={rScale(70)} stroke="#FF5252" strokeWidth={0.5} strokeDasharray="2,3" />
              <Line x1={0} y1={rScale(50)} x2={chartW} y2={rScale(50)} stroke="#444" strokeWidth={0.5} strokeDasharray="2,3" />
              <Line x1={0} y1={rScale(30)} x2={chartW} y2={rScale(30)} stroke="#00E676" strokeWidth={0.5} strokeDasharray="2,3" />
              <Polyline fill="none" stroke="#c084fc" strokeWidth={1.3} points={rsiPoints.join(' ')} />
              <SvgText x={2} y={rsiTop + 10} fontSize={8} fill="#666">RSI 14</SvgText>
            </>
          )}
        </Svg>
        <Svg width={rightW} height={h} style={{ marginLeft: 2 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const price = yDomain.min + (yDomain.max - yDomain.min) * (1 - p);
            return <SvgText key={i} x={4} y={priceH * p + 4} fontSize={9} fill="#555">{fmt(price)}</SvgText>;
          })}
          {drawSignal?.status_label === 'TRADE' && (
            <>
              {axisTag(drawSignal.entry, '#FFD600', 'E', yScale, rightW)}
              {axisTag(drawSignal.sl, '#FF5252', 'SL', yScale, rightW)}
              {axisTag(drawSignal.tp1, '#00E676', 'T1', yScale, rightW)}
              {axisTag(drawSignal.tp2, '#4ade80', 'T2', yScale, rightW)}
            </>
          )}
          {livePrice && axisTag(livePrice, '#60a5fa', '•', yScale, rightW)}
          {toggles.rsi && (
            <>
              <SvgText x={4} y={rsiTop + 10} fontSize={8} fill="#FF5252">70</SvgText>
              <SvgText x={4} y={rsiTop + rsiH / 2 + 2} fontSize={8} fill="#666">50</SvgText>
              <SvgText x={4} y={rsiTop + rsiH - 4} fontSize={8} fill="#00E676">30</SvgText>
            </>
          )}
        </Svg>
      </View>
    );
  };

  const toggleChip = (key, label) => (
    <TouchableOpacity key={key} onPress={() => setToggles(t => ({ ...t, [key]: !t[key] }))}
      style={[styles.chip, toggles[key] && styles.chipActive]}>
      <Text style={[styles.chipText, toggles[key] && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const regime = overlays.volRegime;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {(pair || '--').toUpperCase()} · SMC v6.1
          {htfBias && <Text style={{ color: htfBias.dir === 'BULL' ? '#00E676' : '#FF5252', fontSize: 11 }}>
            {'  '}HTF: {htfBias.dir}</Text>}
          {regime && <Text style={{
            color: regime.state === 'EXPANSION' ? '#00E676' :
              regime.state === 'COMPRESSION' ? '#f59e0b' : '#888',
            fontSize: 11,
          }}>{'  · '}{regime.state}</Text>}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {livePrice && <Text style={styles.livePrice}>{fmt(livePrice)}</Text>}
          {loading && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 8 }} />}
        </View>
      </View>
      <View style={[styles.timeframeSelector, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', flex: 1 }}>
          {TIMEFRAMES.map(tf => (
            <TouchableOpacity key={tf} style={[styles.tfBtn, activeTf === tf && styles.tfBtnActive]} onPress={() => setActiveTf(tf)}>
              <Text style={styles.tfText}>{tf}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <TouchableOpacity style={styles.zoomBtn} onPress={handleZoomIn}>
            <Text style={styles.zoomText}>🔍 +</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomBtn} onPress={handleZoomOut}>
            <Text style={styles.zoomText}>🔍 -</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={styles.toggleRow}>
          {toggleChip('zones', 'Zones')}{toggleChip('ob', 'OB')}{toggleChip('fvg', 'FVG')}
          {toggleChip('ema', 'EMA')}{toggleChip('rsi', 'RSI')}{toggleChip('vol', 'Vol')}
          {toggleChip('bos', 'BOS/MSS')}{toggleChip('sweep', 'Sweep')}{toggleChip('eql', 'EQH/L')}
          {toggleChip('premium', 'Prem/Disc')}{toggleChip('tl', 'TL')}{toggleChip('session', 'Session')}
          {toggleChip('dol', 'DOL')}{toggleChip('pools', 'Pools')}
        </View>
      </ScrollView>
      <TouchableOpacity style={styles.chartAreaWrapper} onPress={() => setIsFullscreen(true)} activeOpacity={0.9}>
        {viewCandles.length === 0 ? (
          <View style={[styles.chartArea, { justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: '#555' }}>{loading ? 'Loading…' : 'No data'}</Text>
          </View>
        ) : (
          <View style={styles.chartArea}>{renderSvg(CHART_W + RIGHT_AXIS_W, CHART_H)}</View>
        )}
        <View style={styles.fullscreenHint}><Text style={styles.hintText}>Click to Enlarge ↗</Text></View>
      </TouchableOpacity>
      {/* v6.1 FIX #12: Modal only mounts when visible */}
      {isFullscreen && (
        <Modal visible animationType="fade" transparent={false} onRequestClose={() => setIsFullscreen(false)}>
          <View style={styles.fullscreenContainer}>
            <View style={styles.fullscreenHeader}>
              <Text style={styles.fullscreenTitle}>{(pair || '--').toUpperCase()} Institutional Analysis ({activeTf})</Text>
              <TouchableOpacity onPress={() => setIsFullscreen(false)} style={styles.closeBtn}>
                <Text style={styles.closeText}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fullscreenChartWrap}>{renderSvg(fullscreenChartSize.width, fullscreenChartSize.height)}</View>
          </View>
        </Modal>
      )}
      <View style={styles.legend}>
        <Legend color="rgba(0,230,118,0.4)" label="Demand" />
        <Legend color="rgba(255,82,82,0.4)" label="Supply" />
        <Legend color="rgba(34,211,238,0.4)" label="OB↑" />
        <Legend color="rgba(251,146,60,0.4)" label="OB↓" />
        <Legend color="rgba(96,165,250,0.4)" label="FVG" />
        <Legend color="#FFD600" label="EMA20" line />
        <Legend color="#60a5fa" label="EMA50" line />
        <Legend color="#f472b6" label="EMA200" line />
        <Legend color="#c084fc" label="RSI" line />
        <Legend color="#f59e0b" label="DOL↑" line />
        <Legend color="#a78bfa" label="DOL↓" line />
        <Legend color="#fde047" label="Inducement" />
      </View>
      {autoSignal && (
        <View style={styles.scoreBox}>
          <Text style={styles.scoreTitle}>
            Weighted Score: {autoSignal.score.toFixed(1)}/{autoSignal.maxScore.toFixed(1)}
            {' Â· '}
            <Text style={{ color: autoSignal.grade === 'AVOID' ? '#FF5252' : '#00E676' }}>{autoSignal.grade}</Text>
            {autoSignal.atr ? <Text style={{ color: '#888' }}>{' Â· ATR '}{fmt(autoSignal.atr)}</Text> : null}
          </Text>
          <View style={styles.scoreRow}>
            {autoSignal.reasons.map((r, i) => (
              <Text key={i} style={[styles.scoreChip, { color: r.ok ? '#00E676' : '#555' }]}>
                {r.ok ? '✓' : '·'} {r.label}{r.weight > 1 ? ` (×${r.weight})` : ''}
              </Text>
            ))}
          </View>
        </View>
      )}
      {drawSignal?.status_label === 'TRADE' && (
        <View style={[styles.entryBox, {
          borderColor: drawSignal.signal_type === 'LONG' ? '#00C853' : '#FF3B30',
          backgroundColor: drawSignal.signal_type === 'LONG' ? 'rgba(0,200,83,0.08)' : 'rgba(255,59,48,0.08)',
        }]}>
          <Text style={[styles.entryTitle, { color: drawSignal.signal_type === 'LONG' ? '#00E676' : '#FF5252' }]}>
            🎯 {drawSignal.signal_type} · {drawSignal.entry_type || 'A+ AUTO'}
            {drawSignal.entry_method ? ` · ${drawSignal.entry_method}` : ''}
          </Text>
          <View style={styles.entryGrid}>
            <Cell label="ENTRY" value={fmt(drawSignal.entry)} color="#FFD600" />
            <Cell label="SL" value={fmt(drawSignal.sl)} color="#FF5252" />
            <Cell label="TP1" value={fmt(drawSignal.tp1)} color="#00E676" />
            <Cell label="TP2" value={fmt(drawSignal.tp2)} color="#4ade80" />
          </View>
          <View style={styles.riskBox}>
            <Text style={styles.riskLabel}>RR: {drawSignal.rr_ratio || '--'}</Text>
            <View style={styles.riskRow}>
              <View><Text style={styles.riskMetric}>Risk</Text>
                <Text style={[styles.riskValue, { color: '#FF5252' }]}>{fmt(Math.abs(drawSignal.entry - drawSignal.sl))}</Text></View>
              <View><Text style={styles.riskMetric}>Reward</Text>
                <Text style={[styles.riskValue, { color: '#00E676' }]}>{fmt(Math.abs(drawSignal.tp2 - drawSignal.entry))}</Text></View>
              {drawSignal.risk_management?.suggested_lots && (
                <View><Text style={styles.riskMetric}>Lots</Text>
                  <Text style={[styles.riskValue, { color: '#4ade80' }]}>{drawSignal.risk_management.suggested_lots}</Text></View>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SVG helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function drawTradeLine(price, color, label, yScale, chartW) {
  if (!price || isNaN(price)) return null;
  const y = yScale(price);
  return (
    <React.Fragment>
      <Line x1={0} y1={y} x2={chartW} y2={y} stroke={color} strokeWidth={1.2} strokeDasharray="5,4" />
      <SvgText x={6} y={y - 3} fontSize={9} fill={color} fontWeight="bold">{label}</SvgText>
    </React.Fragment>
  );
}
function axisTag(price, color, label, yScale, rightW) {
  if (!price || isNaN(price)) return null;
  const y = yScale(price);
  return (
    <React.Fragment>
      <Rect x={0} y={y - 7} width={rightW} height={14} fill={color} opacity={0.85} />
      <SvgText x={4} y={y + 3} fontSize={8} fill="#000" fontWeight="bold">
        {`${label} ${price.toFixed(2)}`}
      </SvgText>
    </React.Fragment>
  );
}
// v6.1 FIX #2: EMA path aligned with candle center via candleOffset
function emaPath(series, xPos, yScale, color, candleOffset = 0) {
  if (!series || !series.length) return null;
  const pts = [];
  series.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) {
      pts.push(`${xPos(i) + candleOffset},${yScale(v)}`);
    }
  });
  if (pts.length < 2) return null;
  return <Polyline fill="none" stroke={color} strokeWidth={1.2} points={pts.join(' ')} />;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// indicator math
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period; out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const ch = values[i] - values[i - 1]; if (ch >= 0) gain += ch; else loss -= ch; }
  let avgG = gain / period, avgL = loss / period;
  out[period] = 100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL));
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL));
  }
  return out;
}
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i]; if (i >= period) s -= values[i - period];
    if (i >= period - 1) out[i] = s / period;
  }
  return out;
}
function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  });
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += trs[i];
  prev /= period; out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

function computeHtfBias(htf) {
  if (!htf || htf.length < 200) return null;
  const closes = htf.map(c => c.close);
  const ema50Arr = ema(closes, 50);
  const e50 = ema50Arr[ema50Arr.length - 1];
  const ema200Arr = ema(closes, 200);
  const e200 = ema200Arr[ema200Arr.length - 1] ?? e50;
  const lastClose = closes[closes.length - 1];
  if (e50 == null) return null;
  const dir = (lastClose > e50 && e50 >= (e200 ?? e50)) ? 'BULL'
    : (lastClose < e50 && e50 <= (e200 ?? e50)) ? 'BEAR'
      : (lastClose > e50 ? 'BULL' : 'BEAR');
  return { dir, e50, e200 };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DST-aware session detection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isDST(d) {
  const y = d.getUTCFullYear();
  const mar = new Date(Date.UTC(y, 2, 31));
  const oct = new Date(Date.UTC(y, 9, 31));
  const lastSunMar = 31 - mar.getUTCDay();
  const lastSunOct = 31 - oct.getUTCDay();
  const start = Date.UTC(y, 2, lastSunMar, 1);
  const end = Date.UTC(y, 9, lastSunOct, 1);
  const t = d.getTime();
  return t >= start && t < end;
}
function sessionKind(date) {
  const dst = isDST(date);
  const h = date.getUTCHours();
  const lonStart = dst ? 7 : 8, lonEnd = dst ? 12 : 13;
  const nyStart = dst ? 12 : 13, nyEnd = dst ? 21 : 22;
  if (h >= lonStart && h < lonEnd) return 'LDN';
  if (h >= nyStart && h < nyEnd) return 'NY';
  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SMC ENGINE v6.1
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function computeOverlays(candles) {
  const empty = {
    demand: [], supply: [], fvg: [], orderBlocks: [],
    swingHighs: [], swingLows: [],
    supportLine: null, resistanceLine: null,
    ema: null, rsi: [], divergences: [],
    bos: [], sweeps: [], volAvg: [], sessions: [],
    eqHighs: [], eqLows: [], displacement: {}, atr: [],
    liquidityPools: [], dolTargets: [], inducement: [], volRegime: null,
  };
  if (!candles || candles.length < 30) return empty;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume || 0);
  const bodies = candles.map(c => Math.abs(c.close - c.open));
  const ranges = candles.map(c => Math.max(c.high - c.low, 1e-9));
  const avgBody = sma(bodies, 20);
  const avgRange = sma(ranges, 20);
  const atrArr = atr(candles, 14);

  // Displacement requires body/range efficiency >= 0.6
  const displacement = {};
  candles.forEach((c, i) => {
    const ab = avgBody[i] || 0, ar = avgRange[i] || 0;
    if (ab === 0 || ar === 0) return;
    const efficiency = bodies[i] / ranges[i];
    const isImpulsive = bodies[i] > ab * 1.8 && ranges[i] > ar * 1.5 && efficiency >= 0.6;
    if (isImpulsive) displacement[i] = c.close >= c.open ? 'BULL' : 'BEAR';
  });

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiArr = rsi(closes, 14);
  const volAvg = sma(volumes, 20);

  // v6.1 FIX #9: NaN guard on regime
  let volRegime = null;
  const validAtr = atrArr.filter(v => v != null);
  if (validAtr.length > 20) {
    const recentAtr = atrArr[atrArr.length - 1];
    const slice = validAtr.slice(-50);
    let sum = 0;
    for (let i = 0; i < slice.length; i++) sum += slice[i];
    const meanAtr = sum / Math.max(slice.length, 1);
    const ratio = meanAtr > 0 ? recentAtr / meanAtr : 1;
    const state = ratio < 0.75 ? 'COMPRESSION' : ratio > 1.4 ? 'EXPANSION' : 'NORMAL';
    volRegime = { state, ratio, atr: recentAtr };
  }

  // Swings
  const lb = 3;
  const sH = [], sL = [];
  for (let i = lb; i < candles.length - lb; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lb; j++) {
      if (candles[i - j].high >= candles[i].high || candles[i + j].high >= candles[i].high) isH = false;
      if (candles[i - j].low <= candles[i].low || candles[i + j].low <= candles[i].low) isL = false;
    }
    if (isH) sH.push({ i, level: candles[i].high });
    if (isL) sL.push({ i, level: candles[i].low });
  }

  // Demand / Supply
  const demand = sL.slice(-6).filter(p => candles.slice(p.i + 1).every(c => c.low > p.level * 0.999)).slice(-2)
    .map(p => ({ fromIdx: p.i, bottom: p.level, top: Math.max(p.level, candles[p.i].open, candles[p.i].close) }));
  const supply = sH.slice(-6).filter(p => candles.slice(p.i + 1).every(c => c.high < p.level * 1.001)).slice(-2)
    .map(p => ({ fromIdx: p.i, top: p.level, bottom: Math.min(p.level, candles[p.i].open, candles[p.i].close) }));

  // FVG with partial-fill tracking
  const fvgRaw = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], b = candles[i - 1], c = candles[i];
    const ab = avgBody[i - 1] || 0;
    if (ab === 0 || bodies[i - 1] < ab * 1.5) continue;
    const bullBody = b.close > b.open;
    const bearBody = b.close < b.open;
    if (a.high < c.low && bullBody) fvgRaw.push({ type: 'BULL', fromIdx: i, top: c.low, bottom: a.high });
    if (a.low > c.high && bearBody) fvgRaw.push({ type: 'BEAR', fromIdx: i, top: a.low, bottom: c.high });
  }
  const fvg = fvgRaw.map(g => {
    // v6.1 FIX #5: divide-by-zero guard
    const gapSize = Math.max(g.top - g.bottom, 1e-9);
    const after = candles.slice(g.fromIdx + 1);
    let deepest = g.type === 'BULL' ? g.top : g.bottom;
    for (const c of after) {
      if (g.type === 'BULL') deepest = Math.min(deepest, c.low);
      else deepest = Math.max(deepest, c.high);
    }
    let fillPct;
    if (g.type === 'BULL') {
      fillPct = Math.max(0, Math.min(1, (g.top - deepest) / gapSize));
    } else {
      fillPct = Math.max(0, Math.min(1, (deepest - g.bottom) / gapSize));
    }
    const strength = fillPct <= 0.5 ? 'STRONG' : fillPct <= 0.8 ? 'WEAK' : 'DEAD';
    return { ...g, fillPct, strength };
  }).filter(g => g.strength !== 'DEAD').slice(-6);

  // v6.1 FIX #8: Sweep detection uses rejection wick ratio
  const rawSweeps = [];
  for (let i = lb + 1; i < candles.length; i++) {
    const c = candles[i];
    const range = Math.max(c.high - c.low, 1e-9);
    const priorHighs = sH.filter(s => s.i < i - 1).slice(-3);
    const priorLows = sL.filter(s => s.i < i - 1).slice(-3);
    for (const h of priorHighs) {
      const rejection = (c.high - c.close) / range;
      if (c.high > h.level && rejection > 0.35) {
        rawSweeps.push({ i, level: h.level, dir: 'BEAR' }); break;
      }
    }
    for (const l of priorLows) {
      const rejection = (c.close - c.low) / range;
      if (c.low < l.level && rejection > 0.35) {
        rawSweeps.push({ i, level: l.level, dir: 'BULL' }); break;
      }
    }
  }
  const sweepIdxSet = new Set(rawSweeps.map(s => `${s.i}:${s.dir}`));

  // Order Blocks
  const orderBlocks = [];
  for (let i = 1; i < candles.length; i++) {
    if (!displacement[i]) continue;
    const dir = displacement[i];
    const prev = candles[i - 1];
    const prevUp = prev.close >= prev.open;
    let hasImbalance = false;
    if (i >= 2) {
      const a = candles[i - 2], c = candles[i];
      if (dir === 'BULL' && a.high < c.low) hasImbalance = true;
      if (dir === 'BEAR' && a.low > c.high) hasImbalance = true;
    }
    const nearbySweep = rawSweeps.some(
      s =>
        (
          (dir === 'BULL' && s.dir === 'BEAR') ||
          (dir === 'BEAR' && s.dir === 'BULL')
        ) &&
        (i - s.i) >= 0 &&
        (i - s.i) <= 6
    )
      || sweepIdxSet.has(`${i}:${dir}`);
    if (!hasImbalance || !nearbySweep) continue;
    if (dir === 'BULL' && !prevUp) {
      orderBlocks.push({ dir: 'BULL', fromIdx: i - 1, top: prev.high, bottom: prev.low, originI: i });
    } else if (dir === 'BEAR' && prevUp) {
      orderBlocks.push({ dir: 'BEAR', fromIdx: i - 1, top: prev.high, bottom: prev.low, originI: i });
    }
  }
  const obFiltered = orderBlocks.filter(o => {
    const mid = (o.top + o.bottom) / 2;
    const after = candles.slice(o.fromIdx + 1);
    if (o.dir === 'BULL') return !after.some(c => c.low <= mid);
    return !after.some(c => c.high >= mid);
  }).slice(-4);

  // Trendlines
  const resistanceLine = bestTrendline(sH, candles.length, 'RES');
  const supportLine = bestTrendline(sL, candles.length, 'SUP');

  // v6.1 FIX #6: BOS requires body close acceptance
  const bos = [];
  let lastTrend = null;
  const consumedH = new Set(), consumedL = new Set();
  for (let i = lb + 1; i < candles.length; i++) {
    const c = candles[i];
    const ar = avgRange[i] || 0;
    const dispDir = displacement[i];

    const filteredH = sH.filter(s => s.i < i && !consumedH.has(s.i));
    const upH = filteredH[filteredH.length - 1];
    const filteredL = sL.filter(s => s.i < i && !consumedL.has(s.i));
    const upL = filteredL[filteredL.length - 1];

    if (upH && c.close > upH.level && Math.min(c.open, c.close) > upH.level) {
      const bodyBreak = true; // body acceptance enforced above
      const closeExt = (c.close - upH.level) > ar * 0.25;
      const strong = dispDir === 'BULL' || closeExt;
      if (!strong) continue;
      const choch = lastTrend === 'BEAR';
      const recentBearSweep = sweepsInRange(candles, sH, sL, i - 6, i, 'BEAR');
      const mss = choch && recentBearSweep && dispDir === 'BULL';
      bos.push({ i, fromI: upH.i, level: upH.level, dir: 'BULL', choch, mss, external: choch || mss, body: bodyBreak });
      consumedH.add(upH.i);
      lastTrend = 'BULL';
    } else if (upL && c.close < upL.level && Math.max(c.open, c.close) < upL.level) {
      const bodyBreak = true;
      const closeExt = (upL.level - c.close) > ar * 0.25;
      const strong = dispDir === 'BEAR' || closeExt;
      if (!strong) continue;
      const choch = lastTrend === 'BULL';
      const recentBullSweep = sweepsInRange(candles, sH, sL, i - 6, i, 'BULL');
      const mss = choch && recentBullSweep && dispDir === 'BEAR';
      bos.push({ i, fromI: upL.i, level: upL.level, dir: 'BEAR', choch, mss, external: choch || mss, body: bodyBreak });
      consumedL.add(upL.i);
      lastTrend = 'BEAR';
    }
  }
  const bosTrim = bos.slice(-5);
  const sweepsTrim = rawSweeps.slice(-5);

  // Sequential pivot divergence
  const divergences = [];
  const recentSH = sH.slice(-6), recentSL = sL.slice(-6);
  for (let k = 1; k < recentSH.length; k++) {
    const A = recentSH[k - 1], B = recentSH[k];
    if (B.i - A.i < 4) continue;
    const rA = rsiArr[A.i], rB = rsiArr[B.i];
    if (rA == null || rB == null) continue;
    if (B.level > A.level && rB < rA - 2) divergences.push({ type: 'BEAR', i: B.i, price: B.level });
  }
  for (let k = 1; k < recentSL.length; k++) {
    const A = recentSL[k - 1], B = recentSL[k];
    if (B.i - A.i < 4) continue;
    const rA = rsiArr[A.i], rB = rsiArr[B.i];
    if (rA == null || rB == null) continue;
    if (B.level < A.level && rB > rA + 2) divergences.push({ type: 'BULL', i: B.i, price: B.level });
  }

  // Equal Highs / Lows
  const eqTol = closes[closes.length - 1] * 0.0008;
  const eqHighs = [], eqLows = [];
  for (let a = 0; a < sH.length - 1; a++) {
    for (let b = a + 1; b < sH.length; b++) {
      if (Math.abs(sH[a].level - sH[b].level) <= eqTol && (sH[b].i - sH[a].i) >= 3) {
        eqHighs.push({ from: sH[a].i, to: sH[b].i, level: (sH[a].level + sH[b].level) / 2 });
      }
    }
  }
  for (let a = 0; a < sL.length - 1; a++) {
    for (let b = a + 1; b < sL.length; b++) {
      if (Math.abs(sL[a].level - sL[b].level) <= eqTol && (sL[b].i - sL[a].i) >= 3) {
        eqLows.push({ from: sL[a].i, to: sL[b].i, level: (sL[a].level + sL[b].level) / 2 });
      }
    }
  }

  const liquidityPools = clusterLiquidity(sH, sL, candles, closes[closes.length - 1]);

  // DST-aware sessions
  const sessions = [];
  let cur = null;
  candles.forEach((c, i) => {
    const kind = sessionKind(new Date(c.time));
    if (kind !== (cur?.kind || null)) { if (cur) sessions.push(cur); cur = kind ? { kind, from: i, to: i } : null; }
    else if (cur) cur.to = i;
  });
  if (cur) sessions.push(cur);

  const { dolTargets, inducement } = computeDolAndInducement(
    candles, sH, sL, liquidityPools, sweepsTrim, lastTrend, closes[closes.length - 1],
  );

  return {
    demand, supply, fvg, orderBlocks: obFiltered,
    swingHighs: sH, swingLows: sL,
    supportLine, resistanceLine,
    ema: { ema20, ema50, ema200 },
    rsi: rsiArr, divergences,
    bos: bosTrim, sweeps: sweepsTrim,
    volAvg, sessions,
    eqHighs: eqHighs.slice(-3), eqLows: eqLows.slice(-3),
    displacement, atr: atrArr,
    liquidityPools, dolTargets, inducement, volRegime,
  };
}

function sweepsInRange(candles, sH, sL, lo, hi, wantDir) {
  for (let i = Math.max(0, lo); i <= hi && i < candles.length; i++) {
    const c = candles[i];
    const range = Math.max(c.high - c.low, 1e-9);
    if (wantDir === 'BEAR') {
      const hs = sH.filter(s => s.i < i - 1).slice(-3);
      if (hs.some(h => c.high > h.level && ((c.high - c.close) / range) > 0.35)) return true;
    } else {
      const ls = sL.filter(s => s.i < i - 1).slice(-3);
      if (ls.some(l => c.low < l.level && ((c.close - c.low) / range) > 0.35)) return true;
    }
  }
  return false;
}

function clusterLiquidity(sH, sL, candles, refPrice) {
  if (!refPrice) return [];
  const tol = refPrice * 0.0012;
  const buildClusters = (pivots, side) => {
    const clusters = [];
    for (const p of pivots) {
      const c = clusters.find(cl => Math.abs(cl.level - p.level) <= tol);
      if (c) {
        c.touches += 1;
        c.level = (c.level * (c.touches - 1) + p.level) / c.touches;
        c.from = Math.min(c.from, p.i);
        c.to = Math.max(c.to, p.i);
      } else {
        clusters.push({ level: p.level, touches: 1, from: p.i, to: p.i, side });
      }
    }
    return clusters.filter(c => c.touches >= 2);
  };
  const stamp = (cluster) => {
    const after = candles.slice(cluster.to + 1);
    let swept = false;
    if (cluster.side === 'HIGH') swept = after.some(k => k.high > cluster.level);
    else swept = after.some(k => k.low < cluster.level);
    return { ...cluster, swept };
  };
  return [
    ...buildClusters(sH, 'HIGH').map(stamp),
    ...buildClusters(sL, 'LOW').map(stamp),
  ].sort((a, b) => b.touches - a.touches).slice(0, 6);
}

function computeDolAndInducement(candles, sH, sL, pools, sweeps, lastTrend, refPrice) {
  if (!refPrice || !candles.length) return { dolTargets: [], inducement: [] };
  const last = candles[candles.length - 1];
  const price = last.close;

  const above = pools.filter(p => !p.swept && p.level > price);
  const below = pools.filter(p => !p.swept && p.level < price);

  const recentSH = sH.slice(-8).filter(p => p.level > price).sort((a, b) => a.level - b.level);
  const recentSL = sL.slice(-8).filter(p => p.level < price).sort((a, b) => b.level - a.level);

  const scoreTarget = (level, touches, side) => {
    const distPct = Math.abs(level - price) / price;
    const proximity = Math.max(0, 1 - distPct / 0.02);
    const touchScore = Math.min(1, touches / 4);
    let trendBoost = 0;
    if (side === 'HIGH' && lastTrend === 'BULL') trendBoost = 0.2;
    if (side === 'LOW' && lastTrend === 'BEAR') trendBoost = 0.2;
    return Math.min(1, proximity * 0.5 + touchScore * 0.4 + trendBoost);
  };

  const dolTargets = [];

  // v6.1 FIX #14: pick strongest liquidity (touches weighted), not nearest
  const sortedAbove = [...above].sort((a, b) => {
    const aScore = (a.touches * 2) - (Math.abs(a.level - price) / price);
    const bScore = (b.touches * 2) - (Math.abs(b.level - price) / price);
    return bScore - aScore;
  });
  const sortedBelow = [...below].sort((a, b) => {
    const aScore = (a.touches * 2) - (Math.abs(a.level - price) / price);
    const bScore = (b.touches * 2) - (Math.abs(b.level - price) / price);
    return bScore - aScore;
  });
  const topAbove = sortedAbove[0]
    || (recentSH[0] ? { level: recentSH[0].level, touches: 1, side: 'HIGH', from: recentSH[0].i, to: recentSH[0].i } : null);
  if (topAbove) {
    dolTargets.push({
      level: topAbove.level,
      side: 'HIGH',
      kind: topAbove.touches >= 2 ? 'BSL Pool' : 'BSL Swing',
      confidence: scoreTarget(topAbove.level, topAbove.touches || 1, 'HIGH'),
    });
  }
  const topBelow = sortedBelow[0]
    || (recentSL[0] ? { level: recentSL[0].level, touches: 1, side: 'LOW', from: recentSL[0].i, to: recentSL[0].i } : null);
  if (topBelow) {
    dolTargets.push({
      level: topBelow.level,
      side: 'LOW',
      kind: topBelow.touches >= 2 ? 'SSL Pool' : 'SSL Swing',
      confidence: scoreTarget(topBelow.level, topBelow.touches || 1, 'LOW'),
    });
  }

  const inducement = [];
  if (topAbove) {
    const minorAbove = recentSH.find(p => p.level < topAbove.level && p.level > price);
    if (minorAbove) inducement.push({ i: minorAbove.i, level: minorAbove.level, side: 'HIGH' });
  }
  if (topBelow) {
    const minorBelow = recentSL.find(p => p.level > topBelow.level && p.level < price);
    if (minorBelow) inducement.push({ i: minorBelow.i, level: minorBelow.level, side: 'LOW' });
  }

  return { dolTargets, inducement };
}

function bestTrendline(pivots, totalLen, kind) {
  if (!pivots || pivots.length < 3) return null;
  const recent = pivots.slice(-8);
  const tol = 0.002;
  let best = null;
  for (let a = 0; a < recent.length - 1; a++) {
    for (let b = a + 1; b < recent.length; b++) {
      const A = recent[a], B = recent[b];
      const dx = B.i - A.i;
      if (dx < 5) continue;
      const slope = (B.level - A.level) / dx;
      if (Math.abs(slope) / Math.max(A.level, 1) > 0.01) continue;
      let touches = 0;
      for (const p of recent) {
        const expected = A.level + slope * (p.i - A.i);
        const diff = Math.abs(p.level - expected) / Math.max(p.level, 1);
        if (diff <= tol) touches++;
        if (touches >= 5) break;
      }
      if (touches >= 3 && (!best || touches > best.touches)) best = { A, B, slope, touches };
    }
  }
  if (!best) return null;
  return {
    x1: best.A.i, y1: best.A.level, x2: best.B.i, y2: best.B.level,
    y2Projected: best.B.level + best.slope * (totalLen - 1 - best.B.i),
    touches: best.touches,
  };
}

function sliceOverlays(full, viewStart, viewLen) {
  if (!full || !full.ema) return full;
  const reIdx = i => i - viewStart;
  const keep = i => i >= viewStart && i < viewStart + viewLen;
  const remapDispl = {};
  Object.keys(full.displacement).forEach(k => { const i = +k; if (keep(i)) remapDispl[reIdx(i)] = full.displacement[k]; });
  const remapLine = ln => ln && ({ ...ln, x1: reIdx(ln.x1), x2: reIdx(ln.x2) });
  return {
    demand: full.demand.filter(z => keep(z.fromIdx)).map(z => ({ ...z, fromIdx: reIdx(z.fromIdx) })),
    supply: full.supply.filter(z => keep(z.fromIdx)).map(z => ({ ...z, fromIdx: reIdx(z.fromIdx) })),
    fvg: full.fvg.filter(z => keep(z.fromIdx)).map(z => ({ ...z, fromIdx: reIdx(z.fromIdx) })),
    orderBlocks: full.orderBlocks.filter(z => keep(z.fromIdx)).map(z => ({ ...z, fromIdx: reIdx(z.fromIdx) })),
    swingHighs: full.swingHighs.filter(p => keep(p.i)).map(p => ({ ...p, i: reIdx(p.i) })),
    swingLows: full.swingLows.filter(p => keep(p.i)).map(p => ({ ...p, i: reIdx(p.i) })),
    supportLine: remapLine(full.supportLine),
    resistanceLine: remapLine(full.resistanceLine),
    ema: { ema20: full.ema.ema20.slice(viewStart), ema50: full.ema.ema50.slice(viewStart), ema200: full.ema.ema200.slice(viewStart) },
    rsi: full.rsi.slice(viewStart),
    divergences: full.divergences.filter(d => keep(d.i)).map(d => ({ ...d, i: reIdx(d.i) })),
    bos: full.bos.filter(b => keep(b.i)).map(b => ({ ...b, i: reIdx(b.i), fromI: Math.max(0, reIdx(b.fromI)) })),
    sweeps: full.sweeps.filter(s => keep(s.i)).map(s => ({ ...s, i: reIdx(s.i) })),
    volAvg: full.volAvg.slice(viewStart),
    sessions: full.sessions.filter(s => s.to >= viewStart).map(s => ({ ...s, from: Math.max(0, reIdx(s.from)), to: reIdx(s.to) })),
    eqHighs: full.eqHighs.filter(p => keep(p.to)).map(p => ({ ...p, from: Math.max(0, reIdx(p.from)), to: reIdx(p.to) })),
    eqLows: full.eqLows.filter(p => keep(p.to)).map(p => ({ ...p, from: Math.max(0, reIdx(p.from)), to: reIdx(p.to) })),
    displacement: remapDispl,
    atr: full.atr.slice(viewStart),
    // v6.1 FIX #13: filter pools strictly by viewport
    liquidityPools: full.liquidityPools
      .filter(p => p.to >= viewStart)
      .map(p => ({ ...p, from: Math.max(0, reIdx(p.from)), to: Math.max(0, reIdx(p.to)) })),
    dolTargets: full.dolTargets,
    inducement: full.inducement.filter(d => keep(d.i)).map(d => ({ ...d, i: reIdx(d.i) })),
    volRegime: full.volRegime,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AUTO A+ SETUP â€” v6.1
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildAutoSignal(candles, ov, livePrice, htfBias) {
  if (!candles || candles.length < 50 || !ov?.ema) return null;
  const last = candles[candles.length - 1];
  const price = livePrice ?? last.close;

  const e20 = ov.ema.ema20[ov.ema.ema20.length - 1];
  const e50 = ov.ema.ema50[ov.ema.ema50.length - 1];
  const e200 = ov.ema.ema200[ov.ema.ema200.length - 1];
  const volNow = last.volume || 0;
  const volAvgNow = ov.volAvg[ov.volAvg.length - 1] || 0;
  const atrNow = ov.atr[ov.atr.length - 1] || 0;

  const lastBos = ov.bos[ov.bos.length - 1];
  const lastMss = [...ov.bos].reverse().find(b => b.mss);
  const lastSweep = ov.sweeps[ov.sweeps.length - 1];
  const lastDiv = ov.divergences[ov.divergences.length - 1];
  const inFvg = ov.fvg.find(g => g.strength === 'STRONG' && price >= g.bottom && price <= g.top);
  const lastOB = ov.orderBlocks[ov.orderBlocks.length - 1];
  const lastDispl = Object.keys(ov.displacement).map(Number).sort((a, b) => b - a)[0];
  const hasDispl = lastDispl != null && (candles.length - 1 - lastDispl) <= 10;

  let dir = null;
  if (lastMss && (candles.length - 1 - lastMss.i) <= 10) dir = lastMss.dir;
  else if (lastBos?.dir === 'BULL' && e20 > e50) dir = 'BULL';
  else if (lastBos?.dir === 'BEAR' && e20 < e50) dir = 'BEAR';
  else if (e20 != null && e50 != null) dir = e20 > e50 ? 'BULL' : 'BEAR';
  if (!dir) return null;

  const htfAligned = !htfBias || htfBias.dir === dir;

  // v6.1 FIX #4: range without spread
  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const eq = (hi + lo) / 2;
  const inDiscount = dir === 'BULL' ? price <= eq : price >= eq;

  const regimeOk = !ov.volRegime || ov.volRegime.state !== 'COMPRESSION' || !!lastMss;

  const dolAligned = ov.dolTargets.some(t =>
    (dir === 'BULL' && t.side === 'HIGH' && t.confidence >= 0.4)
    || (dir === 'BEAR' && t.side === 'LOW' && t.confidence >= 0.4),
  );

  const reasons = [
    { label: 'HTF aligned', ok: htfAligned },
    { label: 'MSS', ok: !!lastMss && lastMss.dir === dir && (candles.length - 1 - lastMss.i) <= 10 },
    { label: 'BOS/CHoCH', ok: !!lastBos && lastBos.dir === dir },
    { label: 'Displacement', ok: hasDispl && ov.displacement[lastDispl] === dir },
    { label: 'Liquidity Sweep', ok: !!lastSweep && lastSweep.dir === dir },
    { label: 'FVG/OB confluence', ok: (!!inFvg && inFvg.type === dir) || (!!lastOB && lastOB.dir === dir) },
    { label: 'EMA stack', ok: dir === 'BULL' ? (e20 > e50 && e50 > (e200 ?? e50)) : (e20 < e50 && e50 < (e200 ?? e50)) },
    { label: 'RSI Divergence', ok: !!lastDiv && lastDiv.type === dir },
    { label: 'Vol spike', ok: volAvgNow > 0 && volNow > volAvgNow * 1.3 },
    { label: 'Premium/Discount', ok: inDiscount },
    { label: 'Session (LDN/NY)', ok: !!sessionKind(new Date(last.time)) },
    { label: 'Vol Regime OK', ok: regimeOk },
    { label: 'DOL aligned', ok: dolAligned },
  ].map(r => ({ ...r, weight: WEIGHTS[r.label] || 1 }));

  const score = reasons.reduce((s, r) => s + (r.ok ? r.weight : 0), 0);
  const maxScore = reasons.reduce((s, r) => s + r.weight, 0);
  const pct = score / maxScore;
  const grade =
    pct >= 0.85 ? 'A+ ELITE' :
      pct >= 0.7 ? 'STRONG' :
        pct >= 0.55 ? 'GOOD' :
          pct >= 0.4 ? 'MODERATE' : 'AVOID';

  // v6.1 FIX #17: FVG entry uses 33% discount/premium not midpoint
  let entry = null, method = null;
  if (inFvg && inFvg.type === dir) {
    const gapSize = Math.max(inFvg.top - inFvg.bottom, 1e-9);
    entry = dir === 'BULL'
      ? inFvg.bottom + gapSize * 0.33
      : inFvg.top - gapSize * 0.33;
    method = 'FVG 33%';
  } else if (lastOB && lastOB.dir === dir) {
    entry = (lastOB.top + lastOB.bottom) / 2; method = 'OB MITIGATION';
  } else if (lastMss && lastMss.dir === dir) {
    entry = lastMss.level; method = 'MSS RETEST';
  } else if (lastBos && lastBos.dir === dir) {
    entry = lastBos.level; method = 'BOS RETEST';
  }

  if (pct < 0.55 || entry == null) {
    return { score, maxScore, grade, reasons, atr: atrNow, status_label: 'NO-TRADE' };
  }

  const swing =
    dir === 'BULL'
      ? ov.swingLows[ov.swingLows.length - 1]?.level
      : ov.swingHighs[ov.swingHighs.length - 1]?.level;
  if (swing == null || atrNow <= 0) {
    return { score, maxScore, grade, reasons, atr: atrNow, status_label: 'NO-TRADE' };
  }
  const slBuffer = atrNow * 0.3;
  let sl = dir === 'BULL'
    ? Math.min(swing - slBuffer, entry - slBuffer)
    : Math.max(swing + slBuffer, entry + slBuffer);
  let risk = Math.abs(entry - sl);
  // v6.1 FIX #15: minimum risk floor (price * 0.001)
  const minRisk = price * 0.001;
  if (risk < minRisk) {
    risk = minRisk;
    sl = dir === 'BULL' ? entry - risk : entry + risk;
  }
  if (risk <= 0) return { score, maxScore, grade, reasons, atr: atrNow, status_label: 'NO-TRADE' };

  let tp2 = dir === 'BULL' ? entry + risk * 4 : entry - risk * 4;
  const dolTgt = ov.dolTargets.find(t =>
    (dir === 'BULL' && t.side === 'HIGH') || (dir === 'BEAR' && t.side === 'LOW'),
  );
  if (dolTgt) {
    const dolRR = Math.abs(dolTgt.level - entry) / risk;
    if (dolRR >= 3 && dolRR <= 6) tp2 = dolTgt.level;
  }
  const tp1 = dir === 'BULL' ? entry + risk * 2 : entry - risk * 2;
  const rr = (Math.abs(tp2 - entry) / risk).toFixed(1);

  return {
    status_label: 'TRADE',
    signal_type: dir === 'BULL' ? 'LONG' : 'SHORT',
    entry_type: grade, entry_method: method,
    entry, sl, tp1, tp2,
    rr_ratio: `1 : ${rr}`,
    score, maxScore, grade, reasons, atr: atrNow,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const Pill = ({ title, color, text }) => (
  <View style={styles.zoneBox}><Text style={[styles.zoneLabel, { color }]}>{title}</Text>
    <Text style={[styles.zonePrice, { color }]}>{text}</Text></View>
);
const Cell = ({ label, value, color }) => (
  <View style={styles.entryItem}><Text style={styles.entryLabel}>{label}</Text>
    <Text style={[styles.entryValue, color && { color }]}>{value}</Text></View>
);
const Legend = ({ color, label, line }) => (
  <View style={styles.legendItem}>
    <View style={[line ? styles.legendLine : styles.legendDot, { backgroundColor: color }]} />
    <Text style={styles.legendText}>{label}</Text></View>
);

const styles = StyleSheet.create({
  container: { padding: 15, backgroundColor: '#0a0a0a', borderRadius: 15, marginVertical: 10, borderWidth: 1, borderColor: '#1a1a1a' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  livePrice: { color: '#60a5fa', fontWeight: 'bold', fontSize: 14 },
  timeframeSelector: { flexDirection: 'row', marginBottom: 8, flexWrap: 'wrap' },
  tfBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 6, marginBottom: 6 },
  tfBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tfText: { color: '#FFF', fontWeight: 'bold', fontSize: 11 },
  zoomBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginLeft: 6, marginBottom: 6 },
  zoomText: { color: '#FFF', fontWeight: 'bold', fontSize: 11 },
  toggleRow: { flexDirection: 'row' },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 6 },
  chipActive: { backgroundColor: '#1f2937', borderColor: '#60a5fa' },
  chipText: { color: '#666', fontSize: 10, fontWeight: 'bold' },
  chipTextActive: { color: '#fff' },
  chartAreaWrapper: { position: 'relative' },
  chartArea: { flexDirection: 'row', backgroundColor: '#0f0f0f', borderRadius: 10, padding: 6, marginBottom: 10, height: CHART_H + 12 },
  fullscreenHint: { position: 'absolute', bottom: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', padding: 6, borderRadius: 6 },
  hintText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 4 },
  legendLine: { width: 14, height: 2, marginRight: 4 },
  legendText: { color: '#888', fontSize: 10 },
  zoneBox: { backgroundColor: '#111', padding: 8, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#222', minWidth: 110 },
  zoneLabel: { fontSize: 10, marginBottom: 4, fontWeight: 'bold' },
  zonePrice: { fontWeight: 'bold', fontSize: 12 },
  scoreBox: { backgroundColor: '#0f1115', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1f2937', marginBottom: 10 },
  scoreTitle: { color: '#fff', fontWeight: 'bold', marginBottom: 6, fontSize: 12 },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap' },
  scoreChip: { fontSize: 10, marginRight: 10, marginBottom: 4, fontWeight: 'bold' },
  entryBox: { borderRadius: 10, padding: 14, borderWidth: 1, marginTop: 6 },
  entryTitle: { fontWeight: 'bold', marginBottom: 10, fontSize: 13 },
  entryGrid: { flexDirection: 'row', marginBottom: 12 },
  entryItem: { width: '25%', alignItems: 'center' },
  entryLabel: { color: '#888', fontSize: 10 },
  entryValue: { color: '#FFF', fontWeight: 'bold', fontSize: 13, marginTop: 4 },
  riskBox: { backgroundColor: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#222' },
  riskLabel: { color: '#aaa', fontSize: 11, fontWeight: 'bold', marginBottom: 8 },
  riskRow: { flexDirection: 'row', justifyContent: 'space-around' },
  riskMetric: { color: '#888', fontSize: 9, marginBottom: 4 },
  riskValue: { fontWeight: 'bold', fontSize: 13 },
  fullscreenContainer: { flex: 1, backgroundColor: '#000', padding: 15 },
  fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  fullscreenTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  closeBtn: { backgroundColor: COLORS.primary, padding: 10, borderRadius: 10 },
  closeText: { color: '#FFF', fontWeight: 'bold' },
  fullscreenChartWrap: { flex: 1, backgroundColor: '#0f0f0f', borderRadius: 15, padding: 10, justifyContent: 'center' },
});

export default ChartWithZones;
