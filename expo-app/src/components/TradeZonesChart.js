import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    View, Text, StyleSheet,
    TouchableOpacity, ActivityIndicator, Modal, useWindowDimensions
} from 'react-native';
import Svg, { Rect, Line, Text as SvgText, Path, G } from 'react-native-svg';
import Config from '../config';

const DEFAULT_PRICE_H = 280;
const DEFAULT_VOL_H = 50;
const DEFAULT_CHART_H = DEFAULT_PRICE_H + DEFAULT_VOL_H;
const RIGHT_AXIS_W = 70;
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const API_URL = Config.API_URL;

// ────────────────────────────────────────────────────────────────────
// Normalise different signal shapes into one canonical structure.
// Supports: {entry, sl, tp1, tp2, tp3}
//           {entry_price, stop_loss, take_profit_1/2/3}
//           {levels: {...}}
//           {targets: [tp1, tp2, tp3]}
// ────────────────────────────────────────────────────────────────────
const num = (v) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && !isNaN(n) ? n : null;
};

const normalizeSignal = (s) => {
    if (!s) return null;
    const src = s.levels && typeof s.levels === 'object' ? { ...s, ...s.levels } : s;
    const targets = Array.isArray(src.targets) ? src.targets : [];

    return {
        signal_type:
            src.signal_type ||
            src.side ||
            src.direction ||
            (src.action ? src.action.toUpperCase() : null),
        entry: num(src.entry ?? src.entry_price ?? src.entryPrice ?? src.price),
        sl: num(src.sl ?? src.stop_loss ?? src.stopLoss ?? src.stop),
        tp1: num(src.tp1 ?? src.take_profit_1 ?? src.takeProfit1 ?? targets[0]),
        tp2: num(src.tp2 ?? src.take_profit_2 ?? src.takeProfit2 ?? targets[1]),
        tp3: num(src.tp3 ?? src.take_profit_3 ?? src.takeProfit3 ?? targets[2]),
        current_price: num(src.current_price ?? src.currentPrice ?? src.live_price),
        // Pass through raw direction hints for fallback
        _raw_signal_type: src.signal_type || src.side || src.direction || null,
    };
};

// ─── Derive entry/sl/tp from candles when parent signal has no levels ─────────
// Uses recent swing high/low (ATR-based) to compute approximate levels.
const buildFallbackLevels = (candles, signalType, livePrice) => {
    if (!candles || candles.length < 20) return null;
    const last = candles[candles.length - 1];
    const price = livePrice ?? last.close;

    // Compute ATR(14)
    let atrSum = 0, atrLen = Math.min(14, candles.length - 1);
    for (let i = candles.length - atrLen; i < candles.length; i++) {
        const prev = candles[i - 1];
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - (prev?.close ?? candles[i].high)),
            Math.abs(candles[i].low - (prev?.close ?? candles[i].low))
        );
        atrSum += tr;
    }
    const atr = atrSum / atrLen;
    if (!atr || atr <= 0) return null;

    // Swing high/low over last 20 bars
    const tail = candles.slice(-20);
    let swingHigh = -Infinity, swingLow = Infinity;
    for (const c of tail) {
        if (c.high > swingHigh) swingHigh = c.high;
        if (c.low < swingLow) swingLow = c.low;
    }

    const isLong = !signalType || signalType === 'LONG' || signalType === 'BUY';
    if (isLong) {
        const entry = price;
        const sl = Math.max(swingLow, entry - atr * 1.5);
        const risk = entry - sl;
        return {
            signal_type: 'LONG',
            entry,
            sl,
            tp1: entry + risk * 1.5,
            tp2: entry + risk * 2.5,
            tp3: entry + risk * 4,
            _is_fallback: true,
        };
    } else {
        const entry = price;
        const sl = Math.min(swingHigh, entry + atr * 1.5);
        const risk = sl - entry;
        return {
            signal_type: 'SHORT',
            entry,
            sl,
            tp1: entry - risk * 1.5,
            tp2: entry - risk * 2.5,
            tp3: entry - risk * 4,
            _is_fallback: true,
        };
    }
};

