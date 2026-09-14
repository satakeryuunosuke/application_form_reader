import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import websockets
import base64

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

async def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    server_port = 8088
    server_proc = subprocess.Popen([
        sys.executable, '-m', 'http.server', str(server_port)
    ], cwd=repo_root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[DEBUG] Started local HTTP server on port {server_port}")
    await asyncio.sleep(1)

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
        f'http://127.0.0.1:{server_port}/'
    ])

    try:
        await asyncio.sleep(2)
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json') as resp:
            targets = json.loads(resp.read().decode())
            page_target = next((t for t in targets if t.get('type') == 'page'), targets[0])
            ws_url = page_target['webSocketDebuggerUrl']
            print(f"[DEBUG] Connecting to target: {page_target.get('url')} ({page_target.get('title')})")

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
                    await asyncio.sleep(0.2)
                raise TimeoutError(f"Timeout waiting for selector: {sel}")

            await send('Page.enable')
            await send('Runtime.enable')
            await send('Page.navigate', {'url': f'http://127.0.0.1:{server_port}/'})
            await asyncio.sleep(2)

            # 1. ページロード確認 & バージョン確認
            await wait_for_selector('#header-app-version')
            version_text = await eval_js("document.querySelector('#header-app-version').textContent")
            print(f"[CHECK 1] Header App Version: {version_text}")
            assert version_text == 'v1.8.0', f"Expected v1.8.0, got {version_text}"

            # 2. 新規プロジェクトモーダルを開く
            await eval_js("document.querySelector('#btn-new-project').click()")
            await wait_for_selector('#wiz-session')

            # 3. 講習・受講期セレクトボックスの選択肢を検証
            options = await eval_js("""
                Array.from(document.querySelectorAll('#wiz-session option')).map(o => ({
                    value: o.value,
                    text: o.textContent.trim()
                }))
            """)
            print(f"[CHECK 2] Select options: {json.dumps(options, ensure_ascii=False)}")
            expected_options = [
                {'value': '夏期', 'text': '夏期講習'},
                {'value': '冬期', 'text': '冬期講習'},
                {'value': '春期', 'text': '春期講習'},
                {'value': '前期', 'text': '前期'},
                {'value': '後期', 'text': '後期'},
                {'value': '志望校別対策講座', 'text': '志望校別対策講座'},
                {'value': 'その他', 'text': 'その他（自由記述）'}
            ]
            assert options == expected_options, f"Options mismatch: {options} vs {expected_options}"
            print("[CHECK 2 PASS] Options matched perfectly!")

            # 3-2. 「その他」選択時の自由記述欄トグルおよび入力バリデーション検証
            # 初期状態では自由記述欄が非表示であることを確認
            is_custom_visible = await eval_js("document.querySelector('#wiz-session-custom-wrapper').style.display !== 'none'")
            assert not is_custom_visible, "Custom session wrapper should be hidden initially"

            # 「その他」を選択してchangeイベント発火
            await eval_js("""
                const sel = document.querySelector('#wiz-session');
                sel.value = 'その他';
                sel.dispatchEvent(new Event('change'));
            """)
            await asyncio.sleep(0.3)
            is_custom_visible_after = await eval_js("document.querySelector('#wiz-session-custom-wrapper').style.display !== 'none'")
            assert is_custom_visible_after, "Custom session wrapper should be visible after selecting 'その他'"
            print("[CHECK 2-2 PASS] Custom input displayed properly on 'その他'!")

            # 空のまま「次へ」をクリック -> Step 2 に進まずエラー（wiz-sessionがまだ存在）
            await eval_js("document.querySelector('#btn-wiz-next').click()")
            await asyncio.sleep(0.3)
            still_step_1 = await eval_js("document.querySelector('#wiz-session') !== null")
            assert still_step_1, "Should block next step when custom session name is empty"
            print("[CHECK 2-3 PASS] Blocked next step on empty custom session name!")

            # 自由記述を入力して「次へ」をクリック
            await eval_js("""
                const input = document.querySelector('#wiz-session-custom');
                input.value = '難関選抜特訓';
                document.querySelector('#btn-wiz-next').click();
            """)
            await asyncio.sleep(0.5)
            # Step 2 に遷移したか確認（#csv-dropzoneが存在）
            is_step_2 = await eval_js("document.querySelector('#csv-dropzone') !== null")
            assert is_step_2, "Should proceed to Step 2 with valid custom session name"
            print("[CHECK 2-4 PASS] Proceeded to Step 2 with custom session name!")

            # 「戻る」をクリックして Step 1 に戻り、値が復元されているか確認
            await eval_js("document.querySelector('#btn-wiz-prev').click()")
            await asyncio.sleep(0.5)
            restored_sel = await eval_js("document.querySelector('#wiz-session').value")
            restored_custom = await eval_js("document.querySelector('#wiz-session-custom').value")
            assert restored_sel == 'その他', f"Expected selected 'その他', got {restored_sel}"
            assert restored_custom == '難関選抜特訓', f"Expected custom value '難関選抜特訓', got {restored_custom}"
            print("[CHECK 2-5 PASS] Restored custom session name upon returning to Step 1!")

            # 4. モーダルを閉じる
            await eval_js("document.querySelector('.modal-close').click()")
            await asyncio.sleep(0.5)

            # 5. DB.createProject によるプロジェクト生成検証
            # (A) 前期（通常）
            proj_zenki = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    return await DB.createProject({
                        year: 2026,
                        grade: 6,
                        sessionName: '前期',
                        students: [{ nichinokenId: '12345678', name: 'テスト前期', className: 'M1', course: '4科' }]
                    });
                })()
            """)
            print(f"[CHECK 3-A] Created Zenki project: title='{proj_zenki.get('title')}', sessionName='{proj_zenki.get('sessionName')}'")
            assert proj_zenki.get('title') == '2026年度 6年 前期', f"Expected '2026年度 6年 前期', got {proj_zenki.get('title')}"
            assert proj_zenki.get('sessionName') == '前期', f"Expected sessionName '前期', got {proj_zenki.get('sessionName')}"

            # (A-2) 「前期講習」として指定された場合でも「前期」に正規化されることの検証
            proj_zenki_koushu = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    return await DB.createProject({
                        year: 2026,
                        grade: 6,
                        sessionName: '前期講習',
                        students: [{ nichinokenId: '12345677', name: 'テスト前期講習指定', className: 'M2', course: '4科' }]
                    });
                })()
            """)
            print(f"[CHECK 3-A2] Created Zenki project from '前期講習': title='{proj_zenki_koushu.get('title')}', sessionName='{proj_zenki_koushu.get('sessionName')}'")
            assert proj_zenki_koushu.get('title') == '2026年度 6年 前期', f"Expected '2026年度 6年 前期', got {proj_zenki_koushu.get('title')}"
            assert proj_zenki_koushu.get('sessionName') == '前期', f"Expected sessionName '前期', got {proj_zenki_koushu.get('sessionName')}"

            # (B) 後期
            proj_kouki = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    return await DB.createProject({
                        year: 2026,
                        grade: 5,
                        sessionName: '後期',
                        students: [{ nichinokenId: '12345679', name: 'テスト後期', className: 'A1', course: '4科' }]
                    });
                })()
            """)
            print(f"[CHECK 3-B] Created Kouki project: title='{proj_kouki.get('title')}', sessionName='{proj_kouki.get('sessionName')}'")
            assert proj_kouki.get('title') == '2026年度 5年 後期', f"Expected '2026年度 5年 後期', got {proj_kouki.get('title')}"

            # (C) 夏期
            proj_natsu = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    return await DB.createProject({
                        year: 2026,
                        grade: 4,
                        sessionName: '夏期',
                        students: [{ nichinokenId: '12345680', name: 'テスト夏期', className: 'W1', course: '4科' }]
                    });
                })()
            """)
            print(f"[CHECK 3-C] Created Natsu project: title='{proj_natsu.get('title')}', sessionName='{proj_natsu.get('sessionName')}'")
            assert proj_natsu.get('title') == '2026年度 4年 夏期講習', f"Expected '2026年度 4年 夏期講習', got {proj_natsu.get('title')}"

            # (D) 志望校別対策講座
            proj_shibou = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    return await DB.createProject({
                        year: 2026,
                        grade: 6,
                        sessionName: '志望校別対策講座',
                        students: [{ nichinokenId: '12345681', name: 'テスト志望校別', className: 'M1', course: '4科' }]
                    });
                })()
            """)
            print(f"[CHECK 3-D] Created Shibou project: title='{proj_shibou.get('title')}', sessionName='{proj_shibou.get('sessionName')}'")
            assert proj_shibou.get('title') == '2026年度 6年 志望校別対策講座', f"Expected '2026年度 6年 志望校別対策講座', got {proj_shibou.get('title')}"
            assert proj_shibou.get('sessionName') == '志望校別対策講座', f"Expected sessionName '志望校別対策講座', got {proj_shibou.get('sessionName')}"

            # (E) その他（自由記述: 難関選抜特訓）
            proj_custom = await eval_js("""
                (async () => {
                    const { DB } = await import('./js/db.js');
                    return await DB.createProject({
                        year: 2026,
                        grade: 6,
                        sessionName: '難関選抜特訓',
                        students: [{ nichinokenId: '12345682', name: 'テスト自由記述', className: 'M1', course: '4科' }]
                    });
                })()
            """)
            print(f"[CHECK 3-E] Created Custom project: title='{proj_custom.get('title')}', sessionName='{proj_custom.get('sessionName')}'")
            assert proj_custom.get('title') == '2026年度 6年 難関選抜特訓', f"Expected '2026年度 6年 難関選抜特訓', got {proj_custom.get('title')}"
            assert proj_custom.get('sessionName') == '難関選抜特訓', f"Expected sessionName '難関選抜特訓', got {proj_custom.get('sessionName')}"

            # 6. ホーム画面を再描画してプロジェクトカードのバッジを確認
            await eval_js("location.hash = '#home'; location.reload();")
            await wait_for_selector('.project-card')
            await asyncio.sleep(1)

            cards = await eval_js("""
                Array.from(document.querySelectorAll('.project-card')).map(c => ({
                    title: c.querySelector('.project-title')?.textContent.trim(),
                    badges: Array.from(c.querySelectorAll('.badge')).map(b => b.textContent.trim())
                }))
            """)
            print(f"[CHECK 4] Rendered project cards count: {len(cards)}")
            for card in cards:
                print(f"  - {card['title']}: {card['badges']}")

            # 前期カードに「前期」バッジがあり、「前期講習」になっていないことを確認
            zenki_card = next((c for c in cards if '前期' in c['title']), None)
            assert zenki_card is not None, "Zenki card not found!"
            assert '前期' in zenki_card['badges'], f"Expected '前期' in badges, got {zenki_card['badges']}"
            assert '前期講習' not in zenki_card['badges'], "Badge should NOT be '前期講習'!"

            # 夏期カードに「夏期講習」バッジがあることを確認
            natsu_card = next((c for c in cards if '夏期' in c['title']), None)
            assert natsu_card is not None, "Natsu card not found!"
            assert '夏期講習' in natsu_card['badges'], f"Expected '夏期講習' in badges, got {natsu_card['badges']}"

            # 志望校別対策講座カードに「志望校別対策講座」バッジがあることを確認
            shibou_card = next((c for c in cards if '志望校別対策講座' in c['title']), None)
            assert shibou_card is not None, "Shibou card not found!"
            assert '志望校別対策講座' in shibou_card['badges'], f"Expected '志望校別対策講座' in badges, got {shibou_card['badges']}"

            # 自由記述カードに「難関選抜特訓」バッジがあることを確認
            custom_card = next((c for c in cards if '難関選抜特訓' in c['title']), None)
            assert custom_card is not None, "Custom card not found!"
            assert '難関選抜特訓' in custom_card['badges'], f"Expected '難関選抜特訓' in badges, got {custom_card['badges']}"

            # 7. 志望校別対策講座プロジェクトの詳細画面へ遷移し、ヘッダーバッジを確認
            await eval_js(f"location.hash = '#project/{proj_shibou['id']}';")
            await wait_for_selector('.project-header-bar')
            await asyncio.sleep(0.5)

            proj_header_badges = await eval_js("""
                Array.from(document.querySelectorAll('.project-header-bar .badge')).map(b => b.textContent.trim())
            """)
            print(f"[CHECK 5] Project header badges: {proj_header_badges}")
            assert '志望校別対策講座' in proj_header_badges, f"Expected '志望校別対策講座' in project header, got {proj_header_badges}"

            # 8. スクリーンショット保存
            # ホームに戻って新規作成モーダルを開き、「その他」を選択して自由記述欄を表示させた状態のスクリーンショットを保存
            await eval_js("location.hash = '#home';")
            await wait_for_selector('#btn-new-project')
            await asyncio.sleep(0.5)
            await eval_js("document.querySelector('#btn-new-project').click()")
            await wait_for_selector('#wiz-session')
            # その他を選択して入力
            await eval_js("""
                const sel = document.querySelector('#wiz-session');
                sel.value = 'その他';
                sel.dispatchEvent(new Event('change'));
                const inp = document.querySelector('#wiz-session-custom');
                inp.value = '志望校別特訓';
            """)
            await asyncio.sleep(0.5)

            ss = await send('Page.captureScreenshot', {'format': 'png'})
            ss_data = base64.b64decode(ss['data'])
            os.makedirs('scratch', exist_ok=True)
            with open('scratch/verify_session_options.png', 'wb') as f:
                f.write(ss_data)
            print("[CHECK 6] Screenshot saved to scratch/verify_session_options.png")

            # モーダルを閉じてホーム画面全体のスクリーンショット保存
            await eval_js("document.querySelector('.modal-close').click()")
            await asyncio.sleep(0.5)
            ss_home = await send('Page.captureScreenshot', {'format': 'png'})
            with open('scratch/home_zenki.png', 'wb') as f:
                f.write(base64.b64decode(ss_home['data']))
            print("[CHECK 7] Screenshot saved to scratch/home_zenki.png")

            # プロジェクト詳細画面のスクリーンショット保存
            await eval_js(f"location.hash = '#project/{proj_zenki['id']}';")
            await wait_for_selector('.project-header-bar')
            await asyncio.sleep(0.5)
            ss_proj = await send('Page.captureScreenshot', {'format': 'png'})
            with open('scratch/project_zenki.png', 'wb') as f:
                f.write(base64.b64decode(ss_proj['data']))
            print("[CHECK 8] Screenshot saved to scratch/project_zenki.png")

            print("\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")

    finally:
        chrome_proc.terminate()
        server_proc.terminate()

if __name__ == '__main__':
    asyncio.run(main())
