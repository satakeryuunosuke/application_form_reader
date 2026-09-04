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
    port = 9222

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
        # Get websocket URL
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

            async def wait_for_selector(sel, timeout=10.0):
                start = time.time()
                while time.time() - start < timeout:
                    res = await eval_js(f"!!document.querySelector('{sel}')")
                    if res:
                        return True
                    await asyncio.sleep(0.3)
                raise TimeoutError(f"Timeout waiting for selector: {sel}")

            # Navigate to URL explicitly to ensure DOM is ready
            print("[1] Navigating to http://127.0.0.1:8000/ ...")
            nav_res = await send('Page.navigate', {'url': 'http://127.0.0.1:8000/'})
            # Wait for Page.loadEventFired
            while True:
                msg = json.loads(await ws.recv())
                if msg.get('method') == 'Page.loadEventFired':
                    break

            await asyncio.sleep(1.0)
            url = await eval_js("window.location.href")
            print(f"Loaded URL: {url}")
            await wait_for_selector('#btn-new-project, #btn-empty-new-project')
            await asyncio.sleep(0.5)

            # Click 新規プロジェクト作成
            print("[2] Opening New Project Wizard...")
            await eval_js("(document.querySelector('#btn-new-project') || document.querySelector('#btn-empty-new-project')).click()")
            await wait_for_selector('.modal-backdrop')
            await asyncio.sleep(0.5)

            # Step 1: Click 次へ進む
            print("[3] Step 1: Advancing to Step 2...")
            await wait_for_selector('#btn-wiz-next')
            await eval_js("document.querySelector('#btn-wiz-next').click()")
            await wait_for_selector('#csv-file-input')
            await asyncio.sleep(0.5)

            # Step 2: Inject mock student data into CSV input
            print("[4] Step 2: Setting mock students...")
            csv_content = "日能研番号,氏名,フリガナ,学年,クラス,受講科目数,受講番号\nTDN60013,あいうえお,アイウエオ,6年,M2,4科,01\n"
            b64_csv = base64.b64encode(csv_content.encode('utf-8')).decode('ascii')
            js_upload = f"""
            (async () => {{
                const blob = new Blob([new TextEncoder().encode(atob('{b64_csv}'))], {{ type: 'text/csv' }});
                const file = new File([blob], 'test_students.csv', {{ type: 'text/csv' }});
                const dt = new DataTransfer();
                dt.items.add(file);
                const input = document.querySelector('#csv-file-input');
                input.files = dt.files;
                input.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }})();
            """
            await eval_js(js_upload)
            await asyncio.sleep(0.5)

            # Advance to Step 3
            print("[5] Step 2 -> Step 3: Advancing to Calibrator...")
            title_before = await eval_js("document.querySelector('.modal-title')?.textContent")
            print(f"Modal title before next: {title_before}")
            # Check parsed students count
            student_count = await eval_js("document.querySelector('#csv-preview-container')?.textContent")
            print(f"CSV preview: {student_count[:100] if student_count else 'None'}")

            await eval_js("document.querySelector('#btn-wiz-next').click()")
            await asyncio.sleep(1.0)

            title_after = await eval_js("document.querySelector('.modal-title')?.textContent")
            print(f"Modal title after next: {title_after}")

            # Check Step 3 Calibrator state
            badge_text = await eval_js("document.querySelector('#calib-page-badge')?.textContent")
            print(f"[6] Initial Step 3 badge: {badge_text}")
            assert "TDN60013" in badge_text or "バーコード" in badge_text, f"Unexpected badge: {badge_text}"

            # Capture initial Step 3 screenshot
            scr1 = await send('Page.captureScreenshot', {'format': 'png'})
            with open('output/wizard_step3_initial.png', 'wb') as f:
                f.write(base64.b64decode(scr1['data']))
            print("Saved output/wizard_step3_initial.png")

            # Test Barcode Non-Detection:
            # Simulate uploading an image without barcode (e.g. solid blank white/grey image)
            print("[7] Simulating upload of non-barcode image...")
            js_upload_blank = """
            (async () => {
                const cv = document.createElement('canvas');
                cv.width = 800; cv.height = 600;
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 800, 600);
                const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
                const file = new File([blob], 'blank_page.png', { type: 'image/png' });
                const dt = new DataTransfer();
                dt.items.add(file);
                const input = document.querySelector('#calib-file-input');
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            })();
            """
            await eval_js(js_upload_blank)
            await asyncio.sleep(1.5)

            badge_text_undetected = await eval_js("document.querySelector('#calib-page-badge').textContent")
            badge_class = await eval_js("document.querySelector('#calib-page-badge').className")
            print(f"[8] After uploading blank page: badge='{badge_text_undetected}', class='{badge_class}'")
            assert "⚠️ バーコード未検出" in badge_text_undetected, f"Expected undetected badge, got: {badge_text_undetected}"
            assert "badge-danger" in badge_class, f"Expected badge-danger class, got: {badge_class}"

            # Try clicking "この書式設定でプロジェクト作成" while barcode is undetected!
            print("[9] Clicking 'この書式設定でプロジェクト作成' while barcode is undetected...")
            await eval_js("document.querySelector('#btn-wiz-next').click()")
            await asyncio.sleep(0.5)

            # Check if error toast is displayed and modal is still open
            toast_text = await eval_js("document.querySelector('.toast.toast-error')?.textContent || ''")
            modal_exists = await eval_js("!!document.querySelector('.modal-backdrop')")
            print(f"[10] Toast message: '{toast_text}', Modal still open: {modal_exists}")
            assert "バーコードが読み取れていません" in toast_text, f"Expected error toast, got: {toast_text}"
            assert modal_exists, "Modal should NOT be closed when barcode is undetected!"

            # Capture screenshot of error state
            scr2 = await send('Page.captureScreenshot', {'format': 'png'})
            with open('output/wizard_step3_undetected_error.png', 'wb') as f:
                f.write(base64.b64decode(scr2['data']))
            print("Saved output/wizard_step3_undetected_error.png")

            print("\n==========================================")
            print(" ALL VERIFICATIONS PASSED SUCCESSFULLY!")
            print("==========================================")

    finally:
        chrome_proc.terminate()
        chrome_proc.wait()

if __name__ == '__main__':
    asyncio.run(main())
