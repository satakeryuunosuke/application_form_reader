import asyncio
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import websockets
import sys
import base64
import http.server
import socketserver
import threading

sys.stdout.reconfigure(encoding='utf-8')

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def start_server(port):
    handler = QuietHandler
    httpd = socketserver.TCPServer(("", port), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd

async def main():
    port_http = 8089
    httpd = start_server(port_http)
    print(f"HTTP Server started on port {port_http}")

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port_cdp = 9224

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
                        return res.get('result', {})

            async def eval_js(expr):
                r = await send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
                val = r.get('result', {}).get('value')
                return val

            await asyncio.sleep(1)

            # 1. CsvUtil.parseStudentsCsv のユニットテスト検証
            test_csv = (
                "日能研番号,氏名,氏名カナ,クラス,科目\\n"
                "TDN60013,テスト一郎,テストイチロウ,W1,4科\\n"
                "TDN60026,テスト二郎,テストジロウ,W1,2科\\n"
                "TDN60039,テスト三郎,テストサブロウ,M1,4\\n"
                "TDN60052,テスト四郎,テストシロウ,M2,\\n"
            )
            parsed = await eval_js(f"""
                (async () => {{
                    const {{ CsvUtil }} = await import('./js/utils/csv.js');
                    return CsvUtil.parseStudentsCsv(`{test_csv}`);
                }})()
            """)
            print("CSV Parse Result:", json.dumps(parsed, ensure_ascii=False))
            assert len(parsed['students']) == 4
            assert parsed['students'][0]['course'] == '4科'
            assert parsed['students'][1]['course'] == '2科'
            assert parsed['students'][2]['course'] == '4科'  # '4' -> '4科'
            assert parsed['students'][3]['course'] == '4科'  # 空欄 -> デフォルト '4科'
            print("✓ CsvUtil.parseStudentsCsv Unit Test Passed!")

            # 2. テスト用プロジェクトをDBに作成して検証
            proj = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const {{ CsvUtil }} = await import('./js/utils/csv.js');
                    const parsed = CsvUtil.parseStudentsCsv(`{test_csv}`);
                    const p = await DB.createProject({{
                        year: 2026,
                        grade: 6,
                        sessionName: '夏期',
                        students: parsed.students
                    }});
                    return p;
                }})()
            """)
            project_id = proj['id']
            print(f"Created test project: {project_id}")

            # 3. 生徒一覧 & 初期受講データの検証
            students_data = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    return await DB.getProjectStudentsWithSubmissions('{project_id}');
                }})()
            """)
            print(f"Loaded {len(students_data)} students with submissions")
            print("Student 0:", json.dumps(students_data[0], ensure_ascii=False))
            print("Student 1:", json.dumps(students_data[1], ensure_ascii=False))
            s_13 = next(x for x in students_data if x['nichinokenId'] == 'TDN60013')
            s_26 = next(x for x in students_data if x['nichinokenId'] == 'TDN60026')
            assert s_13['course'] == '4科'
            assert s_26['course'] == '2科'
            assert s_13['enrollmentCourse'] == '-' # 未提出なので'-'
            print("✓ Initial students and submission structure confirmed!")

            # 4. 手動登録で「変更なし」の登録検証（4科の生徒、2科の生徒）
            # テスト一郎 (TDN60013, 4科) を「変更なし」で保存
            sub1_res = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const students = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    const s = students.find(x => x.nichinokenId === 'TDN60013');
                    await DB.saveSubmission(s.submissionId, {{
                        status: '承認済',
                        hasChange: false,
                        enrollmentClass: s.className,
                        enrollmentCourse: s.course,
                        inputMethod: '口頭',
                        approvedBy: '山田 太郎',
                        remarks: '変更なしテスト'
                    }});
                    const updated = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    return updated.find(x => x.nichinokenId === 'TDN60013');
                }})()
            """)
            assert sub1_res['status'] == '承認済'
            assert sub1_res['enrollmentClass'] == 'W1'
            assert sub1_res['enrollmentCourse'] == '4科'
            print("✓ No-change submission saved with course '4科':", sub1_res['enrollmentCourse'])

            # 5. 手動登録で「変更あり」の登録検証（2科の生徒を4科へ変更、かつ別クラスM1へ変更）
            # テスト二郎 (TDN60026, W1, 2科)
            sub2_res = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const students = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    const s = students.find(x => x.nichinokenId === 'TDN60026');
                    await DB.saveSubmission(s.submissionId, {{
                        status: '承認済',
                        hasChange: true,
                        enrollmentClass: 'M1',
                        enrollmentCourse: '4科',
                        inputMethod: '電話',
                        approvedBy: '佐藤 花子',
                        remarks: 'クラス変更および2科から4科へ変更'
                    }});
                    const updated = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    return updated.find(x => x.nichinokenId === 'TDN60026');
                }})()
            """)
            assert sub2_res['status'] == '承認済'
            assert sub2_res['hasChange'] == True
            assert sub2_res['className'] == 'W1'
            assert sub2_res['course'] == '2科'
            assert sub2_res['enrollmentClass'] == 'M1'
            assert sub2_res['enrollmentCourse'] == '4科'
            print("✓ Has-change submission (W1 2科 -> M1 4科) verified:", sub2_res['enrollmentClass'], sub2_res['enrollmentCourse'])

            # 6. クラスはそのままで科目のみ変更（4科 -> 2科）の登録検証
            # テスト三郎 (TDN60039, M1, 4科)
            sub3_res = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const students = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    const s = students.find(x => x.nichinokenId === 'TDN60039');
                    await DB.saveSubmission(s.submissionId, {{
                        status: '承認済',
                        hasChange: true,
                        enrollmentClass: s.className, // クラス変更なし (M1)
                        enrollmentCourse: '2科',       // 科目のみ変更 (4科 -> 2科)
                        inputMethod: 'メール・連絡帳',
                        approvedBy: '鈴木 一郎',
                        remarks: '算国2科受講を希望'
                    }});
                    const updated = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    return updated.find(x => x.nichinokenId === 'TDN60039');
                }})()
            """)
            assert sub3_res['hasChange'] == True
            assert sub3_res['className'] == 'M1'
            assert sub3_res['course'] == '4科'
            assert sub3_res['enrollmentClass'] == 'M1'
            assert sub3_res['enrollmentCourse'] == '2科'
            print("✓ Course-only change (M1 4科 -> M1 2科) verified:", sub3_res['enrollmentClass'], sub3_res['enrollmentCourse'])

            # 7. 非受講の登録検証
            # テスト四郎 (TDN60052)
            sub4_res = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const students = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    const s = students.find(x => x.nichinokenId === 'TDN60052');
                    await DB.saveSubmission(s.submissionId, {{
                        status: '承認済',
                        hasChange: true,
                        enrollmentClass: '非受講',
                        enrollmentCourse: '非受講',
                        inputMethod: '電話',
                        approvedBy: '山田 太郎',
                        remarks: '夏期不参加'
                    }});
                    const updated = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    return updated.find(x => x.nichinokenId === 'TDN60052');
                }})()
            """)
            assert sub4_res['enrollmentClass'] == '非受講'
            assert sub4_res['enrollmentCourse'] == '非受講'
            print("✓ Not enrolled verified:", sub4_res['enrollmentClass'], sub4_res['enrollmentCourse'])

            # 8. 生徒管理での1名手動追加 (2科) の検証
            add_res = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    return await DB.addStudentToProject('{project_id}', {{
                        nichinokenId: 'TDN60065',
                        name: '追加 五郎',
                        nameKana: 'ツイカ ゴロウ',
                        className: 'W2',
                        course: '2科'
                    }});
                }})()
            """)
            assert add_res['course'] == '2科'
            print("✓ 1 student manually added with course '2科':", add_res['name'], add_res['course'])

            # 9. ListPage のレンダリングとフィルタ機能検証
            await eval_js(f"""
                (async () => {{
                    window.location.hash = '#project/{project_id}';
                }})()
            """)
            await asyncio.sleep(1)

            # リストタブをクリック
            await eval_js("""
                document.querySelector('.tab-btn[data-tab="list"]').click();
            """)
            await asyncio.sleep(1)

            # テーブル行数を取得
            rowCount = await eval_js("""
                document.querySelectorAll('#table-render-area tbody tr').length
            """)
            print(f"ListPage table rendered rows: {rowCount}")
            assert rowCount == 5

            # リスト画面のUIスクリーンショットを保存
            os.makedirs('output', exist_ok=True)
            shot_res = await send('Page.captureScreenshot', {'format': 'png'})
            with open('output/list_ui_smart.png', 'wb') as f:
                f.write(base64.b64decode(shot_res['data']))
            print("Captured output/list_ui_smart.png successfully")

            # 前科目フィルタ (2科) で絞り込み
            await eval_js("""
                const sel = document.querySelector('#sel-filter-prev-course');
                sel.value = '2科';
                sel.dispatchEvent(new Event('change'));
            """)
            await asyncio.sleep(0.5)
            filtered_prev2 = await eval_js("""
                document.querySelectorAll('#table-render-area tbody tr').length
            """)
            print(f"Filtered by prevCourse '2科': {filtered_prev2} rows")
            # 2科だった生徒: テスト二郎, 追加五郎 -> 2名
            assert filtered_prev2 == 2

            # 後科目フィルタ (4科) で絞り込み（前科目はすべてに戻す）
            await eval_js("""
                document.querySelector('#sel-filter-prev-course').value = 'all';
                document.querySelector('#sel-filter-prev-course').dispatchEvent(new Event('change'));
                const selPost = document.querySelector('#sel-filter-post-course');
                selPost.value = '4科';
                selPost.dispatchEvent(new Event('change'));
            """)
            await asyncio.sleep(0.5)
            filtered_post4 = await eval_js("""
                document.querySelectorAll('#table-render-area tbody tr').length
            """)
            print(f"Filtered by postCourse '4科': {filtered_post4} rows")
            # 確定受講4科の生徒: テスト一郎 (変更なし4科), テスト二郎 (2科->4科へ変更) -> 2名
            assert filtered_post4 == 2

            # 履歴モーダルを開いて確認
            await eval_js("""
                document.querySelectorAll('.btn-view-history')[0].click();
            """)
            await asyncio.sleep(0.5)
            history_title = await eval_js("""
                document.querySelector('.modal-title')?.textContent
            """)
            print("History Modal opened:", history_title)
            assert "受講確認・変更履歴" in history_title

            # モーダルを閉じる
            await eval_js("""
                document.querySelector('.btn-close-modal')?.click();
            """)
            await asyncio.sleep(0.5)

            # 10. 手動登録画面 (manual tab) でのUI検証
            await eval_js("""
                document.querySelector('.tab-btn[data-tab="manual"]').click();
            """)
            await asyncio.sleep(1)

            # テスト一郎を選択
            await eval_js("""
                const searchInp = document.querySelector('#man-inp-search-student');
                searchInp.value = 'TDN60013';
                searchInp.dispatchEvent(new Event('input'));
            """)
            await asyncio.sleep(0.5)

            # 検索結果をクリック
            await eval_js("""
                document.querySelector('.student-search-item').click();
            """)
            await asyncio.sleep(0.5)

            dispCourse = await eval_js("""
                document.querySelector('#man-disp-course')?.textContent
            """)
            print("Manual page selected student course display:", dispCourse)
            assert dispCourse == '4科'

            # 「変更あり」を選択し、変更先科目セレクトが存在することを確認
            await eval_js("""
                document.querySelector('#man-card-has-change').click();
            """)
            has_course_select = await eval_js("""
                (() => {
                    const sel = document.querySelector('#man-sel-change-course');
                    return sel !== null && sel.options.length === 2 && !sel.disabled;
                })()
            """)
            assert has_course_select == True
            print("✓ Manual page course selection UI active on 'has-change'!")

            print("\n=======================================================")
            print("ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY!!")
            print("=======================================================")

    finally:
        chrome_proc.terminate()
        httpd.shutdown()

if __name__ == '__main__':
    asyncio.run(main())
