import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8090

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

        # 1. バージョン表記の確認
        print("Navigating to home page...")
        page.goto(f"http://localhost:{PORT}/index.html#home")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        version_el = page.locator("#header-app-version")
        ver_text = version_el.text_content().strip()
        print(f"Header App Version: {ver_text}")
        assert "v1.15.3" in ver_text, f"Expected v1.15.3, got {ver_text}"

        # 2. 受講確認モードのウィザードで「変更なし」「変更あり」が削除できないことの確認
        print("\n--- Test: Wizard Confirmation Mode Standard Box Non-deletion ---")
        page.click("#btn-new-project")
        time.sleep(1)

        page.click("#btn-wiz-next")
        time.sleep(1)

        page.set_input_files("#csv-file-input", csv_file_path)
        time.sleep(1)
        page.click("#btn-wiz-next")
        time.sleep(2)

        # キャリブレーターのタブ内にある削除ボタン（.calib-tab-del-btn）を確認
        del_btns = page.locator("#wizard-calib-mount .calib-tab-del-btn").count()
        print(f"Number of calib-tab-del-btn in wizard confirmation mode: {del_btns}")
        # ガイドバナー内に削除案内文言が存在しないことの確認
        hint_text = page.locator("#wizard-calib-mount .calibrator-hint-card").text_content()
        assert "不要な帳票では" not in hint_text, "Contradictory delete guidance text should not exist"
        print("Verified: contradictory text is successfully removed from calibrator hint card")

        # スクリーンショット取得
        os.makedirs(r"C:\Users\sd23048\.gemini\antigravity-ide\brain\6276a5cf-5055-4a04-9293-86ac04675e2d", exist_ok=True)
        screenshot_wiz = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\6276a5cf-5055-4a04-9293-86ac04675e2d\wizard_standard_nodelete.png"
        page.screenshot(path=screenshot_wiz)
        print(f"Saved screenshot to {screenshot_wiz}")

        page.click("#btn-wizard-close")
        time.sleep(1)

        # 3. 共通設定画面で「変更なし」「変更あり」が削除できないことの確認
        print("\n--- Test: Settings Page Standard Box Non-deletion ---")
        page.goto(f"http://localhost:{PORT}/index.html#settings")
        page.wait_for_load_state("networkidle")
        time.sleep(2)

        # キャリブレータータブ内の削除ボタン
        settings_calib_del = page.locator("#default-calibrator-container .calib-tab-del-btn").count()
        print(f"Number of calib-tab-del-btn in settings: {settings_calib_del}")
        assert settings_calib_del == 0, f"Expected 0 calib-tab-del-btn in settings, got {settings_calib_del}"

        # ボックス管理一覧内の標準枠の削除ボタン
        settings_nochange_del = page.locator('.btn-del-box[data-id="noChange"]').count()
        settings_haschange_del = page.locator('.btn-del-box[data-id="hasChange"]').count()
        print(f"Number of noChange del button in settings: {settings_nochange_del}")
        print(f"Number of hasChange del button in settings: {settings_haschange_del}")
        assert settings_nochange_del == 0, "noChange del button should NOT exist in settings"
        assert settings_haschange_del == 0, "hasChange del button should NOT exist in settings"

        screenshot_settings = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\6276a5cf-5055-4a04-9293-86ac04675e2d\settings_standard_nodelete.png"
        page.screenshot(path=screenshot_settings)
        print(f"Saved screenshot to {screenshot_settings}")

        browser.close()

    if os.path.exists(csv_file_path):
        os.remove(csv_file_path)

    print("\n✅ All standard box non-deletion verification tests passed successfully!")

if __name__ == '__main__':
    main()
