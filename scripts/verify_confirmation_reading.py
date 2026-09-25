import asyncio
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import websockets

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

async def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    server_port = 8099
    server_proc = subprocess.Popen([
        sys.executable, '-m', 'http.server', str(server_port)
    ], cwd=repo_root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port = 9233

    chrome_proc = subprocess.Popen([
        chrome_path,
        '--headless=new',
        '--disable-gpu',
        f'--remote-debugging-port={port}',
        f'--user-data-dir={user_data_dir}',
        '--window-size=1280,950',
        f'http://127.0.0.1:{server_port}/'
    ])

    try:
        await asyncio.sleep(2)
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json') as resp:
            targets = json.loads(resp.read().decode())
            page_target = next((t for t in targets if t.get('type') == 'page'), targets[0])
            ws_url = page_target['webSocketDebuggerUrl']

        async with websockets.connect(ws_url) as ws:
            msg_id = 0
            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                payload = {'id': msg_id, 'method': method}
                if params:
                    payload['params'] = params
                await ws.send(json.dumps(payload))
                while True:
                    res = json.loads(await ws.recv())
                    if res.get('id') == msg_id:
                        return res.get('result', {})

            async def eval_js(expression):
                res = await send('Runtime.evaluate', {
                    'expression': expression,
                    'awaitPromise': True,
                    'returnByValue': True
                })
                if 'exceptionDetails' in res:
                    raise Exception(f"JS Error: {res['exceptionDetails']}")
                return res.get('result', {}).get('value')

            await asyncio.sleep(1)

            res = await eval_js("""
            (async () => {
                const { ScannerEngine } = await import('/js/scanner.js');
                const { CheckboxEngine } = await import('/js/checkbox.js');
                const { TemplateCalibrator } = await import('/js/components/calibrator.js');

                const resp = await fetch('/test_data/受講確認モード_テストスキャン記入済.pdf');
                const blob = await resp.blob();
                const file = new File([blob], '受講確認モード_テストスキャン記入済.pdf', { type: 'application/pdf' });

                // 調整後テンプレート
                const template = {
                    noChangeBox: { dx: -0.07, dy: 0.28, size: 0.022 },
                    hasChangeBox: { dx: -0.07, dy: 0.375, size: 0.022 },
                    customBoxes: [],
                    threshold: 0.20
                };

                const container = document.createElement('div');
                document.body.appendChild(container);
                const calib = new TemplateCalibrator(container, template, null, { codeType: 'code39' });
                await calib.loadFile(file);
                calib.setPage(0);

                const calibRects = CheckboxEngine.calculateTargetRects(calib.sourceCanvas, calib.barcodeBox, calib.template, calib.bottomBorder);
                const savedTemplate = calib.getTemplate();

                const scanRects = CheckboxEngine.calculateTargetRects(calib.sourceCanvas, calib.barcodeBox, savedTemplate, calib.bottomBorder);

                // 全ページの判定テスト
                const scanResults = await ScannerEngine.processPdf(file, savedTemplate, null, { codeType: 'code39' });

                return {
                    calibScaleY: calibRects.scaleY,
                    scanScaleY: scanRects.scaleY,
                    diffY: scanRects.noChangeRect.y - calibRects.noChangeRect.y,
                    page1_hasChange: scanResults[0].checkResult.hasChange,
                    page2_hasChange: scanResults[1].checkResult.hasChange,
                    page3_hasChange: scanResults[2].checkResult.hasChange,
                    page4_hasChange: scanResults[3].checkResult.hasChange,
                    page5_hasChange: scanResults[4].checkResult.hasChange
                };
            })()
            """)

            print(f"[TEST RESULT] {json.dumps(res, indent=2)}")
            assert res['diffY'] == 0, f"diffY should be 0, got {res['diffY']}"
            assert res['page1_hasChange'] == False, "Page 1 should be no-change"
            assert res['page2_hasChange'] == False, "Page 2 should be no-change"
            assert res['page3_hasChange'] == True, "Page 3 should be has-change"
            assert res['page4_hasChange'] == False, "Page 4 should be no-change"
            assert res['page5_hasChange'] == True, "Page 5 should be has-change"
            print("[SUCCESS] All confirmation reading tests passed!")

    finally:
        chrome_proc.terminate()
        server_proc.terminate()

if __name__ == '__main__':
    asyncio.run(main())
