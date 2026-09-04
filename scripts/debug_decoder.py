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
REV_CODE39 = {pat: char for char, pat in CODE39_PATTERNS.items()}

# 元の画像 (1191x840) でテスト
img = Image.open('output/scan_sample_p1.png').convert('L')
pixels = np.array(img)
w, h = img.size

print("--- TESTING DECODER ON ORIGINAL SCAN ---")
for y in [50, 60, 70, 80]:
    line = pixels[y, :]
    for th in [135, 120, 150, 100, 170]:
        runs = []
        current_is_black = line[0] < th
        current_len = 1
        current_start = 0
        for x in range(1, w):
            is_black = line[x] < th
            if is_black == current_is_black:
                current_len += 1
            else:
                runs.append({'isBlack': current_is_black, 'len': current_len, 'startX': current_start, 'endX': x})
                current_is_black = is_black
                current_len = 1
                current_start = x
        runs.append({'isBlack': current_is_black, 'len': current_len, 'startX': current_start, 'endX': w})

        # スタート文字候補のチェック
        for i in range(len(runs) - 8):
            if not runs[i]['isBlack']:
                continue
            elem_lengths = [r['len'] for r in runs[i:i+9]]
            sorted_lens = sorted(elem_lengths)
            narrow_max = sorted_lens[5]
            wide_min = sorted_lens[6]
            th_elem = (narrow_max + wide_min) / 2.0
            pattern = ''.join('1' if l > th_elem else '0' for l in elem_lengths)
            if pattern == CODE39_PATTERNS['*']:
                print(f"FOUND START '*' at y={y}, th={th}, i={i}, x={runs[i]['startX']}, ratio={wide_min/narrow_max:.2f}")
                # 次の文字をデコードしてみる
                char_idx = i + 9
                chars = ['*']
                while char_idx + 9 <= len(runs):
                    gap = runs[char_idx]
                    char_start_idx = char_idx + 1
                    if char_start_idx + 9 > len(runs):
                        break
                    next_elems = [r['len'] for r in runs[char_start_idx:char_start_idx+9]]
                    s_next = sorted(next_elems)
                    n_m = s_next[5]
                    w_m = s_next[6]
                    ch_th = (n_m + w_m) / 2.0
                    ch_pat = ''.join('1' if l > ch_th else '0' for l in next_elems)
                    char = REV_CODE39.get(ch_pat)
                    print(f"  Next char: '{char}' (pat={ch_pat}, nMax={n_m}, wMin={w_m}, ratio={w_m/n_m:.2f if n_m > 0 else 0})")
                    if not char:
                        break
                    chars.append(char)
                    if char == '*':
                        print(f"  ==> COMPLETE DECODE: {''.join(chars)}")
                        break
                    char_idx = char_start_idx + 9

