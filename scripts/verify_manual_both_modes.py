import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8098

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def run_server():
    os.chdir(r"c:\Users\sd23048\application_form_reader")
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        httpd.serve_forever()

def main():
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    time.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    print(f"Using browser at {chrome_path}")

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome_path, headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        page.goto(f"http://127.0.0.1:{PORT}/#home")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        # テスト実行: 通常モードと講座選択モードのプロジェクトを作成し、手動登録画面をテスト
        result = page.evaluate("""
        async () => {
            try {
            const { DB } = await import('/js/db.js');
            const now = Date.now();

            // 1. 通常モード（受講確認モード）プロジェクト
            const standardProj = await DB.createProject({
                year: '2026',
                grade: '6',
                sessionName: '夏期',
                projectType: 'confirmation',
                students: [
                    { nichinokenId: 'STD1001', name: '標準 太郎', nameKana: 'ヒョウジュンタロウ', className: 'M1', course: '4科' }
                ]
            });

            // 2. 講座選択モードプロジェクト
            const selectionProj = await DB.createProject({
                year: '2026',
                grade: '6',
                sessionName: '志望校別対策講座',
                projectType: 'selection',
                scanTemplate: {
                    customBoxes: [
                        { id: 'box_1', label: '12/28 特講A（Zoom）' }
                    ]
                },
                students: [
                    { nichinokenId: 'SEL2001', name: '選抜 花子', nameKana: 'センバツハナコ', className: 'A1', course: '4科' }
                ]
            });

            const { ManualPage } = await import('/js/pages/manual.js');
            const mount = document.createElement('div');
            document.body.appendChild(mount);

            // 通常モード手動登録テスト
            await ManualPage.render(mount, standardProj);
            const standardHasContinuous = !!mount.querySelector('#chk-man-continuous');

            // 生徒選択（Enterキー即時確定）
            const stdSearch = mount.querySelector('#man-inp-search-student');
            stdSearch.value = 'STD1001';
            stdSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            // 保存
            const stdStaff = mount.querySelector('#man-sel-staff');
            if (stdStaff && stdStaff.options.length > 1) {
                stdStaff.value = stdStaff.options[1].value;
                stdStaff.dispatchEvent(new Event('change'));
            }
            const stdSaveBtn = mount.querySelector('#btn-save-manual');
            stdSaveBtn.click();
            await new Promise(r => setTimeout(r, 600));

            const standardHashAfter = window.location.hash;

            // 講座選択モード手動登録テスト
            await ManualPage.render(mount, selectionProj);
            const selectionHasContinuous = !!mount.querySelector('#chk-man-continuous');

            // 生徒選択（Enterキー即時確定）
            const selSearch = mount.querySelector('#man-inp-search-student');
            selSearch.value = 'SEL2001';
            selSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            // 講座を1つチェック
            const selChk = mount.querySelector('.chk-man-custom-box-item');
            if (selChk) {
                selChk.checked = true;
                selChk.dispatchEvent(new Event('change'));
            }

            // 保存
            const selStaff = mount.querySelector('#man-sel-staff');
            if (selStaff && selStaff.options.length > 1) {
                selStaff.value = selStaff.options[1].value;
                selStaff.dispatchEvent(new Event('change'));
            }
            const selSaveBtn = mount.querySelector('#btn-save-manual');
            selSaveBtn.click();
            await new Promise(r => setTimeout(r, 600));

            const selectionHashAfter = window.location.hash;

            // クリーンアップ
            await DB.deleteProject(standardProj.id);
            await DB.deleteProject(selectionProj.id);
            mount.remove();

            return JSON.stringify({
                standardHasContinuous: Boolean(standardHasContinuous),
                standardHashAfter: String(standardHashAfter),
                selectionHasContinuous: Boolean(selectionHasContinuous),
                selectionHashAfter: String(selectionHashAfter),
                standardId: standardProj.id,
                selectionId: selectionProj.id
            });
            } catch(e) {
                return JSON.stringify({ error: e.message, stack: e.stack });
            }
        }
        """)
        import json
        result = json.loads(result)

        print(f"Test Result: {result}")
        assert result['standardHasContinuous'] == False, "Standard mode continuous checkbox must be absent"
        assert result['standardHashAfter'] == f"#project/{result['standardId']}/list", f"Expected #project/{result['standardId']}/list, got {result['standardHashAfter']}"
        assert result['selectionHasContinuous'] == False, "Selection mode continuous checkbox must be absent"
        assert result['selectionHashAfter'] == f"#project/{result['selectionId']}/list", f"Expected #project/{result['selectionId']}/list, got {result['selectionHashAfter']}"

        browser.close()

    print("✅ All manual mode tests passed successfully!")

if __name__ == "__main__":
    main()
