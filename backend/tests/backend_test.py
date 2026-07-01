"""
Tredways backend integration tests (pytest).
Covers: health, chart-data, smc-analyze, analyze (stock/forex/scalp),
angel-price, scanner. Uses public REACT_APP_BACKEND_URL through ingress.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://a13cd43d-181e-43e3-a7b9-0c053d68a493.preview.emergentagent.com",
).rstrip("/")

API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── Health ────────────────────────────────────────────────────────────
class TestHealth:
    def test_root(self, client):
        r = client.get(f"{API}/")
        assert r.status_code == 200
        d = r.json()
        assert d.get("service") == "Tredways"

    def test_health(self, client):
        r = client.get(f"{API}/health")
        assert r.status_code == 200
        d = r.json()
        assert d.get("python") == "ok"
        assert d.get("node_backend") == "ok", f"Node backend down: {d}"


# ── Chart data ────────────────────────────────────────────────────────
class TestChartData:
    @pytest.mark.parametrize(
        "pair,tf",
        [
            ("NIFTY", "15m"),
            ("RELIANCE", "15m"),
            ("EURUSD", "1h"),
            ("BTCUSD", "15m"),
            ("XAUUSD", "15m"),
        ],
    )
    def test_chart_data(self, client, pair, tf):
        r = client.post(f"{API}/chart-data", json={"pair": pair, "timeframe": tf}, timeout=30)
        assert r.status_code == 200, f"{pair} {tf} -> {r.status_code} {r.text[:200]}"
        d = r.json()
        assert "candles" in d and isinstance(d["candles"], list)
        assert len(d["candles"]) >= 100, f"only {len(d['candles'])} candles for {pair}"
        c0 = d["candles"][0]
        for k in ("open", "high", "low", "close", "timestamp"):
            assert k in c0, f"candle missing {k}"
        assert d.get("live_price") is not None


# ── SMC analyze ───────────────────────────────────────────────────────
class TestSMC:
    @pytest.mark.parametrize(
        "pair,tf",
        [
            ("RELIANCE", "15m"),
            ("EURUSD", "1h"),
            ("BTCUSD", "15m"),
            ("XAUUSD", "15m"),
            ("NIFTY", "15m"),
        ],
    )
    def test_smc_analyze(self, client, pair, tf):
        r = client.post(f"{API}/smc-analyze", json={"pair": pair, "timeframe": tf}, timeout=30)
        assert r.status_code == 200, f"{pair}: {r.status_code} {r.text[:200]}"
        d = r.json()
        assert "current_phase" in d
        assert d["current_phase"] in ("NEUTRAL", "ACCUMULATION", "MANIPULATION", "DISTRIBUTION")
        assert "zones" in d and isinstance(d["zones"], list)
        assert "liquidity_grab" in d
        lg = d["liquidity_grab"]
        assert "direction" in lg
        assert lg["direction"] in ("LONG", "SHORT", "NONE")
        assert "grade" in lg
        assert "reasons" in lg and isinstance(lg["reasons"], list)
        # If LONG/SHORT — required numeric fields
        if lg["direction"] != "NONE":
            for k in ("entry", "sl", "tp1", "tp2", "tp3"):
                assert lg.get(k) is not None, f"{pair} missing {k}"
        assert "atr" in d and isinstance(d["atr"], (int, float))
        assert "last_price" in d


# ── Analyze proxies (stock/forex/scalp) ───────────────────────────────
class TestAnalyzeProxies:
    def test_analyze_stock(self, client):
        r = client.post(
            f"{API}/analyze",
            json={"ticker": "RELIANCE", "mode": "AGGRESSIVE", "dataSource": "REALTIME"},
            timeout=45,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        d = r.json()
        # Accept either signal_type or signalType keys — must be JSON, never HTML
        assert isinstance(d, dict)
        # Common keys expected
        possible = {"signal_type", "signalType", "status_label", "statusLabel",
                    "entry", "sl", "tp1", "signal", "status"}
        assert any(k in d for k in possible), f"unexpected shape: {list(d.keys())[:20]}"

    def test_analyze_forex(self, client):
        r = client.post(
            f"{API}/analyze-forex",
            json={"pair": "EURUSD", "mode": "STRICT", "dataSource": "REALTIME"},
            timeout=45,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        d = r.json()
        assert isinstance(d, dict)

    def test_analyze_forex_scalp(self, client):
        r = client.post(
            f"{API}/analyze-forex-scalp",
            json={"pair": "BTCUSD", "mode": "SCALP", "dataSource": "REALTIME"},
            timeout=45,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        d = r.json()
        assert isinstance(d, dict)


# ── Angel price (falls back to Yahoo) ─────────────────────────────────
class TestAngelPrice:
    def test_angel_price_reliance(self, client):
        r = client.post(
            f"{API}/angel-price", json={"ticker": "RELIANCE"}, timeout=30
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        assert isinstance(d, dict)
        # Accept price/last/ltp/close etc.
        found_price = None
        for k in ("price", "last", "ltp", "close", "current", "value"):
            if k in d and isinstance(d[k], (int, float)):
                found_price = d[k]
                break
        assert found_price is not None or "price" in str(d).lower(), (
            f"no price in response: {d}"
        )


# ── Scanner ───────────────────────────────────────────────────────────
class TestScanner:
    def test_scanner(self, client):
        r = client.get(f"{API}/scanner", timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        # Scanner may return a list or an object wrapping a list
        assert isinstance(d, (list, dict))


# ── Symbol normalization implied via chart-data (already covered above) ──
class TestSymbolNormalization:
    def test_indian_stock_ns(self, client):
        # RELIANCE should be normalized to RELIANCE.NS by python backend
        r = client.post(f"{API}/chart-data", json={"pair": "TCS", "timeframe": "1d"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d.get("candles", [])) > 0

    def test_index(self, client):
        r = client.post(f"{API}/chart-data", json={"pair": "BANKNIFTY", "timeframe": "1d"}, timeout=30)
        assert r.status_code == 200

    def test_crypto(self, client):
        r = client.post(f"{API}/chart-data", json={"pair": "ETHUSD", "timeframe": "1h"}, timeout=30)
        assert r.status_code == 200

    def test_bad_symbol_gives_json_error(self, client):
        r = client.post(f"{API}/chart-data", json={"pair": "ZZZZZZZZ", "timeframe": "15m"}, timeout=30)
        # Must return JSON, not HTML — status is 404 per implementation
        assert r.status_code in (404, 400, 200)
        assert r.headers.get("content-type", "").startswith("application/json")
