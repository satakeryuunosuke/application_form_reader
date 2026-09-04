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

doc = fitz.open(r'C:\Users\sd23048\Downloads\SCAN0000_rotated.pdf')
page = doc[0]

for scale in [2.0, 2.5, 3.0]:
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("L")
    pixels = np.array(img)
    w, h = img.size
    
    # バーコード領域 (上部 5%~25%, 左 5%~40%)
    y_start = int(h * 0.05)
    y_end = int(h * 0.16)
    x_start = int(w * 0.05)
    x_end = int(w * 0.35)
    
    bar_area = pixels[y_start:y_end, x_start:x_end]
    column_profile = np.mean(bar_area, axis=0)
    
    found_for_scale = None
    for th in range(120, 180, 5):
        binary = column_profile < th
        runs = []
        cur = binary[0]; l = 1; s = 0
        for x in range(1, len(binary)):
            if binary[x] == cur: l += 1
            else:
                runs.append({'isBlack': bool(cur), 'len': l, 'startX': s + x_start, 'endX': x + x_start})
                cur = binary[x]; l = 1; s = x
        runs.append({'isBlack': bool(cur), 'len': l, 'startX': s + x_start, 'endX': len(binary) + x_start})
        
        for i in range(1, len(runs) - 98):
            if not runs[i]['isBlack'] or runs[i-1]['len'] < (5 * scale / 2.0):
                continue
            bc_runs = runs[i:i+99]
            decoded = []
            idx = 0
            valid = True
            for ch_idx in range(10):
                char_runs = bc_runs[idx:idx+9]
                lengths = [r['len'] for r in char_runs]
                bars = [(lengths[j], j) for j in [0, 2, 4, 6, 8]]
                bars.sort(key=lambda x: x[0])
                wide_bars = {bars[-1][1], bars[-2][1]}
                spaces = [(lengths[j], j) for j in [1, 3, 5, 7]]
                spaces.sort(key=lambda x: x[0])
                wide_spaces = {spaces[-1][1]}
                pat = ''.join('1' if (j in wide_bars or j in wide_spaces) else '0' for j in range(9))
                char = REV.get(pat, None)
                if not char:
                    valid = False; break
                decoded.append(char)
                idx += 10
            if valid and len(decoded) == 10:
                text = ''.join(decoded)
                if text.startswith('*') and text.endswith('*'):
                    found_for_scale = (scale, th, text, runs[i]["startX"], runs[i+98]["endX"])
                    break
        if found_for_scale and found_for_scale[2] == '*TDN60013*':
            break
            
    print(f"Scale {scale}: {found_for_scale}")
