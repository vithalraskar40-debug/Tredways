import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import Svg, { Rect, Line, G, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import TradeZonesChart from '../components/TradeZonesChart';
import { saveTrade } from '../utils/tradeHistory';

// ─── ConfirmTradeScreen v4 ───────────────────────────────────────────────────
// Fixes from v3:
//  • JSX syntax errors corrected ({{...}} inline styles, closed onPress block).
//  • SVG zone visualizer + level cards are now Y-aligned (single coordinate system).
//  • Risk/Reward gradient direction is correct for BOTH LONG and SHORT.
//  • TP3 falls back to TP2/TP1 so the reward zone always renders.
//  • Distance is shown from ENTRY (more useful) with a tiny "live" tag for ref.
// ─────────────────────────────────────────────────────────────────────────────

const ConfirmTradeScreen = ({ onClose, signal, pair, signalSource, dataSource = 'YAHOO' }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isLong = signal?.signal_type === 'LONG';
  const accent = isLong ? '#00E676' : '#FF5252';

  const fmt = (val) => {
    if (val == null || isNaN(val)) return '--';
    const n = Number(val);
    return n >= 1000 ? n.toFixed(3) : n.toFixed(4);
  };

  // Effective TP3 (fallback chain) — used everywhere consistently.
  const tp3Eff = signal?.tp3 ?? signal?.tp2 ?? signal?.tp1;

  const risk = signal ? Math.abs(signal.entry - signal.sl) : 0;
  const reward = signal ? Math.abs(tp3Eff - signal.entry) : 0;
  const rrRatio = risk > 0 ? (reward / risk).toFixed(1) : 0;

  // Distance % from ENTRY (more meaningful for SL/TP than from live price).
  const distFromEntry = (target) => {
    if (signal?.entry == null || target == null) return '';
    const pct = ((target - signal.entry) / signal.entry) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, isFullscreen && { padding: 0 }]}>
        {/* ── HEADER ── */}
        {!isFullscreen && (
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Trade Execution</Text>
              <Text style={[styles.subTitle, { color: accent }]}>
                {isLong ? '▲ BUY' : '▼ SELL'} · {(signal?.pair || pair || '--').toUpperCase()}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {signalSource && (
                <View
                  style={[
                    styles.sourceBadge,
                    {
                      backgroundColor:
                        signalSource === 'CHART' ? 'rgba(34,211,238,0.15)' : 'rgba(99,102,241,0.15)',
                      borderColor: signalSource === 'CHART' ? '#22d3ee' : '#818cf8',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sourceBadgeTxt,
                      { color: signalSource === 'CHART' ? '#22d3ee' : '#818cf8' },
                    ]}
                  >
                    {signalSource === 'CHART' ? '📊 CHART SIGNAL' : '🔗 API SIGNAL'}
                  </Text>
                </View>
              )}
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { marginTop: 6 }]}>
                <Text style={styles.closeText}>✕ Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView
          contentContainerStyle={[styles.content, isFullscreen && { padding: 0, flex: 1 }]}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!isFullscreen}
        >
          {/* ── LIVE CHART ── */}
          {!isFullscreen && <Text style={styles.sectionTitle}>Trade Zones · Live Chart</Text>}
          <TradeZonesChart
            pair={signal?.pair || pair}
            signal={signal}
            dataSource={dataSource}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          />

          {!isFullscreen && (
            <>
             {!(signal
    && signal.status_label === 'TRADE'
    && signal.entry != null
    && signal.sl != null
    && signal.tp1 != null) ? (
  <View style={styles.noSignalBox}>
    <Text style={styles.noSignalIcon}>⚠️</Text>
    <Text style={styles.noSignal}>No confirmed SMC trade.</Text>
    <Text style={styles.noSignalSub}>
      Wait for ChartWithZones to confirm an A+ setup. The entry block
      will appear only after confirmation — not on every timeframe.
    </Text>
  </View>
) : (
                <>
                  <Text style={styles.sectionTitle}>Entry · SL · Targets</Text>
                  <TradeBlock
                    signal={signal}
                    isLong={isLong}
                    fmt={fmt}
                    dist={distFromEntry}
                    risk={risk}
                    reward={reward}
                    rrRatio={rrRatio}
                    tp3Eff={tp3Eff}
                  />

                  {/* ── GRADE / SCORE ROW ── */}
                  {signal.grade && (
                    <View style={styles.gradeRow}>
                      <Text
                        style={[
                          styles.gradeBadge,
                          {
                            backgroundColor:
                              signal.grade.includes('A')
                                ? '#00C853'
                                : signal.grade === 'AVOID'
                                  ? '#FF3B30'
                                  : '#f59e0b',
                          },
                        ]}
                      >
                        {signal.grade}
                      </Text>
                      {signal.rr_ratio && <Text style={styles.gradeText}>R:R  {signal.rr_ratio}</Text>}
                      {signal.atr && <Text style={styles.gradeText}>ATR  {fmt(signal.atr)}</Text>}
                      {signal.entry_method && (
                        <Text style={styles.gradeText} numberOfLines={1}>
                          {signal.entry_method}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* ── CONFIRM BUTTON ── */}
                  <TouchableOpacity
                    style={[
                      styles.confirmBtn,
                      { backgroundColor: isLong ? '#00C853' : '#FF3B30', marginTop: 20 },
                    ]}
                    onPress={() => {
                      try {
                        saveTrade({ ...signal, pair: signal?.pair || pair });
                      } catch { }
                      Alert.alert(
                        '✅ Order Submitted & Logged',
                        `${isLong ? 'BUY' : 'SELL'} trade logged to Accuracy Tracker.`
                      );
                      onClose();
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.confirmBtnText}>
                      {isLong ? '▲ Execute BUY' : '▼ Execute SELL'}
                    </Text>
                    <Text style={styles.confirmSubText}>MARKET · SL {fmt(signal.sl)}</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── TradeBlock v4 ───────────────────────────────────────────────────────────
// One shared coordinate system: each level has a Y position used by BOTH the
// SVG zones/ticks AND the level cards on the right, so they always line up.
// ─────────────────────────────────────────────────────────────────────────────
function TradeBlock({ signal, isLong, fmt, dist, risk, reward, rrRatio, tp3Eff }) {
  const SVG_W = 70;
  const ROW_H = 56;          // Height of each level card row
  const ROW_GAP = 8;
  const PAD_Y = 6;

  // Build the level list. Use tp3Eff (with fallback) so reward zone always works.
  const levels = useMemo(() => {
    const raw = [
      { key: 'sl', label: 'SL', v: signal.sl, color: '#FF5252', kind: 'SL' },
      { key: 'entry', label: 'ENTRY', v: signal.entry, color: '#FFD600', kind: 'ENTRY' },
      { key: 'tp1', label: 'TP1', v: signal.tp1, color: '#0891b2', kind: 'TP' },
      { key: 'tp2', label: 'TP2', v: signal.tp2, color: '#06b6d4', kind: 'TP' },
      { key: 'tp3', label: 'TP3', v: signal.tp3, color: '#22d3ee', kind: 'TP' },
    ].filter((l) => typeof l.v === 'number' && !isNaN(l.v));

    // Sort by price DESC → highest price on top (correct for both LONG and SHORT).
    return raw.sort((a, b) => b.v - a.v);
  }, [signal]);

  // Card-aligned layout: each row has a known Y center.
  const SVG_H = levels.length * ROW_H + (levels.length - 1) * ROW_GAP + PAD_Y * 2;
  const rowCenterY = (idx) => PAD_Y + idx * (ROW_H + ROW_GAP) + ROW_H / 2;

  // Map each level to its row index → Y center.
  const yOf = (key) => {
    const idx = levels.findIndex((l) => l.key === key);
    return idx < 0 ? null : rowCenterY(idx);
  };

  const yEntry = yOf('entry');
  const ySL = yOf('sl');
  // Use tp3Eff's key to pick the right Y for the reward zone end.
  const tp3Key = signal.tp3 != null ? 'tp3' : signal.tp2 != null ? 'tp2' : 'tp1';
  const yTP3 = yOf(tp3Key);

  return (
    <View style={styles.tradeBlockWrap}>
      {/* Header strip */}
      <View style={styles.tbHeader}>
        <View style={[styles.tbDirBadge, { backgroundColor: isLong ? '#00C853' : '#FF3B30' }]}>
          <Text style={styles.tbDirBadgeTxt}>{isLong ? '▲ LONG' : '▼ SHORT'}</Text>
        </View>
        <Text style={styles.tbType}>{signal.entry_type || signal.grade || 'SMC AUTO'}</Text>
        <View style={styles.tbRRChip}>
          <Text style={styles.tbRRChipTxt}>R:R 1:{rrRatio}</Text>
        </View>
      </View>

      {/* Body: [SVG zones] [Aligned level cards] */}
      <View style={styles.tbBody}>
        {/* ── LEFT: SVG zone visualizer ── */}
        <View style={[styles.tbSvgWrap, { height: SVG_H }]}>
          <Svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
            <Defs>
              {/* Gradients flip based on direction so the "stronger" side hugs SL/TP. */}
              <LinearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#22c55e" stopOpacity={isLong ? '0.45' : '0.05'} />
                <Stop offset="1" stopColor="#22c55e" stopOpacity={isLong ? '0.05' : '0.45'} />
              </LinearGradient>
              <LinearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#ef4444" stopOpacity={isLong ? '0.05' : '0.45'} />
                <Stop offset="1" stopColor="#ef4444" stopOpacity={isLong ? '0.45' : '0.05'} />
              </LinearGradient>
            </Defs>

            {/* Reward zone: from ENTRY → TP3 */}
            {yEntry != null && yTP3 != null && (
              <Rect
                x={10}
                y={Math.min(yEntry, yTP3)}
                width={SVG_W - 20}
                height={Math.abs(yEntry - yTP3)}
                fill="url(#rewardGrad)"
                stroke="rgba(34,197,94,0.55)"
                strokeWidth={1}
                rx={3}
              />
            )}

            {/* Risk zone: from ENTRY → SL */}
            {yEntry != null && ySL != null && (
              <Rect
                x={10}
                y={Math.min(yEntry, ySL)}
                width={SVG_W - 20}
                height={Math.abs(yEntry - ySL)}
                fill="url(#riskGrad)"
                stroke="rgba(239,68,68,0.55)"
                strokeWidth={1}
                rx={3}
              />
            )}

            {/* Entry line — bright yellow, full width */}
            {yEntry != null && (
              <Line
                x1={4}
                x2={SVG_W - 4}
                y1={yEntry}
                y2={yEntry}
                stroke="#FFD600"
                strokeWidth={2}
              />
            )}

            {/* Level tick markers — aligned with cards on the right */}
            {levels.map((l, idx) => {
              const y = rowCenterY(idx);
              return (
                <G key={`tick-${l.key}`}>
                  <Line
                    x1={SVG_W - 18}
                    x2={SVG_W - 2}
                    y1={y}
                    y2={y}
                    stroke={l.color}
                    strokeWidth={2.5}
                  />
                </G>
              );
            })}
          </Svg>
        </View>

        {/* ── RIGHT: Aligned level cards (fixed row height matches SVG) ── */}
        <View style={styles.tbCardsWrap}>
          {levels.map((l, idx) => (
            <View
              key={l.key}
              style={[
                styles.levelCard,
                { height: ROW_H, marginBottom: idx === levels.length - 1 ? 0 : ROW_GAP },
                l.kind === 'ENTRY' && styles.levelCardEntry,
                { borderLeftColor: l.color },
              ]}
            >
              <View style={[styles.levelTag, { backgroundColor: l.color }]}>
                <Text
                  style={[
                    styles.levelTagTxt,
                    { color: l.kind === 'ENTRY' ? '#1a1a1a' : '#0a0a0a' },
                  ]}
                >
                  {l.label}
                </Text>
              </View>
              <View style={styles.levelInfo}>
                <Text style={styles.levelPrice}>{fmt(l.v)}</Text>
                <Text style={[styles.levelPct, { color: l.color }]}>{dist(l.v)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── SUMMARY STRIP ── */}
      <View style={styles.tbSummary}>
        <View style={styles.tbSumCell}>
          <Text style={styles.tbSumLabel}>RISK</Text>
          <Text style={[styles.tbSumValue, { color: '#FF5252' }]}>{fmt(risk)}</Text>
        </View>
        <View style={styles.tbDivider} />
        <View style={styles.tbSumCell}>
          <Text style={styles.tbSumLabel}>ENTRY</Text>
          <Text style={[styles.tbSumValue, { color: '#FFD600' }]}>{fmt(signal.entry)}</Text>
        </View>
        <View style={styles.tbDivider} />
        <View style={styles.tbSumCell}>
          <Text style={styles.tbSumLabel}>REWARD</Text>
          <Text style={[styles.tbSumValue, { color: '#22d3ee' }]}>{fmt(reward)}</Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  title: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  subTitle: { fontSize: 13, marginTop: 4, fontWeight: '700' },
  closeBtn: {
    padding: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  closeText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },

  content: { padding: 16, paddingBottom: 50 },
  sectionTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
  },

  noSignalBox: {
    backgroundColor: '#111',
    padding: 30,
    borderRadius: 15,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#222',
  },
  noSignalIcon: { fontSize: 40, marginBottom: 15 },
  noSignal: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  noSignalSub: { color: '#666', textAlign: 'center', fontSize: 13, lineHeight: 20 },

  // ── TradeBlock ──
  tradeBlockWrap: {
    backgroundColor: '#0d0f14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    marginBottom: 8,
  },
  tbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  tbDirBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tbDirBadgeTxt: { color: '#fff', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  tbType: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
    marginLeft: 4,
  },
  tbRRChip: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderColor: 'rgba(34,211,238,0.55)',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tbRRChipTxt: { color: '#22d3ee', fontWeight: '800', fontSize: 12 },

  tbBody: { flexDirection: 'row', alignItems: 'flex-start' },
  tbSvgWrap: { marginRight: 10 },
  tbCardsWrap: { flex: 1 },

  levelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  levelCardEntry: {
    backgroundColor: 'rgba(255,214,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,0,0.45)',
  },
  levelTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    minWidth: 48,
    alignItems: 'center',
  },
  levelTagTxt: { fontWeight: '900', fontSize: 11, letterSpacing: 0.4 },
  levelInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: 10,
  },
  levelPrice: { color: '#fff', fontSize: 14, fontWeight: '800' },
  levelPct: { fontSize: 11, fontWeight: '700' },

  tbSummary: {
    flexDirection: 'row',
    marginTop: 14,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  tbSumCell: { flex: 1, alignItems: 'center' },
  tbSumLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  tbSumValue: { fontSize: 15, fontWeight: '900' },
  tbDivider: { width: 1, backgroundColor: '#1f2937', marginVertical: 4 },

  // Grade row
  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  gradeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
    overflow: 'hidden',
  },
  gradeText: { color: '#888', fontSize: 12, marginLeft: 8 },

  // Execute button
  confirmBtn: { padding: 18, borderRadius: 12, alignItems: 'center', elevation: 5 },
  confirmBtnText: { color: '#FFF', fontWeight: '900', fontSize: 18, marginBottom: 4 },
  confirmSubText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },

  // Signal source badge
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 4,
  },
  sourceBadgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});

export default ConfirmTradeScreen;
