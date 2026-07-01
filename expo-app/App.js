import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, StatusBar, TouchableOpacity, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { COLORS, globalStyles } from './src/theme';
import { SystemBadge } from './src/components/Shared';
import StockScreen from './src/screens/StockScreen';
import ForexScreen from './src/screens/ForexScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import AccuracyScreen from './src/screens/AccuracyScreen';
import { startAutoBot } from './src/utils/AutoBot';

// Configuration
import Config from './src/config';
const BASE_URL = Config.API_URL;
const STOCK_ANALYZE_URL = `${BASE_URL}/api/v1/analyze`;
const ANGEL_PRICE_URL = `${BASE_URL}/api/v1/angel-price`;
const FOREX_ANALYZE_URL = `${BASE_URL}/api/v1/analyze-forex`;
const FOREX_SCALP_URL = `${BASE_URL}/api/v1/analyze-forex-scalp`;
const UPLOAD_URL = `${BASE_URL}/api/v1/upload-chart`;
const IMAGE_BASE_URL = Config.IMAGE_BASE_URL;

export default function App() {
  const [activeTab, setActiveTab] = useState('STOCKS');

  // States
  const [ticker, setTicker] = useState('');
  const [pair, setPair] = useState('');
  const [currentSignal, setCurrentSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastUploadedChart, setLastUploadedChart] = useState(null);

  const [selectedMode, setSelectedMode] = useState('STRICT');
  const [selectedDataSource, setSelectedDataSource] = useState('REALTIME');
  const [activeAlerts, setActiveAlerts] = useState({});

  useEffect(() => {
    // Start automated background trading bot (paper trading for accuracy stats)
    startAutoBot();
  }, []);
  // Analyze Function
  const analyze = async (
    params = {},
    isPolling = false
  ) => {
    // If first param is boolean, it's the old 'isPolling' call from useEffect
    const actualIsPolling =
      typeof params === 'boolean'
        ? params
        : isPolling;

    const actualMode =
      typeof params === 'object'
        ? params.mode || selectedMode
        : selectedMode;

    const dataSource =
      typeof params === 'object'
        ? params.dataSource || selectedDataSource
        : selectedDataSource;

    // Update state if manual call
    if (!actualIsPolling && typeof params === 'object') {
      if (params.mode) setSelectedMode(params.mode);
      if (params.dataSource) setSelectedDataSource(params.dataSource);
    }

    const targetValue = activeTab === 'STOCKS' ? ticker : pair;
    if (!targetValue) return;

    if (!actualIsPolling) {
      setLoading(true);
      setLastUploadedChart(null);
    }


    let analyzeUrl;

    if (activeTab === 'STOCKS') {
      analyzeUrl = STOCK_ANALYZE_URL;
    } else {
      analyzeUrl =
        actualMode === 'SCALP'
          ? FOREX_SCALP_URL
          : FOREX_ANALYZE_URL;
    }
    console.log("MODE:", actualMode);
    console.log("URL:", analyzeUrl);
    try {
      let finalValue = targetValue.trim().toUpperCase();
      console.log('Final value before normalization:', finalValue);
      if (!finalValue) return;

      if (activeTab === 'STOCKS') {
        if (!finalValue.includes('.') && !finalValue.startsWith('^')) {
          finalValue += '.NS';
        }
      }

      const requestBody = activeTab === 'STOCKS'
        ? JSON.stringify({
          ticker: finalValue,
          mode: actualMode,
          dataSource
        })
        : JSON.stringify({
          pair: finalValue,
          mode: actualMode,
          dataSource
        });

      const response = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error('Analyze error', response.status, errText);
        if (Platform.OS === 'web') window.alert(`Server Error: ${response.status} ${errText}`);
        else Alert.alert('Server Error', `${response.status} ${errText}`);
        if (!actualIsPolling) setLoading(false);
        return;
      }

      const data = await response.json();
      console.log('Analyze response', data);
      setCurrentSignal(data);

      // 🔔 NEW: SIGNAL ALERTS
      if (data && data.state === 'TRADE' && !actualIsPolling) {
        if (Platform.OS === 'web') {
          // On web, Alert.alert is just a fallback, maybe use console or custom UI
          console.log("SIGNAL FOUND:", data.signal_type);
        }
        Alert.alert(
          `🚀 SIGNAL FOUND: ${data.signal_type}`,
          `${data.ticker || data.pair} is READY for a ${data.signal_type} trade!\n\nEntry: ${data.entry}\nSL: ${data.sl}\nTP: ${data.tp || data.tp1}`,
          [{ text: "GO TO TRADE", onPress: () => console.log("Alert closed") }]
        );
      }
    } catch (error) {
      if (!actualIsPolling) Alert.alert('Connection Error', `Target: ${analyzeUrl}\nError: ${error.message}`);
    } finally {
      if (!actualIsPolling) setLoading(false);
    }
  };

  // ⚡ GET ANGEL LIVE PRICE
  const getAngelPrice = async (symbol) => {
    console.log('🟦 [getAngelPrice] Called with symbol:', symbol);
    console.log('🟦 [getAngelPrice] ANGEL_PRICE_URL:', ANGEL_PRICE_URL);
    
    if (!symbol) {
      console.log('🟦 [getAngelPrice] No symbol provided');
      Alert.alert('Error', 'Please enter a stock symbol');
      return null;
    }

    try {
      console.log('🟦 [getAngelPrice] Setting loading to true');
      setLoading(true);
      
      const payload = { ticker: symbol.toUpperCase() };
      console.log('🟦 [getAngelPrice] Sending payload:', JSON.stringify(payload));
      
      const response = await fetch(ANGEL_PRICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log('🟦 [getAngelPrice] Response status:', response.status);
      console.log('🟦 [getAngelPrice] Response ok:', response.ok);

      if (!response.ok) {
        const errText = await response.text();
        console.log('🟦 [getAngelPrice] Error text:', errText);
        Alert.alert('Error', `Failed to fetch price: ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log('🟦 [getAngelPrice] Response data:', JSON.stringify(data));

      if (data.status === 'success') {
        console.log('🟦 [getAngelPrice] Success! Price:', data.price);
        return data.price;
      } else {
        console.log('🟦 [getAngelPrice] Status not success:', data.status);
        Alert.alert('Error', data.message || 'Could not fetch price');
        return null;
      }
    } catch (error) {
      console.log('🟦 [getAngelPrice] Exception:', error.message);
      console.log('🟦 [getAngelPrice] Stack:', error);
      Alert.alert('Connection Error', error.message);
      return null;
    } finally {
      console.log('🟦 [getAngelPrice] Setting loading to false');
      setLoading(false);
    }
  };

  // Polling Effect

  useEffect(() => {
    if (!currentSignal) return;
    const updateSpeed = selectedDataSource === 'REALTIME' ? 4000 : 10000;
    const interval = setInterval(() => {
      analyze(true);
    }, updateSpeed);
    return () => clearInterval(interval);
  }, [currentSignal, selectedMode, selectedDataSource, ticker, pair, activeTab]);

  // 🛡️ MARKET WATCHDOG (BTC & GOLD)
  useEffect(() => {
    const watchlist = ['BTC', 'GOLD'];
    const monitor = async () => {
      for (const symbol of watchlist) {
        if (activeTab === 'FOREX' && pair.toUpperCase() === symbol) continue;
        try {
          const response = await fetch(FOREX_ANALYZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pair: symbol,
              mode: 'STRICT',
              dataSource: 'REALTIME'
            }),
          });
          const data = await response.json();
          if (data && data.state === 'TRADE') {
            const alertKey = `${symbol}_${data.signal_type}_${data.entry}`;
            if (!activeAlerts[alertKey]) {
              Alert.alert(
                `🔔 WATCHDOG ALERT: ${symbol}`,
                `${data.signal_type} Signal Detected!\nPrice: ${data.current_price}\nRR: ${data.rr_ratio}`,
                [{
                  text: "VIEW SIGNAL", onPress: () => {
                    setActiveTab('FOREX');
                    setPair(symbol);
                    setCurrentSignal(data);
                  }
                }]
              );
              setActiveAlerts(prev => ({ ...prev, [alertKey]: true }));
            }
          }
        } catch (e) {
          console.log("Watchdog Error:", e.message);
        }
      }
    };
    const interval = setInterval(monitor, 45000);
    return () => clearInterval(interval);
  }, [activeAlerts, activeTab, pair]);



  // Image Picking
  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1
    });
    if (!result.canceled) uploadImage(result.assets[0].uri);
  };

  // New upload handler that works on web and native: do NOT set Content-Type header manually.
  const uploadImage = async (uri) => {
    setUploading(true);
    setCurrentSignal(null);
    try {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        // On web, fetch the file as blob first
        const resp = await fetch(uri);
        const blob = await resp.blob();
        formData.append('chart', blob, 'chart.jpg');
      } else {
        formData.append('chart', { uri, name: 'chart.jpg', type: 'image/jpeg' });
      }

      const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (response.ok) setLastUploadedChart(data.filename);
      else Alert.alert('Upload failed', data.error || 'Server error');
    } catch (e) {
      Alert.alert('Error', 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCurrentSignal(null);
    setLastUploadedChart(null);
  };

  const content = (
    <View style={styles.contentContainer}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.logo}>TrendWay <Text style={styles.logoPro}>PRO</Text></Text>
        <SystemBadge />
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'STOCKS' && styles.activeTab]}
          onPress={() => handleTabChange('STOCKS')}
        >
          <Text style={[styles.tabText, activeTab === 'STOCKS' && styles.activeTabText]}>STOCKS</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'FOREX' && styles.activeTab]}
          onPress={() => handleTabChange('FOREX')}
        >
          <Text style={[styles.tabText, activeTab === 'FOREX' && styles.activeTabText]}>FOREX/CRYPTO</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'SCANNER' && styles.activeTab]}
          onPress={() => handleTabChange('SCANNER')}
        >
          <Text style={[styles.tabText, activeTab === 'SCANNER' && styles.activeTabText]}>SCANNER</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'ACCURACY' && styles.activeTab]}
          onPress={() => handleTabChange('ACCURACY')}
        >
          <Text style={[styles.tabText, activeTab === 'ACCURACY' && styles.activeTabText]}>📊 ACCURACY</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'STOCKS' ? (
          <StockScreen
            analyze={analyze}
            getAngelPrice={getAngelPrice}
            signal={currentSignal}
            loading={loading}
            ticker={ticker}
            setTicker={setTicker}
            uploading={uploading}
            pickImage={pickImage}
            lastUploadedChart={lastUploadedChart}
            IMAGE_BASE_URL={IMAGE_BASE_URL}
          />
        ) : activeTab === 'FOREX' ? (
          <ForexScreen
            analyze={analyze}
            signal={currentSignal}
            loading={loading}
            pair={pair}
            setPair={setPair}
            uploading={uploading}
            pickImage={pickImage}
            lastUploadedChart={lastUploadedChart}
            IMAGE_BASE_URL={IMAGE_BASE_URL}
          />
        ) : activeTab === 'ACCURACY' ? (
          <AccuracyScreen />
        ) : (
          <ScannerScreen BASE_URL={BASE_URL} />
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contentContainer: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: Platform.OS === 'web' ? 20 : 40,
    marginBottom: 10
  },
  logo: { fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: 1 },
  logoPro: { color: COLORS.primary },
  tabContainer: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 18, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { color: COLORS.textMuted, fontWeight: 'bold', fontSize: 13 },
  activeTabText: { color: COLORS.primary },
});
