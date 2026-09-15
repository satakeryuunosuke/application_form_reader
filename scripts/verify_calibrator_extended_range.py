import subprocess
import time
import os
import sys
from playwright.sync_api import sync_playwright

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    # 1. サーバー起動
    server_process = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    time.sleep(1.5)

    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if not os.path.exists(chrome_path):
        chrome_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=chrome_path, headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 900})

            # test_unit_calibrator.html をロードしてユニットテストの成否確認
            print("Checking test_unit_calibrator.html...")
            page.goto("http://127.0.0.1:8000/scripts/test_unit_calibrator.html")
            page.wait_for_selector("#test-results")
            page.wait_for_timeout(2000)
            res_text = page.locator("#test-results").text_content()
            print("Unit test results:\n", res_text)
            assert "❌ FAIL" not in res_text, "Unit test had failures"

            # 設定画面（#settings）でキャリブレータースライダー範囲検証
            print("Navigating to settings page (#settings)...")
            page.goto("http://127.0.0.1:8000/index.html#settings")
            page.wait_for_selector("#rng-dx")
            page.wait_for_timeout(1000)

            # スライダーの min/max 属性検証
            rng_dx_min = page.get_attribute("#rng-dx", "min")
            rng_dx_max = page.get_attribute("#rng-dx", "max")
            rng_dy_min = page.get_attribute("#rng-dy", "min")
            rng_dy_max = page.get_attribute("#rng-dy", "max")
            rng_size_min = page.get_attribute("#rng-size", "min")
            rng_size_max = page.get_attribute("#rng-size", "max")

            print(f"rng-dx: [{rng_dx_min}, {rng_dx_max}]")
            print(f"rng-dy: [{rng_dy_min}, {rng_dy_max}]")
            print(f"rng-size: [{rng_size_min}, {rng_size_max}]")

            assert rng_dx_min == "-1.00" and rng_dx_max == "1.00", f"Unexpected dx range: [{rng_dx_min}, {rng_dx_max}]"
            assert rng_dy_min == "-1.00" and rng_dy_max == "1.00", f"Unexpected dy range: [{rng_dy_min}, {rng_dy_max}]"
            assert rng_size_min == "0.005" and rng_size_max == "0.150", f"Unexpected size range: [{rng_size_min}, {rng_size_max}]"

            # 負のdy（バーコードより上側）や端部へのスライダー移動テスト
            print("Testing negative dy (above barcode) and large dx...")
            page.evaluate("""
                const rngDx = document.querySelector('#rng-dx');
                rngDx.value = 0.500;
                rngDx.dispatchEvent(new Event('input'));

                const rngDy = document.querySelector('#rng-dy');
                rngDy.value = -0.300;
                rngDy.dispatchEvent(new Event('input'));
            """)
            page.wait_for_timeout(300)

            val_dx = page.locator("#val-dx").text_content()
            val_dy = page.locator("#val-dy").text_content()
            print(f"Applied values: dx={val_dx}, dy={val_dy}")
            assert "50.0%" in val_dx, f"Expected 50.0%, got {val_dx}"
            assert "-30.0%" in val_dy, f"Expected -30.0%, got {val_dy}"

            # 微調整ボタンテスト
            print("Testing nudge buttons...")
            page.click(".btn-nudge[data-target='dy'][data-delta='-0.002']")
            page.wait_for_timeout(200)
            val_dy_nudged = page.locator("#val-dy").text_content()
            print(f"Nudged dy value: {val_dy_nudged}")
            assert "-30.2%" in val_dy_nudged, f"Expected -30.2%, got {val_dy_nudged}"

            # スクリーンショットを保存
            os.makedirs("output", exist_ok=True)
            screenshot_path = os.path.abspath("output/calibrator_extended_range_verified.png")
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

            browser.close()
            print("ALL VERIFICATIONS PASSED!")

    finally:
        server_process.terminate()

if __name__ == "__main__":
    main()
