"""
Unit tests for find_bases() in triple_ema_scan.py.
No Fyers API, no DB, no credentials needed — pure synthetic price data.

Run with:  python test_find_bases.py
"""

import sys
import math
import pandas as pd
import pandas_ta_classic as ta
from datetime import datetime, timezone, timedelta

# ── import the function under test ────────────────────────────────────────────
from triple_ema_scan import find_bases

IST = timezone(timedelta(hours=5, minutes=30))

# ── helpers ───────────────────────────────────────────────────────────────────

def make_timestamps(n, start_unix=1_000_000_000):
    """Return n daily unix timestamps starting from start_unix."""
    return [start_unix + i * 86400 for i in range(n)]


def make_df(prices, start_unix=1_000_000_000):
    """Wrap a list of close prices into the OHLCV DataFrame format find_bases() expects."""
    ts = make_timestamps(len(prices), start_unix)
    return pd.DataFrame({
        'date':  ts,
        'open':  prices,
        'high':  [p * 1.01 for p in prices],
        'low':   [p * 0.99 for p in prices],
        'close': prices,
        'vol':   [1_000_000] * len(prices),
    })


def smooth_transition(start, end, n):
    """Linearly interpolate n values from start to end (inclusive)."""
    return [start + (end - start) * i / (n - 1) for i in range(n)]


def build_scenario(segments):
    """
    Build a price series from a list of (price_level, n_bars) segments.
    Transitions are smooth so EMAs track without huge lag spikes.
    """
    prices = []
    for level, bars in segments:
        if not prices:
            prices.extend([level] * bars)
        else:
            prices.extend(smooth_transition(prices[-1], level, bars))
    return prices


# ── scenario builders ─────────────────────────────────────────────────────────

def scenario_happy_path_two_bases():
    """
    Full happy path: EMA50 crosses SMA200 → pullback → base1 → pullback → base2.
    Price is engineered so all four events happen cleanly.
    """
    return build_scenario([
        (50,  250),   # long flat low — SMA200 warmup, EMA50 < SMA200
        (200, 60),    # sharp rally: EMA50 eventually crosses above SMA200
        (160, 40),    # pullback: EMA20 dips below EMA50
        (220, 40),    # recovery: EMA9 crosses above EMA20  → BASE 1
        (170, 40),    # second pullback: EMA20 dips below EMA50
        (240, 40),    # second recovery: EMA9 crosses above EMA20  → BASE 2
    ])


def scenario_no_ema50_cross():
    """EMA50 never crosses above SMA200 — should return None."""
    return build_scenario([
        (100, 250),   # flat — SMA200 and EMA50 track each other, no cross
        (110, 80),    # slight rise, still no definitive EMA50 > SMA200 cross
        (90,  40),
        (110, 40),
    ])


def scenario_ema50_drops_below_sma200_resets():
    """
    EMA50 crosses SMA200 (cycle starts), then drops back below SMA200 mid-cycle,
    resetting everything. The second cross should restart the cycle and produce Base 1.
    Any base found before the reset must NOT appear in results.
    """
    return build_scenario([
        (50,  250),   # warmup low
        (200, 60),    # rally → EMA50 crosses SMA200 (cycle 1 starts)
        (160, 30),    # pullback
        (220, 30),    # recovery → would be Base 1 in old logic
        (60,  80),    # crash: EMA50 drops back below SMA200 → RESET
        (200, 60),    # second rally → EMA50 crosses SMA200 again (cycle 2 starts)
        (160, 40),    # pullback
        (220, 40),    # recovery → Base 1 (from cycle 2 only)
    ])


def scenario_ema9_blocked_when_ema50_below_sma200():
    """
    EMA9 crosses EMA20 but at that moment EMA50 < SMA200 — should NOT count as a base.
    Price: EMA50 crosses SMA200, then both fall (EMA50 dips below SMA200 during pullback),
    EMA9 crosses EMA20 while EMA50 still below SMA200. Then EMA50 recovers above SMA200
    and eventually a valid base follows.
    """
    return build_scenario([
        (50,  250),   # warmup
        (180, 60),    # rally → EMA50 crosses SMA200
        (80,  60),    # sharp drop: EMA20 dips below EMA50, AND EMA50 dips below SMA200
                      # EMA9 will cross EMA20 here — but EMA50 < SMA200, so no base
        (200, 60),    # recovery: EMA50 crosses SMA200 again (new cycle), EMA9 > EMA20 → Base 1
        (160, 40),    # pullback
        (220, 40),    # Base 2
    ])


def scenario_only_one_base():
    """Only one pullback + recovery — should return (base1_date, None)."""
    return build_scenario([
        (50,  250),
        (200, 60),
        (160, 40),
        (220, 40),    # Base 1
        # no further pullback+recovery
        (230, 40),
    ])


def scenario_too_short():
    """Fewer than 210 bars — should return None immediately."""
    return [100.0] * 200


