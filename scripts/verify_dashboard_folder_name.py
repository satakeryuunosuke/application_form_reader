import os
import sys
import time
import http.server
import socketserver
import threading
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8097
BASE_URL = f"http://127.0.0.1:{PORT}"

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def run_server():
    try:
        os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
            httpd.serve_forever()
    except Exception:
        pass

def test_dashboard_folder_name():
    # サーバー起動
    t = threading.Thread(target=run_server, daemon=True)
    t.start()
    time.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome_path, headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        print("[1] Opening app index...")
        page.goto(f"{BASE_URL}/index.html")
        page.wait_for_selector("#header-app-version")

        # バージョン検証
        ver = page.locator("#header-app-version").text_content().strip()
        print(f"  Header app version: {ver}")
        assert ver == "v1.15.0", f"Expected v1.15.0, got {ver}"

        # テストプロジェクト作成
        print("[2] Creating test project...")
        proj_data = page.evaluate("""
        async () => {
            const { DB } = await import('./js/db.js');
            const p = await DB.createProject({
                year: 2026,
                grade: 6,
                sessionName: '前期',
                students: [
                    { nichinokenId: 'TDN60001', name: '日能研 太郎', className: '6A', course: '4科' }
                ]
            });
            return p;
        }
        """)
        proj_id = proj_data['id']
        print(f"  Created Project ID: {proj_id}")
        assert proj_id.startswith('proj_'), f"Expected project ID to start with 'proj_', got {proj_id}"

        # 管理ダッシュボードへ遷移
        print("[3] Navigating to dashboard...")
        page.evaluate(f"window.location.hash = '#project/{proj_id}/dashboard';")
        page.wait_for_selector(".dashboard-folder-info-card")
        page.wait_for_selector("#dash-project-folder-name")

        # フォルダ名表示検証
        displayed_folder = page.locator("#dash-project-folder-name").text_content().strip()
        print(f"  Displayed folder name in card: {displayed_folder}")
        assert displayed_folder == proj_id, f"Expected {proj_id}, got {displayed_folder}"

        # コピーボタン検証
        print("[4] Testing copy button...")
        copy_btn = page.locator("#btn-copy-folder-name")
        assert copy_btn.is_visible(), "Copy button should be visible"
        copy_btn.click()
        page.wait_for_timeout(300)

        btn_text = copy_btn.text_content().strip()
        print(f"  Button text after click: {btn_text}")
        assert "コピー完了" in btn_text, f"Expected 'コピー完了' in button text, got {btn_text}"

        # セクション3カード内の対象フォルダ表示検証
        print("[5] Verifying maintenance cards target folder indication...")
        sync_desc = page.locator("#btn-dash-sync").locator("xpath=../../div/p").text_content()
        print(f"  Sync card description snippet: {sync_desc}")
        assert proj_id in sync_desc, f"Expected {proj_id} in sync card description"

        export_desc = page.locator("#btn-dash-force-export").locator("xpath=../../div/p").text_content()
        print(f"  Force export card description snippet: {export_desc}")
        assert proj_id in export_desc, f"Expected {proj_id} in force export card description"

        # スクリーンショット保存
        screenshot_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard_folder_name_check.png")
        page.screenshot(path=screenshot_path)
        print(f"[6] Screenshot saved to: {screenshot_path}")

        print("ALL TESTS PASSED SUCCESSFULLY!")
        browser.close()

if __name__ == '__main__':
    test_dashboard_folder_name()
