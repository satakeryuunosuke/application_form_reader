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
    port_cdp = 9225

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
            assert app_ver == 'v1.17.0', f"Expected v1.17.0, got {app_ver}"

            # 2. テスト用プロジェクトと生徒の作成
            proj = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    const { CsvUtil } = await import('./js/utils/csv.js');

                    const csvContent = "日能研番号,氏名,フリガナ,クラス,科目\\nBATCH001,バッチ太郎,バッチタロウ,M1,4科\\nBATCH002,バッチ次郎,バッチジロウ,M1,4科\\nBATCH003,バッチ三郎,バッチサブロウ,A1,2科";
                    const parsed = CsvUtil.parseStudentsCsv(csvContent);

                    const p = await DB.createProject({
                        title: 'バッチアップロード検証用講習',
                        year: 2026,
                        grade: 6,
                        sessionName: '夏期',
                        projectType: 'regular',
                        students: parsed.students
                    });
                    return p.id;
                })()
            """)
            print("2. Project created:", proj)
            project_id = proj
            assert project_id is not None

            # 3. バッチモード開始 & saveSubmission テスト
            batch_test = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const {{ SyncManager }} = await import('./js/sync/sync-manager.js');
                    const {{ PendingQueue }} = await import('./js/sync/pending-queue.js');

                    // キューをクリア
                    await PendingQueue.clear();

                    // バッチモード開始
                    SyncManager.startBatchMode();
                    const isBatchBefore = SyncManager.isBatchMode();

                    // 生徒3人分を連続保存（スキャンの承認ループを模倣）
                    const students = await DB.getProjectStudentsWithSubmissions('{project_id}');
                    for (let i = 0; i < students.length; i++) {{
                        const s = students[i];
                        await DB.saveSubmission(s.submissionId, {{
                            status: '承認済',
                            hasChange: i % 2 === 1,
                            enrollmentClass: s.className,
                            enrollmentCourse: s.course,
                            inputMethod: 'スキャン',
                            approvedBy: 'テスト承認者'
                        }});
                    }}

                    // 未送信キューの件数を取得
                    const pendingCount = await PendingQueue.getPendingCount();

                    return JSON.stringify({{
                        isBatchBefore,
                        pendingCount
                    }});
                }})()
            """)
            print("3. Batch submission result:", batch_test)
            assert batch_test['isBatchBefore'] is True, "Batch mode should be active"
            assert batch_test['pendingCount'] == 3, f"Expected 3 pending events, got {batch_test['pendingCount']}"

            # 4. バッチ終了 & 進捗リスナー + バックグラウンドフラッシュのテスト
            flush_test = await eval_js("""
                (async () => {
                    const { SyncManager } = await import('./js/sync/sync-manager.js');
                    const { PendingQueue } = await import('./js/sync/pending-queue.js');

                    const eventsReceived = [];
                    const progressHandler = (p) => {
                        eventsReceived.push({ type: p.type, current: p.current, total: p.total, flushed: p.flushed });
                    };
                    SyncManager.addProgressListener(progressHandler);

                    // endBatchMode を呼び出す
                    SyncManager.endBatchMode({ flush: false });
                    const isBatchAfter = SyncManager.isBatchMode();

                    // 擬似的な writeFn で PendingQueue.flush の onProgress 挙動を検証
                    const writtenEvents = [];
                    const flushRes = await PendingQueue.flush(
                        async (pId, ev) => {
                            writtenEvents.push({ pId, eventId: ev.eventId });
                            return true; // 成功を返す
                        },
                        (prog) => {
                            progressHandler({
                                type: 'progress',
                                current: prog.current,
                                total: prog.total,
                                flushed: prog.flushed,
                                failed: prog.failed
                            });
                        }
                    );

                    SyncManager.removeProgressListener(progressHandler);
                    const remainingPending = await PendingQueue.getPendingCount();

                    return JSON.stringify({
                        isBatchAfter,
                        flushRes,
                        writtenCount: writtenEvents.length,
                        remainingPending,
                        eventsReceived
                    });
                })()
            """)
            print("4. Flush test result:", flush_test)
            assert flush_test['isBatchAfter'] is False, "Batch mode should be inactive after endBatchMode"
            assert flush_test['writtenCount'] == 3, f"Expected 3 written events, got {flush_test['writtenCount']}"
            assert flush_test['remainingPending'] == 0, f"Expected 0 remaining pending events, got {flush_test['remainingPending']}"
            assert len(flush_test['eventsReceived']) == 3, f"Expected 3 progress events, got {len(flush_test['eventsReceived'])}"
            print("   Progress events:", flush_test['eventsReceived'])

            # 5. ScanPage の完了画面レンダリングテスト
            page_render_test = await eval_js(f"""
                (async () => {{
                    const {{ DB }} = await import('./js/db.js');
                    const {{ ScanPage }} = await import('./js/pages/scan.js');
                    const p = await DB.getProject('{project_id}');

                    const container = document.createElement('div');
                    container.id = 'test-scan-container';
                    document.body.appendChild(container);

                    ScanPage.container = container;
                    ScanPage.project = p;
                    ScanPage.pendingQueue = [
                        {{ pageNum: 1, approved: true }},
                        {{ pageNum: 2, approved: true }}
                    ];
                    ScanPage.currentIndex = 2; // 全件完了状態

                    await ScanPage.renderApprovalView();

                    const syncCard = container.querySelector('#scan-sync-card');
                    const btnReUpload = container.querySelector('#btn-re-upload');
                    const btnGoList = container.querySelector('#btn-go-list');

                    const result = {{
                        hasSyncCard: !!syncCard,
                        syncCardText: syncCard ? syncCard.innerText.trim().replace(/\\s+/g, ' ') : '',
                        hasReUploadBtn: !!btnReUpload,
                        hasGoListBtn: !!btnGoList
                    }};

                    container.remove();
                    return JSON.stringify(result);
                }})()
            """)
            print("5. ScanPage completion view render test:", page_render_test)
            assert page_render_test['hasSyncCard'] is True, "Sync card should be rendered"
            assert page_render_test['hasReUploadBtn'] is True, "Re-upload button should be rendered"
            assert page_render_test['hasGoListBtn'] is True, "Go-list button should be rendered"

            print("\n========================================================")
            print("🎉 ALL TESTS PASSED SUCCESSFULLY! (v1.17.0 verified)")
            print("========================================================")

    finally:
        chrome_proc.terminate()
        chrome_proc.wait()

if __name__ == '__main__':
    asyncio.run(main())
