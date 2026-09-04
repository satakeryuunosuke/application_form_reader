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

img = Image.open('output/user_barcode_cropped.png').convert('L')
pixels = np.array(img)
bar_area = pixels[10:70, :]
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

# runs[1] から runs[99] までがバーコード本体
bc_runs = runs[1:100]
print(f"Total barcode runs: {len(bc_runs)}")

# 1文字目: *TDN60013* の '*'
target_chars = ['*', 'T', 'D', 'N', '6', '0', '0', '1', '3', '*']
idx = 0
for char in target_chars:
    char_runs = bc_runs[idx:idx+9]
    lengths = [r['len'] for r in char_runs]
    pattern = CODE39_PATTERNS[char]
    print(f"Char '{char}' expected pattern: {pattern}")
    print(f"  Runs: {lengths}")
    
    # ギャップ (1本) をスキップ
    idx += 10

