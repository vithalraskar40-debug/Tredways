"""
Tredways Python Backend — FastAPI on port 8001
- Prefix: /api  (routed through Kubernetes ingress)
- Proxies signal/chart requests to the Node backend (port 8002) which owns the
  live-data engine (Angel/Yahoo/TwelveData). We keep both backends per user's request.
- Also exposes a lightweight, self-contained SMC (Smart Money Concept) strategy
  engine implementing Accumulation / Manipulation / Distribution zones and the
  Liquidity Grab & Retest setup from the user's reference images.
"""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Any, Optional

import httpx
import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from smc_engine import analyze_smc, candles_to_df

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

NODE_BACKEND_URL = os.environ.get("NODE_BACKEND_URL", "http://localhost:8002")

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("tredways")

app = FastAPI(title="Tredways API", version="2.0.0")
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ────────────────────────────────────────────────────────────────────────────
# Request models
# ────────────────────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    ticker: Optional[str] = None
    pair: Optional[str] = None
    mode: str = "STRICT"
    dataSource: str = "REALTIME"


class ChartDataRequest(BaseModel):
    pair: str
    timeframe: str = "5m"


class AngelPriceRequest(BaseModel):
    ticker: str


# ────────────────────────────────────────────────────────────────────────────
# Ticker normalization for yfinance (India stocks + FX + Crypto)
# ────────────────────────────────────────────────────────────────────────────
CRYPTO_MAP = {
    "BTC": "BTC-USD", "BTCUSD": "BTC-USD", "BITCOIN": "BTC-USD",
    "ETH": "ETH-USD", "ETHUSD": "ETH-USD",
    "SOL": "SOL-USD", "SOLUSD": "SOL-USD",
    "XRP": "XRP-USD", "XRPUSD": "XRP-USD",
    "DOGE": "DOGE-USD", "DOGEUSD": "DOGE-USD",
    "BNB": "BNB-USD", "BNBUSD": "BNB-USD",
}
COMMODITY_MAP = {
    "GOLD": "GC=F", "XAU": "GC=F", "XAUUSD": "GC=F",
    "SILVER": "SI=F", "XAG": "SI=F", "XAGUSD": "SI=F",
    "OIL": "CL=F", "CRUDE": "CL=F",
}
INDEX_MAP = {
    "NIFTY": "^NSEI", "NIFTY50": "^NSEI",
    "BANKNIFTY": "^NSEBANK", "NIFTYBANK": "^NSEBANK",
    "SENSEX": "^BSESN",
}


def normalize_symbol(symbol: str) -> str:
    if not symbol:
        return symbol
    s = symbol.strip().upper().replace("-", "").replace("_", "").replace("/", "")
    if s in CRYPTO_MAP:
        return CRYPTO_MAP[s]
    if s in COMMODITY_MAP:
        return COMMODITY_MAP[s]
    if s in INDEX_MAP:
        return INDEX_MAP[s]
    # 6-letter FX pair → Yahoo format e.g. EURUSD → EURUSD=X
    if len(s) == 6 and s.isalpha():
        return f"{s}=X"
    if s.endswith(".NS") or s.endswith(".BO") or s.startswith("^"):
        return s
    # Assume Indian NSE stock
    return f"{s}.NS"


