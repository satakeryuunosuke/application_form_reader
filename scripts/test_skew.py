import math
from PIL import Image, ImageDraw
import numpy as np

# 1. 傾き角度と座標系補正の数学的検証
# anchorX, anchorY を中心として、角度 theta (rad) で回転したとき、
# 正しいチェックボックス中心座標 (cx, cy) が得られるか検証

anchor_x = 200.0
anchor_y = 150.0
cw = 1200.0
ch = 800.0

# テンプレートの相対オフセット (未回転)
dx = -0.058
dy = 0.225
side = 0.032 * cw

unrot_dx = dx * cw
unrot_dy = dy * ch

print(f"Unrotated relative offset: dx={unrot_dx:.2f}, dy={unrot_dy:.2f}")

# テスト角度: 0度, +3度, -3度, +5度
angles_deg = [0.0, 3.0, -3.0, 5.0]

for deg in angles_deg:
    rad = deg * math.pi / 180.0
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)
    
    rot_dx = unrot_dx * cos_a - unrot_dy * sin_a
    rot_dy = unrot_dx * sin_a + unrot_dy * cos_a
    
    cx = anchor_x + rot_dx
    cy = anchor_y + rot_dy
    
    # 原点からの距離（ノルム）が回転後も不変であることを確認
    orig_dist = math.hypot(unrot_dx, unrot_dy)
    rot_dist = math.hypot(rot_dx, rot_dy)
    dist_diff = abs(orig_dist - rot_dist)
    
    print(f"Angle {deg:+.1f} deg ({rad:+.4f} rad): cx={cx:.2f}, cy={cy:.2f}, norm_diff={dist_diff:.6f}")
    assert dist_diff < 1e-5, "Rotation norm must be conserved!"

print("\n--- Rotation math test PASSED successfully! ---")
