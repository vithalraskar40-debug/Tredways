import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export const SystemBadge = () => (
  <View style={styles.systemBadge}>
    <View style={styles.pulseDot} />
    <Text style={styles.systemText}>SYSTEM LIVE: DATA FEED ACTIVE</Text>
  </View>
);

export const StrategyPoint = ({ title, status, details }) => {
  const getStatusColor = (s) => {
    switch (s) {
      case 'PASS': return '#00FF94';
      case 'FAIL': return COLORS.danger;
      case 'SKIPPED': return '#888888';
      case 'BLOCKED': return '#FF9500';
      default: return '#888888';
    }
  };
  const color = getStatusColor(status);
  const bgColor = `${color}1A`; // 10% opacity

  return (
    <View style={styles.strategyPoint}>
      <View style={styles.strategyRow}>
        <View style={styles.pointHeader}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={styles.pointTitle}>{title}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: bgColor }]}>
          <Text style={[styles.statusText, { color: color }]}>{status}</Text>
        </View>
      </View>
      <Text style={styles.strategyDetails}>{details}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  systemBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,255,148,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  systemText: { color: '#00FF94', fontSize: 9, fontWeight: 'bold' },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00FF94',
    marginRight: 6,
  },
  strategyPoint: { marginBottom: 18 },
  strategyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pointHeader: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  pointTitle: { color: '#EEE', fontSize: 14, fontWeight: '600', marginLeft: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: 'bold' },
  strategyDetails: { color: COLORS.textMuted, fontSize: 12 },
});