def fetch_yf_candles(symbol: str, interval: str, period: str) -> list[dict]:
    """Fetch candles directly from Yahoo v8 chart endpoint (avoids yfinance flakiness)."""
    yf_symbol = normalize_symbol(symbol)
    # Convert period (e.g. '60d', '2y', '5d') to a range parameter Yahoo understands.
    range_map = {
        "1d": "1d", "5d": "5d", "60d": "60d", "180d": "6mo",
        "365d": "1y", "730d": "2y", "2y": "2y", "5y": "5y",
    }
    yf_range = range_map.get(period, period)
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_symbol}"
        f"?interval={interval}&range={yf_range}"
    )
    try:
        r = httpx.get(url, timeout=10.0, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code != 200:
            return []
        payload = r.json()
        result = (payload.get("chart") or {}).get("result") or []
        if not result:
            return []
        r0 = result[0]
        ts = r0.get("timestamp") or []
        q = ((r0.get("indicators") or {}).get("quote") or [{}])[0]
        candles: list[dict] = []
        for i, t in enumerate(ts):
            o, h, l, c = q.get("open")[i], q.get("high")[i], q.get("low")[i], q.get("close")[i]
            v = (q.get("volume") or [None] * len(ts))[i]
            if None in (o, h, l, c):
                continue
            candles.append({
                "timestamp": int(t) * 1000,
                "datetime": pd.Timestamp(t, unit="s", tz="UTC").isoformat(),
                "open": float(o), "high": float(h), "low": float(l), "close": float(c),
                "volume": float(v or 0),
            })
        return candles
    except Exception as exc:
        log.warning("yahoo v8 fetch failed for %s: %s", yf_symbol, exc)
        return []


# ────────────────────────────────────────────────────────────────────────────
# Health
# ────────────────────────────────────────────────────────────────────────────
@api.get("/")
async def root():
    return {"service": "Tredways", "version": "2.0.0", "node_backend": NODE_BACKEND_URL}


@api.get("/health")
async def health():
    node_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{NODE_BACKEND_URL}/ping")
            node_ok = r.status_code == 200
    except Exception:
        node_ok = False
    return {"python": "ok", "node_backend": "ok" if node_ok else "down"}


# ────────────────────────────────────────────────────────────────────────────
# Chart data — used by the ChartWithZones component
# ────────────────────────────────────────────────────────────────────────────
TF_MAP = {
    # (interval, range) — Yahoo restricts intraday intervals to short ranges
    "1m":  ("1m",  "5d"),
    "5m":  ("5m",  "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h":  ("60m", "730d"),
    "4h":  ("60m", "730d"),
    "1d":  ("1d",  "2y"),
    "1w":  ("1wk", "5y"),
}


@api.post("/chart-data")
async def chart_data(req: ChartDataRequest):
    interval, period = TF_MAP.get(req.timeframe, ("5m", "60d"))
    candles = fetch_yf_candles(req.pair, interval, period)
    if not candles:
        raise HTTPException(status_code=404, detail=f"No chart data for {req.pair}")
    # Return last 300 candles for a clean chart
    limited = candles[-300:]
    live_price = limited[-1]["close"] if limited else None
    return {
        "pair": req.pair.upper(),
        "timeframe": req.timeframe,
        "candles": limited,
        "live_price": live_price,
    }


# ────────────────────────────────────────────────────────────────────────────
# SMC Analysis endpoint — Accumulation / Manipulation / Distribution
#                        + Liquidity Grab & Retest
# ────────────────────────────────────────────────────────────────────────────
@api.post("/smc-analyze")
async def smc_analyze(req: ChartDataRequest):
    interval, period = TF_MAP.get(req.timeframe, ("15m", "60d"))
    candles = fetch_yf_candles(req.pair, interval, period)
    if len(candles) < 60:
        raise HTTPException(status_code=404, detail=f"Insufficient data for {req.pair}")
    df = candles_to_df(candles)
    analysis = analyze_smc(df)
    analysis["pair"] = req.pair.upper()
    analysis["timeframe"] = req.timeframe
    analysis["last_price"] = float(df["close"].iloc[-1])
    analysis["candles_count"] = len(candles)
    return analysis


# ────────────────────────────────────────────────────────────────────────────
# Proxies to Node backend  (Node owns live Angel/TwelveData feeds)
# ────────────────────────────────────────────────────────────────────────────
async def _proxy(path: str, method: str = "POST", json: Optional[dict] = None) -> Any:
    url = f"{NODE_BACKEND_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if method == "POST":
                r = await client.post(url, json=json or {})
            else:
                r = await client.get(url)
            if r.status_code >= 400:
                # forward error message
                raise HTTPException(status_code=r.status_code, detail=r.text)
            return r.json()
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail=f"Node backend unreachable: {exc}") from exc


@api.get("/live-price")
async def live_price(symbol: str):
    url = f"{NODE_BACKEND_URL}/api/v1/live-price?symbol={symbol}"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(url)
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=r.text)
            return r.json()
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@api.post("/analyze")
async def analyze_stock(req: AnalyzeRequest):
    payload = req.model_dump(exclude_none=True)
    return await _proxy("/api/v1/analyze", json=payload)


