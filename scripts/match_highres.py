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

img = Image.open('output/scan_sample_highres.png').convert('L')
pixels = np.array(img)
bar_area = pixels[80:180, 160:540]
column_profile = np.mean(bar_area, axis=0)

for th_val in range(120, 200, 5):
    binary = column_profile < th_val
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

    if len(runs) < 99:
        continue

    for start_i in range(len(runs) - 98):
        if not runs[start_i]['isBlack']:
            continue
        bc_runs = runs[start_i:start_i+99]
        
        decoded = []
        c_idx = 0
        for ch_num in range(10):
            elems = [r['len'] for r in bc_runs[c_idx:c_idx+9]]
            best_char = None
            best_dist = float('inf')
            
            for char, pat in CODE39_PATTERNS.items():
                n_lens = [elems[k] for k in range(9) if pat[k] == '0']
                w_lens = [elems[k] for k in range(9) if pat[k] == '1']
                avg_n = sum(n_lens) / 6.0
                avg_w = sum(w_lens) / 3.0
                if avg_w <= avg_n:
                    continue
                cost = sum((x - avg_n)**2 for x in n_lens) + sum((x - avg_w)**2 for x in w_lens)
                if cost < best_dist:
                    best_dist = cost
                    best_char = char
            
            if best_char:
                decoded.append(best_char)
            else:
                break
            c_idx += 10
        
        if len(decoded) == 10:
            res_text = ''.join(decoded)
            if res_text.startswith('*') and res_text.endswith('*'):
                print(f"HIGH-RES MATCH with th={th_val}: {res_text}")

