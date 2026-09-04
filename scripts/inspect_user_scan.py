from PIL import Image
import numpy as np

img = Image.open('output/scan_sample_p1.png').convert('L')
w, h = img.size
print(f"Image size: {w}x{h}")

pixels = np.array(img)

# バーコードがありそうな上部領域 (x: 50~300, y: 30~150)
crop = pixels[30:150, 50:300]
print("Crop shape:", crop.shape)
print("Crop min:", crop.min(), "max:", crop.max(), "mean:", crop.mean())

# スキャンラインを調べてみる
for y in range(40, 120, 10):
    line = pixels[y, 50:300]
    black_count = np.sum(line < 140)
    white_count = np.sum(line >= 140)
    print(f"y={y}: min={line.min()}, max={line.max()}, black={black_count}, white={white_count}")

