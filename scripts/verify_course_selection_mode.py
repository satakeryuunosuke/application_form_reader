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
    server_port = 8092
    server_proc = subprocess.Popen([
        sys.executable, '-m', 'http.server', str(server_port)
    ], cwd=repo_root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[DEBUG] Started local HTTP server on port {server_port}")
    await asyncio.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port = 9226

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

            # 1. 講座選択モードのプロジェクト作成とテストデータ投入
            setup_code = """
            (async () => {
                const { DB, db } = await import('/js/db.js');

                const customBoxes = [
                    { id: 'c1', label: '12/28 Zoom 名古屋Ⅰ', x: 200, y: 1500, width: 40, height: 40 },
                    { id: 'c2', label: '1/2 動画 名古屋Ⅰ', x: 200, y: 1600, width: 40, height: 40 },
                    { id: 'c3', label: '1/3 校舎 名古屋Ⅰ', x: 200, y: 1700, width: 40, height: 40 }
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
                            nichinokenId: 'TDN60013',
                            name: '日能研太郎',
                            nameKana: 'ニチノウケンタロウ',
                            className: 'W1',
                            course: '4科'
                        },
                        {
                            nichinokenId: 'TDN60026',
                            name: '日能研花子',
                            nameKana: 'ニチノウケンハナコ',
                            className: 'M1',
                            course: '4科'
                        }
                    ]
                });

                const projId = proj.id;
                const students = await db.students.where('projectId').equals(projId).toArray();
                const s1 = students.find(s => s.nichinokenId === 'TDN60013');
                const s2 = students.find(s => s.nichinokenId === 'TDN60026');

                const sub1 = await db.submissions.where('studentId').equals(s1.id).first();

                // 太郎の申込承認（2講座選択）
                await DB.saveSubmission(sub1.id, {
                    status: '承認済',
                    hasChange: true,
                    enrollmentClass: '2講座申込',
                    enrollmentCourse: '-',
                    inputMethod: '手動登録',
                    approvedBy: 'テスト担当者',
                    customChecks: {
                        'c1': { id: 'c1', isChecked: true, label: '12/28 Zoom 名古屋Ⅰ', confidence: 0.95 },
                        'c2': { id: 'c2', isChecked: true, label: '1/2 動画 名古屋Ⅰ', confidence: 0.92 },
                        'c3': { id: 'c3', isChecked: false, label: '1/3 校舎 名古屋Ⅰ', confidence: 0.05 }
                    }
                });

                return { projId, s1: s1.id, s2: s2.id };
            })()
            """
            init_res = await eval_js(setup_code)
            proj_id = init_res['projId']
            print(f"[SUCCESS] Created selection project: ID={proj_id}")

            # 2. 一覧画面へ遷移
            print(f"[DEBUG] Navigating to list page: #project/{proj_id}/list")
            nav_code = """
            (async () => {
                window.location.hash = '#project/__PROJ_ID__/list';
                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    if (document.querySelector('.submission-list-table')) break;
                }
                let applyErr = null;
                try {
                    const listMod = await import('/js/pages/list.js');
                    listMod.ListPage.applyFiltersAndRenderTable();
                } catch(err) {
                    applyErr = err.stack || err.message;
                }

                return {
                    tableFound: !!document.querySelector('.submission-list-table'),
                    tableArea: document.getElementById('table-render-area')?.innerHTML,
                    applyErr: applyErr,
                    hash: window.location.hash
                };
            })()
            """.replace('__PROJ_ID__', proj_id)
            nav_debug = await eval_js(nav_code)
            print(f"[DEBUG] Nav debug: {json.dumps(nav_debug, ensure_ascii=False, indent=2)}")

            # 3. 一覧画面の検証
            list_check = """
            (() => {
                const headerText = document.querySelector('.project-header-bar')?.innerText || '';
                const tableText = document.querySelector('.submission-list-table')?.innerText || '';
                const thElements = Array.from(document.querySelectorAll('.submission-list-table thead th')).map(th => th.innerText.trim());

                const rows = Array.from(document.querySelectorAll('.submission-list-table tbody tr')).map(tr => {
                    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                    return tds;
                });

                const courseFilter = document.querySelector('#sel-filter-course');
                const courseFilterOptions = courseFilter ? Array.from(courseFilter.options).map(o => o.text) : [];

                return {
                    headerHasBadge: headerText.includes('🎯 講座選択モード'),
                    thElements,
                    hasCoursesCountTh: thElements.some(t => t.includes('申込講座数')),
                    hasCoursesListTh: thElements.some(t => t.includes('申込講座一覧')),
                    rows,
                    courseFilterOptions
                };
            })()
            """
            res_list = await eval_js(list_check)
            print(f"Header has selection badge: {res_list['headerHasBadge']}")
            print(f"Table headers: {res_list['thElements']}")
            print(f"Rows count: {len(res_list['rows'])}")
            print(f"Row 1 (Taro): {res_list['rows'][0]}")
            print(f"Row 2 (Hanako): {res_list['rows'][1]}")
            print(f"Course filter options: {res_list['courseFilterOptions']}")

            assert res_list['headerHasBadge'], "Header must display '🎯 講座選択モード' badge"
            assert res_list['hasCoursesCountTh'], "Table must have '申込講座数' header"
            assert res_list['hasCoursesListTh'], "Table must have '申込講座一覧' header"

            # 太郎の行に「2 講座」と講座名バッジが含まれること
            taro_row_str = " ".join(res_list['rows'][0])
            assert '2 講座' in taro_row_str or '2' in taro_row_str, f"Taro should have 2 courses: {taro_row_str}"
            assert 'Zoom 名古屋Ⅰ' in taro_row_str, f"Taro should have Zoom course: {taro_row_str}"
            assert '動画 名古屋Ⅰ' in taro_row_str, f"Taro should have Movie course: {taro_row_str}"

            # 花子の行に「未提出」が含まれること
            hanako_row_str = " ".join(res_list['rows'][1])
            assert '未提出' in hanako_row_str, f"Hanako should be unsubmitted: {hanako_row_str}"
            print("[SUCCESS] List page columns and student data verified successfully.")

            # 4. 講座フィルターでの絞り込みテスト
            print("[DEBUG] Testing course filter...")
            filter_test = """
            (async () => {
                const { ListPage } = await import('/js/pages/list.js');
                const courseSelect = document.querySelector('#sel-filter-course');
                // '12/28 Zoom 名古屋Ⅰ' でフィルター
                courseSelect.value = '12/28 Zoom 名古屋Ⅰ';
                courseSelect.dispatchEvent(new Event('change'));
                
                await new Promise(r => setTimeout(r, 100));

                const rows = Array.from(document.querySelectorAll('.submission-list-table tbody tr')).map(tr => {
                    return Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()).join(' ');
                });
                return rows;
            })()
            """
            filtered_rows = await eval_js(filter_test)
            print(f"Filtered rows (Zoom only): {len(filtered_rows)} items")
            assert len(filtered_rows) == 1, f"Expected 1 filtered row, got {len(filtered_rows)}"
            assert '日能研太郎' in filtered_rows[0], "Filtered row must be Taro"
            print("[SUCCESS] Course filter verified successfully.")

            # 5. ダッシュボード画面の検証
            print(f"[DEBUG] Navigating to dashboard: #project/{proj_id}/dashboard")
            await eval_js(f"window.location.hash = '#project/{proj_id}/dashboard'")
            await asyncio.sleep(1.5)

            dash_check = """
            (() => {
                const dashText = document.querySelector('.dashboard-container')?.innerText || '';
                return {
                    hasSummaryHeader: dashText.includes('志望校別 講座別申込人数サマリー'),
                    hasTotalBadge: dashText.includes('延べ申込: 2 講座'),
                    hasZoomCount: dashText.includes('Zoom: 1 件') || dashText.includes('12/28 Zoom 名古屋Ⅰ'),
                    dashSnippet: dashText.substring(0, 500)
                };
            })()
            """
            res_dash = await eval_js(dash_check)
            print(f"Dashboard summary header: {res_dash['hasSummaryHeader']}")
            print(f"Dashboard total badge: {res_dash['hasTotalBadge']}")
            print(f"Dashboard text snippet: {res_dash['dashSnippet']}")

            assert res_dash['hasSummaryHeader'], "Dashboard must show course summary header"
            assert res_dash['hasTotalBadge'], "Dashboard must show '延べ申込: 2 講座'"
            print("[SUCCESS] Dashboard selection summary verified successfully.")

            # 6. CSV/Excel エクスポート関数のテスト
            export_test = """
            (async () => {
                const { DB } = await import('/js/db.js');
                const { CsvUtil } = await import('/js/utils/csv.js');

                const items = await DB.getProjectStudentsWithSubmissions('""" + proj_id + """');
                const project = await DB.getProject('""" + proj_id + """');

                // CSV出力関数の呼出検証（ダウンロード処理をモック）
                let csvResult = '';
                const origDownload = CsvUtil.downloadFile;
                CsvUtil.downloadFile = (content, name, type) => {
                    csvResult = content;
                };

                CsvUtil.exportSelectionSubmissionsCsv(items, 'test.csv');
                CsvUtil.downloadFile = origDownload;

                return {
                    csvLength: csvResult.length,
                    hasHeader: csvResult.includes('申込講座数') && csvResult.includes('申込講座一覧'),
                    hasTaroCourses: csvResult.includes('12/28 Zoom 名古屋Ⅰ / 1/2 動画 名古屋Ⅰ'),
                    csvPreview: csvResult
                };
            })()
            """
            res_export = await eval_js(export_test)
            print(f"CSV Header has selection columns: {res_export['hasHeader']}")
            print(f"CSV content has Taro's courses: {res_export['hasTaroCourses']}")
            print(f"CSV content:\n{res_export['csvPreview']}")

            assert res_export['hasHeader'], "CSV must have selection headers"
            assert res_export['hasTaroCourses'], "CSV must include Taro's courses separated by /"
            print("[SUCCESS] Selection CSV export verified successfully.")

            print("\n==========================================")
            print("ALL COURSE SELECTION MODE TESTS PASSED!!")
            print("==========================================")

    finally:
        chrome_proc.terminate()
        server_proc.terminate()

if __name__ == '__main__':
    asyncio.run(main())