@api.post("/analyze-forex")
async def analyze_forex(req: AnalyzeRequest):
    return await _proxy("/api/v1/analyze-forex", json=req.model_dump(exclude_none=True))


@api.post("/analyze-forex-scalp")
async def analyze_forex_scalp(req: AnalyzeRequest):
    return await _proxy("/api/v1/analyze-forex-scalp", json=req.model_dump(exclude_none=True))


@api.post("/angel-price")
async def angel_price(req: AngelPriceRequest):
    return await _proxy("/api/v1/angel-price", json=req.model_dump())


@api.get("/scanner")
async def scanner():
    return await _proxy("/api/v1/scanner", method="GET")


@api.get("/stats")
async def stats():
    return await _proxy("/api/v1/stats", method="GET")


# ────────────────────────────────────────────────────────────────────────────
# Opportunity Ticker — scan a curated watchlist across timeframes and return
# every SMC setup the engine sees (all grades A+, A, B).
# ────────────────────────────────────────────────────────────────────────────
DEFAULT_WATCHLIST: list[str] = [
    "GOLD", "XAUUSD", "BTCUSD", "ETHUSD",
    "EURUSD", "GBPUSD", "USDJPY", "AUDUSD",
    "NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN",
]
OPPORTUNITY_TIMEFRAMES = ["15m", "1h"]


@api.get("/opportunities")
async def opportunities(
    symbols: Optional[str] = None,
    timeframes: Optional[str] = None,
    min_grade: str = "B",
):
    """Scan a watchlist and return every SMC liquidity-grab setup found.

    Query params:
      • symbols=GOLD,BTCUSD,NIFTY  (comma separated, optional)
      • timeframes=15m,1h          (comma separated, optional)
      • min_grade=A                (A+, A, or B — default B = all)
    """
    import asyncio
    watch = [s.strip().upper() for s in (symbols or ",".join(DEFAULT_WATCHLIST)).split(",") if s.strip()]
    tfs = [t.strip() for t in (timeframes or ",".join(OPPORTUNITY_TIMEFRAMES)).split(",") if t.strip()]
    grade_rank = {"A+": 3, "A": 2, "B": 1}
    min_rank = grade_rank.get(min_grade.upper(), 1)

    async def _scan_one(sym: str, tf: str) -> Optional[dict]:
        interval, period = TF_MAP.get(tf, ("15m", "60d"))
        try:
            candles = await asyncio.to_thread(fetch_yf_candles, sym, interval, period)
            if len(candles) < 60:
                return None
            df = candles_to_df(candles)
            analysis = await asyncio.to_thread(analyze_smc, df)
            lg = analysis.get("liquidity_grab") or {}
            direction = lg.get("direction", "NONE")
            grade = lg.get("grade", "AVOID")
            if direction == "NONE" or grade_rank.get(grade, 0) < min_rank:
                return None
            return {
                "symbol": sym,
                "timeframe": tf,
                "direction": direction,
                "grade": grade,
                "entry": lg.get("entry"),
                "sl": lg.get("sl"),
                "tp1": lg.get("tp1"),
                "tp2": lg.get("tp2"),
                "tp3": lg.get("tp3"),
                "rr": lg.get("rr"),
                "retest": lg.get("retest_confirmed", False),
                "reasons": lg.get("reasons", []),
                "current_price": float(df["close"].iloc[-1]),
                "phase": analysis.get("current_phase"),
                "atr": analysis.get("atr"),
                "grab_price": lg.get("grab_price"),
                "bos_price": lg.get("bos_price"),
            }
        except Exception as exc:
            log.warning("opportunity scan failed for %s %s: %s", sym, tf, exc)
            return None

    tasks = [_scan_one(sym, tf) for sym in watch for tf in tfs]
    results = [r for r in await asyncio.gather(*tasks) if r]
    results.sort(key=lambda r: (grade_rank.get(r["grade"], 0), r.get("rr") or 0), reverse=True)
    return {"count": len(results), "opportunities": results}


