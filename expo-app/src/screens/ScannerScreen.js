import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert
} from 'react-native';

import { COLORS } from '../theme';

const ScannerScreen = ({ BASE_URL }) => {

  const [tickers, setTickers] = useState(
    'RELIANCE, SBIN, HEROMOTOCORP, NIFTY50, BANKNIFTY, SENSEX'
  );

  const [scanning, setScanning] = useState(false);

  const [results, setResults] = useState([]);

  const [progress, setProgress] = useState(0);

  // ─────────────────────────────────────
  // START SCAN
  // ─────────────────────────────────────
  const startScan = async () => {

    const tickerList = tickers
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t);

    if (tickerList.length === 0) return;

    setScanning(true);
    setResults([]);
    setProgress(0);

    const foundSignals = [];

    for (let i = 0; i < tickerList.length; i++) {

      const ticker = tickerList[i];



      try {

        let finalTicker = ticker;

        const isCrypto =
          ticker === 'BTC' ||
          ticker === 'ETH' ||
          ticker === 'SOL';

        if (
          !ticker.includes('.') &&
          !isCrypto &&
          !ticker.includes('NIFTY') &&
          !ticker.includes('SENSEX')
        ) {
          finalTicker += '.NS';
        }

        // ─────────────────────────────
        // API CALL
        // ─────────────────────────────
        const response = await fetch(
          `${BASE_URL}/api/v1/analyze`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ticker: finalTicker,
              mode: 'STRICT'
            }),
          }
        );
        // Update progress ONLY if we got a valid signal

        const data = await response.json();

        setProgress(
          ((i + 1) / tickerList.length) * 100
        );

        // ─────────────────────────────
        // PUSH RESULTS
        // ─────────────────────────────
        const smartMoney =
          data.smart_money || {};

        const resultItem = {
          ticker,
          state: data.status_label,  // ✅ FIXED: Use correct field
          signal_type: data.signal_type || 'NEUTRAL',
          price: data.current_price || 0,
          smartScore: smartMoney.score || 0,
          smartLabel: smartMoney.label || 'NO EDGE',
          volumeSpike: smartMoney.volume_spike || false,
          volumeRatio: smartMoney.volume_ratio || 0,
          relativeStrength: smartMoney.relative_strength || 0,
          liquiditySweep: smartMoney.liquidity_sweep || false,
          aboveVWAP: smartMoney.above_vwap || false,
          entryType: data.entry_type || '--',
          bias: data.bias || '--',
          reason: data.reason_summary || '--'
        };

        // ✅ FIXED: Show ALL results including WAIT status
        setResults(prev => [...prev, resultItem]);


        // ─────────────────────────────
        // ALERTS
        // ─────────────────────────────
        if (data.status_label === 'TRADE') {

          foundSignals.push(data);

          Alert.alert(
            `🚨 ${data.signal_type} SETUP`,
            `${ticker}

SMART SCORE: ${smartMoney.score || 0}

${smartMoney.label || 'NO EDGE'}`
          );
        }

      } catch (error) {

        setResults(prev => [
          ...prev,
          {
            ticker,
            state: 'ERROR',
            reason: error.message
          }
        ]);
      }
    }

    setScanning(false);

    // ─────────────────────────────────
    // FINAL ALERT
    // ─────────────────────────────────
    if (foundSignals.length > 0) {

      Alert.alert(
        'SCAN COMPLETE',
        `Found ${foundSignals.length} Smart Money setups`
      );

    } else {

      Alert.alert(
        'SCAN COMPLETE',
        'No institutional setups found'
      );
    }
  };

  // ─────────────────────────────────────
  // UI
  // ─────────────────────────────────────
  return (

    <ScrollView contentContainerStyle={styles.container}>

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>
          Smart Money Scanner
        </Text>

        <Text style={styles.subtitle}>
          Institutional flow + BOS + VWAP + Volume Spike Scanner
        </Text>
      </View>

      {/* INPUT */}
      <View style={styles.inputBox}>

        <Text style={styles.label}>
          ENTER TICKERS
        </Text>

        <TextInput
          style={styles.input}
          value={tickers}
          onChangeText={setTickers}
          multiline
          placeholder="RELIANCE, SBIN, HDFCBANK..."
          placeholderTextColor="#444"
        />

        <TouchableOpacity
          style={[
            styles.scanBtn,
            scanning && styles.disabledBtn
          ]}
          onPress={startScan}
          disabled={scanning}
        >

          {scanning ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.scanBtnText}>
              RUN SMART MONEY SCAN
            </Text>
          )}

        </TouchableOpacity>

      </View>

      {/* PROGRESS */}
      {scanning && (

        <View style={styles.progressContainer}>

          <View
            style={[
              styles.progressBar,
              { width: `${progress}%` }
            ]}
          />

          <Text style={styles.progressText}>
            Scanning... {Math.round(progress)}%
          </Text>

        </View>
      )}

      {/* RESULTS */}
      <View style={styles.resultsBox}>

        <Text style={styles.resultsTitle}>
          Institutional Signals
        </Text>

        {results.map((res, idx) => {

          const isTrade =
            res.state === 'TRADE' || res.state === 'WATCHLIST';

          const smartColor =
            res.smartScore >= 80
              ? '#00E5FF'
              : res.smartScore >= 65
                ? '#00C853'
                : res.smartScore >= 50
                  ? '#FFD600'
                  : '#666';

          return (

            <View
              key={idx}
              style={styles.resultCard}
            >

              {/* TOP */}
              <View style={styles.topRow}>

                <Text style={styles.resTicker}>
                  {res.ticker}
                </Text>

                <View
                  style={[
                    styles.badge,
                    res.state === 'TRADE'
                      ? styles.buyBadge
                      : res.state === 'WATCHLIST'
                      ? styles.watchBadge
                      : styles.waitBadge
                  ]}
                >

                  <Text style={styles.badgeText}>
                    {res.state === 'TRADE'
                      ? res.signal_type
                      : res.state === 'WATCHLIST'
                      ? 'WATCH'
                      : 'WAIT'}
                  </Text>

                </View>

              </View>

              {/* PRICE */}
              <Text style={styles.price}>
                ₹{res.price || '---'}
              </Text>

              {/* SMART MONEY */}
              <View style={styles.smartBox}>

                <Text style={styles.smartTitle}>
                  SMART MONEY
                </Text>

                <Text
                  style={[
                    styles.smartScore,
                    { color: smartColor }
                  ]}
                >
                  SCORE: {res.smartScore}
                </Text>

                <Text style={styles.smartLabel}>
                  {res.smartLabel}
                </Text>

              </View>

              {/* DETAILS */}
              <View style={styles.detailsRow}>

                <MiniItem
                  label="VWAP"
                  value={
                    res.aboveVWAP
                      ? 'ABOVE'
                      : 'BELOW'
                  }
                />

                <MiniItem
                  label="VOLUME"
                  value={
                    res.volumeSpike
                      ? `${res.volumeRatio}x`
                      : 'NORMAL'
                  }
                />

                <MiniItem
                  label="RS"
                  value={res.relativeStrength}
                />

              </View>

              {/* SECOND ROW */}
              <View style={styles.detailsRow}>

                <MiniItem
                  label="ENTRY"
                  value={res.entryType}
                />

                <MiniItem
                  label="SWEEP"
                  value={
                    res.liquiditySweep
                      ? 'YES'
                      : 'NO'
                  }
                />

                <MiniItem
                  label="BIAS"
                  value={res.bias}
                />

              </View>

              {/* REASON */}
              <View style={styles.reasonBox}>
                <Text style={styles.reasonText}>
                  {res.reason}
                </Text>
              </View>

            </View>
          );
        })}

        {results.length === 0 && !scanning && (
          <Text style={styles.emptyText}>
            Start scan to detect institutional activity
          </Text>
        )}

      </View>

    </ScrollView>
  );
};

