
// Uses react-native-wagmi-charts (or fall back to a simple line) + SVG overlays
// for FVG, OB, BOS, CHoCH, liquidity sweeps, trendlines, premium/discount.
// Install:  yarn add react-native-wagmi-charts react-native-svg

import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ActivityIndicator, StyleSheet,
  Dimensions, TouchableOpacity, Modal, useWindowDimensions
} from 'react-native';
import Svg, { Line, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../theme';

import { Platform } from 'react-native';
import Config from '../config';
const API_URL = Config.API_URL;

const ChartView = ({ pair, timeframe, dataSource, signal }) => {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const W = SCREEN_W - 40;
  const H = 320;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWeakFVGs, setShowWeakFVGs] = useState(false);

  useEffect(() => {
    if (!pair) return;
    setLoading(true);
    fetch(`${API_URL}/api/v1/chart-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair, timeframe, dataSource })
    })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  }, [pair, timeframe, dataSource]);

  const allCandles = useMemo(() => data?.candles || [], [data]);
  const candles = useMemo(() => allCandles.slice(-100), [allCandles]);
  const candleOffset = useMemo(() => Math.max(0, allCandles.length - 100), [allCandles]);
  const o = useMemo(() => data?.overlays || {}, [data]);
  console.log(
    'TRENDLINES',
    JSON.stringify(data?.overlays?.trendline, null, 2)
  );
  const renderSvg = (width, height) => {
    if (!candles.length) return null;
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const xStep = width / candles.length;
    const yScale = (v) => height - ((v - min) / (Math.max(max - min, 0.0001))) * height;
    const xPos = (i) => i * xStep;
    // compute simple ATR-like range (average high-low)
    const atr = (() => {
      const N = Math.min(14, candles.length);
      if (N <= 0) return 0;
      const slice = candles.slice(-N);
      const sum = slice.reduce((s, c) => s + Math.max(c.high - c.low, 0), 0);
      return sum / N || Math.max(candles.at(-1)?.high - candles.at(-1)?.low || 0, 0.0001);
    })();

    return (
      <Svg width={width} height={height}>
        {/* Overlays render first; candles will be rendered on top below to keep last bar visible */}

        {/* FVG zones (show STRONG only by default; toggle to include WEAK) */}
        {(o.fvg_bull || []).slice(-5).filter(g => showWeakFVGs ? true : (g.strength === 'STRONG')).map((g, k) => {
          const idx = candles.findIndex(c => c.datetime === data.candles[g.i]?.datetime);
          if (idx < 0) return null;
          return (
            <Rect
              key={`fb${k}`} x={xPos(idx)} y={yScale(g.top)}
              width={width - xPos(idx)} height={Math.max(yScale(g.bottom) - yScale(g.top), 1)}
              fill="rgba(74,222,128,0.15)"
            />
          );
        })}
        {(o.fvg_bear || []).slice(-5).filter(g => showWeakFVGs ? true : (g.strength === 'STRONG')).map((g, k) => {
          const idx = candles.findIndex(c => c.datetime === data.candles[g.i]?.datetime);
          if (idx < 0) return null;
          return (
            <Rect
              key={`fr${k}`} x={xPos(idx)} y={yScale(g.top)}
              width={width - xPos(idx)} height={Math.max(yScale(g.bottom) - yScale(g.top), 1)}
              fill="rgba(255,82,82,0.15)"
            />
          );
        })}

        {/* Order Block */}
        {o.order_block && (() => {
          // map numeric or proxy strength to opacity/stroke
          const raw = o.order_block.strength;
          const s = typeof raw === 'number' ? Math.min(1, Math.abs(raw)) : (raw === 'STRONG' ? 1 : 0.6);
          const fillOpacity = 0.06 + s * 0.36; // 0.06..0.42
          const strokeW = 1 + s * 2; // 1..3
          const color = o.order_block.type === 'BULLISH' ? '96,165,250' : '244,114,182';
          return (
            <React.Fragment>
              <Rect
                x={0} y={yScale(o.order_block.top)}
                width={width} height={Math.max(Math.abs(yScale(o.order_block.bottom) - yScale(o.order_block.top)), 1)}
                fill={`rgba(${color},${fillOpacity.toFixed(3)})`}
              />
              <Line x1={0} y1={yScale(o.order_block.top)} x2={width} y2={yScale(o.order_block.top)} stroke={`rgba(${color},${Math.min(1, s + 0.15)})`} strokeWidth={strokeW} />
              <Line x1={0} y1={yScale(o.order_block.bottom)} x2={width} y2={yScale(o.order_block.bottom)} stroke={`rgba(${color},${Math.min(1, s + 0.15)})`} strokeWidth={Math.max(1, strokeW - 0.5)} />
            </React.Fragment>
          );
        })()}

        {/* In-progress live price overlay (do not mutate candles) */}
        {typeof data.live_price === 'number' && (() => {
          const lastIdx = candles.length - 1;
          const last = candles[lastIdx];
          if (!last) return null;
          const x = xPos(lastIdx) + xStep / 2;
          const liveY = yScale(data.live_price);
          const lastCloseY = yScale(last.close);
          const color = data.live_price >= last.close ? '#00E676' : '#FF5252';
          return (
            <React.Fragment>
              <Line x1={x} y1={lastCloseY} x2={x} y2={liveY} stroke={color} strokeWidth={2} strokeDasharray="3,2" />
              <Circle cx={x} cy={liveY} r={3} fill={color} />
              <SvgText x={x + 6} y={liveY - 6} fontSize={10} fill={color}>{'IN-PROG'}</SvgText>
              <SvgText x={x - 12} y={yScale(last.high) - 6} fontSize={10} fill="#AAA">{'Closed'}</SvgText>
            </React.Fragment>
          );
        })()}

        {/* Smart Entry / Target / Stop planner */}
        {signal?.status_label === 'TRADE' && (() => {
          const entryY = yScale(signal.entry);
          const stopY = yScale(signal.sl);
          const targY1 = yScale(signal.tp1);
          const targY2 = yScale(signal.tp2);

          return (
            <React.Fragment>
              {signal.entry ? (
                <>
                  <Line x1={0} y1={entryY} x2={width} y2={entryY} stroke="#FFD600" strokeWidth={1.2} strokeDasharray="4,3" />
                  <SvgText x={6} y={entryY - 6} fontSize={11} fill="#FFD600">{`ENTRY ${signal.entry.toFixed(4)}`}</SvgText>
                </>
              ) : null}

              {signal.tp1 ? (
                <>
                  <Line x1={0} y1={targY1} x2={width} y2={targY1} stroke="#00E676" strokeWidth={1.6} />
                  <SvgText x={6} y={targY1 - 6} fontSize={11} fill="#00E676">{`TP1 ${signal.tp1.toFixed(4)}`}</SvgText>
                </>
              ) : null}

              {signal.tp2 ? (
                <>
                  <Line x1={0} y1={targY2} x2={width} y2={targY2} stroke="#4ade80" strokeWidth={1.6} />
                  <SvgText x={6} y={targY2 - 6} fontSize={11} fill="#4ade80">{`TP2 ${signal.tp2.toFixed(4)}`}</SvgText>
                </>
              ) : null}

              {signal.sl ? (
                <>
                  <Line x1={0} y1={stopY} x2={width} y2={stopY} stroke="#FF5252" strokeWidth={1.6} />
                  <SvgText x={6} y={stopY - 6} fontSize={11} fill="#FF5252">{`STOP ${signal.sl.toFixed(4)}`}</SvgText>
                </>
              ) : null}
            </React.Fragment>
          );
        })()}

        {/* BOS line */}
        {o.bos?.level && (
          <Line x1={0} y1={yScale(o.bos.level)} x2={width} y2={yScale(o.bos.level)}
            stroke={o.bos.type === 'BULLISH' ? '#00E676' : '#FF5252'}
            strokeDasharray="6,4" strokeWidth={1.5} />
        )}

        {/* Premium / Discount mid line */}
        {o.premium_discount?.mid && (
          <Line x1={0} y1={yScale(o.premium_discount.mid)} x2={width} y2={yScale(o.premium_discount.mid)}
            stroke="#888" strokeDasharray="2,3" strokeWidth={1} />
        )}

        {/* Trendlines — projected across full visible range with price-domain slope + clamping */}
        {[['resistance', '#FF5252'], ['support', '#00E676']].map(([key, color]) => {
          const pts = o.trendline?.[key];
          if (!pts || pts.length < 2) return null;

          const i1raw = allCandles.findIndex(c => c.datetime === pts[0].time) - candleOffset;
          const i2raw = allCandles.findIndex(c => c.datetime === pts[1].time) - candleOffset;
          console.log('TREND DEBUG', {
            key,
            time1: pts[0].time,
            time2: pts[1].time,
            i1raw,
            i2raw,
            candleOffset
          });
          // Both points before visible window → skip
          if (i2raw < 0) return null;

          // Calculate slope in PRICE domain (not pixel domain)
          const dxRaw = i2raw - i1raw;
          const priceSlope = dxRaw !== 0
            ? (pts[1].price - pts[0].price) / dxRaw
            : 0;

          // Left clip: if i1raw is off-screen, extrapolate price at visible left edge
          const leftI = Math.max(0, i1raw);
          const rightI = candles.length - 1;

          // Calculate projected prices at left and right edges
          const priceAtLeft = pts[0].price + priceSlope * (leftI - i1raw);
          const priceAtRight = pts[0].price + priceSlope * (rightI - i1raw);

          return (
            <Line
              key={key}
              x1={xPos(leftI)} y1={yScale(priceAtLeft)}
              x2={xPos(rightI)} y2={yScale(priceAtRight)}
              stroke={color} strokeWidth={1.5} strokeDasharray="6,3"
            />
          );
        })}

        {/* Fake traps */}
        {(o.fake_traps || []).map((t, k) => {
          const idx = candles.findIndex(c => c.datetime === t.time);
          if (idx < 0) return null;
          return <Circle key={`ft${k}`} cx={xPos(idx) + xStep / 2} cy={yScale(t.high)} r={3} fill="#facc15" />;
        })}

        {/* CANDLES - drawn last so they stay visible above filled overlays */}
        {candles.map((c, i) => {
          const x = xPos(i);
          const color = c.close >= c.open ? '#00E676' : '#FF5252';
          return (
            <React.Fragment key={`c${i}`}>
              <Line x1={x + xStep / 2} y1={yScale(c.high)} x2={x + xStep / 2} y2={yScale(c.low)} stroke={color} strokeWidth={1} />
              <Rect
                x={x + 1}
                y={yScale(Math.max(c.open, c.close))}
                width={Math.max(xStep - 2, 1)}
                height={Math.max(Math.abs(yScale(c.open) - yScale(c.close)), 1)}
                fill={color}
              />
            </React.Fragment>
          );
        })}
      </Svg>
    );
  };

  if (loading) {
    return (
      <View style={styles.box}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (!data?.candles?.length) {
    return (
      <View style={styles.box}>
        <Text style={styles.muted}>No chart data</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text style={styles.title}>{pair} · {timeframe}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setShowWeakFVGs(s => !s)} style={styles.toggleBtn}>
            <Text style={styles.toggleText}>{showWeakFVGs ? 'FVGs: All' : 'FVGs: Strong'}</Text>
          </TouchableOpacity>
          <Text style={[styles.price, { marginLeft: 8 }]}>{data.live_price?.toFixed(5)}</Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => setIsFullscreen(true)}
        activeOpacity={0.9}
        style={styles.chartTouchable}
      >
        {renderSvg(W, H)}
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>⛶ Fullscreen</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={isFullscreen} animationType="fade" transparent={false}>
        <View style={styles.fullscreenContainer}>
          <View style={styles.fullscreenHeader}>
            <Text style={styles.fullscreenTitle}>{pair} Analysis</Text>
            <TouchableOpacity onPress={() => setIsFullscreen(false)} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.fullscreenChartWrap}>
            {renderSvg(SCREEN_W - 20, SCREEN_H - 120)}
          </View>
        </View>
      </Modal>

      {/* Legend */}
      <View style={styles.legend}>
        <Legend color="rgba(74,222,128,0.4)" label="FVG Bull" />
        <Legend color="rgba(255,82,82,0.4)" label="FVG Bear" />
        <Legend color="rgba(96,165,250,0.4)" label="Order Block" />
        <Legend color="#facc15" label="Trap" />
        <Legend color="#888" label="P/D Mid" />
      </View>
    </View>
  );
};

const Legend = ({ color, label }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color }]} />
    <Text style={styles.legendText}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#0a0a0a', borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: '#1f1f1f', minHeight: 360, justifyContent: 'center',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: '#FFF', fontWeight: 'bold' },
  price: { color: '#00E676', fontWeight: 'bold' },
  muted: { color: '#666', textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 4 },
  legendText: { color: '#888', fontSize: 10 },

  chartTouchable: { position: 'relative' },
  hintBox: {
    position: 'absolute', bottom: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  hintText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

  toggleBtn: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#111', borderRadius: 6, borderWidth: 1, borderColor: '#222' },
  toggleText: { color: '#AAA', fontSize: 11 },

  fullscreenContainer: { flex: 1, backgroundColor: '#000', padding: 10 },
  fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 },
  fullscreenTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  closeBtn: { padding: 10, backgroundColor: '#222', borderRadius: 8 },
  closeText: { color: '#FFF', fontWeight: 'bold' },
  fullscreenChartWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default ChartView;
