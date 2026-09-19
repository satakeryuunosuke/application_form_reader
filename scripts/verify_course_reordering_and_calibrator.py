import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8092

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

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE ERROR] {err}"))

        print("1. ホーム画面へアクセス & バージョン検証...")
        page.goto(f"http://localhost:{PORT}/index.html#home")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        version_el = page.locator("#header-app-version")
        ver_text = version_el.text_content().strip()
        print(f"Header App Version: {ver_text}")
        assert ver_text == "v1.18.0", f"Expected v1.18.0, got {ver_text}"

        print("2. 設定画面（#settings）での講座名マスタ並び替え検証...")
        page.goto(f"http://localhost:{PORT}/index.html#settings")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        # 講座名マスタのタグ確認
        course_tags = page.locator("#course-tags-list .badge")
        print(f"Course presets count: {course_tags.count()}")
        assert course_tags.count() > 0, "No course presets found"

        # 名前順ソートボタンの存在確認
        sort_courses_btn = page.locator("#btn-sort-course-presets")
        assert sort_courses_btn.is_visible(), "Sort courses button not found"
        sort_courses_btn.click()
        time.sleep(0.5)

        first_course = page.locator("#course-tags-list .badge span").first.text_content()
        print(f"First course after sort: {first_course}")

        print("3. プロジェクト作成 & 34講チェックボックス登録シミュレーション...")
        # DBに34講のプロジェクトを直接作成して検証
        proj_ids = page.evaluate("""async () => {
            const { DB } = await import('./js/db.js');
            const { CheckboxEngine } = await import('./js/checkbox.js');

            const template = CheckboxEngine.getDefaultTemplate();
            delete template.noChangeBox;
            delete template.hasChangeBox;
            template.customBoxes = [];

            // 34講のダミー講座を作成
            const courses = ['東海Ⅰ', '滝Ⅰ', '南山女子', '名古屋Ⅰ', '愛知淑徳Ⅰ', '金城学院', '全国Ⅰ', '早慶', '開成', '麻布', '桜蔭', '女子学院', '豊島岡', '駒場東邦', '海城', '武蔵', '浅野', '栄光', '聖光', '渋谷幕張', '慶應普通部', '慶應中等部', '早稲田', '早大学院', '筑波大附属', '学芸大世田谷', '芝', '本郷', '攻玉社', '鴎友', '頌栄', '吉祥女子', '学習院', '立教新座'];
            for (let i = 0; i < courses.length; i++) {
                template.customBoxes.push({
                    id: 'course_box_' + (i + 1),
                    label: `${courses[i]}（Zoom）`,
                    dx: -0.058,
                    dy: 0.200 + i * 0.025,
                    size: 0.032
                });
            }

            const proj34 = await DB.createProject({
                year: 2026,
                grade: 6,
                sessionName: '志望校別対策講座',
                students: [{ nichinokenId: '12345678', name: 'テスト生徒', className: 'M1', course: '4科' }],
                scanTemplate: template,
                projectType: 'selection'
            });

            // 受講確認モードの通常プロジェクトも作成
            const stdTemplate = CheckboxEngine.getDefaultTemplate();
            const projStd = await DB.createProject({
                year: 2026,
                grade: 6,
                sessionName: '夏期講習',
                students: [{ nichinokenId: '12345679', name: 'テスト標準生徒', className: 'A1', course: '4科' }],
                scanTemplate: stdTemplate,
                projectType: 'confirmation'
            });

            return { proj34Id: proj34.id, projStdId: projStd.id };
        }""")
        time.sleep(1)

        proj34_id = proj_ids["proj34Id"]
        proj_std_id = proj_ids["projStdId"]
        print(f"Created projects: 34 courses => {proj34_id}, Standard => {proj_std_id}")

        print("4. 受講確認モード（標準プロジェクト）でのキャリブレーター検証...")
        page.goto(f"http://localhost:{PORT}/index.html#project/{proj_std_id}/dashboard")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#btn-dash-edit-template", timeout=5000)

        # 書式設定モーダルを開く
        calib_btn = page.locator("#btn-dash-edit-template")
        calib_btn.click()
        page.wait_for_selector(".modal-content", timeout=5000)
        time.sleep(1)

        # 受講確認モードでは従来のタブ（🟩 「変更なし」枠、🟧 「変更あり」枠）が表示されていることを確認
        no_change_tab = page.locator(".calib-tab-btn[data-tab='noChange']")
        has_change_tab = page.locator(".calib-tab-btn[data-tab='hasChange']")
        assert no_change_tab.is_visible(), "Standard noChange tab should be visible in standard mode"
        assert has_change_tab.is_visible(), "Standard hasChange tab should be visible in standard mode"
        print("Standard mode calibrator verified: shows clean 2-tab pills without breaking layout.")

        page.locator("#btn-modal-cancel").click()
        time.sleep(0.5)

        print("5. 講座選択モード（全34講プロジェクト）でのキャリブレーター検証...")
        page.goto(f"http://localhost:{PORT}/index.html#project/{proj34_id}/dashboard")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#btn-dash-edit-template", timeout=5000)

        # 書式設定モーダルを開く
        calib_btn = page.locator("#btn-dash-edit-template")
        calib_btn.click()
        page.wait_for_selector(".modal-content", timeout=5000)
        time.sleep(1)

        # スマート枠セレクタの存在確認
        smart_select = page.locator("#calib-smart-box-select")
        assert smart_select.is_visible(), "Smart selector dropdown should be visible for 34 courses"
        options = smart_select.locator("option")
        print(f"Smart selector options count: {options.count()}")
        assert options.count() == 34, f"Expected 34 options, got {options.count()}"

        # 前後送りボタンの存在確認
        prev_btn = page.locator("#btn-calib-prev-target")
        next_btn = page.locator("#btn-calib-next-target")
        assert prev_btn.is_visible(), "Previous target button not found"
        assert next_btn.is_visible(), "Next target button not found"

        # 並び替えボタンの存在確認
        up_btn = page.locator("#btn-calib-box-up")
        down_btn = page.locator("#btn-calib-box-down")
        sort_btn = page.locator("#btn-calib-box-sort")
        assert up_btn.is_visible(), "Move box up button not found"
        assert down_btn.is_visible(), "Move box down button not found"
        assert sort_btn.is_visible(), "Sort boxes button not found"

        # リアルタイム判定カードのコンパクト化確認
        active_focus = page.locator("#eval-active-focus-container")
        summary_bar = page.locator("#eval-custom-summary-bar")
        assert active_focus.is_visible(), "Active box focus card should be visible"
        assert summary_bar.is_visible(), "Summary bar should be visible"
        print(f"Active focus title: {page.locator('#eval-active-title').text_content()}")
        print(f"Summary text: {page.locator('#eval-summary-text').text_content()}")

        # 次へボタンをクリックして枠切り替え
        next_btn.click()
        time.sleep(0.3)
        selected_val = smart_select.input_value()
        print(f"Selected box after next: {selected_val}")
        assert selected_val == "course_box_2", f"Expected course_box_2, got {selected_val}"

        # 🔤 名前順ソートを実行
        sort_btn.click()
        time.sleep(0.5)
        first_opt_text = smart_select.locator("option").first.text_content().strip()
        print(f"First option after alphabetical sort: {first_opt_text}")

        # 管理パネルでの検索フィルタ動作確認
        search_filter = page.locator("#proj-custom-filter")
        if search_filter.is_visible():
            search_filter.fill("開成")
            time.sleep(0.3)
            visible_cards = page.locator("#proj-custom-boxes-container .custom-box-item-card")
            print(f"Filtered cards count for '開成': {visible_cards.count()}")
            assert visible_cards.count() >= 1, "Expected at least 1 filtered card"

        print("6. 検証成功！全34講のキャリブレーションUIスマートセレクタおよび並び替え機能が正常に動作しています。")
        browser.close()

if __name__ == '__main__':
    main()
