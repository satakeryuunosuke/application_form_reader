from PIL import Image
import numpy as np

img = Image.open('output/scan_sample_highres.png').convert('L')
pixels = np.array(img)
bar_area = pixels[80:180, 160:540]
column_profile = np.mean(bar_area, axis=0)

for th in [130, 140, 150, 160]:
    binary = column_profile < th
    runs = []
    cur = binary[0]
    l = 1
    start = 0
    for x in range(1, len(binary)):
        if binary[x] == cur:
            l += 1
        else:
            runs.append({'isBlack': bool(cur), 'len': l, 'startX': start, 'endX': x})
            cur = binary[x]
            l = 1
            start = x
    runs.append({'isBlack': bool(cur), 'len': l, 'startX': start, 'endX': len(binary)})
    print(f"th={th}: total runs={len(runs)}")
    if len(runs) >= 99:
        print("  First 5 runs:", runs[:5])
        print("  Last 5 runs:", runs[-5:])
