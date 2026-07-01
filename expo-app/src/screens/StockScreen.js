import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Image, Alert } from 'react-native';
import { COLORS, globalStyles } from '../theme';
import StockSignalCard from '../components/StockSignalCard';
import Config from '../config';

const StockScreen = ({ analyze, getAngelPrice, signal, loading, ticker, setTicker, uploading, pickImage, lastUploadedChart, IMAGE_BASE_URL }) => {
  const [mode, setMode] = useState('STRICT'); // default
  const [dataSource, setDataSource] = useState('REALTIME');
  const [useRealtime, setUseRealtime] = useState(false);
  const [realtimePrice, setRealtimePrice] = useState(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);

  // Run analyze with explicit per-mode logic so each button has its own behavior
  const runMode = (m) => {
    // Determine default data source per mode (do not mix logic)
    let ds = 'REALTIME';
    if (m === 'STRICT') ds = 'YAHOO';
    if (m === 'AGGRESSIVE') ds = 'REALTIME';
    if (m === 'SCALP') ds = 'REALTIME';

    setMode(m);
    setDataSource(ds);
    setUseRealtime(false);
    setRealtimePrice(null);

    // Call analyze with explicit params for this mode
    analyze({ mode: m, dataSource: ds });
  };

  // Real-time button handler - Get direct Angel price
  const handleRealtimeClick = async () => {
    console.log('🔴 Real-time button clicked');
    console.log('📝 Ticker:', ticker);
    console.log('📝 getAngelPrice function:', typeof getAngelPrice);
    
    if (!ticker || ticker.trim() === '') {
      console.log('❌ No ticker entered');
      Alert.alert('Error', 'Please enter a stock ticker');
      return;
    }

    if (typeof getAngelPrice !== 'function') {
      console.log('❌ getAngelPrice is not a function:', typeof getAngelPrice);
      Alert.alert('Error', 'getAngelPrice function not available - check app initialization');
      return;
    }

    setFetchingPrice(true);
    setUseRealtime(true);
    
    try {
      console.log('⏳ Calling getAngelPrice...');
      const price = await getAngelPrice(ticker);
      console.log('💰 Price received:', price);
      
      if (price) {
        setRealtimePrice(price);
        console.log('✅ Price set to state:', price);
        Alert.alert(
          `💰 LIVE PRICE - ${ticker.toUpperCase()}`,
          `₹${price}`,
          [{ text: 'OK', onPress: () => console.log('Price displayed') }]
        );
      } else {
        console.log('⚠️ Price is null/undefined');
        Alert.alert('No Price', 'Could not fetch live price. Check ticker symbol.');
      }
    } catch (err) {
      console.log('❌ Error fetching price:', err.message);
      console.log('Error stack:', err);
      Alert.alert('Error', `Error: ${err.message}`);
    } finally {
      setFetchingPrice(false);
    }
  };

  // Test backend connectivity
  const handleTestConnection = async () => {
    console.log('🧪 Testing backend connectivity...');
    const apiUrl = Config.API_URL;
    console.log('🧪 API URL:', apiUrl);
    Alert.alert('Testing Connection', `API URL: ${apiUrl}`, [
      { text: 'Ping', onPress: testPing },
      { text: 'Close' }
    ]);
  };

  const testPing = async () => {
    try {
      console.log('🧪 Pinging backend...');
      const response = await fetch(`${Config.API_URL}/ping`);
      const data = await response.json();
      console.log('🧪 Ping response:', data);
      Alert.alert('✅ Connection OK', `Response:\n${JSON.stringify(data)}`);
    } catch (err) {
      console.log('❌ Ping failed:', err.message);
      Alert.alert('❌ Connection Failed', `Error: ${err.message}`);
    }
  };

  const getDefaultDataSource = (m) => {
    if (m === 'STRICT') return 'YAHOO';
    return 'REALTIME';
  };
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.searchSection}>
        <TextInput
          style={styles.input}
          placeholder="Enter Ticker (HEROMOTOCORP, RELIANCE, SBIN)"
          placeholderTextColor="#444"
          value={ticker}
          onChangeText={setTicker}
        />
        {/* ✅ ADD TOGGLE HERE */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              styles.strictBtn,
              mode === 'STRICT' && styles.activeToggle
            ]}
            onPress={() => runMode('STRICT')}
          >
            <Text style={styles.toggleText}>STRICT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleBtn,
              styles.aggressiveBtn,
              mode === 'AGGRESSIVE' && styles.activeToggle
            ]}
            onPress={() => runMode('AGGRESSIVE')}
          >
            <Text style={styles.toggleText}>AGGRESSIVE</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleBtn,
              styles.scalpBtn,
              mode === 'SCALP' && styles.activeToggle
            ]}
            onPress={() => runMode('SCALP')}
          >
            <Text style={styles.toggleText}>SCALP</Text>
          </TouchableOpacity>

        </View>
        {/* ⚡ REAL-TIME BUTTON - PROMINENT */}
        <TouchableOpacity
          style={[styles.realtimeButton, useRealtime && styles.realtimeButtonActive]}
          onPress={handleRealtimeClick}
          disabled={fetchingPrice}
        >
          {fetchingPrice ? (
            <ActivityIndicator size="small" color={useRealtime ? '#000' : '#00ff00'} />
          ) : (
            <Text style={[styles.realtimeButtonText, useRealtime && styles.realtimeButtonTextActive]}>
              ⚡ GET REAL-TIME PRICE
            </Text>
          )}
          {realtimePrice && (
            <Text style={[styles.priceDisplay, useRealtime && styles.priceDisplayActive]}>
              ₹{realtimePrice}
            </Text>
          )}
        </TouchableOpacity>

        {/* 🧪 NETWORK TEST BUTTON */}
        <TouchableOpacity
          style={[styles.realtimeButton, { marginTop: 8, backgroundColor: 'rgba(100, 150, 200, 0.1)', borderColor: '#6496c8' }]}
          onPress={handleTestConnection}
        >
          <Text style={[styles.realtimeButtonText, { color: '#6496c8' }]}>
            🧪 Test Connection
          </Text>
        </TouchableOpacity>

        {/* DATA SOURCE TOGGLE */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              dataSource === 'YAHOO' && styles.activeToggle
            ]}
            onPress={() => {
              setDataSource('YAHOO');
              if (ticker) analyze({ mode, dataSource: 'YAHOO' });
            }}
          >
            <Text style={styles.toggleText}>YAHOO</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleBtn,
              dataSource === 'REALTIME' && styles.activeToggle
            ]}
            onPress={() => {
              setDataSource('REALTIME');
              if (ticker) analyze({ mode, dataSource: 'REALTIME' });
            }}
          >
            <Text style={styles.toggleText}>REALTIME</Text>
          </TouchableOpacity>
        </View>

        {mode === 'SCALP' && (
          <View style={styles.scalpInfoBox}>
            <Text style={{ color: '#FFD700', fontSize: 12, fontWeight: 'bold', marginBottom: 4 }}>
              ⚡ SCALP MODE
            </Text>
            <Text style={{ color: '#aaa', fontSize: 11 }}>
              EMA9/EMA21 crossover retest on 1m candles. Select REALTIME for live Angel API pricing, or YAHOO for delayed data to save API hits.
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.searchButton}
          onPress={() =>
            analyze({
              mode,
              dataSource
            })
          }
        >
          <Text style={styles.searchButtonText}>
            {mode === 'SCALP' ? 'Start Scalp Analysis' : 'Start Deep Stock Analysis'}
          </Text>
        </TouchableOpacity>
        <Text style={{ color: '#888', textAlign: 'center', marginTop: 6 }}>
          Mode: {mode}
        </Text>
      </View>

      <TouchableOpacity style={styles.uploadBtn} onPress={pickImage} disabled={uploading}>
        <Text style={styles.uploadBtnText}>{uploading ? 'Processing...' : 'Upload & Audit Stock Chart'}</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Analyzing {ticker.toUpperCase()}...</Text>
        </View>
      ) : (
        <View>
          {signal && <StockSignalCard signal={signal} mode={mode} />}
          {lastUploadedChart && (
            <View style={styles.chartBox}>
              <Text style={styles.chartTitle}>Technical Audit: Key Support/Resistance</Text>
              <Image source={{ uri: IMAGE_BASE_URL + lastUploadedChart }} style={styles.fullImg} resizeMode="contain" />
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: { padding: 20 },
  searchSection: { marginBottom: 20 },
  input: { backgroundColor: '#111', color: '#FFF', padding: 18, borderRadius: 15, fontSize: 18, marginBottom: 12, borderWidth: 1, borderColor: '#222' },
  searchButton: { backgroundColor: COLORS.primary, padding: 18, borderRadius: 15, alignItems: 'center' },
  searchButtonText: { color: '#FFF', fontWeight: 'bold' },
  uploadBtn: { padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#222', marginBottom: 20 },
  uploadBtnText: { color: '#666', fontSize: 14 },
  loadingContainer: { marginTop: 50, alignItems: 'center' },
  loadingText: { color: '#666', marginTop: 10 },
  chartBox: { marginTop: 10 },
  chartTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  fullImg: { width: '100%', height: 300, borderRadius: 15, backgroundColor: '#111' },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toggleBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#111',
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#222',
  },
  activeToggle: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  toggleText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  disabledToggle: {
    opacity: 0.4,
    backgroundColor: '#222',
  },
  scalpInfoBox: {
    backgroundColor: '#1a1a2e',
    borderLeftWidth: 4,
    borderLeftColor: '#FFD700',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  strictBtn: {
    backgroundColor: '#0066cc',
  },
  aggressiveBtn: {
    backgroundColor: '#cc6600',
  },
  scalpBtn: {
    backgroundColor: '#cc0000',
  },
  realtimeButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#00ff00',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  realtimeButtonActive: {
    backgroundColor: '#00ff00',
    borderColor: '#00ff00',
  },
  realtimeButtonTextActive: {
    color: '#000',
  },
  realtimeButtonText: {
    color: '#00ff00',
    fontWeight: 'bold',
    fontSize: 16,
  },
  priceDisplay: {
    color: '#00ff00',
    fontWeight: 'bold',
    fontSize: 14,
    marginTop: 4,
  },
  priceDisplayActive: {
    color: '#000',
  },
});

export default StockScreen;