// ─────────────────────────────────────
// MINI ITEM
// ─────────────────────────────────────
const MiniItem = ({ label, value }) => (
  <View style={styles.miniItem}>
    <Text style={styles.miniLabel}>
      {label}
    </Text>

    <Text style={styles.miniValue}>
      {value}
    </Text>
  </View>
);

// ─────────────────────────────────────
// STYLES
// ─────────────────────────────────────
const styles = StyleSheet.create({

  container: {
    padding: 20
  },

  header: {
    marginBottom: 25
  },

  title: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: '900',
  },

  subtitle: {
    color: '#666',
    fontSize: 13,
    marginTop: 5
  },

  inputBox: {
    backgroundColor: '#111',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222'
  },

  label: {
    color: COLORS.primary,
    fontWeight: 'bold',
    fontSize: 12,
    marginBottom: 10
  },

  input: {
    color: '#FFF',
    fontSize: 16,
    minHeight: 90,
    textAlignVertical: 'top'
  },

  scanBtn: {
    backgroundColor: COLORS.primary,
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    marginTop: 15
  },

  disabledBtn: {
    opacity: 0.5
  },

  scanBtnText: {
    color: '#FFF',
    fontWeight: '900',
    letterSpacing: 1
  },

  progressContainer: {
    marginTop: 20
  },

  progressBar: {
    height: 5,
    backgroundColor: COLORS.primary,
    borderRadius: 10
  },

  progressText: {
    color: '#888',
    marginTop: 8,
    textAlign: 'center'
  },

  resultsBox: {
    marginTop: 30
  },

  resultsTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15
  },

  resultCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 18,
    padding: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#1A1A1A'
  },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },

  resTicker: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold'
  },

  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },

  buyBadge: {
    backgroundColor: '#00C853'
  },

  watchBadge: {
    backgroundColor: '#FFD600'
  },

  waitBadge: {
    backgroundColor: '#333'
  },

  badgeText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 10
  },

  price: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 10
  },

  smartBox: {
    backgroundColor: '#111',
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center'
  },

  smartTitle: {
    color: '#666',
    fontSize: 10
  },

  smartScore: {
    fontSize: 28,
    fontWeight: 'bold'
  },

  smartLabel: {
    color: '#FFF',
    fontSize: 12,
    marginTop: 4
  },

  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12
  },

  miniItem: {
    backgroundColor: '#111',
    flex: 1,
    marginHorizontal: 4,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center'
  },

  miniLabel: {
    color: '#666',
    fontSize: 9
  },

  miniValue: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 3
  },

  reasonBox: {
    backgroundColor: '#111',
    padding: 10,
    borderRadius: 10,
    marginTop: 14
  },

  reasonText: {
    color: '#AAA',
    fontSize: 11,
    textAlign: 'center'
  },

  emptyText: {
    color: '#444',
    textAlign: 'center',
    marginTop: 20
  }

});

export default ScannerScreen;