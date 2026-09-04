import asyncio
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import websockets
import base64

async def main():
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port = 9333

    chrome_proc = subprocess.Popen([
        chrome_path,
        '--headless=new',
        '--disable-gpu',
        f'--remote-debugging-port={port}',
        f'--user-data-dir={user_data_dir}',
        '--window-size=1280,950',
        'http://127.0.0.1:8000/'
    ])

    try:
        await asyncio.sleep(2)
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json') as resp:
            targets = json.loads(resp.read().decode())
            ws_url = targets[0]['webSocketDebuggerUrl']

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

            async def eval_js(expr):
                r = await send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
                val = r.get('result', {}).get('value')
                return val

            print("[1] Opening http://127.0.0.1:8000/ ...")
            await send('Page.navigate', {'url': 'http://127.0.0.1:8000/'})
            await asyncio.sleep(2.0)

            # 1. ScannerEngine.detectBarcode で直接テスト
            print("[2] Running ScannerEngine.detectBarcode directly on SCAN0000_rotated.pdf in browser context...")
            direct_test_code = """
            (async () => {
                const { ScannerEngine } = await import('./js/scanner.js');
                const res = await fetch('./output/SCAN0000_rotated.pdf');
                const ab = await res.arrayBuffer();
                
                pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
                const pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
                const page = await pdfDoc.getPage(1);
                
                const unscaled = page.getViewport({ scale: 1.0 });
                const maxDim = Math.max(unscaled.width, unscaled.height);
                const scale = Math.max(2.5, Math.min(3.5, 2200 / maxDim));
                const viewport = page.getViewport({ scale });
                
                const cv = document.createElement('canvas');
                cv.width = viewport.width;
                cv.height = viewport.height;
                const ctx = cv.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                
                const bc = await ScannerEngine.detectBarcode(cv);
                return {
                    found: bc.found,
                    text: bc.text,
                    rawText: bc.rawText,
                    box: bc.box,
                    canvasSize: { width: cv.width, height: cv.height }
                };
            })()
            """
            barcode_res = await eval_js(direct_test_code)
            print("Direct Barcode Result:", json.dumps(barcode_res, ensure_ascii=False, indent=2))

            # 2. UI上のウィザードキャリブレータでの検証
            print("\n[3] Testing Calibrator UI in New Project Wizard...")
            await eval_js("document.querySelector('#btn-new-project, #btn-empty-new-project').click()")
            await asyncio.sleep(0.5)

            # Step 1: プロジェクト名入力
            await eval_js("document.getElementById('wizard-proj-name').value = 'スキャン検証プロジェクト'")
            # 次へ
            await eval_js("document.getElementById('btn-wizard-next').click()")
            await asyncio.sleep(0.5)
            # Step 2: 次へ
            await eval_js("document.getElementById('btn-wizard-next').click()")
            await asyncio.sleep(0.5)

            # Step 3 に到達（キャリブレータ表示）
            print("[4] Arrived at Step 3 (Calibrator). Uploading SCAN0000_rotated.pdf into calibrator...")
            
            # File を生成して calibratorInstance.loadFile(file) を直接呼出
            calib_load_code = """
            (async () => {
                const res = await fetch('./output/SCAN0000_rotated.pdf');
                const blob = await res.blob();
                const file = new File([blob], 'SCAN0000_rotated.pdf', { type: 'application/pdf' });
                
                // ウィザードのキャリブレータインスタンスを取得
                const homeModule = await import('./js/pages/home.js');
                // ファイル読み込み
                const calib = window.__calibratorInstance || (window.currentCalibrator);
                // または dropzone に dispatch
                const dropzone = document.getElementById('calib-dropzone');
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const event = new DragEvent('drop', { dataTransfer, bubbles: true });
                dropzone.dispatchEvent(event);
                
                // 解析完了を待機
                await new Promise(r => setTimeout(r, 2000));
                
                const pageBadge = document.getElementById('calib-page-badge')?.textContent;
                const canvas = document.getElementById('calib-canvas');
                return {
                    pageBadge,
                    canvasWidth: canvas?.width,
                    canvasHeight: canvas?.height
                };
            })()
            """
            calib_res = await eval_js(calib_load_code)
            print("Calibrator load result:", json.dumps(calib_res, ensure_ascii=False, indent=2))

            await asyncio.sleep(1.0)
            
            # ステータス確認
            badge_text = await eval_js("document.getElementById('calib-page-badge')?.textContent")
            next_btn_disabled = await eval_js("document.getElementById('btn-wizard-next')?.disabled")
            print(f"Page Badge Text: '{badge_text}'")
            print(f"Wizard Next Button Disabled: {next_btn_disabled}")

            # スクリーンショット取得
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            img_data = base64.b64decode(shot['data'])
            with open('output/calibrator_user_scan_result.png', 'wb') as f:
                f.write(img_data)
            print("Saved screenshot to output/calibrator_user_scan_result.png")

    finally:
        chrome_proc.terminate()

if __name__ == '__main__':
    asyncio.run(main())
