import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, globalStyles } from '../theme';
import { StrategyPoint } from './Shared';

const ForexSignalCard = React.memo(({ signal }) => {
  if (!signal) return null;

  const isLong = signal.signal_type === 'LONG';
  const isError = signal.signal_type === 'ERROR';
  const isTrade = signal.status_label === 'TRADE';

  // ✅ FIXED digit formatter (BTC=2, Gold/ETH=2, JPY=3, FX=5)
  const dec = (() => {
    const pair = String(signal.pair || '');

    if (pair.includes('BTC')) return 2;
    if (pair.includes('ETH')) return 2;
    if (pair.includes('XAU')) return 2;
    if (pair.includes('JPY')) return 3;

    return 5;
  })();
  const fmt = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v.toFixed(dec) : '--');

  if (isError) {
    return (
      <View style={globalStyles.card}>
        <Text style={styles.errorTitle}>Analysis Error</Text>
        <Text style={styles.errorText}>{signal.reasons?.[0] || 'Unknown error'}</Text>
      </View>
    );
  }

  const statusColor = isTrade ? COLORS.success
    : signal.status_label === 'WAIT' ? COLORS.warning : COLORS.danger;
  const biasColor =
    signal.bias === 'BULLISH' ? COLORS.success
      : signal.bias === 'BEARISH' ? COLORS.danger : COLORS.textMuted;

  const modules = signal.modules || {};
  const strategies = React.useMemo(() => [
    { title: 'Trend (HTF)', s: modules.trend },
    { title: 'Structure', s: modules.structure },
    { title: 'Break of Structure', s: modules.bos },
    { title: 'Fair Value Gap', s: modules.fvg },
    { title: 'Order Block', s: modules.orderBlock },
    { title: 'Liquidity Sweep', s: modules.liquidity },
    { title: 'Premium/Discount', s: modules.zone },
    { title: 'Momentum (RSI)', s: modules.momentum },
  ].filter(x => x.s), [modules]);

  const rm = signal.risk_management;

  return (
    <View style={globalStyles.card}>
      {/* HEADER */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.symbolText}>{signal.pair || signal.ticker}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: biasColor }]}>
              <Text style={styles.badgeText}>{signal.bias || '--'}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: statusColor }]}>
              <Text style={styles.badgeText}>
                {signal.status_label === 'WAIT' ? 'SETUP' : signal.status_label}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#444' }]}>
              <Text style={styles.badgeText}>{signal.strategy || signal.mode || 'SWING'}</Text>
            </View>
          </View>
          <Text style={styles.confidence}>CONF: {signal.confidence || 0}%</Text>
          <View style={styles.confBarBg}>
            <View style={[styles.confBarFill, {
              width: `${signal.confidence || 0}%`,
              backgroundColor:
                signal.confidence >= 75 ? '#00E676'
                  : signal.confidence >= 50 ? '#FFD600' : '#FF5252',
            }]} />
          </View>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.priceLabel}>LIVE PRICE</Text>
          <Text style={styles.priceValue}>{fmt(signal.current_price ?? signal.entry)}</Text>
          <Text style={styles.priceSub}>RSI {signal.metrics?.rsi ?? '--'}</Text>
        </View>
      </View>

      {/* DIRECTION */}
      {isTrade && (
        <View style={[styles.directionBox, {
          backgroundColor: isLong ? 'rgba(0,200,83,0.12)' : 'rgba(255,59,48,0.12)',
          borderColor: isLong ? '#00C853' : '#FF3B30',
        }]}>
          <Text style={[styles.directionText, { color: isLong ? '#00E676' : '#FF5252' }]}>
            {signal.signal_type}
          </Text>
          <Text style={styles.directionSub}>EXECUTION READY</Text>
        </View>
      )}

      {/* SCALP RETEST BANNER */}
      {signal.mode === 'SCALP' && signal.scalpAvailable && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#003300', borderColor: '#00C853', borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 15 }}>
          <Text style={{ color: '#00C853', fontSize: 12, fontWeight: 'bold' }}>✅ RETEST CONFIRMED</Text>
          <Text style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>EMA 9 bounce detected · Enter Now</Text>
        </View>
      )}
      {signal.mode === 'SCALP' && !signal.scalpAvailable && !isError && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1200', borderColor: '#FFD600', borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 15 }}>
          <Text style={{ color: '#FFD600', fontSize: 12, fontWeight: 'bold' }}>⏳ WAITING FOR RETEST</Text>
          <Text style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>EMA 9/21 crossover detected</Text>
        </View>
      )}


      {!isTrade && (
        <View style={styles.waitBox}>
          <Text style={styles.waitTitle}>WAIT</Text>
          <Text style={styles.waitReason}>
            {signal.reason_summary || 'Waiting for confirmation'}
          </Text>
        </View>
      )}

      {/* METRICS */}
      <View style={styles.metricsContainer}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>RSI</Text>
          <Text style={styles.metricValue}>{signal.metrics?.rsi ?? '--'}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>ATR</Text>
          <Text style={styles.metricValue}>{signal.metrics?.atr ?? '--'}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>EMA21</Text>
          <Text style={styles.metricValue}>{signal.metrics?.ema21 ?? '--'}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>ZONE</Text>
          <Text style={styles.metricValue}>{signal.metrics?.pd_zone ?? '--'}</Text>
        </View>
      </View>

      {isTrade && signal.mode !== 'SCALP' && (
        <View style={styles.timingBox}>
          <Text style={styles.timingLabel}>ENTRY TIMING</Text>
          <Text style={[styles.timingValue, { color: timingColor(signal.entry_timing) }]}>
            {signal.entry_timing || 'WAIT'}
          </Text>
          <Text style={[styles.timingValue, { marginTop: 6, color: typeColor(signal.entry_type) }]}>
            {signal.entry_type || 'CONFIRMATION'}
          </Text>
        </View>
      )}

      {isTrade && (
        <View style={styles.detailsGrid}>
          <Cell label="Entry" value={fmt(signal.entry)} />
          <Cell label="TP1" value={fmt(signal.tp1)} color={COLORS.success} />
          <Cell label="TP2" value={fmt(signal.tp2)} color="#00E676" />
          <Cell label="SL" value={fmt(signal.sl)} color={COLORS.danger} />
          <Cell label="RR" value={signal.rr_ratio || '--'} color="#4ade80" />
          <Cell label="TYPE" value={signal.entry_type || '--'} color={typeColor(signal.entry_type)} />
        </View>
      )}

      {isTrade && rm && (
        <View style={styles.riskBox}>
          <Text style={styles.riskTitle}>RISK MANAGEMENT</Text>
          <View style={styles.riskRow}>
            <Cell label="RISK $" value={`$${rm.risk_amount}`} color="#FF5252" />
            <Cell label="PIPS" value={rm.pip_distance} color="#FFD600" />
            <Cell label="LOTS" value={rm.suggested_lots} color="#4ade80" />
          </View>
        </View>
      )}

      <View style={globalStyles.divider} />
      <Text style={globalStyles.sectionSubTitle}>Strategy Breakdown</Text>
      {strategies.map((x, i) => (
        <StrategyPoint key={i} title={x.title} status={x.s.status} details={x.s.reason} />
      ))}

      <Text style={styles.timestamp}>
        Data: {signal.last_candle_time || 'N/A'} | Local: {new Date().toLocaleTimeString()}
      </Text>
    </View>
  );
});

