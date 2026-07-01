/**
 * Trade Alert & Notification System
 * Sends alerts for BTC & GOLD trade opportunities
 */

const notifications = {
  // Store device tokens from frontend
  deviceTokens: new Set(),

  // Alert history (last 100)
  recentAlerts: [],

  // Register device for notifications
  registerDevice(token) {
    if (token && !this.deviceTokens.has(token)) {
      this.deviceTokens.add(token);
      console.log(`📱 Device registered: ${token.substring(0, 20)}... (Total: ${this.deviceTokens.size})`);
      return true;
    }
    return false;
  },

  // ✅ SEND ALERT FOR TRADE OPPORTUNITY
  sendTradeAlert(pair, signal) {
    if (!pair || !signal) return false;

    // Only alert for BTC & GOLD
    const isBTC = pair.toUpperCase().includes('BTC');
    const isGOLD = pair.toUpperCase().includes('GOLD') || pair.toUpperCase().includes('XAU');

    if (!isBTC && !isGOLD) return false;

    const alert = {
      timestamp: new Date().toISOString(),
      pair: pair.toUpperCase(),
      type: signal.signal_type, // LONG or SHORT
      entry: signal.entry,
      sl: signal.sl,
      tp1: signal.tp1,
      tp2: signal.tp2,
      status: signal.status_label,
      score: signal.confidence_text || signal.smart_money?.label || 'N/A',
      reason: signal.reason_summary,
      rr: signal.rr_ratio || 'N/A',
    };

    // Store in history
    this.recentAlerts.push(alert);
    if (this.recentAlerts.length > 100) {
      this.recentAlerts.shift(); // Keep last 100
    }

    // Log alert
    const emoji = signal.signal_type === 'LONG' ? '📈' : '📉';
    console.log(`
${emoji} ⚠️  TRADE ALERT: ${pair} ${signal.signal_type}
   Entry: ${signal.entry.toFixed(2)}
   SL: ${signal.sl.toFixed(2)}
   TP1: ${signal.tp1.toFixed(2)}
   TP2: ${signal.tp2.toFixed(2)}
   Score: ${signal.confidence_text || 'Professional'}
    `);

    // Send to all registered devices
    this.notifyAllDevices(alert);

    return alert;
  },

  // Broadcast alert to all registered devices
  notifyAllDevices(alert) {
    if (this.deviceTokens.size === 0) {
      console.log('📱 No devices registered for notifications');
      return;
    }

    // In production, here you'd send via Firebase Cloud Messaging, OneSignal, etc.
    // For now, we just log
    console.log(`📢 Broadcasting alert to ${this.deviceTokens.size} device(s)...`);

    // Example: Send email notification
    if (alert.pair === 'BTC' || alert.pair === 'GOLD') {
      sendEmailAlert(alert);
    }
  },

  // Get recent alerts
  getRecentAlerts(limit = 20) {
    return this.recentAlerts.slice(-limit).reverse();
  },

  // Get alerts for specific pair
  getAlertsForPair(pair, limit = 10) {
    return this.recentAlerts
      .filter(a => a.pair.includes(pair.toUpperCase()))
      .slice(-limit)
      .reverse();
  },

  // Clear old alerts (older than 24 hours)
  cleanupOldAlerts() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.recentAlerts = this.recentAlerts.filter(a => {
      return new Date(a.timestamp).getTime() > oneDayAgo;
    });
  },
};

// ✅ EMAIL ALERT (OPTIONAL - requires SendGrid/Mailgun API key)
async function sendEmailAlert(alert) {
  const emailApiKey = process.env.SENDGRID_API_KEY || process.env.MAILGUN_API_KEY;

  if (!emailApiKey) {
    console.log('⚠️  Email alerts not configured (set SENDGRID_API_KEY or MAILGUN_API_KEY in .env)');
    return;
  }

  const subject = `🚨 ${alert.pair} ${alert.type} TRADE ALERT`;
  const body = `
TRADE OPPORTUNITY DETECTED

Pair: ${alert.pair}
Direction: ${alert.type}
Score: ${alert.score}

Entry: ${alert.entry.toFixed(2)}
Stop Loss: ${alert.sl.toFixed(2)}
Take Profit 1: ${alert.tp1.toFixed(2)}
Take Profit 2: ${alert.tp2.toFixed(2)}

Risk/Reward: ${alert.rr}

Reason: ${alert.reason}

---
TrendWay Pro Trading Bot
  `;

  console.log(`📧 Email would be sent:\nSubject: ${subject}\n${body}`);

  // TODO: Implement actual email sending
  // POST to SendGrid or Mailgun API
}

// ✅ IN-APP NOTIFICATION FORMAT (for React Native)
function formatNotificationForApp(alert) {
  return {
    title: `🎯 ${alert.pair} ${alert.type}`,
    body: `Entry: ${alert.entry.toFixed(2)} | TP: ${alert.tp1.toFixed(2)}`,
    data: alert,
    sound: true,
    vibrate: [0, 250, 250, 250],
    badge: 1,
  };
}

module.exports = {
  notifications,
  sendEmailAlert,
  formatNotificationForApp,
};
