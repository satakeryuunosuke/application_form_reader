# -*- coding: utf-8 -*-
"""
Verification script for evaluateCheckbox Adaptive Preprocessing (Top-Percentile White Estimation).
Tests various scanning scenarios:
1. Standard white paper (unfilled): white ~ 230, no pencil
2. Faint pencil/water pen check: white ~ 230, pencil stroke ~ 160
3. Dark/shadowed/gray scan paper: white ~ 170, dark stroke ~ 70
4. Overfilled / cancelled outlier: almost all black (white ~ 90)
"""

import math

def simulate_evaluate_checkbox(pixels, darkness_threshold=140, check_threshold=0.25, adaptive=True, adaptive_factor=0.72):
    total_pixels = len(pixels)
    hist = [0] * 256
    for b in pixels:
        b_clamped = min(255, max(0, int(round(b))))
        hist[b_clamped] += 1

    white_brightness = 220
    effective_darkness_threshold = darkness_threshold

    if total_pixels > 0 and adaptive:
        p_low_idx = int(math.floor(total_pixels * 0.80))
        p_high_idx = int(math.floor(total_pixels * 0.95))
        cum = 0
        sum_br = 0
        count_br = 0
        p85_brightness = 220

        for b in range(256):
            prev_cum = cum
            cum += hist[b]
            if cum >= int(math.floor(total_pixels * 0.85)) and prev_cum < int(math.floor(total_pixels * 0.85)):
                p85_brightness = b
            
            overlap_start = max(prev_cum, p_low_idx)
            overlap_end = min(cum, p_high_idx)
            if overlap_end > overlap_start:
                count = overlap_end - overlap_start
                sum_br += b * count
                count_br += count

        white_brightness = int(round(sum_br / count_br)) if count_br > 0 else p85_brightness

        if white_brightness >= 110:
            raw_adaptive = int(round(white_brightness * adaptive_factor))
            effective_darkness_threshold = min(178, max(100, raw_adaptive))
        else:
            effective_darkness_threshold = max(darkness_threshold, 110)

    dark_pixels = sum(hist[b] for b in range(effective_darkness_threshold))
    dark_ratio = dark_pixels / total_pixels if total_pixels > 0 else 0
    is_checked = dark_ratio >= check_threshold

    return {
        "white_brightness": white_brightness,
        "effective_threshold": effective_darkness_threshold,
        "dark_pixels": dark_pixels,
        "dark_ratio": dark_ratio,
        "is_checked": is_checked
    }

def main():
    print("=== Testing Adaptive Preprocessing Scenarios ===")
    
    # 900 pixels (30x30 box)
    # Scenario 1: Standard White Paper, Unfilled (Border ~ 12% at 50, Paper ~ 88% at 235)
    s1_pixels = [50] * 108 + [235] * 792
    r1_fixed = simulate_evaluate_checkbox(s1_pixels, adaptive=False)
    r1_adapt = simulate_evaluate_checkbox(s1_pixels, adaptive=True)
    print(f"Scenario 1 (Standard Unfilled):")
    print(f"  Fixed: darkRatio={r1_fixed['dark_ratio']:.3f}, checked={r1_fixed['is_checked']}")
    print(f"  Adapt: whiteBr={r1_adapt['white_brightness']}, effTh={r1_adapt['effective_threshold']}, darkRatio={r1_adapt['dark_ratio']:.3f}, checked={r1_adapt['is_checked']}")
    assert not r1_adapt['is_checked'], "Unfilled should remain unchecked"

    # Scenario 2: Faint Pencil on Standard Paper (Border 12% at 50, Faint pencil 18% at 160, Paper 70% at 235)
    # Total ink = 12% + 18% = 30% -> Should be checked!
    s2_pixels = [50] * 108 + [160] * 162 + [235] * 630
    r2_fixed = simulate_evaluate_checkbox(s2_pixels, adaptive=False)
    r2_adapt = simulate_evaluate_checkbox(s2_pixels, adaptive=True)
    print(f"\nScenario 2 (Faint Pencil ~160):")
    print(f"  Fixed: darkRatio={r2_fixed['dark_ratio']:.3f}, checked={r2_fixed['is_checked']} (FAILED to detect stroke < 140)")
    print(f"  Adapt: whiteBr={r2_adapt['white_brightness']}, effTh={r2_adapt['effective_threshold']}, darkRatio={r2_adapt['dark_ratio']:.3f}, checked={r2_adapt['is_checked']} (SUCCESS)")
    assert not r2_fixed['is_checked'], "Fixed threshold should miss faint pencil (160 > 140)"
    assert r2_adapt['is_checked'], "Adaptive threshold should detect faint pencil (160 < 169)"

    # Scenario 3: Dark/Shadowed Scan Paper, Unfilled (Border 12% at 40, Background paper with shadow 88% at 165, shadow noise at 135)
    s3_pixels = [40] * 108 + [135] * 180 + [165] * 612
    r3_fixed = simulate_evaluate_checkbox(s3_pixels, adaptive=False)
    r3_adapt = simulate_evaluate_checkbox(s3_pixels, adaptive=True)
    print(f"\nScenario 3 (Dark/Shadowed Scan Unfilled):")
    print(f"  Fixed: darkRatio={r3_fixed['dark_ratio']:.3f}, checked={r3_fixed['is_checked']} (FALSE POSITIVE due to shadow 135 < 140)")
    print(f"  Adapt: whiteBr={r3_adapt['white_brightness']}, effTh={r3_adapt['effective_threshold']}, darkRatio={r3_adapt['dark_ratio']:.3f}, checked={r3_adapt['is_checked']} (SUCCESS, rejected shadow)")
    assert r3_fixed['is_checked'], "Fixed threshold causes false positive on dark scan (12% + 20% = 32% >= 25%)"
    assert not r3_adapt['is_checked'], "Adaptive threshold correctly rejects dark scan shadow (effTh ~ 119)"

    # Scenario 4: Fully Filled Box (Outlier)
    s4_pixels = [40] * 850 + [90] * 50
    r4_adapt = simulate_evaluate_checkbox(s4_pixels, adaptive=True)
    print(f"\nScenario 4 (Fully Filled Black):")
    print(f"  Adapt: whiteBr={r4_adapt['white_brightness']}, effTh={r4_adapt['effective_threshold']}, darkRatio={r4_adapt['dark_ratio']:.3f}, checked={r4_adapt['is_checked']}")
    assert r4_adapt['is_checked'], "Fully filled should remain detected as high dark ratio"

    print("\nALL SCENARIOS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    main()
