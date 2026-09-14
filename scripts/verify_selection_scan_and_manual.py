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
    server_port = 8094
    server_proc = subprocess.Popen([
        sys.executable, '-m', 'http.server', str(server_port)
    ], cwd=repo_root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[DEBUG] Started local HTTP server on port {server_port}")
    await asyncio.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port = 9228

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
            print(f"[DEBUG] Connecting to: {page_target.get('url')}")

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

            print("[DEBUG] Waiting for app to initialize...")
            await asyncio.sleep(2)

            # 1. 講座選択プロジェクト作成
            print("[TEST 1] Setup selection mode project and sample students...")
            setup_res = await eval_js("""
            (async () => {
                const { DB } = await import('/js/db.js');

                const customBoxes = [
                    { id: 'c1', label: '12/28 名古屋Ⅰ（Zoom）', dx: 0.1, dy: 0.2, size: 0.03 },
                    { id: 'c2', label: '12/29 名古屋Ⅰ（対面）', dx: 0.1, dy: 0.25, size: 0.03 },
                    { id: 'c3', label: '1/2 名古屋Ⅰ（動画）', dx: 0.1, dy: 0.3, size: 0.03 }
                ];

                const template = {
                    barcodeBox: { x: 300, y: 200, width: 500, height: 80 },
                    noChangeBox: null,
                    hasChangeBox: null,
                    customBoxes: customBoxes
                };

                const proj = await DB.createProject({
                    year: 2026,
                    grade: 6,
                    sessionName: '志望校別対策講座',
                    projectType: 'selection',
                    scanTemplate: template,
                    students: [
                        {
                            nichinokenId: 'TDN60001',
                            name: '日能研 太郎',
                            nameKana: 'ニチノケン タロウ',
                            className: 'M1',
                            course: '4科'
                        },
                        {
                            nichinokenId: 'TDN60002',
                            name: '名古屋 花子',
                            nameKana: 'ナゴヤ ハナコ',
                            className: 'A1',
                            course: '4科'
                        }
                    ]
                });

                return { projectId: proj.id };
            })()
            """)
            proj_id = setup_res['projectId']
            print(f"  -> Created project ID: {proj_id}")

            # 2. 手動入力画面のテスト
            print("[TEST 2] Testing Manual Input with Course Selection, Quick Filters & Continuous Mode...")
            # 手動入力画面を開く
            await eval_js(f"""
            (async () => {{
                const {{ ProjectPage }} = await import('/js/pages/project.js');
                const main = document.querySelector('#app-content');
                await ProjectPage.render(main, '{proj_id}', 'manual');
            }})()
            """)
            await asyncio.sleep(0.5)

            # Enterキーでの生徒確定
            enter_test = await eval_js("""
            (async () => {
                const searchInput = document.querySelector('#man-inp-search-student');
                if (!searchInput) throw new Error('#man-inp-search-student not found');
                searchInput.value = 'TDN60001';
                // Trigger input first then Enter
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                await new Promise(r => setTimeout(r, 300));

                const dispName = document.querySelector('#man-disp-name')?.textContent;
                const dispId = document.querySelector('#man-disp-id')?.textContent;
                const cardVisible = !document.querySelector('#man-selected-student-card')?.classList.contains('hidden');

                return { dispName, dispId, cardVisible };
            })()
            """)
            print(f"  -> Enter instant select: {enter_test}")
            assert enter_test['dispName'] == '日能研 太郎', f"Expected 日能研 太郎, got {enter_test['dispName']}"
            assert enter_test['dispId'] == 'TDN60001', f"Expected TDN60001, got {enter_test['dispId']}"
            assert enter_test['cardVisible'] == True

            # クイック選択ツールバーの動作検証
            quick_test = await eval_js("""
            (async () => {
                const btnAll = document.querySelector('#btn-man-select-all');
                const btnNone = document.querySelector('#btn-man-select-none');
                const countEl = document.querySelector('#man-sel-count');
                const zeroNote = document.querySelector('#man-zero-selected-note');

                // 1. 全選択
                btnAll.click();
                const afterAll = countEl.textContent;

                // 2. 全解除
                btnNone.click();
                const afterNone = countEl.textContent;
                const zeroDisplay = zeroNote.style.display;

                // 3. Zoomのみ選択
                const zoomBtn = Array.from(document.querySelectorAll('.btn-quick-man-method')).find(b => b.textContent.includes('Zoom'));
                if (zoomBtn) zoomBtn.click();
                const afterZoom = countEl.textContent;

                return { afterAll, afterNone, zeroDisplay, afterZoom };
            })()
            """)
            print(f"  -> Quick buttons test: {quick_test}")
            assert quick_test['afterAll'] == '3', f"Expected 3, got {quick_test['afterAll']}"
            assert quick_test['afterNone'] == '0', f"Expected 0, got {quick_test['afterNone']}"
            assert quick_test['zeroDisplay'] == 'block'
            assert quick_test['afterZoom'] == '1', f"Expected 1, got {quick_test['afterZoom']}"

            # 担当者選択して保存（連続登録モードON）
            save_test = await eval_js("""
            (async () => {
                const staffSelect = document.querySelector('#man-sel-staff');
                staffSelect.value = staffSelect.options[1].value;
                staffSelect.dispatchEvent(new Event('change'));

                const chkContinuous = document.querySelector('#chk-man-continuous');
                chkContinuous.checked = true;

                const saveBtn = document.querySelector('#btn-save-manual');
                saveBtn.click();

                await new Promise(r => setTimeout(r, 600));

                const searchVal = document.querySelector('#man-inp-search-student').value;
                const cardHidden = document.querySelector('#man-selected-student-card').classList.contains('hidden');
                const countAfter = document.querySelector('#man-sel-count').textContent;

                return { searchVal, cardHidden, countAfter };
            })()
            """)
            print(f"  -> Continuous save reset test: {save_test}")
            assert save_test['searchVal'] == '', "Search input should be cleared for next student"
            assert save_test['cardHidden'] == True, "Student card should be reset"
            assert save_test['countAfter'] == '0', "Course selection should be reset"

            # DB保存データの検証
            db_check = await eval_js(f"""
            (async () => {{
                const {{ DB }} = await import('/js/db.js');
                const list = await DB.getProjectStudentsWithSubmissions('{proj_id}');
                const taro = list.find(s => s.nichinokenId === 'TDN60001');
                return {{
                    status: taro.status,
                    enrollmentClass: taro.enrollmentClass,
                    selectedCourses: taro.selectedCourses,
                    inputMethod: taro.inputMethod
                }};
            }})()
            """)
            print(f"  -> DB record for Taro: {db_check}")
            assert db_check['status'] == '承認済'
            assert '1講座申込' in db_check['enrollmentClass']
            assert '12/28 名古屋Ⅰ（Zoom）' in db_check['selectedCourses']

            # 3. スキャン読み取りエンジンと承認ビューの検証
            print("[TEST 3] Testing ScannerEngine and Approval View for Course Selection...")
            scan_test = await eval_js(f"""
            (async () => {{
                const {{ ScannerEngine }} = await import('/js/scanner.js');
                const {{ ScanPage }} = await import('/js/pages/scan.js');
                const {{ DB }} = await import('/js/db.js');

                // Canvas作成
                const canvas = document.createElement('canvas');
                canvas.width = 600;
                canvas.height = 800;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 600, 800);

                const proj = await DB.getProject('{proj_id}');

                // analyzeCanvas 呼び出し
                const res = await ScannerEngine.analyzeCanvas(canvas, proj.scanTemplate);
                const hasOverlay = !!res.overlayDataUrl;

                // スキャン承認ビューのレンダリングテスト
                ScanPage.project = proj;
                ScanPage.staffList = ['担当者A'];
                ScanPage.selectedStaff = '担当者A';
                ScanPage.pendingQueue = [
                    {{
                        pageNum: 1,
                        barcodeFound: true,
                        rawNichinokenId: 'TDN60002',
                        validatedId: 'TDN60002',
                        isIdValid: true,
                        imageDataUrl: res.imageDataUrl,
                        overlayDataUrl: res.overlayDataUrl,
                        checkResult: {{
                            customChecks: {{
                                'c1': {{ id: 'c1', label: '12/28 名古屋Ⅰ（Zoom）', isChecked: true, darkRatio: 0.45 }},
                                'c2': {{ id: 'c2', label: '12/29 名古屋Ⅰ（対面）', isChecked: false, darkRatio: 0.02 }},
                                'c3': {{ id: 'c3', label: '1/2 名古屋Ⅰ（動画）', isChecked: true, darkRatio: 0.50 }}
                            }}
                        }},
                        matchedStudent: (await DB.findStudentByNichinokenId('{proj_id}', 'TDN60002'))
                    }}
                ];
                ScanPage.currentIndex = 0;

                ScanPage.container = document.querySelector('#app-content') || document.body;
                await ScanPage.renderApprovalView();

                const previewSrc = document.querySelector('#scanned-image-preview')?.src;
                const isOverlayUsed = previewSrc && previewSrc.startsWith('data:image/jpeg');
                const selectedCount = document.querySelector('#scan-sel-count')?.textContent;
                const hasQuickAll = !!document.querySelector('#btn-scan-select-all');
                const hasQuickNone = !!document.querySelector('#btn-scan-select-none');

                // 承認保存を実行
                const approveBtn = document.querySelector('#btn-approve');
                approveBtn.click();
                await new Promise(r => setTimeout(r, 600));

                const list2 = await DB.getProjectStudentsWithSubmissions('{proj_id}');
                const hanako = list2.find(s => s.nichinokenId === 'TDN60002');

                return {{
                    hasOverlay,
                    isOverlayUsed,
                    selectedCount,
                    hasQuickAll,
                    hasQuickNone,
                    hanakoStatus: hanako.status,
                    hanakoCourses: hanako.selectedCourses,
                    hanakoClass: hanako.enrollmentClass
                }};
            }})()
            """)
            print(f"  -> Scan & Approval test: {scan_test}")
            assert scan_test['hasOverlay'] == True, "analyzeCanvas must return overlayDataUrl"
            assert scan_test['isOverlayUsed'] == True, "scanned-image-preview must use overlay image"
            assert scan_test['selectedCount'] == '2', f"Expected 2 courses selected, got {scan_test['selectedCount']}"
            assert scan_test['hasQuickAll'] == True
            assert scan_test['hasQuickNone'] == True
            assert scan_test['hanakoStatus'] == '承認済'
            assert '2講座申込' in scan_test['hanakoClass']
            assert len(scan_test['hanakoCourses']) == 2
            assert '12/28 名古屋Ⅰ（Zoom）' in scan_test['hanakoCourses']
            assert '1/2 名古屋Ⅰ（動画）' in scan_test['hanakoCourses']

            print("\n🎉 ALL TESTS PASSED SUCCESSFULLY! Everything works as specified.")

    finally:
        chrome_proc.terminate()
        server_proc.terminate()

if __name__ == '__main__':
    asyncio.run(main())
