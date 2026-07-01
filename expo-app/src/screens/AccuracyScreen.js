import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { getAllTrades, updateTradeOutcome, clearAllTrades, computeStats } from '../utils/tradeHistory';
import { checkOpenTrades } from '../utils/outcomeChecker';
import { isAutoBotRunning } from '../utils/AutoBot';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Outcome colour helpers ───────────────────────────────────────────────────
const OUTCOME_COLOR = {
  WIN:         '#00E676',
  MANUAL_WIN:  '#69f0ae',
  LOSS:        '#FF5252',
  MANUAL_LOSS: '#ff867c',
  OPEN:        '#60a5fa',
};
const OUTCOME_LABEL = {
  WIN:         '✅ WIN',
  MANUAL_WIN:  '✅ WIN*',
  LOSS:        '❌ LOSS',
  MANUAL_LOSS: '❌ LOSS*',
  OPEN:        '⏳ OPEN',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(v) {
  if (v == null || isNaN(v)) return '--';
  const n = Number(v);
  if (Math.abs(n) < 0.01) return n.toFixed(5);
  if (Math.abs(n) < 10)   return n.toFixed(4);
  if (Math.abs(n) < 1000) return n.toFixed(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function timeAgo(iso) {
  if (!iso) return '--';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ─── Big Win Rate Circle ──────────────────────────────────────────────────────
function WinRateCircle({ winRate, total }) {
  const color = winRate >= 60 ? '#00E676' : winRate >= 45 ? '#FFC107' : '#FF5252';
  return (
    <View style={styles.circleWrap}>
      <View style={[styles.outerCircle, { borderColor: color + '55' }]}>
        <View style={[styles.innerCircle, { borderColor: color }]}>
          <Text style={[styles.circleRate, { color }]}>{winRate}%</Text>
          <Text style={styles.circleLabel}>WIN RATE</Text>
          <Text style={styles.circleTotal}>{total} trade{total !== 1 ? 's' : ''}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Stat Pill ────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statPillValue, { color: color || '#fff' }]}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Trade Row ────────────────────────────────────────────────────────────────
function TradeRow({ trade, onManualUpdate }) {
  const isLong = trade.signal_type === 'LONG';
  const dirColor = isLong ? '#00E676' : '#FF5252';
  const outColor = OUTCOME_COLOR[trade.outcome] || '#888';
  const isOpen = trade.outcome === 'OPEN';

  return (
    <View style={styles.tradeRow}>
      {/* Left: Pair + dir */}
      <View style={styles.tradeLeft}>
        <Text style={styles.tradePair}>{trade.pair}</Text>
        <View style={[styles.tradeDir, { backgroundColor: dirColor + '22', borderColor: dirColor + '66' }]}>
          <Text style={[styles.tradeDirTxt, { color: dirColor }]}>
            {isLong ? '▲ L' : '▼ S'}
          </Text>
        </View>
      </View>

      {/* Middle: Entry / TP1 / SL */}
      <View style={styles.tradeMid}>
        <Text style={styles.tradeLevel}>E {fmt(trade.entry)}</Text>
        <Text style={[styles.tradeLevel, { color: '#00E676' }]}>T {fmt(trade.tp1)}</Text>
        <Text style={[styles.tradeLevel, { color: '#FF5252' }]}>S {fmt(trade.sl)}</Text>
      </View>

      {/* Right: Outcome + Time */}
      <View style={styles.tradeRight}>
        <Text style={[styles.tradeOutcome, { color: outColor }]}>{OUTCOME_LABEL[trade.outcome]}</Text>
        <Text style={styles.tradeTime}>{timeAgo(trade.created_at)}</Text>

        {/* Manual override buttons for OPEN trades */}
        {isOpen && (
          <View style={styles.manualBtns}>
            <TouchableOpacity
              style={[styles.manualBtn, { backgroundColor: '#00E67622', borderColor: '#00E67655' }]}
              onPress={() => onManualUpdate(trade.id, 'MANUAL_WIN')}
            >
              <Text style={{ color: '#00E676', fontSize: 10, fontWeight: '700' }}>W</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.manualBtn, { backgroundColor: '#FF525222', borderColor: '#FF525255' }]}
              onPress={() => onManualUpdate(trade.id, 'MANUAL_LOSS')}
            >
              <Text style={{ color: '#FF5252', fontSize: 10, fontWeight: '700' }}>L</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function AccuracyScreen() {
  const [trades, setTrades]     = useState([]);
  const [stats, setStats]       = useState(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [filter, setFilter]     = useState('ALL'); // ALL | OPEN | WIN | LOSS
  const [strategyFilter, setStrategyFilter] = useState('ALL'); // ALL | SCALP | SWING

  const reload = useCallback(() => {
    const t = getAllTrades();
    setTrades(t);
    setStats(computeStats(t, strategyFilter));
  }, [strategyFilter]);

  useEffect(() => { reload(); }, [reload]);

  const handleCheckOutcomes = async () => {
    setChecking(true);
    try {
      const resolved = await checkOpenTrades();
      reload();
      setLastChecked(new Date().toISOString());
      if (resolved.length > 0) {
        const msg = resolved.map(r => `${r.pair}: ${r.outcome} @ ${fmt(r.closePrice)}`).join('\n');
        Alert.alert('🎯 Outcomes Updated', msg);
      } else {
        Alert.alert('No Changes', 'No open trades hit their TP or SL yet.');
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setChecking(false);
    }
  };

  const handleManualUpdate = (id, outcome) => {
    updateTradeOutcome(id, outcome);
    reload();
  };

  const handleClear = () => {
    Alert.alert(
      'Clear All Trades?',
      'This will permanently delete your entire trade history.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { clearAllTrades(); reload(); } },
      ]
    );
  };

  const filteredTrades = trades.filter(t => {
    if (strategyFilter !== 'ALL' && t.strategy !== strategyFilter) return false;
    if (filter === 'ALL')  return true;
    if (filter === 'OPEN') return t.outcome === 'OPEN';
    if (filter === 'WIN')  return t.outcome === 'WIN' || t.outcome === 'MANUAL_WIN';
    if (filter === 'LOSS') return t.outcome === 'LOSS' || t.outcome === 'MANUAL_LOSS';
    return true;
  });

  const noTrades = trades.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>📊 Accuracy Tracker</Text>
          <Text style={styles.headerSub}>SMC Signal Performance</Text>
          {isAutoBotRunning() && (
            <View style={styles.autoBotBadge}>
              <Text style={styles.autoBotTxt}>🤖 AutoBot Active (BTC & GOLD)</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
          <Text style={styles.clearBtnTxt}>🗑</Text>
        </TouchableOpacity>
      </View>

      {noTrades ? (
        /* ── EMPTY STATE ── */
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No Trades Logged Yet</Text>
          <Text style={styles.emptySub}>
            Execute a trade from the Forex / Chart screen.{'\n'}
            Each executed signal is auto-logged here.
          </Text>
        </View>
      ) : (
        <>
          {/* ── WIN RATE CIRCLE ── */}
          <WinRateCircle winRate={stats?.winRate ?? 0} total={stats?.total ?? 0} />

          {/* ── STATS STRIP ── */}
          <View style={styles.statsRow}>
            <StatPill label="WINS"   value={stats?.wins   ?? 0} color="#00E676" />
            <StatPill label="LOSSES" value={stats?.losses ?? 0} color="#FF5252" />
            <StatPill label="OPEN"   value={stats?.open   ?? 0} color="#60a5fa" />
            <StatPill label="AVG R:R" value={stats?.avgRR ?? '--'} color="#FFC107" />
          </View>

          {/* ── STREAK BANNER ── */}
          {stats?.streak > 0 && (
            <View style={[
              styles.streakBanner,
              { backgroundColor: stats.streakType === 'WIN' ? '#00E67615' : '#FF525215',
                borderColor:     stats.streakType === 'WIN' ? '#00E67633' : '#FF525233' },
            ]}>
              <Text style={[styles.streakTxt, { color: stats.streakType === 'WIN' ? '#00E676' : '#FF5252' }]}>
                {stats.streakType === 'WIN' ? '🔥' : '⚠️'}{' '}
                {stats.streak} {stats.streakType} streak
              </Text>
            </View>
          )}

          {/* ── CHECK OUTCOMES BUTTON ── */}
          <TouchableOpacity
            style={[styles.checkBtn, checking && { opacity: 0.6 }]}
            onPress={handleCheckOutcomes}
            disabled={checking}
          >
            {checking
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.checkBtnTxt}>🔍 Auto-Check Open Trades</Text>
            }
          </TouchableOpacity>
          {lastChecked && (
            <Text style={styles.lastCheckedTxt}>Last checked: {timeAgo(lastChecked)}</Text>
          )}

          {/* ── STRATEGY FILTER ROW ── */}
          <View style={[styles.filterRow, { marginBottom: 10 }]}>
            {['ALL', 'SCALP', 'SWING'].map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterBtn, strategyFilter === f && { backgroundColor: '#60a5fa33', borderColor: '#60a5fa' }]}
                onPress={() => setStrategyFilter(f)}
              >
                <Text style={[styles.filterTxt, strategyFilter === f && { color: '#60a5fa' }]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── OUTCOME FILTER ROW ── */}
          <View style={styles.filterRow}>
            {['ALL', 'OPEN', 'WIN', 'LOSS'].map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterTxt, filter === f && styles.filterTxtActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── TRADE LOG ── */}
          <View style={styles.tradeLog}>
            <View style={styles.tradeLogHeader}>
              <Text style={styles.tradeLogTitle}>Trade Log</Text>
              <Text style={styles.tradeLogHint}>
                Tap W / L to manually set outcome
              </Text>
            </View>

            {filteredTrades.length === 0 ? (
              <Text style={styles.noFilterTxt}>No {filter.toLowerCase()} trades.</Text>
            ) : (
              filteredTrades.map(t => (
                <TradeRow
                  key={t.id}
                  trade={t}
                  onManualUpdate={handleManualUpdate}
                />
              ))
            )}
          </View>
        </>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#0a0a0a' },
  content:  { paddingHorizontal: 16, paddingTop: 16 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  headerSub: { color: '#888', fontSize: 13, fontWeight: '600' },
  autoBotBadge: { marginTop: 6, backgroundColor: '#60a5fa22', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#60a5fa' },
  autoBotTxt: { color: '#60a5fa', fontSize: 10, fontWeight: '700' },
  clearBtn: { backgroundColor: '#FF525222', padding: 10, borderRadius: 10, borderColor: '#FF525255', borderWidth: 1 },
  clearBtnTxt: { fontSize: 16 },

  // Empty state
  emptyState:  { alignItems: 'center', paddingTop: 80, paddingBottom: 40 },
  emptyIcon:   { fontSize: 60, marginBottom: 20 },
  emptyTitle:  { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  emptySub:    { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 22 },

  // Win Rate Circle
  circleWrap:   { alignItems: 'center', marginBottom: 24 },
  outerCircle:  {
    width: 180, height: 180, borderRadius: 90, borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
  },
  innerCircle:  {
    width: 150, height: 150, borderRadius: 75, borderWidth: 3,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#0f0f0f',
  },
  circleRate:   { fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  circleLabel:  { color: '#666', fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 2 },
  circleTotal:  { color: '#444', fontSize: 11, marginTop: 4 },

  // Stats
  statsRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  statPill:    {
    flex: 1, alignItems: 'center', backgroundColor: '#111', borderRadius: 12,
    paddingVertical: 12, marginHorizontal: 3, borderWidth: 1, borderColor: '#1e1e1e',
  },
  statPillValue: { fontSize: 22, fontWeight: '900' },
  statPillLabel: { color: '#555', fontSize: 10, fontWeight: '700', marginTop: 3, letterSpacing: 1 },

  // Streak
  streakBanner: {
    borderRadius: 10, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16,
    marginBottom: 16, alignItems: 'center',
  },
  streakTxt: { fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },

  // Check button
  checkBtn: {
    backgroundColor: '#1e3a5f', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 6, borderWidth: 1, borderColor: '#2563eb55',
  },
  checkBtnTxt:     { color: '#60a5fa', fontWeight: '800', fontSize: 14 },
  lastCheckedTxt:  { color: '#444', fontSize: 11, textAlign: 'center', marginBottom: 16 },

  // Filter
  filterRow: { flexDirection: 'row', marginBottom: 16 },
  filterBtn: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
    marginHorizontal: 3, borderRadius: 8,
  },
  filterBtnActive: { backgroundColor: '#1f2937', borderColor: '#60a5fa' },
  filterTxt:       { color: '#555', fontSize: 12, fontWeight: '700' },
  filterTxtActive: { color: '#60a5fa' },

  // Trade Log
  tradeLog:       { backgroundColor: '#0f0f0f', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  tradeLogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  tradeLogTitle:  { color: '#fff', fontWeight: '800', fontSize: 14 },
  tradeLogHint:   { color: '#444', fontSize: 10 },
  noFilterTxt:    { color: '#444', textAlign: 'center', paddingVertical: 20, fontSize: 13 },

  // Trade Row
  tradeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  tradeLeft:   { width: 60, marginRight: 8 },
  tradePair:   { color: '#fff', fontWeight: '800', fontSize: 12 },
  tradeDir:    {
    borderRadius: 4, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 2,
    marginTop: 4, alignSelf: 'flex-start',
  },
  tradeDirTxt: { fontSize: 10, fontWeight: '800' },

  tradeMid:    { flex: 1 },
  tradeLevel:  { color: '#888', fontSize: 10, lineHeight: 16 },

  tradeRight:  { alignItems: 'flex-end', minWidth: 80 },
  tradeOutcome:{ fontWeight: '800', fontSize: 11 },
  tradeTime:   { color: '#444', fontSize: 10, marginTop: 2 },

  manualBtns:  { flexDirection: 'row', marginTop: 6, gap: 4 },
  manualBtn:   {
    width: 26, height: 26, borderRadius: 6, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
});
