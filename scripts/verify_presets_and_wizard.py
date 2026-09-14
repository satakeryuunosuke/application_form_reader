import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8085

def main():


    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    print(f"Using browser at {chrome_path}")

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome_path, headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE ERROR] {err}"))

        print("Navigating to settings...")
        page.goto(f"http://localhost:{PORT}/index.html#settings")
        page.wait_for_load_state("networkidle")
        time.sleep(2)

        # 1. バージョン表記の確認
        version_el = page.locator("#header-app-version")
        ver_text = version_el.text_content().strip()
        print(f"Header App Version: {ver_text}")
        assert "v1.10.0" in ver_text, f"Expected v1.10.0, got {ver_text}"

        # 2. 講座名マスタに「東海Ⅱ」を追加
        print("Adding '東海Ⅱ' to course presets...")
        page.fill("#inp-new-course", "東海Ⅱ")
        page.click("#btn-add-course-preset")
        time.sleep(1)

        # 3. 受講方法マスタに「名駅校」を追加
        print("Adding '名駅校' to method presets...")
        page.fill("#inp-new-method", "名駅校")
        page.click("#btn-add-method-preset")
        time.sleep(1)

        # 設定画面内のプルダウンに反映されているか確認
        course_opts = page.locator("#sel-course-preset option").all_inner_texts()
        method_opts = page.locator("#sel-method-preset option").all_inner_texts()
        print(f"Course options in settings: {course_opts}")
        print(f"Method options in settings: {method_opts}")
        assert "東海Ⅱ" in course_opts, "東海Ⅱ should be in course presets select"
        assert "名駅校" in method_opts, "名駅校 should be in method presets select"

        # 設定画面のスクリーンショット
        os.makedirs(r"C:\Users\sd23048\.gemini\antigravity-ide\brain\9067ca80-b600-4141-b2c0-86443cc4f251", exist_ok=True)
        screenshot_settings = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\9067ca80-b600-4141-b2c0-86443cc4f251\settings_presets.png"
        page.screenshot(path=screenshot_settings, full_page=True)
        print(f"Saved settings screenshot to {screenshot_settings}")

        # 4. ホーム画面へ移動して「新規プロジェクト作成ウィザード」を実行
        print("Navigating to home page...")
        page.goto(f"http://localhost:{PORT}/index.html#home")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        print("Opening project wizard...")
        page.click("#btn-new-project")
        time.sleep(1)

        # ステップ1: 講習選択
        page.select_option("#wiz-grade", "6")
        page.select_option("#wiz-session", "志望校別対策講座")
        page.click("#btn-wiz-next")
        time.sleep(1)

        # ステップ2: CSVアップロード（ダミーCSV）
        dummy_csv = "日能研番号,氏名,氏名カナ,クラス,科目\n10001,日能 太郎,ニチノウタロウ,M1,4科\n10002,能研 花子,ノウケンハナコ,A1,4科\n"
        csv_file_path = r"c:\Users\sd23048\application_form_reader\dummy_test_students.csv"
        with open(csv_file_path, "w", encoding="utf-8") as f:
            f.write(dummy_csv)

        page.set_input_files("#csv-file-input", csv_file_path)
        time.sleep(1)
        assert page.is_visible("#csv-preview-area"), "CSV preview area should be visible"

        page.click("#btn-wiz-next")
        time.sleep(2)

        # ステップ3: 受講票書式設定 & 追加チェックボックス管理
        print("Checking wizard step 3 presets...")
        wiz_course_opts = page.locator("#wiz-sel-course option").all_inner_texts()
        wiz_method_opts = page.locator("#wiz-sel-method option").all_inner_texts()
        print(f"Wizard course options: {wiz_course_opts}")
        print(f"Wizard method options: {wiz_method_opts}")
        assert "東海Ⅱ" in wiz_course_opts, "東海Ⅱ should be in wizard course select"
        assert "名駅校" in wiz_method_opts, "名駅校 should be in wizard method select"

        # 東海Ⅱ × 名駅校 を追加
        print("Adding 東海Ⅱ（名駅校） in wizard...")
        page.select_option("#wiz-sel-course", "東海Ⅱ")
        page.select_option("#wiz-sel-method", "名駅校")
        page.click("#wiz-btn-add-course")
        time.sleep(1)

        # 自由項目「Zoom補習」を追加
        print("Adding 'Zoom補習' in wizard...")
        page.fill("#wiz-inp-custom-name", "Zoom補習")
        page.click("#wiz-btn-add-free")
        time.sleep(1)

        # 登録中チェックボックスに存在するか確認
        wiz_tags = page.locator("#wiz-custom-boxes-container .custom-box-tag, #wiz-custom-boxes-container span").all_inner_texts()
        print(f"Wizard tags text: {wiz_tags}")
        assert any("東海Ⅱ（名駅校）" in t for t in wiz_tags), "東海Ⅱ（名駅校） tag should be visible"
        assert any("Zoom補習" in t for t in wiz_tags), "Zoom補習 tag should be visible"

        # キャリブレーターのタブにも存在するか確認
        tab_texts = page.locator(".calib-tab-btn").all_inner_texts()
        print(f"Calibrator tabs: {tab_texts}")
        assert any("東海Ⅱ" in t for t in tab_texts), "東海Ⅱ should have a calibrator tab"
        assert any("Zoom補習" in t for t in tab_texts), "Zoom補習 should have a calibrator tab"

        # ウィザードのステップ3スクリーンショット
        screenshot_wizard = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\9067ca80-b600-4141-b2c0-86443cc4f251\wizard_custom_boxes.png"
        page.screenshot(path=screenshot_wizard)
        print(f"Saved wizard screenshot to {screenshot_wizard}")

        # プロジェクト作成実行
        print("Submitting project creation...")
        page.click("#btn-wiz-next")
        time.sleep(1.5)

        # 共有フォルダ未接続の確認ダイアログが表示された場合は承認して続行
        if page.is_visible(".btn-confirm"):
            print("Confirming creation without shared folder...")
            page.click(".btn-confirm")
            time.sleep(3)

        # プロジェクト画面への遷移確認
        print(f"Current URL: {page.url}")
        assert "#project/" in page.url, "Should navigate to project page"

        # プロジェクトの IndexedDB データを検証
        project_data = page.evaluate("""async () => {
            const hash = window.location.hash;
            const pId = hash.replace('#project/', '');
            const p = await window.NichinokenAppFormDB ? window.NichinokenAppFormDB.projects.get(pId) : null;
            return await (await import('./js/db.js')).DB.getProject(pId);
        }""")

        assert project_data is not None, "Project data should exist in DB"
        custom_boxes = project_data.get('scanTemplate', {}).get('customBoxes', [])
        print(f"Saved Project Custom Boxes: {custom_boxes}")
        labels = [b['label'] for b in custom_boxes]
        assert "東海Ⅱ（名駅校）" in labels, "東海Ⅱ（名駅校） should be saved in scanTemplate.customBoxes"
        assert "Zoom補習" in labels, "Zoom補習 should be saved in scanTemplate.customBoxes"

        # プロジェクト画面のスクリーンショット
        screenshot_proj = r"C:\Users\sd23048\.gemini\antigravity-ide\brain\9067ca80-b600-4141-b2c0-86443cc4f251\project_created_with_custom_boxes.png"
        page.screenshot(path=screenshot_proj, full_page=True)
        print(f"Saved project screenshot to {screenshot_proj}")

        print("=== ALL TESTS PASSED SUCCESSFULLY! ===")
        browser.close()

if __name__ == "__main__":
    main()
