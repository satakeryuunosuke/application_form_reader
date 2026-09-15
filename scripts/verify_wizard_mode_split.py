import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8089

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

    dummy_csv = "日能研番号,氏名,氏名カナ,クラス,科目\n10001,日能 太郎,ニチノウタロウ,M1,4科\n10002,能研 花子,ノウケンハナコ,A1,4科\n"
    csv_file_path = r"c:\Users\sd23048\application_form_reader\dummy_test_students.csv"
    with open(csv_file_path, "w", encoding="utf-8") as f:
        f.write(dummy_csv)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome_path, headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE ERROR] {err}"))

        print("Navigating to home page...")
        page.goto(f"http://localhost:{PORT}/index.html#home")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        # 1. バージョン表記の確認
        version_el = page.locator("#header-app-version")
        ver_text = version_el.text_content().strip()
        print(f"Header App Version: {ver_text}")
        assert "v1.15." in ver_text, f"Expected v1.15.x, got {ver_text}"

        # ----------------------------------------------------
        # テスト 1: 受講確認モード（デフォルト: 夏期講習）
        # ----------------------------------------------------
        print("\n--- Test 1: Confirmation Mode (受講確認モード) ---")
        page.click("#btn-new-project")
        time.sleep(1)

        # Step 1: デフォルトで夏期講習（受講確認モード）
        session_val = page.locator("#wiz-session").input_value()
        print(f"Selected session: {session_val}")
        page.click("#btn-wiz-next")
        time.sleep(1)

        # Step 2: CSV取り込み
        page.set_input_files("#csv-file-input", csv_file_path)
        time.sleep(1)
        assert page.is_visible("#csv-preview-area"), "CSV preview area should be visible"
        page.click("#btn-wiz-next")
        time.sleep(2)

        # Step 3: 受講確認モードでは講座追加パネル（custom-boxes-config-panel）が存在しないこと
        has_custom_panel = page.is_visible(".custom-boxes-config-panel")
        has_add_course_btn = page.is_visible("#wiz-btn-add-course")
        has_add_free_btn = page.is_visible("#wiz-btn-add-free")
        has_calib_mount = page.is_visible("#wizard-calib-mount")

        print(f"custom-boxes-config-panel visible: {has_custom_panel}")
        print(f"wiz-btn-add-course visible: {has_add_course_btn}")
        print(f"wiz-btn-add-free visible: {has_add_free_btn}")
        print(f"wizard-calib-mount visible: {has_calib_mount}")

        assert not has_custom_panel, "custom-boxes-config-panel should NOT exist in confirmation mode"
        assert not has_add_course_btn, "wiz-btn-add-course should NOT exist in confirmation mode"
        assert not has_add_free_btn, "wiz-btn-add-free should NOT exist in confirmation mode"
        assert has_calib_mount, "wizard-calib-mount should exist in confirmation mode"

        # スクリーンショット取得
        os.makedirs(r"C:\Users\sd23048\.gemini\antigravity-ide\brain\6276a5cf-5055-4a04-9293-86ac04675e2d", exist_ok=True)
        screenshot_conf = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\6276a5cf-5055-4a04-9293-86ac04675e2d\wizard_confirmation_mode.png"
        page.screenshot(path=screenshot_conf)
        print(f"Saved confirmation mode screenshot to {screenshot_conf}")

        # ウィザードを閉じる
        page.click("#btn-wizard-close")
        time.sleep(1)

        # ----------------------------------------------------
        # テスト 2: 講座選択モード（志望校別対策講座）
        # ----------------------------------------------------
        print("\n--- Test 2: Selection Mode (講座選択モード) ---")
        page.click("#btn-new-project")
        time.sleep(1)

        # Step 1: 志望校別対策講座を選択
        page.select_option("#wiz-session", "志望校別対策講座")
        time.sleep(0.5)
        page.click("#btn-wiz-next")
        time.sleep(1)

        # Step 2: CSV取り込み
        page.set_input_files("#csv-file-input", csv_file_path)
        time.sleep(1)
        page.click("#btn-wiz-next")
        time.sleep(2)

        # Step 3: 講座選択モードでは講座追加パネル（custom-boxes-config-panel）が存在すること
        has_custom_panel_sel = page.is_visible(".custom-boxes-config-panel")
        has_add_course_btn_sel = page.is_visible("#wiz-btn-add-course")
        has_add_free_btn_sel = page.is_visible("#wiz-btn-add-free")

        print(f"custom-boxes-config-panel visible (selection): {has_custom_panel_sel}")
        print(f"wiz-btn-add-course visible (selection): {has_add_course_btn_sel}")
        print(f"wiz-btn-add-free visible (selection): {has_add_free_btn_sel}")

        assert has_custom_panel_sel, "custom-boxes-config-panel should exist in selection mode"
        assert has_add_course_btn_sel, "wiz-btn-add-course should exist in selection mode"
        assert has_add_free_btn_sel, "wiz-btn-add-free should exist in selection mode"

        # スクリーンショット取得
        screenshot_sel = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\6276a5cf-5055-4a04-9293-86ac04675e2d\wizard_selection_mode.png"
        page.screenshot(path=screenshot_sel)
        print(f"Saved selection mode screenshot to {screenshot_sel}")

        # 自由記述項目を追加してみる
        page.fill("#wiz-inp-custom-name", "特別テスト講座A")
        page.click("#wiz-btn-add-free")
        time.sleep(1)

        boxes_text = page.locator("#wiz-custom-boxes-container").text_content()
        print(f"Boxes container text: {boxes_text}")
        assert "特別テスト講座A" in boxes_text, "Added custom box should appear in boxes container"

        page.click("#btn-wizard-close")
        time.sleep(1)

        browser.close()

    print("\n✅ All wizard verification tests passed successfully!")

if __name__ == '__main__':
    main()
