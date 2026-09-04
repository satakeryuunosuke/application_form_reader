import subprocess
import os
import time

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
html_url = 'http://127.0.0.1:8000/scripts/test_unit_calibrator.html'
out_png = os.path.abspath('output/test_results_screenshot.png')

cmd = [
    chrome_path,
    '--headless',
    '--disable-gpu',
    '--window-size=900,700',
    f'--screenshot={out_png}',
    html_url
]

subprocess.run(cmd, check=True)
print("Screenshot captured:", out_png)
