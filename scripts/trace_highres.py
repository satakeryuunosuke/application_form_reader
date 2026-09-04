from PIL import Image
import numpy as np

img = Image.open('output/scan_sample_highres.png').convert('L')
pixels = np.array(img)
w, h = img.size

# y: 120 付近 (scale 4.0 なので y=60*2 = 120)
y = 120
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

bc_runs = [r for r in runs if 150 <= r['startX'] <= 550]
print(f"High-res BC runs count: {len(bc_runs)}")
for i, r in enumerate(bc_runs[:25]):
    print(f"[{i:02d}] {'B' if r['isBlack'] else 'W'}: len={r['len']} (x: {r['startX']}~{r['endX']})")

