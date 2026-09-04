from PIL import Image
import numpy as np

img = Image.open('output/user_barcode_cropped.png').convert('L')
pixels = np.array(img)
h, w = pixels.shape

# バーコードのバーが存在する y: 10 ~ 70 の範囲を縦方向に平均化（Column Profile）
bar_area = pixels[10:70, :]
column_profile = np.mean(bar_area, axis=0)

print("Column profile shape:", column_profile.shape)
print("Min:", column_profile.min(), "Max:", column_profile.max())

# 二値化 (閾値: min と max の中間)
mid_th = (column_profile.min() + column_profile.max()) / 2.0
print(f"Mid threshold: {mid_th:.1f}")

binary = column_profile < mid_th

# ランレングス
runs = []
cur = binary[0]
l = 1
start = 0
for x in range(1, w):
    if binary[x] == cur:
        l += 1
    else:
        runs.append({'isBlack': bool(cur), 'len': l, 'startX': start, 'endX': x})
        cur = binary[x]
        l = 1
        start = x
runs.append({'isBlack': bool(cur), 'len': l, 'startX': start, 'endX': w})

print(f"Column-averaged runs count: {len(runs)}")
for i, r in enumerate(runs):
    print(f"[{i:02d}] {'B' if r['isBlack'] else 'W'}: len={r['len']} (x: {r['startX']}~{r['endX']})")

