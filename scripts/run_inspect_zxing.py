import subprocess, re, sys
sys.stdout.reconfigure(encoding='utf-8')
chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
cmd = [chrome_path, '--headless', '--disable-gpu', '--virtual-time-budget=2000', '--dump-dom', 'http://127.0.0.1:8000/scripts/inspect_zxing_methods.html']
res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
m = re.search(r'<pre id="methods">(.*?)</pre>', res.stdout, re.DOTALL)
if m:
    methods = m.group(1).splitlines()
    for method in methods:
        if 'decode' in method.lower():
            print(method)
else:
    print("Not found")