# ────────────────────────────────────────────────────────────────────────────
# Trade outcome checker — walks candle history bar-by-bar since `created_at`
# and returns WIN/LOSS/OPEN for each open trade. Handles the case where price
# TOUCHED TP or SL (wick) even if it later returned back to entry.
# ────────────────────────────────────────────────────────────────────────────
class OpenTrade(BaseModel):
    id: str
    pair: str
    signal_type: str            # LONG or SHORT
    entry: float
    sl: float
    tp1: float
    created_at: Optional[str] = None    # ISO timestamp of trade open


class CheckTradesRequest(BaseModel):
    trades: list[OpenTrade]


@api.post("/check-trades")
async def check_trades(req: CheckTradesRequest):
    """Given a batch of open trades, return the outcome of each by walking
    candle history since `created_at`. Fetches 1-minute candles for accuracy.
    """
    import asyncio
    from datetime import datetime, timezone

    async def _check_one(t: OpenTrade) -> dict:
        try:
            # Choose interval: 1m gives best precision for intraday; fallback to 5m if 1m
            # doesn't cover the age of the trade (Yahoo caps 1m to ~5 days).
            if t.created_at:
                try:
                    opened = datetime.fromisoformat(t.created_at.replace("Z", "+00:00"))
                    age_days = (datetime.now(timezone.utc) - opened).total_seconds() / 86400
                except Exception:
                    age_days = 0
            else:
                age_days = 0
            if age_days < 4:
                interval, period = "1m", "5d"
            elif age_days < 25:
                interval, period = "5m", "60d"
            elif age_days < 55:
                interval, period = "15m", "60d"
            else:
                interval, period = "1h", "730d"

            candles = await asyncio.to_thread(fetch_yf_candles, t.pair, interval, period)
            if not candles:
                return {"id": t.id, "outcome": "OPEN", "close_price": None, "closed_at": None}

            # Filter candles to those AT or AFTER trade creation time
            if t.created_at:
                try:
                    opened_ms = int(datetime.fromisoformat(t.created_at.replace("Z", "+00:00")).timestamp() * 1000)
                    candles = [c for c in candles if c.get("timestamp", 0) >= opened_ms - 60_000]
                except Exception:
                    pass

            if not candles:
                return {"id": t.id, "outcome": "OPEN", "close_price": None, "closed_at": None}

            is_long = t.signal_type.upper() == "LONG"
            for c in candles:
                hi, lo = float(c["high"]), float(c["low"])
                if is_long:
                    hit_tp = hi >= t.tp1
                    hit_sl = lo <= t.sl
                else:
                    hit_tp = lo <= t.tp1
                    hit_sl = hi >= t.sl
                # If both hit in the same candle, we assume SL first (conservative).
                if hit_sl:
                    return {
                        "id": t.id,
                        "outcome": "LOSS",
                        "close_price": t.sl,
                        "closed_at": pd.Timestamp(c["timestamp"], unit="ms", tz="UTC").isoformat(),
                    }
                if hit_tp:
                    return {
                        "id": t.id,
                        "outcome": "WIN",
                        "close_price": t.tp1,
                        "closed_at": pd.Timestamp(c["timestamp"], unit="ms", tz="UTC").isoformat(),
                    }
            # Neither hit → still OPEN. Return current live price for reference.
            return {
                "id": t.id,
                "outcome": "OPEN",
                "close_price": float(candles[-1]["close"]),
                "closed_at": None,
            }
        except Exception as exc:
            log.warning("check-trade failed for %s (%s): %s", t.pair, t.id, exc)
            return {"id": t.id, "outcome": "OPEN", "close_price": None, "closed_at": None}

    results = await asyncio.gather(*[_check_one(t) for t in req.trades])
    resolved = [r for r in results if r["outcome"] != "OPEN"]
    return {"checked": len(results), "resolved": len(resolved), "results": results}


# ────────────────────────────────────────────────────────────────────────────
app.include_router(api)


@app.get("/")
async def home():
    return {"service": "Tredways", "docs": "/docs", "api": "/api"}
