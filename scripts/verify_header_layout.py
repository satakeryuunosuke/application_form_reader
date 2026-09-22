import os
import sys
import time
import http.server
import socketserver
import threading
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8098
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

def test_header_layout():
    t = threading.Thread(target=run_server, daemon=True)
    t.start()
    time.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome_path, headless=True)
        # 幅 1200px の一般的な解像度で検証
        context = browser.new_context(viewport={"width": 1200, "height": 800})
        page = context.new_page()

        print("[1] Opening app...")
        page.goto(f"{BASE_URL}/index.html")
        page.wait_for_selector("#header-app-version")

        ver = page.locator("#header-app-version").text_content().strip()
        print(f"  Header App Version: {ver}")
        assert ver == "v1.22.2", f"Expected v1.22.2, got {ver}"

        print("[2] Creating test project (Selection mode: 志望校別対策講座)...")
        proj_data = page.evaluate("""
        async () => {
            const { DB } = await import('./js/db.js');
            const p = await DB.createProject({
                year: 2026,
                grade: 6,
                sessionName: '志望校別対策講座',
                projectType: 'selection',
                students: [
                    { nichinokenId: '60001', name: '日能研 太郎', className: '6A', course: '4科' },
                    { nichinokenId: '60002', name: '日能研 次郎', className: '6A', course: '4科' },
                    { nichinokenId: '60003', name: '日能研 三郎', className: '6B', course: '2科' },
                    { nichinokenId: '60004', name: '日能研 四郎', className: '6B', course: '4科' },
                    { nichinokenId: '60005', name: '日能研 五郎', className: '6C', course: '4科' }
                ]
            });
            return p;
        }
        """)
        proj_id = proj_data['id']
        print(f"  Created Project ID: {proj_id}")

        print("[3] Navigating to project detail page...")
        page.evaluate(f"window.location.hash = '#project/{proj_id}/list';")
        page.wait_for_selector(".project-header-bar")
        page.wait_for_selector("#btn-go-dashboard")
        page.wait_for_selector("#btn-header-sync")
        page.wait_for_selector("#btn-go-manual")
        page.wait_for_timeout(500)

        # 1. 右側主要ボタン群の折り返し検証（すべて同一Y座標に並んでいること）
        print("[4] Checking action buttons alignment (no wrap)...")
        btn_sync = page.locator("#btn-header-sync")
        btn_manual = page.locator("#btn-go-manual")
        btn_dash = page.locator("#btn-go-dashboard")

        box_sync = btn_sync.bounding_box()
        box_manual = btn_manual.bounding_box()
        box_dash = btn_dash.bounding_box()

        print(f"  Sync button: y={box_sync['y']}, height={box_sync['height']}")
        print(f"  Manual button: y={box_manual['y']}, height={box_manual['height']}")
        print(f"  Dashboard button: y={box_dash['y']}, height={box_dash['height']}")

        # Y座標が概ね同一（差が5px以内）であることを確認
        assert abs(box_sync['y'] - box_manual['y']) < 5, f"Sync and Manual buttons must be on the same row: {box_sync['y']} vs {box_manual['y']}"
        assert abs(box_manual['y'] - box_dash['y']) < 5, f"Manual and Dashboard buttons must be on the same row: {box_manual['y']} vs {box_dash['y']}"
        print("  --> ALL 3 BUTTONS ARE ON THE SAME ROW (NO WRAP)!")

        # 2. タイトルとステータスバッジの並び検証
        print("[5] Checking title and status badge alignment...")
        title_el = page.locator(".project-header-title h1")
        status_badge = page.locator("#header-status-badge")
        box_title = title_el.bounding_box()
        box_status = status_badge.bounding_box()

        print(f"  Title: y={box_title['y']}, text='{title_el.text_content()}'")
        print(f"  Status badge: y={box_status['y']}, text='{status_badge.text_content().strip()}'")
        assert abs(box_title['y'] - box_status['y']) < 15, f"Title and status badge should be vertically aligned on row 1"

        # 3. 属性バッジおよび統計サマリーの存在検証
        badges = page.locator(".project-header-bar .badge").all_text_contents()
        print(f"  All header badges: {badges}")
        assert any('志望校別対策講座' in b for b in badges), "Header must contain session badge '志望校別対策講座'"
        assert any('2026年度' in b for b in badges), "Header must contain '2026年度'"
        assert any('6年生' in b for b in badges), "Header must contain '6年生'"

        # 4. スクリーンショットの撮影と保存
        screenshot_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "header_layout_check.png")
        page.screenshot(path=screenshot_path)
        print(f"[6] Full screenshot saved to: {screenshot_path}")

        # ヘッダー部分のクロップスクリーンショット
        header_el = page.locator(".project-header-bar")
        header_ss_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "header_bar_crop.png")
        header_el.screenshot(path=header_ss_path)
        print(f"  Header bar crop screenshot saved to: {header_ss_path}")

        print("\nALL HEADER LAYOUT VERIFICATION CHECKS PASSED SUCCESSFULLY!")
        browser.close()

if __name__ == '__main__':
    test_header_layout()
