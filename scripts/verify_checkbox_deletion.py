import os
import sys
import time
import http.server
import socketserver
import threading
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8094
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

def test_checkbox_deletion_and_restore():
    # 1. サーバー起動
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

        page.goto(f"{BASE_URL}/index.html")
        page.wait_for_selector("#header-app-version")
        page.evaluate("""
        async () => {
            const { UI } = await import('./js/utils/ui.js');
            UI.confirm = async () => true;
            const { TemplateCalibrator } = await import('./js/components/calibrator.js');
            TemplateCalibrator.prototype.isBarcodeDetected = () => true;
        }
        """)
        ver = page.locator("#header-app-version").text_content().strip()
        print(f"Header app version: {ver}")
        assert ver == "v1.11.0", f"Expected v1.11.0, got {ver}"

        # 2. CheckboxEngine & ScannerEngine のユニット動作検証
        engine_eval = page.evaluate("""
        async () => {
          const { CheckboxEngine } = await import('./js/checkbox.js');
          const cv = document.createElement('canvas');
          cv.width = 1000;
          cv.height = 700;
          const barcodeBox = { centerX: 100, centerY: 80, angle: 0 };
          
          // Test A: noChangeBox のみ削除
          const tmplA = {
            hasChangeBox: { dx: -0.05, dy: 0.2, size: 0.03 },
            customBoxes: []
          };
          const rectsA = CheckboxEngine.calculateTargetRects(cv, barcodeBox, tmplA);
          
          // Test B: hasChangeBox のみ削除
          const tmplB = {
            noChangeBox: { dx: -0.05, dy: 0.2, size: 0.03 },
            customBoxes: []
          };
          const rectsB = CheckboxEngine.calculateTargetRects(cv, barcodeBox, tmplB);

          // Test C: 両方削除
          const tmplC = {
            customBoxes: [{ id: 'custom1', label: '特講', dx: 0, dy: 0.1, size: 0.03 }]
          };
          const rectsC = CheckboxEngine.calculateTargetRects(cv, barcodeBox, tmplC);

          return {
            testA_noChangeNull: rectsA.noChangeRect === null,
            testA_hasChangeValid: rectsA.hasChangeRect !== null,
            testB_noChangeValid: rectsB.noChangeRect !== null,
            testB_hasChangeNull: rectsB.hasChangeRect === null,
            testC_bothNull: rectsC.noChangeRect === null && rectsC.hasChangeRect === null,
            testC_customValid: rectsC.customRects.length === 1
          };
        }
        """)
        print("Engine unit eval result:", engine_eval)
        assert engine_eval['testA_noChangeNull'] and engine_eval['testA_hasChangeValid']
        assert engine_eval['testB_noChangeValid'] and engine_eval['testB_hasChangeNull']
        assert engine_eval['testC_bothNull'] and engine_eval['testC_customValid']
        print("PASS: CheckboxEngine target rects calculation with deleted boxes")

        # 3. プロジェクト作成ウィザードのテスト
        page.click("#btn-new-project")
        page.wait_for_selector(".modal-content")
        print("Wizard opened")

        # Step 1: 次へ
        page.click("#btn-wiz-next")
        page.wait_for_timeout(400)

        # Step 2: 生徒CSVファイル取込
        temp_csv = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_temp_test_students.csv")
        with open(temp_csv, "w", encoding="utf-8") as f:
            f.write("日能研番号,氏名,クラス,受講科目\nTDN60001,テスト生徒1,M1,4科\nTDN60002,テスト生徒2,W1,2科\n")
        
        page.set_input_files("#csv-file-input", temp_csv)
        page.wait_for_timeout(600)
        assert page.is_visible("#csv-preview-area"), "CSV preview area should be visible"
        
        page.click("#btn-wiz-next")
        page.wait_for_timeout(800)

        # Step 3: 書式設定
        page.wait_for_selector("#wiz-custom-boxes-container")
        print("Wizard Step 3 loaded")

        # 管理パネルに「変更なし」「変更あり」が表示されていることを確認
        panel_text = page.locator("#wiz-custom-boxes-container").text_content()
        assert "変更なし" in panel_text, "Panel should contain 変更なし"
        assert "変更あり" in panel_text, "Panel should contain 変更あり"
        print("Panel contains standard boxes")

        # キャリブレーターのタブにも「変更なし」「変更あり」があることを確認
        calib_tabs = page.locator(".calib-tabs-list").text_content()
        assert "「変更なし」枠" in calib_tabs
        assert "「変更あり」枠" in calib_tabs
        print("Calibrator tabs contain standard boxes")

        # タブ内の「変更あり」削除ボタンをクリック
        page.locator('.calib-tab-del-btn[data-del="hasChange"]').click()
        page.wait_for_timeout(500)

        # キャリブレーターのタブから「変更あり」が消え、「➕ 「変更あり」枠を追加」ボタンが表示されたか確認
        calib_tabs_after = page.locator(".calib-tabs-list").text_content()
        assert "「変更あり」枠" not in calib_tabs_after, "「変更あり」should be removed from tabs"
        assert page.locator('.calib-btn-restore-box[data-restore="hasChange"]').is_visible(), "Restore button for hasChange should be visible in tabs"
        print("PASS: Deleted hasChange from calibrator tab")

        # 管理パネルからも「変更あり」が消え、復元ボタンが表示されていることを確認
        panel_after = page.locator("#wiz-custom-boxes-container").text_content()
        assert "変更あり" not in panel_after or "➕ 「変更あり」枠を追加" in panel_after

        # 管理パネルから「変更なし」の削除ボタンをクリック
        page.locator('.wiz-btn-del-box[data-id="noChange"]').click()
        page.wait_for_timeout(500)

        # 両方削除された状態を確認
        calib_tabs_none = page.locator(".calib-tabs-list").text_content()
        assert "「変更なし」枠" not in calib_tabs_none
        assert "「変更あり」枠" not in calib_tabs_none
        print("PASS: Deleted noChange from panel")

        # スライダーカードで「読取枠がありません」メッセージが表示されているか確認
        assert page.locator("#calib-no-target-msg").is_visible()
        print("PASS: Calibrator shows no target box message")

        # キャリブレーター側から「➕ 「変更なし」枠を追加」をクリック
        page.locator('.calib-btn-restore-box[data-restore="noChange"]').click()
        page.wait_for_timeout(500)

        # 「変更なし」が復元されたことを確認
        calib_tabs_restored = page.locator(".calib-tabs-list").text_content()
        assert "「変更なし」枠" in calib_tabs_restored
        print("PASS: Restored noChange from calibrator button")

        # 管理パネル側から「➕ 「変更あり」枠を追加」をクリック
        page.locator('.wiz-btn-restore-box[data-type="hasChange"]').click()
        page.wait_for_timeout(500)

        # 「変更あり」も復元されたことを確認
        calib_tabs_both = page.locator(".calib-tabs-list").text_content()
        assert "「変更あり」枠" in calib_tabs_both
        print("PASS: Restored hasChange from panel button")

        # 再度「変更あり」を削除した状態でプロジェクトを作成してみる
        page.locator('.wiz-btn-del-box[data-id="hasChange"]').click()
        page.wait_for_timeout(500)

        # 「プロジェクトを作成」ボタンをクリック
        page.click("#btn-wiz-next")
        page.wait_for_timeout(1000)
        print("Project created without hasChangeBox")

        # プロジェクト詳細画面へ遷移したことを確認
        page.wait_for_selector("#btn-go-dashboard")
        print("Project view opened")

        # 管理ダッシュボードを開く
        page.click("#btn-go-dashboard")
        page.wait_for_selector("#btn-dash-edit-template")

        # 書式設定モーダルを開く
        page.click("#btn-dash-edit-template")
        page.wait_for_selector("#project-calib-container")
        page.wait_for_timeout(500)

        # プロジェクト書式モーダルでも「変更あり」が未登録（削除された状態）で保持されているか確認
        proj_calib_tabs = page.locator("#project-calib-container .calib-tabs-list").text_content()
        assert "「変更なし」枠" in proj_calib_tabs
        assert "「変更あり」枠" not in proj_calib_tabs, "hasChange should remain deleted in project settings"
        print("PASS: Project preserved template without hasChangeBox")

        # プロジェクト書式モーダルから「➕ 「変更あり」枠を追加」をクリックして復元できるか確認
        page.locator('#project-calib-container .calib-btn-restore-box[data-restore="hasChange"]').click()
        page.wait_for_timeout(500)
        proj_calib_tabs_restored = page.locator("#project-calib-container .calib-tabs-list").text_content()
        assert "「変更あり」枠" in proj_calib_tabs_restored
        print("PASS: Restored hasChangeBox in project template calibration modal")

        # 保存ボタンをクリック
        page.click("#btn-modal-save")
        page.wait_for_timeout(500)
        print("Saved project settings")

        browser.close()
    print("ALL TESTS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    test_checkbox_deletion_and_restore()
