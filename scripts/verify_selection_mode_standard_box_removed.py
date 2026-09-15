import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8095

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

    artifact_dir = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\a726dac4-0800-4414-a2b7-fb54bc94a4ea"
    os.makedirs(artifact_dir, exist_ok=True)

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
        assert "v1.15.4" in ver_text, f"Expected v1.15.4, got {ver_text}"

        # ----------------------------------------------------
        # テスト 1: 受講確認モードでは「変更なし」「変更あり」が保持されていること
        # ----------------------------------------------------
        print("\n--- Test 1: Confirmation Mode (受講確認モードの標準枠保持確認) ---")
        page.click("#btn-new-project")
        time.sleep(1)

        # Step 1: デフォルト夏期講習（受講確認モード）
        page.click("#btn-wiz-next")
        time.sleep(1)

        # Step 2: CSV取り込み
        page.set_input_files("#csv-file-input", csv_file_path)
        time.sleep(1)
        page.click("#btn-wiz-next")
        time.sleep(2)

        # Step 3: 受講確認モードでは「変更なし」「変更あり」枠が存在し、削除ボタンがないこと
        calib_text = page.locator("#wizard-calib-mount").text_content()
        assert "「変更なし」枠" in calib_text, "Confirmation mode should have 変更なし"
        assert "「変更あり」枠" in calib_text, "Confirmation mode should have 変更あり"
        has_tab_del_btn = page.locator("#wizard-calib-mount .calib-tab-del-btn").count()
        assert has_tab_del_btn == 0, f"Expected 0 del buttons in confirmation mode, got {has_tab_del_btn}"
        print("✅ Confirmation mode: Standard boxes are properly present and protected.")

        page.click("#btn-wizard-close")
        time.sleep(1)

        # ----------------------------------------------------
        # テスト 2: 講座選択モードでの「変更なし」「変更あり」完全廃止確認
        # ----------------------------------------------------
        print("\n--- Test 2: Selection Mode (講座選択モードでの標準枠廃止確認) ---")
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

        # Step 3: 講座選択モードでのウィザード検証
        wiz_container = page.locator("#wiz-custom-boxes-container").text_content()
        print(f"Wizard boxes container text: {wiz_container}")
        assert "変更なし" not in wiz_container, "Wizard container should NOT contain 変更なし"
        assert "変更あり" not in wiz_container, "Wizard container should NOT contain 変更あり"
        assert "➕ 「変更なし」枠を追加" not in wiz_container
        assert "➕ 「変更あり」枠を追加" not in wiz_container

        calib_mount_text = page.locator("#wizard-calib-mount").text_content()
        print(f"Calib mount text: {calib_mount_text}")
        assert "「変更なし」枠" not in calib_mount_text, "Calibrator should NOT contain 「変更なし」枠 in selection mode"
        assert "「変更あり」枠" not in calib_mount_text, "Calibrator should NOT contain 「変更あり」枠 in selection mode"
        assert "➕ 「変更なし」枠を追加" not in calib_mount_text
        assert "➕ 「変更あり」枠を追加" not in calib_mount_text

        # 講座を追加してみる
        page.fill("#wiz-inp-custom-name", "特訓テスト講座A")
        page.click("#wiz-btn-add-free")
        time.sleep(1)

        wiz_container_after = page.locator("#wiz-custom-boxes-container").text_content()
        assert "特訓テスト講座A" in wiz_container_after
        assert "変更なし" not in wiz_container_after
        assert "変更あり" not in wiz_container_after

        calib_mount_after = page.locator("#wizard-calib-mount").text_content()
        assert "特訓テスト講座A" in calib_mount_after
        assert "「変更なし」枠" not in calib_mount_after
        assert "「変更あり」枠" not in calib_mount_after

        # スクリーンショット取得（ウィザード）
        screenshot_wiz = os.path.join(artifact_dir, "selection_wizard_standard_boxes_removed.png")
        page.screenshot(path=screenshot_wiz)
        print(f"Saved wizard screenshot to {screenshot_wiz}")

        # プロジェクト作成
        page.click("#btn-wiz-next")
        time.sleep(1)

        btn_confirm = page.locator(".modal-confirm-overlay button.btn-confirm")
        if btn_confirm.is_visible():
            print("Clicking confirm button for non-shared creation...")
            btn_confirm.click()
            time.sleep(2)
        else:
            print("Confirm button not found or not visible!")

        # プロジェクト作成後の画面遷移待機 (#btn-go-dashboard の出現を待機)
        page.wait_for_selector("#btn-go-dashboard", timeout=15000)
        time.sleep(1)

        current_hash = page.evaluate("() => window.location.hash")
        print(f"Current hash after creation: {current_hash}")
        assert "#project/" in current_hash

        proj_id = current_hash.split("#project/")[1].split("/")[0]

        # ----------------------------------------------------
        # テスト 3: プロジェクト画面の書式設定モーダルでの検証
        # ----------------------------------------------------
        print("\n--- Test 3: Project Detail Template Settings Modal ---")
        # 管理ダッシュボードを開く
        page.click("#btn-go-dashboard")
        time.sleep(1)
        page.wait_for_selector("#btn-dash-edit-template", timeout=10000)

        # 書式設定ボタンをクリック
        page.click("#btn-dash-edit-template")
        time.sleep(1.5)

        proj_modal = page.locator(".modal-content")
        assert proj_modal.is_visible(), "Template settings modal should be visible"
        proj_modal_text = proj_modal.text_content()
        print("Checking project template modal text...")
        assert "読取チェックボックス項目管理（志望校別講座）" in proj_modal_text
        assert "標準の変更なし・変更あり" not in proj_modal_text
        assert "🟩 変更なし" not in proj_modal_text
        assert "🟧 変更あり" not in proj_modal_text
        assert "「変更なし」枠" not in proj_modal_text
        assert "「変更あり」枠" not in proj_modal_text
        assert "➕ 「変更なし」枠を追加" not in proj_modal_text
        assert "➕ 「変更あり」枠を追加" not in proj_modal_text
        print("✅ Project template modal: Standard boxes completely removed and clean.")

        # スクリーンショット取得（プロジェクト書式設定モーダル）
        screenshot_proj_modal = os.path.join(artifact_dir, "project_settings_standard_boxes_removed.png")
        page.screenshot(path=screenshot_proj_modal)
        print(f"Saved project modal screenshot to {screenshot_proj_modal}")

        # ----------------------------------------------------
        # テスト 4: 保存と再読み込み後の永続化確認
        # ----------------------------------------------------
        print("\n--- Test 4: Persistence Check (保存と再読み込み後の標準枠非存在確認) ---")
        # 「💾 この設定を保存」ボタンをクリックしてモーダルを保存終了
        page.click("#btn-modal-save")
        time.sleep(2)

        # 再度モーダルを開いて標準枠が復活していないか確認
        page.click("#btn-dash-edit-template")
        time.sleep(1.5)

        proj_modal_reopen = page.locator(".modal-content")
        assert proj_modal_reopen.is_visible()
        reopen_text = proj_modal_reopen.text_content()
        assert "特訓テスト講座A" in reopen_text
        assert "標準の変更なし・変更あり" not in reopen_text
        assert "🟩 変更なし" not in reopen_text
        assert "🟧 変更あり" not in reopen_text
        assert "「変更なし」枠" not in reopen_text
        assert "「変更あり」枠" not in reopen_text
        print("✅ Reopened template modal: Confirmed persistence! No standard boxes present.")

        page.click(".btn-close-modal")
        time.sleep(1)

        browser.close()

    print("\n🎉 All verification tests for standard box removal in selection mode PASSED successfully!")

if __name__ == '__main__':
    main()
