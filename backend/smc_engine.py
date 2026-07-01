"""
SMC (Smart Money Concept) Engine
─────────────────────────────────
Implements the strategy from the user's reference images:

  1. Accumulation / Manipulation / Distribution phase detection
       – Accumulation: sideways range with liquidity below (SSL)
       – Manipulation: false breakout above range (MS_FU) that traps buyers
       – Distribution: post-MSS lower highs, order blocks, FVGs, SIBI
  2. Liquidity Grab & Retest (bullish + bearish setups from image #2)
       – Detects BOS (Break of Structure)
       – Detects "Lower Low Failed" or "Higher High Failed"
       – Confirms Retest of the broken level
       – Emits an A+ entry only after retest confirmation

The engine returns structured zones, phase label, and a graded signal that
the frontend chart overlays and the TradeConfirm screen consumes.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import numpy as np
import pandas as pd


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────
def candles_to_df(candles: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(candles)
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    return df


def _atr(df: pd.DataFrame, period: int = 14) -> float:
    high = df["high"].values
    low = df["low"].values
    close = df["close"].values
    tr = np.maximum(high[1:] - low[1:], np.abs(high[1:] - close[:-1]))
    tr = np.maximum(tr, np.abs(low[1:] - close[:-1]))
    if len(tr) < period:
        return float(tr.mean() if len(tr) else 0)
    return float(pd.Series(tr).rolling(period).mean().iloc[-1])


def _swings(df: pd.DataFrame, lookback: int = 3) -> list[dict]:
    """Return list of swing highs/lows using a symmetric fractal (lookback bars each side)."""
    highs = df["high"].values
    lows = df["low"].values
    out: list[dict] = []
    for i in range(lookback, len(df) - lookback):
        window_high = highs[i - lookback: i + lookback + 1]
        window_low = lows[i - lookback: i + lookback + 1]
        if highs[i] == window_high.max() and (window_high == highs[i]).sum() == 1:
            out.append({"idx": int(i), "type": "HIGH", "price": float(highs[i])})
        if lows[i] == window_low.min() and (window_low == lows[i]).sum() == 1:
            out.append({"idx": int(i), "type": "LOW", "price": float(lows[i])})
    return out


# ────────────────────────────────────────────────────────────────────────────
# Phase detection: Accumulation / Manipulation / Distribution
# ────────────────────────────────────────────────────────────────────────────
@dataclass
class Zone:
    kind: str            # ACCUMULATION | MANIPULATION | DISTRIBUTION | FVG | ORDER_BLOCK
    start_idx: int
    end_idx: int
    top: float
    bottom: float
    label: str = ""


def detect_phases(df: pd.DataFrame, atr: float) -> list[Zone]:
    """Detect the three SMC phases over the last portion of the series.

    Heuristic:
      1. Find the last consolidation window (accumulation) where price range < 1.2*ATR
         over 20+ bars.
      2. If price then spikes above that range but closes back inside (or below) →
         Manipulation.
      3. After manipulation, sustained lower highs / lower closes → Distribution.
    """
    zones: list[Zone] = []
    n = len(df)
    if n < 40:
        return zones

    # 1) Scan for the most recent accumulation window (>=15 bars, range < 1.5*ATR)
    window = 20
    best_acc: Optional[Zone] = None
    for start in range(max(0, n - 200), n - window):
        seg = df.iloc[start:start + window]
        r = float(seg["high"].max() - seg["low"].min())
        if atr <= 0 or r < atr * 2.0:
            best_acc = Zone(
                kind="ACCUMULATION",
                start_idx=start,
                end_idx=start + window - 1,
                top=float(seg["high"].max()),
                bottom=float(seg["low"].min()),
                label="Accumulation",
            )
    if best_acc:
        zones.append(best_acc)

        # 2) Manipulation zone right after accumulation
        after = df.iloc[best_acc.end_idx + 1: best_acc.end_idx + 25]
        if len(after) >= 3:
            spike_high = float(after["high"].max())
            if spike_high > best_acc.top + atr * 0.3:
                # Confirm the close came back below the range top (false breakout)
                back_inside = (after["close"] < best_acc.top).any()
                if back_inside:
                    manip_top = spike_high
                    manip_bottom = best_acc.top
                    mstart = int(best_acc.end_idx + 1)
                    mend = int(min(n - 1, best_acc.end_idx + len(after)))
                    zones.append(
                        Zone(
                            kind="MANIPULATION",
                            start_idx=mstart,
                            end_idx=mend,
                            top=manip_top,
                            bottom=manip_bottom,
                            label="Manipulation (False breakout)",
                        )
                    )

                    # 3) Distribution after manipulation — check for LH/LL closes
                    dist_start = mend + 1
                    if dist_start < n - 5:
                        dist_seg = df.iloc[dist_start:]
                        lower_highs = (dist_seg["high"].diff().dropna() < 0).sum()
                        if lower_highs >= max(3, len(dist_seg) // 3):
                            zones.append(
                                Zone(
                                    kind="DISTRIBUTION",
                                    start_idx=int(dist_start),
                                    end_idx=int(n - 1),
                                    top=float(dist_seg["high"].max()),
                                    bottom=float(dist_seg["low"].min()),
                                    label="Distribution",
                                )
                            )
    return zones


# ────────────────────────────────────────────────────────────────────────────
# Fair Value Gaps + Order Blocks (used for entries inside Manip → Distribution)
# ────────────────────────────────────────────────────────────────────────────
def detect_fvgs(df: pd.DataFrame, max_out: int = 10) -> list[Zone]:
    """FVG: 3-candle imbalance where candle[i-1].high < candle[i+1].low (bullish FVG)
    or candle[i-1].low > candle[i+1].high (bearish FVG)."""
    out: list[Zone] = []
    highs = df["high"].values
    lows = df["low"].values
    for i in range(1, len(df) - 1):
        if highs[i - 1] < lows[i + 1]:
            out.append(
                Zone(
                    kind="FVG",
                    start_idx=int(i - 1),
                    end_idx=int(i + 1),
                    top=float(lows[i + 1]),
                    bottom=float(highs[i - 1]),
                    label="Bullish FVG",
                )
            )
        elif lows[i - 1] > highs[i + 1]:
            out.append(
                Zone(
                    kind="FVG",
                    start_idx=int(i - 1),
                    end_idx=int(i + 1),
                    top=float(lows[i - 1]),
                    bottom=float(highs[i + 1]),
                    label="Bearish FVG",
                )
            )
    return out[-max_out:]


def detect_order_blocks(df: pd.DataFrame, atr: float, max_out: int = 6) -> list[Zone]:
    """Last opposite-color candle before a strong displacement move."""
    if atr <= 0:
        return []
    out: list[Zone] = []
    o = df["open"].values
    c = df["close"].values
    h = df["high"].values
    low_ = df["low"].values
    for i in range(2, len(df) - 1):
        move = c[i + 1] - c[i]
        if abs(move) < atr * 1.8:
            continue
        # Bullish OB = last down candle before big bullish move
        if move > 0 and c[i] < o[i]:
            out.append(
                Zone(
                    kind="ORDER_BLOCK",
                    start_idx=int(i),
                    end_idx=int(i),
                    top=float(h[i]),
                    bottom=float(low_[i]),
                    label="Bullish OB",
                )
            )
        # Bearish OB = last up candle before big bearish move
        elif move < 0 and c[i] > o[i]:
            out.append(
                Zone(
                    kind="ORDER_BLOCK",
                    start_idx=int(i),
                    end_idx=int(i),
                    top=float(h[i]),
                    bottom=float(low_[i]),
                    label="Bearish OB",
                )
            )
    return out[-max_out:]


# ────────────────────────────────────────────────────────────────────────────
# Liquidity Grab & Retest signal (image #2)
# ────────────────────────────────────────────────────────────────────────────
@dataclass
class LiquidityGrabSignal:
    direction: str                  # LONG | SHORT | NONE
    entry: Optional[float] = None
    sl: Optional[float] = None
    tp1: Optional[float] = None
    tp2: Optional[float] = None
    tp3: Optional[float] = None
    rr: Optional[float] = None
    grade: str = "AVOID"
    reasons: list[str] = field(default_factory=list)
    bos_price: Optional[float] = None
    grab_price: Optional[float] = None
    retest_confirmed: bool = False


def liquidity_grab_and_retest(df: pd.DataFrame, atr: float) -> LiquidityGrabSignal:
    """Detect the setup from image #2.

    BEARISH setup:
      1. Prior BOS to the downside (break of a swing low)
      2. Price returns UP and grabs liquidity above a prior swing high
      3. Then closes back below that high (LL Failed / trap)
      4. Retest of the trap zone → SHORT

    BULLISH setup (mirror):
      1. Prior BOS to the upside
      2. Price returns DOWN and grabs liquidity below a prior swing low
      3. Then closes back above that low
      4. Retest → LONG
    """
    sig = LiquidityGrabSignal(direction="NONE")
    if len(df) < 40 or atr <= 0:
        return sig

    sw = _swings(df, lookback=3)
    if len(sw) < 6:
        return sig

    highs = [s for s in sw if s["type"] == "HIGH"]
    lows = [s for s in sw if s["type"] == "LOW"]
    if len(highs) < 3 or len(lows) < 3:
        return sig

    last_close = float(df["close"].iloc[-1])
    last_high = float(df["high"].iloc[-1])
    last_low = float(df["low"].iloc[-1])
    last_idx = len(df) - 1

    # ─── BEARISH SETUP ────────────────────────────────────────────────
    prev_swing_low = lows[-2]
    prev_swing_high = highs[-1] if highs[-1]["idx"] > prev_swing_low["idx"] else highs[-2]
    # 1) BOS down: some candle after prev_swing_low broke lows[-3]?
    older_low = lows[-3]
    bos_down = df.iloc[prev_swing_low["idx"]:]["low"].min() < older_low["price"]
    # 2) Grab: recent high pierced prev_swing_high but closed below
    recent = df.iloc[max(0, last_idx - 20): last_idx + 1]
    grabbed_high = recent["high"].max() > prev_swing_high["price"] + atr * 0.15
    closed_back = last_close < prev_swing_high["price"]
    # 3) Retest: current bar/close is testing the broken high from below
    retest = abs(last_high - prev_swing_high["price"]) < atr * 0.6 and last_close < prev_swing_high["price"]

    if bos_down and grabbed_high and closed_back:
        entry = float(prev_swing_high["price"] - atr * 0.1)
        sl = float(recent["high"].max() + atr * 0.3)
        risk = abs(sl - entry)
        tp1 = entry - risk * 1.5
        tp2 = entry - risk * 2.5
        tp3 = entry - risk * 4.0
        reasons = [
            "BOS to downside confirmed",
            "Liquidity grabbed above prior swing high",
            "Closed back below the grabbed level (LL Failed / trap)",
        ]
        if retest:
            reasons.append("Retest of broken high confirmed")
        sig = LiquidityGrabSignal(
            direction="SHORT",
            entry=round(entry, 4),
            sl=round(sl, 4),
            tp1=round(tp1, 4),
            tp2=round(tp2, 4),
            tp3=round(tp3, 4),
            rr=round(risk and (abs(tp2 - entry) / risk), 2),
            grade="A+" if retest else "A",
            reasons=reasons,
            bos_price=float(older_low["price"]),
            grab_price=float(prev_swing_high["price"]),
            retest_confirmed=retest,
        )
        return sig

    # ─── BULLISH SETUP ────────────────────────────────────────────────
    prev_swing_high2 = highs[-2]
    prev_swing_low2 = lows[-1] if lows[-1]["idx"] > prev_swing_high2["idx"] else lows[-2]
    older_high = highs[-3]
    bos_up = df.iloc[prev_swing_high2["idx"]:]["high"].max() > older_high["price"]
    recent = df.iloc[max(0, last_idx - 20): last_idx + 1]
    grabbed_low = recent["low"].min() < prev_swing_low2["price"] - atr * 0.15
    closed_back = last_close > prev_swing_low2["price"]
    retest = abs(last_low - prev_swing_low2["price"]) < atr * 0.6 and last_close > prev_swing_low2["price"]

    if bos_up and grabbed_low and closed_back:
        entry = float(prev_swing_low2["price"] + atr * 0.1)
        sl = float(recent["low"].min() - atr * 0.3)
        risk = abs(entry - sl)
        tp1 = entry + risk * 1.5
        tp2 = entry + risk * 2.5
        tp3 = entry + risk * 4.0
        reasons = [
            "BOS to upside confirmed",
            "Liquidity grabbed below prior swing low",
            "Closed back above the grabbed level (HL Failed / trap)",
        ]
        if retest:
            reasons.append("Retest of broken low confirmed")
        sig = LiquidityGrabSignal(
            direction="LONG",
            entry=round(entry, 4),
            sl=round(sl, 4),
            tp1=round(tp1, 4),
            tp2=round(tp2, 4),
            tp3=round(tp3, 4),
            rr=round(risk and (abs(tp2 - entry) / risk), 2),
            grade="A+" if retest else "A",
            reasons=reasons,
            bos_price=float(older_high["price"]),
            grab_price=float(prev_swing_low2["price"]),
            retest_confirmed=retest,
        )
    return sig


# ────────────────────────────────────────────────────────────────────────────
# Top-level analysis
# ────────────────────────────────────────────────────────────────────────────
def analyze_smc(df: pd.DataFrame) -> dict[str, Any]:
    atr = _atr(df, 14)
    phases = detect_phases(df, atr)
    fvgs = detect_fvgs(df, max_out=6)
    obs = detect_order_blocks(df, atr, max_out=4)
    grab = liquidity_grab_and_retest(df, atr)

    current_phase = "NEUTRAL"
    if phases:
        current_phase = phases[-1].kind

    return {
        "atr": round(atr, 4),
        "current_phase": current_phase,
        "zones": [asdict(z) for z in phases + fvgs + obs],
        "liquidity_grab": asdict(grab),
    }
