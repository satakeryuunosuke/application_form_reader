import subprocess
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
cmd = [chrome_path, '--headless', '--disable-gpu', '--virtual-time-budget=6000', '--dump-dom', 'http://127.0.0.1:8000/scripts/test_scan_direct.html']
res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
m = re.search(r'<pre id="output"[^>]*>(.*?)</pre>', res.stdout, re.DOTALL)
if m:
    print(m.group(1).strip())
else:
    print('Not found')
