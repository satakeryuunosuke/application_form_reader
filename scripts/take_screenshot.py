import subprocess
import os
import time

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
if not os.path.exists(chrome_path):
    chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

out_png = os.path.abspath('output/app_screenshot.png')

cmd = [
    chrome_path,
    '--headless',
    '--disable-gpu',
    '--window-size=1280,900',
    f'--screenshot={out_png}',
    'http://127.0.0.1:8000/'
]

subprocess.run(cmd, check=True)
print('Screenshot saved to:', out_png)
