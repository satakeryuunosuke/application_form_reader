import asyncio
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import websockets
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    user_data_dir = tempfile.mkdtemp()
    port = 9223

    chrome_proc = subprocess.Popen([
        chrome_path,
        '--headless=new',
        '--disable-gpu',
        f'--remote-debugging-port={port}',
        f'--user-data-dir={user_data_dir}',
        '--window-size=1280,950',
        'http://127.0.0.1:8085/'
    ])

    try:
        await asyncio.sleep(2)
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json') as resp:
            targets = json.loads(resp.read().decode())
            target = next(t for t in targets if '8085' in t.get('url', ''))
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

            # ページ読み込み待機
            await asyncio.sleep(1)

            # プロジェクト一覧があるか確認、なければ作成
            setup_res = await eval_js("""
            (async () => {
                try {
                    const { DB } = await import('./js/db.js');
                    await DB.init();
                    let projects = await DB.getProjects();
                    if (!projects || projects.length === 0) {
                        const p = await DB.createProject({
                            year: 2026,
                            grade: 5,
                            sessionName: '夏期',
                            students: [{
                                nichinokenId: 'N1234567',
                                name: '日能研 花子',
                                nameKana: 'ニチノウケン ハナコ',
                                className: 'M1'
                            }]
                        });
                        projects = [p];
                    }
                    const proj = projects[0];
                    return { projectId: proj.id };
                } catch(e) {
                    return { error: e.message, stack: e.stack };
                }
            })()
            """)
            print("Setup result:", setup_res)
            proj_id = setup_res['projectId']

            # プロジェクト詳細の手動登録タブへ遷移
            await eval_js(f"""
            (() => {{
                window.location.hash = '#project/{proj_id}/manual';
            }})()
            """)
            await asyncio.sleep(1.5)

            # 手動登録タブがレンダリングされたか確認
            inp_exists = await eval_js("!!document.querySelector('#man-inp-search-student')")
            print("Search input exists:", inp_exists)

            # 1. 検索入力テスト (氏名漢字)
            search1 = await eval_js("""
            (() => {
                const inp = document.querySelector('#man-inp-search-student');
                inp.value = '花子';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                const items = document.querySelectorAll('.student-search-item');
                return { count: items.length, text: items[0]?.innerText };
            })()
            """)
            print("Search 1 (漢字 '花子'):", search1)

            # 2. 検索入力テスト (ひらがな)
            search2 = await eval_js("""
            (() => {
                const inp = document.querySelector('#man-inp-search-student');
                inp.value = 'はなこ';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                const items = document.querySelectorAll('.student-search-item');
                return { count: items.length, text: items[0]?.innerText };
            })()
            """)
            print("Search 2 (ひらがな 'はなこ'):", search2)

            # 3. 検索入力テスト (ID)
            search3 = await eval_js("""
            (() => {
                const inp = document.querySelector('#man-inp-search-student');
                inp.value = '1234';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                const items = document.querySelectorAll('.student-search-item');
                return { count: items.length, text: items[0]?.innerText };
            })()
            """)
            print("Search 3 (ID '1234'):", search3)

            # 4. 生徒を選択クリック
            click_res = await eval_js("""
            (() => {
                const item = document.querySelector('.student-search-item');
                if (item) item.click();
                const dispName = document.querySelector('#man-disp-name')?.innerText;
                const dispId = document.querySelector('#man-disp-id')?.innerText;
                const isCardVisible = !document.querySelector('#man-selected-student-card')?.classList.contains('hidden');
                return { dispName, dispId, isCardVisible };
            })()
            """)
            print("Select result:", click_res)

            # 5. 受付担当者を選択して保存テスト
            save_res = await eval_js("""
            (async () => {
                const staffSel = document.querySelector('#man-sel-staff');
                if (staffSel && staffSel.options.length > 1) {
                    staffSel.selectedIndex = 1;
                    staffSel.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const saveBtn = document.querySelector('#btn-save-manual');
                saveBtn.click();
                await new Promise(r => setTimeout(r, 600));
                
                const { DB } = await import('./js/db.js');
                const students = await DB.getProjectStudentsWithSubmissions('""" + proj_id + """');
                const stu = students.find(s => s.nichinokenId === 'N1234567');
                return {
                    savedStatus: stu?.status,
                    approvedBy: stu?.approvedBy,
                    inputMethod: stu?.inputMethod
                };
            })()
            """)
            print("Save result:", save_res)

            # 判定
            if (search1['count'] > 0 and search2['count'] > 0 and search3['count'] > 0 and 
                click_res['isCardVisible'] and save_res.get('savedStatus') == '承認済'):
                print("SUCCESS: All student search and save tests passed!")
            else:
                print("FAILURE: Some checks did not pass.")

    finally:
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=2)
        except:
            chrome_proc.kill()

if __name__ == '__main__':
    asyncio.run(main())
