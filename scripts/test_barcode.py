import sys
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

def decode_single_line(gray_line, threshold, width):
    runs = []
    current_is_black = gray_line[0] < threshold
    current_len = 1
    current_start = 0

    for x in range(1, width):
        is_black = gray_line[x] < threshold
        if is_black == current_is_black:
            current_len += 1
        else:
            runs.append({'isBlack': current_is_black, 'len': current_len, 'startX': current_start, 'endX': x})
            current_is_black = is_black
            current_len = 1
            current_start = x
    runs.append({'isBlack': current_is_black, 'len': current_len, 'startX': current_start, 'endX': width})

    if len(runs) < 10:
        return None

    for i in range(len(runs) - 8):
        if not runs[i]['isBlack']:
            continue
        elem_lengths = [r['len'] for r in runs[i:i+9]]
        sorted_lens = sorted(elem_lengths)
        narrow_max = sorted_lens[5]
        wide_min = sorted_lens[6]

        if wide_min <= narrow_max * 1.3:
            continue

        th = (narrow_max + wide_min) / 2.0
        pattern = ''.join('1' if l > th else '0' for l in elem_lengths)

        if pattern == CODE39_PATTERNS['*']:
            decoded_chars = ['*']
            char_idx = i + 9
            last_char_end = runs[i+8]['endX']
            start_x = runs[i]['startX']

            while char_idx + 9 <= len(runs):
                gap_run = runs[char_idx]
                if gap_run['isBlack']:
                    break
                char_start_idx = char_idx + 1
                if char_start_idx + 9 > len(runs):
                    break
                if not runs[char_start_idx]['isBlack']:
                    break

                next_elem_lengths = [r['len'] for r in runs[char_start_idx:char_start_idx+9]]
                next_sorted = sorted(next_elem_lengths)
                n_max = next_sorted[5]
                w_min = next_sorted[6]

                if w_min <= n_max * 1.25:
                    break

                char_th = (n_max + w_min) / 2.0
                char_pat = ''.join('1' if l > char_th else '0' for l in next_elem_lengths)
                char = REV_CODE39.get(char_pat)
                if not char:
                    break
                decoded_chars.append(char)
                last_char_end = runs[char_start_idx+8]['endX']

                if char == '*' and len(decoded_chars) >= 3:
                    return {'text': ''.join(decoded_chars), 'startX': start_x, 'endX': last_char_end}
                char_idx = char_start_idx + 9
    return None

img = Image.open('output/test_page1.png').convert('L')
w, h = img.size
pixels = np.array(img)
scan_height = min(h, int(h * 0.45))

hits = []
for y in range(10, scan_height - 5, 2):
    line = pixels[y, :]
    for th in [135, 120, 150]:
        res = decode_single_line(line, th, w)
        if res:
            hits.append((y, res))
            break

print(f"Total hits: {len(hits)}")
for y, res in hits[:10]:
    print(f"y={y}: {res}")
if hits:
    print(f"Last hit: y={hits[-1][0]}: {hits[-1][1]}")
