import axios from 'axios';

const BASE_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE_URL}/api`;

export const api = axios.create({
  baseURL: API,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// ── Chart & SMC ─────────────────────────────────────────────
export const getChartData = (pair, timeframe = '15m') =>
  api.post('/chart-data', { pair, timeframe }).then(r => r.data);

export const getSMCAnalysis = (pair, timeframe = '15m') =>
  api.post('/smc-analyze', { pair, timeframe }).then(r => r.data);

// ── Signals ─────────────────────────────────────────────────
export const analyzeStock = (ticker, mode = 'STRICT', dataSource = 'REALTIME') =>
  api.post('/analyze', { ticker, mode, dataSource }).then(r => r.data);

export const analyzeForex = (pair, mode = 'STRICT', dataSource = 'REALTIME') => {
  const path = mode === 'SCALP' ? '/analyze-forex-scalp' : '/analyze-forex';
  return api.post(path, { pair, mode, dataSource }).then(r => r.data);
};

export const getScanner = () => api.get('/scanner').then(r => r.data);
export const getHealth  = () => api.get('/health').then(r => r.data);

// ── Opportunity Ticker ─────────────────────────────────────
export const getOpportunities = (minGrade = 'B') =>
  api.get(`/opportunities?min_grade=${encodeURIComponent(minGrade)}`, { timeout: 120000 }).then(r => r.data);
