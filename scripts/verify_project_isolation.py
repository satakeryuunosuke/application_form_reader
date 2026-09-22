import asyncio
import json
import urllib.request
import websockets
import subprocess
import os
import tempfile
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    port_http = 8000
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port_cdp = 9226

    chrome_proc = subprocess.Popen([
        chrome_path,
        '--headless=new',
        '--disable-gpu',
        f'--remote-debugging-port={port_cdp}',
        f'--user-data-dir={user_data_dir}',
        '--window-size=1280,950',
        f'http://127.0.0.1:{port_http}/'
    ])

    try:
        await asyncio.sleep(2)
        with urllib.request.urlopen(f'http://127.0.0.1:{port_cdp}/json') as resp:
            targets = json.loads(resp.read().decode())
            target = next(t for t in targets if str(port_http) in t.get('url', ''))
            ws_url = target['webSocketDebuggerUrl']

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
                        if 'error' in res:
                            print('CDP Error:', res['error'])
                        return res.get('result', {})

            async def eval_js(expr):
                r = await send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
                if 'exceptionDetails' in r:
                    print('JS Error:', json.dumps(r['exceptionDetails'], ensure_ascii=False, indent=2))
                val = r.get('result', {}).get('value')
                if isinstance(val, str):
                    try:
                        return json.loads(val)
                    except:
                        return val
                return val

            await asyncio.sleep(1)

            # 1. バージョン確認
            app_ver = await eval_js("document.getElementById('header-app-version')?.textContent")
            print("1. App version:", app_ver)
            assert app_ver == 'v1.22.1', f"Version mismatch: {app_ver}"

            # 2. テスト用プロジェクト2つ（Project A, Project B）を作成
            create_projs_script = """
            (async () => {
                const { DB } = await import('./js/db.js');
                await DB.init();
                
                const pA = await DB.createProject({
                    title: 'テストプロジェクトA',
                    year: 2026,
                    grade: 6,
                    sessionName: '夏期',
                    projectType: 'regular',
                    students: [
                        { nichinokenId: 'A001', name: '生徒A1', className: 'M1' },
                        { nichinokenId: 'A002', name: '生徒A2', className: 'M1' }
                    ]
                });
                
                const pB = await DB.createProject({
                    title: 'テストプロジェクトB',
                    year: 2026,
                    grade: 5,
                    sessionName: '夏期',
                    projectType: 'regular',
                    students: [
                        { nichinokenId: 'B001', name: '生徒B1', className: 'A1' }
                    ]
                });

                return pA.id + ',' + pB.id;
            })()
            """
            projs_str = await eval_js(create_projs_script)
            print("2. Created projects:", projs_str)
            pA_id, pB_id = projs_str.split(',')

            # 3. Project A のスキャン画面へ遷移し、スキャン完了状態（5件承認完了）をシミュレート
            simulate_scan_completion = f"""
            (async () => {{
                const {{ ScanPage }} = await import('./js/pages/scan.js');
                const {{ DB }} = await import('./js/db.js');
                const projectA = await DB.getProject('{pA_id}');
                
                window.location.hash = '#project/{pA_id}/scan';
                await new Promise(r => setTimeout(r, 400));
                
                // 5件のダミースキャン完了状態を設定
                ScanPage.pendingQueue = [
                    {{ pageNum: 1, approved: true }},
                    {{ pageNum: 2, approved: true }},
                    {{ pageNum: 3, approved: true }},
                    {{ pageNum: 4, approved: true }},
                    {{ pageNum: 5, approved: true }}
                ];
                ScanPage.currentIndex = 5;
                await ScanPage.renderApprovalView();
                
                return JSON.stringify({{
                    renderedCardTitle: document.querySelector('#scan-page-inner h2')?.textContent?.trim(),
                    hasSyncCard: !!document.querySelector('#scan-sync-card'),
                    queueLength: ScanPage.pendingQueue.length
                }});
            }})()
            """
            resA = await eval_js(simulate_scan_completion)
            print("3. Project A scan completion view:", resA)
            assert "すべての確認票の承認が完了しました" in (resA.get('renderedCardTitle') or '')
            assert resA.get('queueLength') == 5

            # 4. Project B のスキャン画面へ遷移
            navigate_to_B = f"""
            (async () => {{
                const {{ ScanPage }} = await import('./js/pages/scan.js');
                window.location.hash = '#project/{pB_id}/scan';
                await new Promise(r => setTimeout(r, 600));
                
                return JSON.stringify({{
                    queueLength: ScanPage.pendingQueue.length,
                    currentIndex: ScanPage.currentIndex,
                    scanProjectId: ScanPage.project?.id,
                    renderedCardTitle: document.querySelector('#scan-page-inner h2')?.textContent?.trim(),
                    hasDropzone: !!document.querySelector('#pdf-dropzone')
                }});
            }})()
            """
            resB = await eval_js(navigate_to_B)
            print("4. Project B scan view after switching from A:", resB)
            assert resB.get('queueLength') == 0, f"Expected empty queue in Project B, got: {resB.get('queueLength')}"
            assert resB.get('currentIndex') == 0
            assert resB.get('hasDropzone') is True, "Expected dropzone in Project B"
            assert "すべての確認票の承認が完了しました" not in (resB.get('renderedCardTitle') or '')
            print("   -> SUCCESS: Project A's completion view is NOT displayed in Project B!")

            # 5. 再度 Project A の完了画面を設定し、完了ボタン（提出状況一覧を見る）をクリックして戻るテスト
            test_button_cleanup = f"""
            (async () => {{
                const {{ ScanPage }} = await import('./js/pages/scan.js');
                const {{ DB }} = await import('./js/db.js');
                const projectA = await DB.getProject('{pA_id}');
                
                window.location.hash = '#project/{pA_id}/scan';
                await new Promise(r => setTimeout(r, 400));
                
                // 再度5件完了状態にして完了画面を表示
                ScanPage.pendingQueue = [
                    {{ pageNum: 1, approved: true }},
                    {{ pageNum: 2, approved: true }},
                    {{ pageNum: 3, approved: true }},
                    {{ pageNum: 4, approved: true }},
                    {{ pageNum: 5, approved: true }}
                ];
                ScanPage.currentIndex = 5;
                await ScanPage.renderApprovalView();
                
                // 「提出状況一覧を見る」ボタンをクリック
                const btnGoList = document.querySelector('#btn-go-list');
                if (btnGoList) btnGoList.click();
                await new Promise(r => setTimeout(r, 400));
                
                const queueAfterClick = ScanPage.pendingQueue.length;
                
                // 再度スキャン画面へ戻る
                window.location.hash = '#project/{pA_id}/scan';
                await new Promise(r => setTimeout(r, 400));
                
                return JSON.stringify({{
                    queueAfterClick: queueAfterClick,
                    queueAfterReturning: ScanPage.pendingQueue.length,
                    hasDropzone: !!document.querySelector('#pdf-dropzone')
                }});
            }})()
            """
            resBtn = await eval_js(test_button_cleanup)
            print("5. Button cleanup and re-entering scan tab test:", resBtn)
            assert resBtn.get('queueAfterClick') == 0
            assert resBtn.get('queueAfterReturning') == 0
            assert resBtn.get('hasDropzone') is True
            print("   -> SUCCESS: Navigating via completion buttons properly resets the scan queue!")

            print("\nALL PROJECT ISOLATION TESTS PASSED!")

    finally:
        chrome_proc.terminate()

if __name__ == '__main__':
    asyncio.run(main())