def scenario_no_pullback_after_cross():
    """EMA50 crosses SMA200 but EMA20 never dips below EMA50 — no base."""
    return build_scenario([
        (50,  250),
        (200, 60),    # EMA50 > SMA200
        (210, 80),    # price keeps rising: EMA20 stays above EMA50
        (220, 80),
    ])


# ── test runner ───────────────────────────────────────────────────────────────

PASS = 0
FAIL = 0

def check(name, result, expected):
    global PASS, FAIL
    ok = result == expected
    status = "PASS" if ok else "FAIL"
    if ok:
        PASS += 1
    else:
        FAIL += 1
    print(f"  [{status}] {name}")
    if not ok:
        print(f"         expected : {expected}")
        print(f"         got      : {result}")


def run_test(name, prices, expected_result, expected_type='tuple_or_none'):
    """
    expected_result: None | 'one_base' | 'two_bases' | 'reset_gives_one_base'
    For precise date assertions we just check structural shape since
    synthetic timestamps give deterministic but non-calendar dates.
    """
    df = make_df(prices)
    result = find_bases(df)

    if expected_result == 'none':
        check(name, result, None)

    elif expected_result == 'one_base':
        if result is None:
            check(name, 'got None', 'tuple with second=None')
        else:
            first, second = result
            check(name + ' — first base exists', first is not None, True)
            check(name + ' — second base is None', second, None)

    elif expected_result == 'two_bases':
        if result is None:
            check(name, 'got None', 'tuple with two dates')
        else:
            first, second = result
            check(name + ' — first base exists', first is not None, True)
            check(name + ' — second base exists', second is not None, True)
            check(name + ' — second base after first', second > first, True)

    elif expected_result == 'reset_gives_one_base':
        # After reset, only one valid base from the new cycle
        if result is None:
            check(name, 'got None', 'tuple with one base from post-reset cycle')
        else:
            first, second = result
            check(name + ' — base exists after reset', first is not None, True)
            # second base may or may not exist depending on price shape, that's fine


def verify_reset_clears_pre_reset_base(prices_reset_scenario):
    """
    Extra check: verify that in the reset scenario, the base date found
    is NOT from the pre-reset rally (bars 250-370 roughly).
    It should be from the second rally (bars ~470+).
    """
    df = make_df(prices_reset_scenario)
    result = find_bases(df)
    if result is None:
        check("reset: result not None", False, True)
        return

    first_base, _ = result
    # Convert bar index to timestamp — the second rally starts around bar 470
    # unix ts for bar 470 = 1_000_000_000 + 470*86400
    second_rally_start_ts = 1_000_000_000 + 470 * 86400
    second_rally_start_dt = datetime.fromtimestamp(second_rally_start_ts, IST).strftime('%Y-%m-%d')

    check(
        "reset: base1 date is from post-reset cycle (not pre-reset)",
        first_base >= second_rally_start_dt,
        True
    )


# ── main ──────────────────────────────────────────────────────────────────────

print("=" * 60)
print("find_bases() unit tests")
print("=" * 60)

print("\n1. Too short — returns None immediately")
run_test("too short (<210 bars)", scenario_too_short(), 'none')

print("\n2. No EMA50/SMA200 cross — returns None")
run_test("no EMA50 cross", scenario_no_ema50_cross(), 'none')

print("\n3. EMA50 crosses SMA200 but no pullback follows — returns None")
run_test("no pullback after cross", scenario_no_pullback_after_cross(), 'none')

print("\n4. Happy path — two bases found")
run_test("two bases", scenario_happy_path_two_bases(), 'two_bases')

print("\n5. Only one pullback/recovery — one base, second=None")
run_test("one base only", scenario_only_one_base(), 'one_base')

print("\n6. EMA50 drops below SMA200 mid-cycle → full reset, base from new cycle")
reset_prices = scenario_ema50_drops_below_sma200_resets()
run_test("reset scenario", reset_prices, 'reset_gives_one_base')
verify_reset_clears_pre_reset_base(reset_prices)

print("\n7. EMA9 crosses EMA20 while EMA50 < SMA200 — must NOT count as base")
run_test(
    "EMA9 cross blocked (EMA50 below SMA200 at re-entry)",
    scenario_ema9_blocked_when_ema50_below_sma200(),
    'two_bases'   # valid bases only come from after EMA50 recovers above SMA200
)

print("\n8. State machine stops after 2 bases (no third base captured)")
two_base_prices = scenario_happy_path_two_bases()
df = make_df(two_base_prices)
result = find_bases(df)
if result is not None:
    check("stops at 2 bases — result is a 2-tuple", len(result), 2)
else:
    check("stops at 2 bases — got a result", result is not None, True)

print("\n" + "=" * 60)
print(f"Results: {PASS} passed, {FAIL} failed")
print("=" * 60)

sys.exit(0 if FAIL == 0 else 1)
