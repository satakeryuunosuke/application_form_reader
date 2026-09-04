from PIL import Image
import numpy as np

img = Image.open('output/scan_sample_p1.png').convert('L')
pixels = np.array(img)
w, h = img.size

# y=60のラインを取り出して詳細にランレングスを出力
y = 60
gray_line = pixels[y, :]

threshold = 135
runs = []
current_is_black = gray_line[0] < threshold
current_len = 1
current_start = 0

for x in range(1, w):
    is_black = gray_line[x] < threshold
    if is_black == current_is_black:
        current_len += 1
    else:
        runs.append({'isBlack': current_is_black, 'len': current_len, 'startX': current_start, 'endX': x})
        current_is_black = is_black
        current_len = 1
        current_start = x
runs.append({'isBlack': current_is_black, 'len': current_len, 'startX': current_start, 'endX': w})

print(f"Total runs at y={y}: {len(runs)}")
# バーコードと思われる部分のruns（startXが50〜300の間）
bc_runs = [r for r in runs if 50 <= r['startX'] <= 280]
print(f"BC runs count: {len(bc_runs)}")
for i, r in enumerate(bc_runs):
    print(f"[{i:02d}] {'B' if r['isBlack'] else 'W'}: len={r['len']} (x: {r['startX']}~{r['endX']})")

