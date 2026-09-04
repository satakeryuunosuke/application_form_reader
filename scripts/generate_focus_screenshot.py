import subprocess, os

chrome = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
html = """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="../css/variables.css">
  <link rel="stylesheet" href="../css/base.css">
  <link rel="stylesheet" href="../css/components.css">
  <link rel="stylesheet" href="../css/pages.css">
  <script src="../lib/dexie.min.js"></script>
  <script src="../lib/xlsx.full.min.js"></script>
  <script src="../lib/pdf.min.js"></script>
  <script src="../lib/zxing-library.min.js"></script>
</head>
<body style="background: #1e293b; padding: 30px; display: flex; justify-content: center;">
  <div style="background: #ffffff; border-radius: 12px; width: 1350px; max-width: 96vw; padding: 24px;">
    <div id="calib-mount"></div>
  </div>
  <script type="module">
    import { TemplateCalibrator } from '../js/components/calibrator.js';
    const mount = document.getElementById('calib-mount');
    const calib = new TemplateCalibrator(mount);
    setTimeout(function() {
      calib.focusTargetArea();
    }, 100);
  </script>
</body>
</html>"""

with open('scripts/preview_focus.html', 'w', encoding='utf-8') as f:
    f.write(html)

out = os.path.abspath('output/calibrator_focus_preview.png')
cmd = [
    chrome,
    '--headless',
    '--disable-gpu',
    '--virtual-time-budget=2000',
    '--window-size=1450,950',
    f'--screenshot={out}',
    'http://127.0.0.1:8000/scripts/preview_focus.html'
]
subprocess.run(cmd, check=True)
print('Focus screenshot generated:', out)