const Cell = ({ label, value, color }) => (
  <View style={{ width: '30%', marginBottom: 12 }}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, color && { color }]}>{value}</Text>
  </View>
);

const timingColor = (t) =>
  t === 'RETEST ENTRY' ? '#4ade80'
    : t === 'MOMENTUM ENTRY' ? '#60a5fa'
      : t === 'SWEEP REVERSAL' ? '#facc15'
        : t === 'FVG FILL' ? '#a78bfa'
          : t === 'ORDER BLOCK' ? '#f472b6' : '#aaa';

const typeColor = (t) =>
  t === 'RETEST' ? '#4ade80'
    : t === 'BREAKOUT' ? '#f97316'
      : t === 'REVERSAL' ? '#c084fc'
        : t === 'FVG' ? '#a78bfa'
          : t === 'ORDER BLOCK' ? '#f472b6'
            : t === 'SWEEP REVERSAL' ? '#facc15' : '#aaa';

const styles = StyleSheet.create({
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  symbolText: { fontSize: 22, fontWeight: 'bold', color: COLORS.textPrimary },
  badgeRow: { flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 6, marginBottom: 4 },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  confidence: { marginTop: 4, color: '#888', fontSize: 11 },
  confBarBg: { height: 6, backgroundColor: '#222', borderRadius: 10, marginTop: 6, overflow: 'hidden', width: 140 },
  confBarFill: { height: '100%' },
  priceLabel: { color: '#888', fontSize: 10 },
  priceValue: { fontSize: 18, fontWeight: 'bold', color: COLORS.textPrimary },
  priceSub: { color: '#666', fontSize: 11, marginTop: 4 },
  directionBox: { padding: 14, borderRadius: 14, marginBottom: 14, alignItems: 'center', borderWidth: 1 },
  directionText: { fontWeight: 'bold', fontSize: 26 },
  directionSub: { color: '#AAA', marginTop: 4, fontSize: 11 },
  waitBox: { backgroundColor: '#111', borderRadius: 14, padding: 18, marginBottom: 15, borderWidth: 1, borderColor: '#222', alignItems: 'center' },
  waitTitle: { color: '#FFD600', fontSize: 20, fontWeight: 'bold' },
  waitReason: { color: '#888', marginTop: 6, textAlign: 'center', fontSize: 12 },
  metricsContainer: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#111', padding: 12, borderRadius: 10, marginBottom: 15 },
  metricItem: { alignItems: 'center', flex: 1 },
  metricLabel: { color: '#888', fontSize: 10 },
  metricValue: { color: '#FFF', fontWeight: 'bold' },
  timingBox: { backgroundColor: '#111', padding: 10, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  timingLabel: { fontSize: 10, color: '#888' },
  timingValue: { fontSize: 14, fontWeight: 'bold', marginTop: 4 },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 15 },
  label: { color: '#888', fontSize: 10 },
  value: { fontSize: 16, fontWeight: 'bold', color: '#FFF' },
  riskBox: { backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 12 },
  riskTitle: { color: '#888', fontSize: 11, marginBottom: 8 },
  riskRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timestamp: { color: '#666', fontSize: 10, textAlign: 'center', marginTop: 10 },
  errorTitle: { color: COLORS.danger, fontSize: 16, fontWeight: 'bold' },
  errorText: { color: '#aaa', marginTop: 6 },
});

export default ForexSignalCard;
