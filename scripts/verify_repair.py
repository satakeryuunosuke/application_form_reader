import asyncio
import os
import tempfile
import subprocess
import urllib.request
import json
import websockets

async def test_autorepair():
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    port = 9336
    user_data_dir = tempfile.mkdtemp()
    proc = subprocess.Popen([
        chrome_path, '--headless=new', '--disable-gpu',
        f'--remote-debugging-port={port}', f'--user-data-dir={user_data_dir}',
        'http://localhost:8000/'
    ])
    try:
        await asyncio.sleep(2)
        with urllib.request.urlopen(f'http://localhost:{port}/json') as resp:
            targets = json.loads(resp.read().decode())
            # Find page target for http://localhost:8000/
            page_target = [t for t in targets if t.get('type') == 'page'][0]
            ws_url = page_target['webSocketDebuggerUrl']
        async with websockets.connect(ws_url) as ws:
            msg_id = 0
            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                payload = {'id': msg_id, 'method': method}
                if params: payload['params'] = params
                await ws.send(json.dumps(payload))
                while True:
                    res = json.loads(await ws.recv())
                    if res.get('id') == msg_id: return res.get('result', {})

            async def eval_js(expr):
                r = await send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
                if 'exceptionDetails' in r:
                    print('JS EXCEPTION:', r['exceptionDetails'])
                return r.get('result', {}).get('value')

            await send('Page.navigate', {'url': 'http://localhost:8000/'})
            await asyncio.sleep(1.5)

            # Test: insert a student with katakana name
            code = """
            (async () => {
                const { DB, db } = await import('./js/db.js');
                const pId = 'proj_test_repair_' + Date.now();
                await db.projects.add({ id: pId, name: 'テスト修復', status: '進行中' });
                const stuId = 'stu_repair_1';
                await db.students.add({
                    id: stuId,
                    projectId: pId,
                    nichinokenId: 'TDN60013',
                    name: 'ニチノウケンタロウ',
                    nameKana: 'ニチノウケンタロウ',
                    className: 'W1',
                    course: '4科'
                });
                await db.submissions.add({
                    id: 'sub_repair_1',
                    projectId: pId,
                    studentId: stuId,
                    status: '未提出',
                    hasChange: false
                });

                // Call getProjectStudentsWithSubmissions
                const result = await DB.getProjectStudentsWithSubmissions(pId);
                const repairedStudent = await db.students.get(stuId);

                // Also test CSV UPSERT
                const csvData = [
                    { nichinokenId: 'TDN60013', name: '日能研太郎新', nameKana: 'ニチノウケンタロウシン', className: 'M1', course: '2科' },
                    { nichinokenId: 'TDN60026', name: '日能研花子新', nameKana: 'ニチノウケンハナコシン', className: 'W2', course: '4科' }
                ];
                const upsertRes = await DB.addStudentsBulkToProject(pId, csvData);
                const afterUpsert = await db.students.get(stuId);

                return {
                    inMemoryName: result[0].name,
                    inMemoryKana: result[0].nameKana,
                    dbName: repairedStudent.name,
                    dbKana: repairedStudent.nameKana,
                    upsertRes,
                    afterUpsertName: afterUpsert.name,
                    afterUpsertClass: afterUpsert.className,
                    afterUpsertCourse: afterUpsert.course
                };
            })()
            """
            res = await eval_js(code)
            print('Test result:', json.dumps(res, ensure_ascii=False, indent=2))
            assert res['inMemoryName'] == '日能研太郎'
            assert res['dbName'] == '日能研太郎'
            assert res['afterUpsertName'] == '日能研太郎新'
            assert res['afterUpsertClass'] == 'M1'
            assert res['afterUpsertCourse'] == '2科'
            assert res['upsertRes']['updatedCount'] == 1
            assert res['upsertRes']['addedCount'] == 1
            print('[PASS] AUTO-REPAIR & CSV UPSERT TESTS PASSED PERFECTLY!')
    finally:
        proc.kill()

if __name__ == '__main__':
    asyncio.run(test_autorepair())
