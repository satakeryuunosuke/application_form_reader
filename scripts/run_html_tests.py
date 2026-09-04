import subprocess
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
cmd = [
    chrome_path,
    '--headless',
    '--disable-gpu',
    '--virtual-time-budget=8000',
    '--dump-dom',
    'http://127.0.0.1:8000/scripts/test_unit_calibrator.html'
]
res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
match = re.search(r'<pre id="test-results"[^>]*>(.*?)</pre>', res.stdout, re.DOTALL)
if match:
    print("=== TEST RESULTS ===")
    print(match.group(1).strip())
else:
    print("No test results found in DOM:")
    print(res.stdout[:500])
