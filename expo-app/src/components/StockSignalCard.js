import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

function getNextExpiryDate(ticker) {
  const t = (ticker || '').toUpperCase();
  let targetDay = -1;

  if (t.includes('BANKNIFTY') || t.includes('NSEBANK') || t.includes('NIFTY BANK')) {
    targetDay = 3; 
  } else if (t.includes('FINNIFTY') || t.includes('NIFTY FIN')) {
    targetDay = 2; 
  } else if (t.includes('MIDCPNIFTY') || t.includes('MIDCAP')) {
    targetDay = 1; 
  } else if (t.includes('NIFTY') || t.includes('NSEI')) {
    targetDay = 4; 
  } else if (t.includes('SENSEX') || t.includes('BSESN')) {
    targetDay = 5; 
  }

  if (targetDay === -1) return null;

  const nowIST = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  
  let daysUntil = targetDay - nowIST.getDay();
  if (daysUntil < 0) {
    daysUntil += 7;
  } else if (daysUntil === 0) {
    if (nowIST.getHours() > 15 || (nowIST.getHours() === 15 && nowIST.getMinutes() >= 30)) {
      daysUntil += 7;
    }
  }
  
  const expiryDate = new Date(nowIST.getTime());
  expiryDate.setDate(nowIST.getDate() + daysUntil);
  
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][targetDay];
  const dateStr = expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  
  return `Next Expiry: ${dateStr} (${dayName})`;
}