export default function TradeZonesChart({ pair, signal: rawSignal, dataSource = 'YAHOO', onLevels }) {
    const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();

    // 🔑 Normalised signal from parent — chart uses this, falls back to derived levels
    const parentSignal = useMemo(() => normalizeSignal(rawSignal), [rawSignal]);

    const [candles, setCandles] = useState([]);
    const [livePrice, setLivePrice] = useState(parentSignal?.current_price ?? null);
    const [loading, setLoading] = useState(false);
    const [tf, setTf] = useState('15m');
    const [viewN, setViewN] = useState(60);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // 🔧 Final signal: prefer parent levels, fall back to ATR-derived levels from candles.
    // This ensures the chart is NEVER empty even when the API didn't return entry/sl/tp.
  const signal = useMemo(() => {
  // Only trust levels that came from the confirmed parent signal.
  // No ATR/swing fallback — that was causing entry boxes to show on every TF.
  const parentHasLevels = parentSignal &&
    parentSignal.entry != null &&
    parentSignal.sl != null &&
    parentSignal.tp1 != null;
  return parentHasLevels ? parentSignal : null;
}, [parentSignal]);

    // 📡 Emit resolved levels back to parent so it can update its own TradeBlock
    useEffect(() => {
        if (typeof onLevels === 'function' && signal?.entry != null) {
            onLevels(signal);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signal?.entry, signal?.sl, signal?.tp1, signal?.signal_type]);

    const fetchData = useCallback(async (silent = false) => {
        if (!pair) return;
        if (!silent) setLoading(true);
        try {
            const cleanPair = pair.toUpperCase().replace(/[-/_]/g, '');
            const isCrypto = /BTC|ETH|SOL|XRP|DOGE/.test(cleanPair);
            let arr = [], live = null;

            if (isCrypto && dataSource === 'REALTIME') {
                const sym = cleanPair.replace('USD', '') + 'USDT';
                const [k, p] = await Promise.all([
                    fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=200`).then(r => r.json()),
                    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`).then(r => r.json()),
                ]);
                arr = k.map(d => ({
                    time: new Date(d[0]).toISOString(),
                    open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5],
                }));
                live = p.price ? +p.price : null;
            } else {
                const res = await fetch(`${API_URL}/api/v1/chart-data`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pair, timeframe: tf, dataSource, limit: 200 }),
                }).then(r => r.json());
                arr = (res.candles || []).map(c => ({
                    time: c.datetime, open: c.open, high: c.high, low: c.low,
                    close: c.close, volume: c.volume ?? 0,
                }));
                live = res.live_price ?? arr[arr.length - 1]?.close ?? null;
            }
            setCandles(arr.slice(-150));
            setLivePrice(live);
        } catch (e) {
            console.warn('TradeZonesChart fetch err', e);
            if (!silent) setCandles([]);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [pair, tf, dataSource]);

    useEffect(() => {
        fetchData(false);
        const id = setInterval(() => fetchData(true), 15000);
        return () => clearInterval(id);
    }, [fetchData]);

    const visibleCandles = useMemo(() => candles.slice(-viewN), [candles, viewN]);

    const dec = useMemo(() => {
        const p = livePrice ?? visibleCandles[visibleCandles.length - 1]?.close ?? 0;
        if (!p) return 5;
        if (p > 1000) return 2;
        if (p > 50) return 3;
        return 5;
    }, [livePrice, visibleCandles]);

    const fmt = (v) => (typeof v === 'number' && !isNaN(v) ? v.toFixed(dec) : '--');

    const yDomain = useMemo(() => {
        if (!visibleCandles.length) return { min: 0, max: 1 };
        let mn = Infinity, mx = -Infinity;
        for (const c of visibleCandles) {
            if (c.high > mx) mx = c.high;
            if (c.low < mn) mn = c.low;
        }
        [signal?.entry, signal?.sl, signal?.tp1, signal?.tp2, signal?.tp3, livePrice]
            .filter((v) => typeof v === 'number' && !isNaN(v))
            .forEach((v) => { if (v > mx) mx = v; if (v < mn) mn = v; });
        const pad = (mx - mn) * 0.08 || 1;
        return { min: mn - pad, max: mx + pad };
    }, [visibleCandles, signal, livePrice]);

    const zoomIn = () => setViewN(prev => Math.max(20, prev - 15));
    const zoomOut = () => setViewN(prev => Math.min(150, prev + 15));

    // hasLevels: true when signal (parent or fallback) has any usable price levels
    const hasLevels = signal && (signal.entry != null || signal.sl != null || signal.tp1 != null);
    const isFallback = hasLevels && signal?._is_fallback === true;

    const renderSvg = (w, h) => {
        const chartW = w - RIGHT_AXIS_W;
        const chartH = h;
        const volH = Math.min(50, chartH * 0.2);
        const priceH = chartH - volH;
        const xStep = visibleCandles.length ? chartW / (visibleCandles.length + 3) : 1;
        const yScale = (v) =>
            priceH - ((v - yDomain.min) / Math.max(yDomain.max - yDomain.min, 1e-9)) * priceH;
        const xPos = (i) => i * xStep;

        let maxVol = 1;
        for (const c of visibleCandles) if ((c.volume || 0) > maxVol) maxVol = c.volume || 0;
        const vScale = (v) => priceH + (volH - (v / maxVol) * (volH - 4));

        const isLong = signal?.signal_type === 'LONG' || signal?.signal_type === 'BUY';
        const sideColor = isLong ? '#16a34a' : '#ef4444';
        const sideText = isLong ? 'BUY' : 'SELL';

        const yEntry = signal?.entry != null ? yScale(signal.entry) : null;
        const ySL = signal?.sl != null ? yScale(signal.sl) : null;
        const yTP1 = signal?.tp1 != null ? yScale(signal.tp1) : null;
        const yTP2 = signal?.tp2 != null ? yScale(signal.tp2) : null;
        const yTP3 = signal?.tp3 != null ? yScale(signal.tp3) : null;
        const topTP = yTP3 ?? yTP2 ?? yTP1;

        const lastCandleX = xPos(visibleCandles.length - 1) + xStep;
        const boxStartX = Math.max(lastCandleX + 4, chartW * 0.72);
        const boxEndX = chartW - 2;

        const pill = (x, y, ww, color, textColor, label) => {
            const PH = 18, tip = 7, r = 3;
            const top = y - PH / 2, bot = y + PH / 2;
            const left = x, right = x + ww;
            const d = `M ${left} ${y} L ${left + tip} ${top} L ${right - r} ${top} Q ${right} ${top} ${right} ${top + r} L ${right} ${bot - r} Q ${right} ${bot} ${right - r} ${bot} L ${left + tip} ${bot} Z`;
            return (
                <React.Fragment>
                    <Path d={d} fill={color} />
                    <SvgText x={x + tip + 4} y={y + 3.5} fontSize={9} fill={textColor} fontWeight="bold">
                        {label}
                    </SvgText>
                </React.Fragment>
            );
        };

        return (
            <View style={{ flexDirection: 'row' }}>
                <Svg width={chartW} height={chartH}>
                    {/* grid */}
                    {[0.25, 0.5, 0.75].map((p) => (
                        <Line key={`g${p}`} x1={0} y1={priceH * p} x2={chartW} y2={priceH * p}
                            stroke="rgba(255,255,255,0.05)" strokeWidth={0.6} />
                    ))}

                    {/* candles */}
                    {visibleCandles.map((c, i) => {
                        const isLast = i === visibleCandles.length - 1;
                        const close = isLast && livePrice ? livePrice : c.close;
                        const high = isLast && livePrice ? Math.max(c.high, livePrice) : c.high;
                        const low = isLast && livePrice ? Math.min(c.low, livePrice) : c.low;
                        const up = close >= c.open;
                        const color = up ? '#00E676' : '#FF5252';
                        const x = xPos(i);
                        const bodyTop = yScale(Math.max(c.open, close));
                        const bodyH = Math.max(Math.abs(yScale(c.open) - yScale(close)), 1);
                        return (
                            <React.Fragment key={i}>
                                <Line x1={x + xStep / 2} y1={yScale(high)} x2={x + xStep / 2} y2={yScale(low)}
                                    stroke={color} strokeWidth={1.2} />
                                <Rect x={x + 1} y={bodyTop} width={Math.max(xStep - 2, 1)} height={bodyH} fill={color} />
                            </React.Fragment>
                        );
                    })}

                    {/* REWARD zone */}
                    {yEntry != null && topTP != null && (
                        <Rect x={boxStartX} y={Math.min(yEntry, topTP)}
                            width={boxEndX - boxStartX} height={Math.abs(yEntry - topTP)}
                            fill="rgba(0,230,118,0.18)" stroke="rgba(0,230,118,0.55)" strokeWidth={1} />
                    )}

                    {/* RISK zone */}
                    {yEntry != null && ySL != null && (
                        <Rect x={boxStartX} y={Math.min(yEntry, ySL)}
                            width={boxEndX - boxStartX} height={Math.abs(yEntry - ySL)}
                            fill="rgba(255,82,82,0.18)" stroke="rgba(255,82,82,0.55)" strokeWidth={1} />
                    )}

                    {/* level lines */}
                    {[
                        { y: yTP3, color: '#22d3ee' },
                        { y: yTP2, color: '#22d3ee' },
                        { y: yTP1, color: '#22d3ee' },
                        { y: yEntry, color: '#FFD600', solid: true },
                        { y: ySL, color: '#f59e0b' },
                    ].filter(t => t.y != null).map((t, i) => (
                        <Line key={`zl${i}`}
                            x1={boxStartX} y1={t.y} x2={boxEndX} y2={t.y}
                            stroke={t.color} strokeWidth={t.solid ? 1.5 : 1}
                            strokeDasharray={t.solid ? undefined : '4,3'} />
                    ))}

                    {/* BUY/SELL chip */}
                    {yEntry != null && (
                        <React.Fragment>
                            <Rect x={boxStartX - 38} y={yEntry - 9} width={36} height={18} rx={4} fill={sideColor} />
                            <SvgText x={boxStartX - 20} y={yEntry + 4} fontSize={10}
                                fill="#fff" fontWeight="bold" textAnchor="middle">
                                {sideText}
                            </SvgText>
                        </React.Fragment>
                    )}

                    {/* right-edge pills */}
                    {[
                        { y: yTP3, color: '#22d3ee', v: signal?.tp3, label: 'TP3' },
                        { y: yTP2, color: '#22d3ee', v: signal?.tp2, label: 'TP2' },
                        { y: yTP1, color: '#22d3ee', v: signal?.tp1, label: 'TP1' },
                        { y: yEntry, color: '#FFD600', v: signal?.entry, label: 'ENTRY' },
                        { y: ySL, color: '#f59e0b', v: signal?.sl, label: 'SL' },
                    ].filter(t => t.y != null).map((t, i) =>
                        <G key={`pill${i}`}>{pill(boxEndX + 2, t.y, 72, t.color, '#0a0a0a', `${t.label} ${fmt(t.v)}`)}</G>
                    )}

                    {/* live price line */}
                    {livePrice && (
                        <Line x1={0} y1={yScale(livePrice)} x2={chartW} y2={yScale(livePrice)}
                            stroke="#60a5fa" strokeWidth={0.8} strokeDasharray="2,3" opacity={0.6} />
                    )}

                    {/* volume separator */}
                    <Line x1={0} y1={priceH} x2={chartW} y2={priceH} stroke="#222" strokeWidth={0.5} />

                    {/* volume bars */}
                    {visibleCandles.map((c, i) => {
                        const v = c.volume || 0;
                        const yTop = vScale(v);
                        const up = c.close >= c.open;
                        return (
                            <Rect key={`v${i}`} x={xPos(i) + 1} y={yTop}
                                width={Math.max(xStep - 2, 1)}
                                height={Math.max(chartH - yTop, 1)}
                                fill={up ? 'rgba(0,230,118,0.45)' : 'rgba(255,82,82,0.45)'} />
                        );
                    })}
                </Svg>

                {/* right axis */}
                <Svg width={RIGHT_AXIS_W} height={chartH} style={{ marginLeft: 2 }}>
                    {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
                        const price = yDomain.min + (yDomain.max - yDomain.min) * (1 - p);
                        return (
                            <SvgText key={i} x={4} y={priceH * p + 4} fontSize={9} fill="#555">
                                {fmt(price)}
                            </SvgText>
                        );
                    })}
                    {livePrice && (
                        <React.Fragment>
                            <Rect x={0} y={yScale(livePrice) - 7} width={RIGHT_AXIS_W} height={14} fill="#60a5fa" opacity={0.9} />
                            <SvgText x={3} y={yScale(livePrice) + 3} fontSize={9} fill="#000" fontWeight="bold">
                                {fmt(livePrice)}
                            </SvgText>
                        </React.Fragment>
                    )}
                </Svg>
            </View>
        );
    };

    const headerControls = (
        <View style={styles.tfRow}>
            {TIMEFRAMES.map((t) => (
                <TouchableOpacity key={t}
                    style={[styles.tfBtn, tf === t && styles.tfBtnActive]}
                    onPress={() => setTf(t)}>
                    <Text style={[styles.tfTxt, tf === t && { color: '#fff' }]}>{t}</Text>
                </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}>
                <Text style={styles.zoomTxt}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}>
                <Text style={styles.zoomTxt}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={() => setIsFullscreen(true)}>
                <Text style={styles.zoomTxt}>⛶</Text>
            </TouchableOpacity>
        </View>
    );

    const defaultChartW = SCREEN_W - 40;
    const defaultChartH = DEFAULT_CHART_H;

    const content = (
        <>
            <View style={styles.header}>
                <Text style={styles.title}>
                    {(pair || '--').toUpperCase()} · Trade Zones
                    {signal?.signal_type && (
                        <Text style={{
                            color: (signal.signal_type === 'LONG' || signal.signal_type === 'BUY') ? '#00E676' : '#FF5252',
                            fontSize: 11, fontWeight: '700',
                        }}>
                            {'  '}{(signal.signal_type === 'LONG' || signal.signal_type === 'BUY') ? '▲ LONG' : '▼ SHORT'}
                        </Text>
                    )}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {livePrice && <Text style={styles.live}>{fmt(livePrice)}</Text>}
                    {loading && <ActivityIndicator size="small" color="#60a5fa" style={{ marginLeft: 6 }} />}
                </View>
            </View>

            {headerControls}

            {candles.length === 0 ? (
                <View style={[styles.chartBox, { height: defaultChartH + 12, justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ color: '#555' }}>{loading ? 'Loading…' : 'No data'}</Text>
                </View>
            ) : (
                <View style={[styles.chartBox, { height: defaultChartH + 12 }]}>
                    {renderSvg(defaultChartW, defaultChartH)}
                    {!hasLevels && (
                        <View style={styles.missingOverlay} pointerEvents="none">
                            <Text style={styles.missingText}>⚠ Waiting for entry / SL / TP levels…</Text>
                        </View>
                    )}
                </View>
            )}

            {/* Debug strip — confirms levels source and values */}
            <View style={styles.debugRow}>
                <Text style={styles.debugTxt}>
                    {isFallback ? '⚠ AUTO ' : ''}E: {fmt(signal?.entry)}  · SL: {fmt(signal?.sl)}  · TP1: {fmt(signal?.tp1)}  · TP2: {fmt(signal?.tp2)}  · TP3: {fmt(signal?.tp3)}
                </Text>
            </View>

            <View style={styles.legend}>
                <LegendDot color="#FFD600" label="Entry" />
                <LegendDot color="#f59e0b" label="SL" />
                <LegendDot color="#22d3ee" label="TP1" />
                <LegendDot color="#22d3ee" label="TP2" />
                <LegendDot color="#22d3ee" label="TP3" />
                <LegendDot color="#60a5fa" label="Live" dashed />
            </View>
        </>
    );

    return (
        <View style={styles.wrap}>
            {content}
            <Modal visible={isFullscreen} animationType="fade" transparent={false} supportedOrientations={['portrait', 'landscape']}>
                <View style={styles.fullscreenContainer}>
                    <View style={styles.fullscreenHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={styles.fullscreenTitle}>{(pair || '--').toUpperCase()} · Trade Zones</Text>
                            <View style={{ marginLeft: 15 }}>{headerControls}</View>
                        </View>
                        <TouchableOpacity style={styles.closeBtn} onPress={() => setIsFullscreen(false)}>
                            <Text style={styles.closeText}>✕ Close</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.fullscreenChartWrap}>
                        {candles.length > 0 && renderSvg(SCREEN_W - 30, SCREEN_H - 120)}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const LegendDot = ({ color, label, dashed }) => (
    <View style={styles.legendItem}>
        <View style={[
            styles.legendChip,
            { backgroundColor: dashed ? 'transparent' : color, borderColor: color, borderWidth: dashed ? 1.5 : 0 },
        ]} />
        <Text style={styles.legendTxt}>{label}</Text>
    </View>
);

const styles = StyleSheet.create({
    wrap: {
        backgroundColor: '#0a0a0a', borderRadius: 14, padding: 12,
        borderWidth: 1, borderColor: '#1a1a1a', marginVertical: 8,
    },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
    },
    title: { color: '#fff', fontSize: 14, fontWeight: '700' },
    live: { color: '#60a5fa', fontWeight: '800', fontSize: 13 },
    tfRow: { flexDirection: 'row', marginBottom: 10, flexWrap: 'wrap' },
    tfBtn: {
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
        backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 5,
    },
    tfBtnActive: { backgroundColor: '#1f2937', borderColor: '#60a5fa' },
    tfTxt: { color: '#888', fontSize: 11, fontWeight: '700' },
    chartBox: {
        backgroundColor: '#0f0f0f', borderRadius: 10, padding: 6,
        flexDirection: 'row', position: 'relative',
    },
    missingOverlay: {
        position: 'absolute', top: 8, left: 0, right: 0,
        alignItems: 'center',
    },
    missingText: {
        color: '#f59e0b', fontSize: 11, fontWeight: '700',
        backgroundColor: 'rgba(245,158,11,0.12)',
        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
        borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)',
    },
    debugRow: {
        marginTop: 6, paddingHorizontal: 6, paddingVertical: 4,
        backgroundColor: '#111', borderRadius: 6,
    },
    debugTxt: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
    legend: {
        flexDirection: 'row', flexWrap: 'wrap', marginTop: 8,
        paddingHorizontal: 4,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 4 },
    legendChip: { width: 10, height: 10, borderRadius: 2, marginRight: 5 },
    legendTxt: { color: '#888', fontSize: 10, fontWeight: '600' },
    zoomBtn: {
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
        backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
        marginLeft: 6, justifyContent: 'center', alignItems: 'center'
    },
    zoomTxt: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
    fullscreenContainer: { flex: 1, backgroundColor: '#000', padding: 15 },
    fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    fullscreenTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    closeBtn: { backgroundColor: '#FF5252', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    closeText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },
    fullscreenChartWrap: { flex: 1, backgroundColor: '#0f0f0f', borderRadius: 15, padding: 10, justifyContent: 'center' },
});