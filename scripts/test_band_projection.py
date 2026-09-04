import fitz
from PIL import Image
import numpy as np

CODE39_PATTERNS = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
  'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
  'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
  'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
  'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
  'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
  'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100'
}
REV = {v: k for k, v in CODE39_PATTERNS.items()}

def decode_line_profile(profile, thresholds=[135, 120, 150, 105, 165]):
    min_b = profile.min()
    max_b = profile.max()
    if max_b - min_b < 35:
        return None
    mid_th = (min_b + max_b) / 2.0
    all_th = [mid_th] + thresholds
    
    for th in all_th:
        binary = profile < th
        runs = []
        cur = binary[0]; l = 1; s = 0
        for x in range(1, len(binary)):
            if binary[x] == cur: l += 1
            else:
                runs.append({'isBlack': bool(cur), 'len': l, 'startX': s, 'endX': x})
                cur = binary[x]; l = 1; s = x
        runs.append({'isBlack': bool(cur), 'len': l, 'startX': s, 'endX': len(binary)})

        # 99エレメントの探索
        for i in range(1, len(runs) - 98):
            # クワイエットゾーン（直前の白スペースが十分広い）かつ黒バーから開始
            if not runs[i]['isBlack'] or runs[i-1]['len'] < 6:
                continue
            bc_runs = runs[i:i+99]
            # クワイエットゾーン（末尾の白スペースも存在確認）
            if i + 99 < len(runs) and runs[i+99]['len'] < 6:
                continue
            
            decoded = []
            idx = 0
            valid = True
            for ch_idx in range(10):
                char_runs = bc_runs[idx:idx+9]
                lengths = [r['len'] for r in char_runs]
                # 黒バー5本
                bars = [(lengths[j], j) for j in [0, 2, 4, 6, 8]]
                bars.sort(key=lambda x: x[0])
                wide_bars = {bars[-1][1], bars[-2][1]}
                # 白スペース4本
                spaces = [(lengths[j], j) for j in [1, 3, 5, 7]]
                spaces.sort(key=lambda x: x[0])
                wide_spaces = {spaces[-1][1]}
                
                # wideバーがnarrowバーより太いか検証
                # narrow最大 < wide最小 * 1.05
                bar_n_max = bars[2][0]
                bar_w_min = bars[3][0]
                space_n_max = spaces[2][0]
                space_w_min = spaces[3][0]
                if bar_w_min <= bar_n_max or space_w_min <= space_n_max:
                    valid = False; break

                pat = ''.join('1' if (j in wide_bars or j in wide_spaces) else '0' for j in range(9))
                char = REV.get(pat, None)
                if not char:
                    valid = False; break
                decoded.append(char)
                idx += 10
            
            if valid and len(decoded) == 10:
                text = ''.join(decoded)
                if text.startswith('*') and text.endswith('*'):
                    return {
                        'text': text,
                        'startX': runs[i]['startX'],
                        'endX': runs[i+98]['endX'],
                        'th': th
                    }
    return None

# PDFをレンダリングしてテスト
doc = fitz.open(r'C:\Users\sd23048\Downloads\SCAN0000_rotated.pdf')
page = doc[0]

# scale: 3.0 (高精度レンダリング)
scale = 3.0
mat = fitz.Matrix(scale, scale)
pix = page.get_pixmap(matrix=mat)
img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("L")
pixels = np.array(img)
w, h = img.size

scan_h = int(h * 0.45)
band_h = 24  # 24pxの小バンド（高さ24px分を平均化）
step_y = 6   # 6px刻みでスライド走査

hits = []
for y in range(10, scan_h - band_h, step_y):
    band = pixels[y:y+band_h, :]
    profile = np.mean(band, axis=0)
    res = decode_line_profile(profile)
    if res:
        res['y'] = y + band_h / 2
        res['midX'] = (res['startX'] + res['endX']) / 2
        hits.append(res)

print(f"Total hits across vertical bands: {len(hits)}")
for h_item in hits[:10]:
    print(f"  y={h_item['y']:.1f}, startX={h_item['startX']}, endX={h_item['endX']}, text={h_item['text']}")

# 傾き角度算出
if len(hits) >= 3:
    avg_y = sum(h['y'] for h in hits) / len(hits)
    avg_mid_x = sum(h['midX'] for h in hits) / len(hits)
    num = sum((h['y'] - avg_y) * (h['midX'] - avg_mid_x) for h in hits)
    den = sum((h['y'] - avg_y) ** 2 for h in hits)
    slope = num / den if den > 0 else 0
    angle_rad = -np.arctan(slope)
    angle_deg = np.degrees(angle_rad)
    print(f"Estimated skew angle: {angle_deg:.3f} deg")
    
    min_x = min(h['startX'] for h in hits)
    max_x = max(h['endX'] for h in hits)
    min_y = min(h['y'] for h in hits) - band_h / 2
    max_y = max(h['y'] for h in hits) + band_h / 2
    print(f"Barcode Box: x=[{min_x}, {max_x}], y=[{min_y:.1f}, {max_y:.1f}], text={hits[0]['text']}")