const StockSignalCard = ({ signal, mode }) => {
  console.log("SIGNAL:", signal);
  if (!signal) return null;

  const smartMoney = signal.smart_money || {};

  const statusColor =
    signal.status_label === 'TRADE'
      ? '#00C853'
      : signal.status_label === 'WAIT'
        ? '#FFD600'
        : '#FF3B30';

  const biasColor =
    signal.bias === 'BULLISH'
      ? '#00C853'
      : signal.bias === 'BEARISH'
        ? '#FF3B30'
        : '#888';

  const rsi = signal.metrics?.rsi;

  const rsiColor =
    rsi && rsi > 70 ? '#FF3B30' :
      rsi && rsi < 30 ? '#00C853' :
        '#FFF';

  const TradeItem = ({ label, value }) => (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: '#777', fontSize: 10 }}>{label}</Text>
      <Text style={{ color: '#FFF', fontWeight: 'bold' }}>
        {value != null ? value.toFixed(2) : '--'}
      </Text>
    </View>
  );
  
  // Mode-specific strategy names
  const strategyNames = mode === 'SCALP' ? {
    trend: 'EMA9/EMA21 Crossover',
    structure: 'Market Structure',
    bos: '1m BOS',
    zone: 'Zone',
    momentum: 'RSI Momentum',
    volume: 'Volume'
  } : {
    trend: 'Trend (200 EMA)',
    structure: 'Market Structure',
    bos: '5m BOS',
    zone: 'Zone',
    momentum: 'RSI Momentum',
    volume: 'Volume'
  };

  const strategies = signal.modules
    ? Object.entries(signal.modules).map(([key, val]) => ({
      title: strategyNames[key] || key,
      ...val
    }))
    : [];

  return (
    <View style={styles.card}>

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.symbol}>
            {signal.ticker || signal.pair}
          </Text>
          {getNextExpiryDate(signal.ticker || signal.pair) && (
            <Text style={{ color: '#00D2FF', fontSize: 11, marginTop: 2, fontWeight: 'bold' }}>
              {getNextExpiryDate(signal.ticker || signal.pair)}
            </Text>
          )}
        </View>

        <View style={[styles.badge, { backgroundColor: statusColor }]}>
          <Text style={styles.badgeText}>{signal.status_label}</Text>
        </View>
      </View>

      {/* PRICE (FIXED) */}
      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>CURRENT PRICE</Text>
        <Text style={styles.currentPrice}>
          {signal.current_price != null
            ? signal.current_price.toFixed(2)
            : '--'}
        </Text>
      </View>
      {/* ENTRY TIMING (NEW FEATURE) */}
      {signal.state === "TRADE" && signal.entry_type && (
        <View style={styles.entryTypeBox}>
          <Text style={styles.entryTypeLabel}>ENTRY TYPE</Text>
          <Text
            style={[
              styles.entryTypeValue,
              signal.entry_type === 'EARLY' && { color: '#FFD600' },
              signal.entry_type === 'CONFIRMATION' && { color: '#00C853' },
              signal.entry_type === 'BREAKOUT' && { color: '#FF3B30' },
            ]}
          >
            {signal.entry_type}
          </Text>
        </View>
      )}
      {/* ENTRY / SL / TP */}
      {signal.state === "TRADE" ? (
        <View style={styles.tradeBox}>
          <TradeItem label="ENTRY" value={signal.entry} />
          <TradeItem label="SL" value={signal.sl} />
          <TradeItem label="TP1" value={signal.tp1} />
          <TradeItem label="TP2" value={signal.tp2} />
        </View>
      ) : (
        <View style={styles.waitBox}>
          <Text style={styles.noTradeText}>
            {signal.reason_summary}
          </Text>
          <Text style={styles.waitingHint}>
            Waiting for breakout (BOS)
          </Text>
          {/* OPTIONAL: show useful info instead */}
          <View style={styles.infoRow}>
            <Text style={styles.infoText}>
              ATR: {signal.metrics?.atr?.toFixed(2)}
            </Text>
            <Text style={styles.infoText}>
              RSI: {signal.metrics?.rsi?.toFixed(1)}
            </Text>
          </View>
        </View>
      )}
      {/* BIAS */}
      <View style={styles.row}>
        <Text style={styles.label}>Bias:</Text>
        <Text style={[styles.value, { color: biasColor }]}>
          {signal.bias}
        </Text>

        <Text style={styles.label}> | Confidence:</Text>
        <Text style={styles.value}>{signal.confidence_text || '--'}</Text>
      </View>

      {/* METRICS */}
      <View style={styles.metrics}>
        <Metric label="RSI" value={rsi} color={rsiColor} />
        <Metric label="ATR" value={signal.metrics?.atr} />
        {mode !== 'SCALP' && <Metric label="EMA200" value={signal.metrics?.ema200} />}
        {mode === 'SCALP' && <Metric label="Scalp Setup" value={signal.scalper_signal?.direction ? (signal.scalper_signal.direction === 'LONG' ? 1 : -1) : 0} />}
      </View>

      {/* REASON */}
      {signal.state !== "TRADE" ? (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonText}>
            {signal.reason_summary}
          </Text>


        </View>
      ) : (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonText}>
            {signal.reason_summary}
          </Text>
        </View>
      )}
      {/* STRATEGY */}
      <Text style={styles.section}>Strategy Logic</Text>

      {strategies.map((s, i) => {
        // Hide non-SCALP modules for SCALP mode
        if (mode === 'SCALP' && (s.title === 'Market Structure' || s.title === 'Zone')) {
          return null;
        }
        return <StrategyRow key={i} item={s} />;
      })}
      {/* SMART MONEY ENGINE - HIDDEN FOR SCALP */}
      {mode !== 'SCALP' && (
      <View style={styles.smartMoneyBox}>

        <Text style={styles.smartMoneyTitle}>
          SMART MONEY ENGINE
        </Text>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            Institutional Flow
          </Text>

          <Text
            style={[
              styles.smartValue,
              {
                color:
                  smartMoney.score >= 65
                    ? '#00C853'
                    : smartMoney.score >= 50
                      ? '#FFD600'
                      : '#AAA'
              }
            ]}
          >
            {smartMoney.label || 'NO DATA'}
          </Text>
        </View>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            Smart Score
          </Text>

          <Text style={styles.smartValue}>
            {smartMoney.score || 0}
          </Text>
        </View>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            Volume Spike
          </Text>

          <Text style={styles.smartValue}>
            {
              smartMoney.volume_spike
                ? `YES (${smartMoney.volume_ratio}x)`
                : 'NO'
            }
          </Text>
        </View>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            Relative Strength
          </Text>

          <Text style={styles.smartValue}>
            {smartMoney.relative_strength || 0}
          </Text>
        </View>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            VWAP Control
          </Text>

          <Text style={styles.smartValue}>
            {
              smartMoney.above_vwap
                ? 'ABOVE VWAP'
                : 'BELOW VWAP'
            }
          </Text>
        </View>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            Compression
          </Text>

          <Text style={styles.smartValue}>
            {
              smartMoney.compression
                ? 'YES'
                : 'NO'
            }
          </Text>
        </View>

        <View style={styles.smartRow}>
          <Text style={styles.smartLabel}>
            Liquidity Sweep
          </Text>

          <Text style={styles.smartValue}>
            {
              smartMoney.liquidity_sweep
                ? 'DETECTED'
                : 'NO'
            }
          </Text>
        </View>

      </View>
      )}

      {/* ───── SCALPER ENGINE PANEL ───── */}
      {signal.scalper_signal && (
        <View style={styles.scalperBox}>
          <Text style={styles.scalperTitle}>
            ⚡ SCALPER STRATEGY ENGINE
          </Text>
          <View style={styles.smartRow}>
            <Text style={styles.smartLabel}>Action Bias</Text>
            <Text style={[styles.smartValue, { color: signal.scalper_signal.status_label === 'TRADE' ? '#00C853' : '#FFD600' }]}>
              {signal.scalper_signal.action}
            </Text>
          </View>
          {signal.scalper_signal.status_label === 'TRADE' && (
            <View style={styles.tradeBox}>
              <TradeItem label="ENTRY" value={signal.scalper_signal.entry} />
              <TradeItem label="TARGET" value={signal.scalper_signal.target} />
              <TradeItem label="STOP LOSS" value={signal.scalper_signal.sl} />
            </View>
          )}
          {signal.scalper_signal.option_trade && signal.scalper_signal.option_trade !== "N/A" && (
            <View style={styles.smartRow}>
              <Text style={styles.smartLabel}>Option Play</Text>
              <Text style={[styles.smartValue, { color: '#00D2FF', fontWeight: 'bold' }]}>
                {signal.scalper_signal.option_trade}
              </Text>
            </View>
          )}
          <View style={styles.reasonBox}>
            <Text style={styles.reasonText}>{signal.scalper_signal.reason_summary}</Text>
          </View>
        </View>
      )}

      {/* ───── OI WRITER PANEL - HIDDEN FOR SCALP ───── */}
      {mode !== 'SCALP' && signal.oi_writer_signal && (
        <View style={styles.oiBox}>
          <Text style={styles.oiTitle}>
            📊 INSTITUTIONAL OI WRITER (OPTION SELLER)
          </Text>
          <View style={styles.smartRow}>
            <Text style={styles.smartLabel}>Writing Strike</Text>
            <Text style={[styles.smartValue, { color: '#00C853', fontSize: 13 }]}>
              {signal.oi_writer_signal.strike ? `${signal.ticker || signal.pair || 'Strike'} ${signal.oi_writer_signal.strike} ${signal.oi_writer_signal.premium_type}` : '--'}
            </Text>
          </View>
          <View style={styles.smartRow}>
            <Text style={styles.smartLabel}>Safety Buffer</Text>
            <Text style={[styles.smartValue, { color: '#FFD600' }]}>
              {signal.oi_writer_signal.safety_buffer}
            </Text>
          </View>
          <View style={styles.smartRow}>
            <Text style={styles.smartLabel}>Premium Eating (Decay)</Text>
            <Text style={[styles.smartValue, { color: signal.oi_writer_signal.premium_eating.includes('YES') ? '#00C853' : '#FF3B30', fontWeight: 'bold' }]}>
              {signal.oi_writer_signal.premium_eating}
            </Text>
          </View>
          <View style={styles.smartRow}>
            <Text style={styles.smartLabel}>System Conviction</Text>
            <Text style={styles.smartValue}>
              {signal.oi_writer_signal.status_label}
            </Text>
          </View>
          <View style={styles.reasonBox}>
            <Text style={styles.reasonText}>{signal.oi_writer_signal.reason_summary}</Text>
          </View>
        </View>
      )}
    </View>
  );
};

