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

# 高解像度版
img = Image.open('output/scan_sample_highres.png').convert('L')
pixels = np.array(img)
bar_area = pixels[20:140, :]
column_profile = np.mean(bar_area, axis=0)

mid_th = (column_profile.min() + column_profile.max()) / 2.0
binary = column_profile < mid_th

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

print(f"High-res runs count: {len(runs)}")
# バーコード本体を探す (左クワイエットゾーンの後の黒バーから)
for i in range(len(runs)):
    if runs[i]['isBlack'] and runs[i-1]['len'] > 15:
        bc_start = i
        break

print(f"BC starts at run {bc_start}, x={runs[bc_start]['startX']}")
bc_runs = runs[bc_start:bc_start+99]

# 9エレメントずつ、上位3番目をwideとする相対順位デコード（Top-3 longest elements are wide!）
decoded_chars = []
idx = 0
for ch_idx in range(10):
    char_runs = bc_runs[idx:idx+9]
    lengths = [r['len'] for r in char_runs]
    
    # 9エレメントのうち「最も長い3つ」を1、残りの6つを0とする！
    # これがCode 39の数学的本質！
    indices_sorted_by_len = np.argsort(lengths) # 昇順
    # 上位3つのインデックス
    wide_indices = set(indices_sorted_by_len[-3:])
    
    pat = ''.join('1' if j in wide_indices else '0' for j in range(9))
    char = REV.get(pat, '?')
    decoded_chars.append(char)
    print(f"Char {ch_idx}: pat={pat} -> '{char}', lengths={lengths}")
    idx += 10

print("===> RESULT:", ''.join(decoded_chars))
