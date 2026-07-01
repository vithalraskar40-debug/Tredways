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
app.include_router(api)


@app.get("/")
async def home():
    return {"service": "Tredways", "docs": "/docs", "api": "/api"}