export default StockSignalCard;

////////////////////////////////////////////////////////

const Metric = ({ label, value, color }) => (
  <View style={styles.metricItem}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={[styles.metricValue, color && { color }]}>
      {value != null ? Number(value).toFixed(2) : '--'}
    </Text>
  </View>
);

////////////////////////////////////////////////////////

const StrategyRow = ({ item }) => {
  const color =
    item.status === 'PASS'
      ? '#00C853'
      : item.status === 'FAIL'
        ? '#FF3B30'
        : '#888';

  return (
    <View style={styles.strategyRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />

      <View style={{ flex: 1 }}>
        <Text style={styles.strategyTitle}>{item.title}</Text>
        <Text style={styles.strategySub}>{item.reason}</Text>
      </View>

      <Text style={[styles.statusTag, { color }]}>
        {item.status}
      </Text>
    </View>
  );
};

////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  priceRow: {
    alignItems: 'center',
    marginVertical: 10,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },

  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  waitingHint: {
    color: '#FFD600',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
  activeToggle: {
    backgroundColor: COLORS.primary,
  },

  toggleText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  priceLabel: {
    color: '#666',
    fontSize: 10,
  },

  currentPrice: {
    color: '#FFF',
    fontSize: 28,   // bigger
    fontWeight: 'bold',
  },
  tradeBox: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
    backgroundColor: '#111',
    padding: 10,
    borderRadius: 10,
  },
  card: {
    backgroundColor: '#0B0B0F',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1A1F',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  symbol: {
    fontSize: 20,
    color: '#FFF',
    fontWeight: 'bold',
  },

  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },

  row: {
    flexDirection: 'row',
    marginTop: 8,
  },

  label: {
    fontSize: 11,
    color: '#777',
  },

  value: {
    fontSize: 11,
    color: '#FFF',
    marginRight: 6,
  },

  confidenceBar: {
    height: 6,
    backgroundColor: '#222',
    borderRadius: 10,
    marginTop: 8,
  },

  confidenceFill: {
    height: 6,
    backgroundColor: '#00C853',
    borderRadius: 10,
  },

  priceBox: {
    alignItems: 'center',
    marginVertical: 15,
  },


  price: {
    fontSize: 22,
    color: '#FFF',
    fontWeight: 'bold',
  },

  metrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    padding: 10,
    borderRadius: 10,
  },

  metricItem: {
    alignItems: 'center',
  },

  metricLabel: {
    fontSize: 9,
    color: '#777',
  },

  metricValue: {
    fontSize: 13,
    color: '#FFF',
    fontWeight: 'bold',
  },

  reasonBox: {
    backgroundColor: '#111',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },

  reasonText: {
    color: '#bbb',
    textAlign: 'center',
    fontSize: 12,
  },

  marketBadge: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 10,
  },

  ranging: {
    backgroundColor: 'rgba(255, 214, 0, 0.2)',
  },

  trending: {
    backgroundColor: 'rgba(0, 200, 83, 0.2)',
  },

  marketText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },

  section: {
    marginTop: 15,
    color: '#888',
    fontSize: 11,
  },

  strategyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    marginRight: 10,
  },

  strategyTitle: {
    color: '#FFF',
    fontSize: 12,
  },

  strategySub: {
    color: '#777',
    fontSize: 10,
  },

  statusTag: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  entryTypeBox: {
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#111',
  },

  entryTypeLabel: {
    fontSize: 9,
    color: '#666',
  },
  noTradeBox: {
    backgroundColor: '#111',
    padding: 12,
    borderRadius: 10,
    marginVertical: 10,
    alignItems: 'center',
  },
  waitBox: {
    backgroundColor: '#111',
    padding: 12,
    borderRadius: 10,
    marginVertical: 10,
    alignItems: 'center',
  },

  waitText: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },

  infoRow: {
    flexDirection: 'row',
    gap: 10,
  },

  infoText: {
    color: '#666',
    fontSize: 11,
  },
  noTradeText: {
    color: '#888',
    fontSize: 12,
  },
  entryTypeValue: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  smartMoneyBox: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
  },

  smartMoneyTitle: {
    color: '#00C853',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 14,
  },

  smartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  smartLabel: {
    color: '#777',
    fontSize: 12,
  },

  smartValue: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  time: {
    marginTop: 10,
    fontSize: 10,
    color: '#555',
    textAlign: 'center',
  },
  scalperBox: {
    marginTop: 16,
    backgroundColor: '#070C14',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1D2A44',
  },
  scalperTitle: {
    color: '#00D2FF',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  oiBox: {
    marginTop: 16,
    backgroundColor: '#0F0914',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#321D47',
  },
  oiTitle: {
    color: '#D800FF',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 12,
  },
});