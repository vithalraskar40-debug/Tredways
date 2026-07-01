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
      1. Prior BOS to the downside (break of a swing low)  OR  clear downtrend structure
      2. Price returns UP and grabs liquidity above a prior swing high
      3. Then closes back below that high (LL Failed / trap) OR strong impulse candle
      4. Retest of the trap zone → SHORT

    BULLISH setup (mirror):
      1. Prior BOS to the upside  OR  clear uptrend structure
      2. Price returns DOWN and grabs liquidity below a prior swing low
      3. Then closes back above that low OR strong impulse candle
      4. Retest → LONG
    """
    sig = LiquidityGrabSignal(direction="NONE")
    if len(df) < 40 or atr <= 0:
        return sig

    sw = _swings(df, lookback=3)
    if len(sw) < 4:
        return sig

    highs = [s for s in sw if s["type"] == "HIGH"]
    lows = [s for s in sw if s["type"] == "LOW"]
    if len(highs) < 2 or len(lows) < 2:
        return sig

    last_close = float(df["close"].iloc[-1])
    last_open = float(df["open"].iloc[-1])
    last_high = float(df["high"].iloc[-1])
    last_low = float(df["low"].iloc[-1])
    last_idx = len(df) - 1
    last_body = abs(last_close - last_open)
    strong_bull_impulse = (last_close > last_open) and (last_body >= atr * 1.2)
    strong_bear_impulse = (last_close < last_open) and (last_body >= atr * 1.2)

    # Look at the most recent swings within the last 100 bars only
    recent_lookback = min(100, len(df))
    recent_start = last_idx - recent_lookback
    highs_r = [h for h in highs if h["idx"] >= recent_start]
    lows_r = [l for l in lows if l["idx"] >= recent_start]
    if len(highs_r) < 2 or len(lows_r) < 2:
        highs_r, lows_r = highs, lows

    # ─── BEARISH SETUP ────────────────────────────────────────────────
    bearish_candidate = None
    if len(highs_r) >= 2 and len(lows_r) >= 2:
        prev_swing_low = lows_r[-1]
        prev_swing_high = highs_r[-1]
        older_low = lows_r[-2] if len(lows_r) >= 2 else lows_r[0]
        older_high = highs_r[-2] if len(highs_r) >= 2 else highs_r[0]

        # Short-term BOS_DOWN: after the recent higher-low (prev_swing_low), price broke below it
        after_low = df.iloc[prev_swing_low["idx"] + 1:]
        bos_down = len(after_low) > 0 and float(after_low["low"].min()) < prev_swing_low["price"]
        # Structure: any downtrend evidence (lower highs)
        struct_down = len(highs_r) >= 2 and highs_r[-1]["price"] < older_high["price"]

        recent = df.iloc[max(0, last_idx - 20): last_idx + 1]
        grabbed_high = float(recent["high"].max()) > prev_swing_high["price"] + atr * 0.1
        closed_back = last_close < prev_swing_high["price"]
        # Retest = last candle's high near the grabbed level and current close below it
        retest = abs(last_high - prev_swing_high["price"]) < atr * 0.8 and last_close < prev_swing_high["price"]
        distance = prev_swing_high["price"] - last_close
        extended = distance > atr * 8   # grade B if far, still emit
        distance_ok = distance < atr * 25   # only reject truly stale setups

        # Trigger: (a) closed back OR (b) strong bear impulse candle that swept & closed lower
        triggered = closed_back or strong_bear_impulse

        if (bos_down or struct_down) and grabbed_high and triggered and distance_ok:
            entry = float(prev_swing_high["price"] - atr * 0.1)
            sl = float(recent["high"].max() + atr * 0.3)
            risk = abs(sl - entry)
            if risk > 0:
                tp1 = entry - risk * 1.5
                tp2 = entry - risk * 2.5
                tp3 = entry - risk * 4.0
                reasons = []
                if bos_down: reasons.append("Short-term BOS down (broke recent higher low)")
                elif struct_down: reasons.append("Downtrend structure (lower highs)")
                reasons.append("Liquidity grabbed above prior swing high")
                if closed_back: reasons.append("Closed back below the grabbed level (trap)")
                if strong_bear_impulse: reasons.append(f"Strong bearish impulse candle (body {last_body:.2f})")
                if retest: reasons.append("Retest of broken high confirmed")
                if extended: reasons.append(f"Extended entry ({distance/atr:.1f}× ATR away)")
                # Grade
                if extended:
                    grade = "B"
                elif retest and bos_down:
                    grade = "A+"
                elif bos_down or strong_bear_impulse:
                    grade = "A"
                else:
                    grade = "B"
                bearish_candidate = LiquidityGrabSignal(
                    direction="SHORT",
                    entry=round(entry, 4), sl=round(sl, 4),
                    tp1=round(tp1, 4), tp2=round(tp2, 4), tp3=round(tp3, 4),
                    rr=round(abs(tp2 - entry) / risk, 2),
                    grade=grade, reasons=reasons,
                    bos_price=float(prev_swing_low["price"]),
                    grab_price=float(prev_swing_high["price"]),
                    retest_confirmed=retest,
                )

    # ─── BULLISH SETUP ────────────────────────────────────────────────
    bullish_candidate = None
    if len(highs_r) >= 2 and len(lows_r) >= 2:
        prev_swing_high2 = highs_r[-1]
        prev_swing_low2 = lows_r[-1]
        older_high = highs_r[-2] if len(highs_r) >= 2 else highs_r[0]
        older_low = lows_r[-2] if len(lows_r) >= 2 else lows_r[0]

        # Short-term BOS_UP: after the recent lower-high (prev_swing_high2), price broke above it
        after_high = df.iloc[prev_swing_high2["idx"] + 1:]
        bos_up = len(after_high) > 0 and float(after_high["high"].max()) > prev_swing_high2["price"]
        struct_up = len(lows_r) >= 2 and lows_r[-1]["price"] > older_low["price"]

        recent = df.iloc[max(0, last_idx - 20): last_idx + 1]
        grabbed_low = float(recent["low"].min()) < prev_swing_low2["price"] - atr * 0.1
        closed_back = last_close > prev_swing_low2["price"]
        retest = abs(last_low - prev_swing_low2["price"]) < atr * 0.8 and last_close > prev_swing_low2["price"]
        distance = last_close - prev_swing_low2["price"]
        extended = distance > atr * 8
        distance_ok = distance < atr * 25

        triggered = closed_back or strong_bull_impulse

        if (bos_up or struct_up) and grabbed_low and triggered and distance_ok:
            entry = float(prev_swing_low2["price"] + atr * 0.1)
            sl = float(recent["low"].min() - atr * 0.3)
            risk = abs(entry - sl)
            if risk > 0:
                tp1 = entry + risk * 1.5
                tp2 = entry + risk * 2.5
                tp3 = entry + risk * 4.0
                reasons = []
                if bos_up: reasons.append("Short-term BOS up (broke recent lower high)")
                elif struct_up: reasons.append("Uptrend structure (higher lows)")
                reasons.append("Liquidity grabbed below prior swing low")
                if closed_back: reasons.append("Closed back above the grabbed level (trap)")
                if strong_bull_impulse: reasons.append(f"Strong bullish impulse candle (body {last_body:.2f})")
                if retest: reasons.append("Retest of broken low confirmed")
                if extended: reasons.append(f"Extended entry ({distance/atr:.1f}× ATR away)")
                if extended:
                    grade = "B"
                elif retest and bos_up:
                    grade = "A+"
                elif bos_up or strong_bull_impulse:
                    grade = "A"
                else:
                    grade = "B"
                bullish_candidate = LiquidityGrabSignal(
                    direction="LONG",
                    entry=round(entry, 4), sl=round(sl, 4),
                    tp1=round(tp1, 4), tp2=round(tp2, 4), tp3=round(tp3, 4),
                    rr=round(abs(tp2 - entry) / risk, 2),
                    grade=grade, reasons=reasons,
                    bos_price=float(prev_swing_high2["price"]),
                    grab_price=float(prev_swing_low2["price"]),
                    retest_confirmed=retest,
                )

    # Pick the freshest / higher-grade candidate. Prefer the direction whose grab
    # happened most recently (impulse candle is decisive).
    def _grade_rank(g: str) -> int:
        return {"A+": 3, "A": 2, "B": 1}.get(g, 0)

    if bullish_candidate and bearish_candidate:
        if strong_bull_impulse and not strong_bear_impulse:
            return bullish_candidate
        if strong_bear_impulse and not strong_bull_impulse:
            return bearish_candidate
        return bullish_candidate if _grade_rank(bullish_candidate.grade) >= _grade_rank(bearish_candidate.grade) else bearish_candidate
    return bullish_candidate or bearish_candidate or sig


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
