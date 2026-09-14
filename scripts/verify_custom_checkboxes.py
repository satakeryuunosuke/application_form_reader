import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8997

def start_server():
    os.chdir(r"c:\Users\sd23048\application_form_reader")
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("", PORT), handler)
    httpd.serve_forever()

def main():
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    time.sleep(1)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    print(f"Using browser at {chrome_path}")

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome_path, headless=True)
        page = browser.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE ERROR] {err}"))

        print("Navigating to app...")
        page.goto(f"http://localhost:{PORT}/index.html#settings")
        page.wait_for_load_state("networkidle")
        time.sleep(2)

        # 1. バージョン表記の確認
        version_el = page.locator("#header-app-version")
        ver_text = version_el.text_content()
        print(f"Header App Version: {ver_text}")
        assert "v1.9.0" in ver_text, f"Expected v1.9.0, got {ver_text}"

        # 2. 志望校別対策講座の追加
        print("Selecting '名古屋Ⅰ' and 'Zoom授業'...")
        page.select_option("#sel-course-preset", "名古屋Ⅰ")
        page.select_option("#sel-method-preset", "Zoom授業")
        page.click("#btn-add-course-checkbox")
        time.sleep(1)

        print("Selecting '愛知淑徳Ⅰ' and '御器所校'...")
        page.select_option("#sel-course-preset", "愛知淑徳Ⅰ")
        page.select_option("#sel-method-preset", "御器所校")
        page.click("#btn-add-course-checkbox")
        time.sleep(1)

        # 3. 自由記述項目の追加
        print("Adding free item '特別演習A'...")
        page.fill("#inp-custom-box-name", "特別演習A")
        page.click("#btn-add-custom-free-checkbox")
        time.sleep(1)

        # 4. 一覧タグの確認
        tags = page.locator(".custom-box-tag").all_text_contents()
        print(f"Registered custom tags: {tags}")
        assert any("名古屋Ⅰ（Zoom授業）" in t for t in tags), "Tag for 名古屋Ⅰ（Zoom授業） missing"
        assert any("愛知淑徳Ⅰ（御器所校）" in t for t in tags), "Tag for 愛知淑徳Ⅰ（御器所校） missing"
        assert any("特別演習A" in t for t in tags), "Tag for 特別演習A missing"

        # 5. キャリブレーターのタブ確認
        tabs = page.locator(".calib-tab-btn").all_text_contents()
        print(f"Calibrator tabs: {tabs}")
        assert any("名古屋Ⅰ（Zoom授業）" in t for t in tabs), "Tab for 名古屋Ⅰ（Zoom授業） missing"

        # 6. 「名古屋Ⅰ（Zoom授業）」のタブをクリックして位置調整スライダーを動かす
        target_tab = page.locator('.calib-tab-btn:has-text("名古屋Ⅰ（Zoom授業）")')
        target_tab.click()
        time.sleep(0.5)

        # スライダー調整
        page.evaluate("""
            const rngDx = document.querySelector('#rng-dx');
            rngDx.value = -0.040;
            rngDx.dispatchEvent(new Event('input'));

            const rngDy = document.querySelector('#rng-dy');
            rngDy.value = 0.380;
            rngDy.dispatchEvent(new Event('input'));
        """)
        time.sleep(0.5)

        dx_val = page.locator("#val-dx").text_content()
        dy_val = page.locator("#val-dy").text_content()
        print(f"Adjusted slider values: dx={dx_val}, dy={dy_val}")

        # 7. 保存ボタンをクリック
        print("Saving default template...")
        page.click("#btn-save-default-template")
        time.sleep(2)

        # スクリーンショットを保存
        os.makedirs("artifacts", exist_ok=True)
        screenshot_path = os.path.abspath("artifacts/custom_checkbox_settings.png")
        page.screenshot(path=screenshot_path, full_page=True)
        print(f"Screenshot saved to {screenshot_path}")

        # 8. ページをリロードして保存された設定が読み込まれるか検証
        print("Reloading page to verify persistence...")
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(2)

        reloaded_tags = page.locator(".custom-box-tag").all_text_contents()
        print(f"Reloaded custom tags: {reloaded_tags}")
        assert any("名古屋Ⅰ（Zoom授業）" in t for t in reloaded_tags), "Persistence check failed for 名古屋Ⅰ（Zoom授業）"
        assert any("愛知淑徳Ⅰ（御器所校）" in t for t in reloaded_tags), "Persistence check failed for 愛知淑徳Ⅰ（御器所校）"
        assert any("特別演習A" in t for t in reloaded_tags), "Persistence check failed for 特別演習A"

        print("SUCCESS: All custom checkbox tests passed!")
        browser.close()

if __name__ == "__main__":
    main()
