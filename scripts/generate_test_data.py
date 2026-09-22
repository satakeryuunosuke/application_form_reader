import os
import sys
import csv
import subprocess
import shutil
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

CODE39_PATTERNS = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
    '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
    '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
    'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
    'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
    'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
    'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
    'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
    'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
    '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
    '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100'
}

def generate_code39_svg(text, height=22, narrow_width=0.9, wide_width=2.2, show_text=True):
    full_text = f"*{text.upper()}*"
    rects = []
    current_x = 8.0
    for char in full_text:
        pattern = CODE39_PATTERNS.get(char, CODE39_PATTERNS[' '])
        for i, bit in enumerate(pattern):
            is_bar = (i % 2 == 0)
            width = wide_width if bit == '1' else narrow_width
            if is_bar:
                rects.append(f'<rect x="{current_x:.1f}" y="0" width="{width:.1f}" height="{height}" fill="#000" />')
            current_x += width
        current_x += narrow_width
    current_x += 8.0
    total_w = current_x
    text_svg = f'<text x="{total_w/2:.1f}" y="{height + 9}" font-family="Consolas, monospace" font-size="7.5" font-weight="bold" text-anchor="middle" fill="#000">*{text.upper()}*</text>' if show_text else ''
    total_h = height + (11 if show_text else 2)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.1f} {total_h}" width="{total_w:.1f}" height="{total_h}">
        <rect width="100%" height="100%" fill="#fff"/>
        {''.join(rects)}
        {text_svg}
    </svg>'''
    return svg

def get_name_style(name):
    clean_name = name.replace(" ", "").replace("　", "")
    length = len(clean_name)
    if length <= 4:
        return 'font-size: 17px; letter-spacing: 3px;'
    elif length <= 6:
        return 'font-size: 15px; letter-spacing: 1.5px;'
    elif length <= 8:
        return 'font-size: 13.5px; letter-spacing: 1px;'
    elif length <= 11:
        return 'font-size: 12px; letter-spacing: 0.5px;'
    else:
        return 'font-size: 10.5px; letter-spacing: 0px;'

STUDENTS = [
    {'nichinoken_id': 'TDN60013', 'name': '日能研太郎', 'kana': 'ニチノウケンタロウ', 'class_name': 'W1', 'course': '4科'},
    {'nichinoken_id': 'TDN60026', 'name': '日能研花子', 'kana': 'ニチノウケンハナコ', 'class_name': 'W1', 'course': '4科'},
    {'nichinoken_id': 'TDN60039', 'name': '日能研次郎', 'kana': 'ニチノウケンジロウ', 'class_name': 'M1', 'course': '2科'},
    {'nichinoken_id': 'TDN60052', 'name': '日能研三郎', 'kana': 'ニチノウケンサブロウ', 'class_name': 'W2', 'course': '4科'},
    {'nichinoken_id': 'TDN60065', 'name': '日能研四郎', 'kana': 'ニチノウケンシロウ', 'class_name': 'M2', 'course': '2科'},
]

COURSES_LIST = [
    '名古屋Ⅰ（Zoom授業）',
    '名古屋Ⅰ（動画のみ）',
    '東海Ⅰ（千種校）',
    '滝Ⅰ（御器所校）',
    '愛知淑徳Ⅰ（御器所校）',
    '金城学院（千種校）'
]

SELECTION_SAMPLES = [
    # 太郎: 2講座
    {'courses': ['名古屋Ⅰ（Zoom授業）', '東海Ⅰ（千種校）'], 'remarks': 'Zoomと対面を併用します。'},
    # 花子: 3講座
    {'courses': ['滝Ⅰ（御器所校）', '愛知淑徳Ⅰ（御器所校）', '金城学院（千種校）'], 'remarks': '第1志望・第2志望対策'},
    # 次郎: 1講座
    {'courses': ['東海Ⅰ（千種校）'], 'remarks': '対面授業を希望'},
    # 三郎: 0講座 (未受講テスト)
    {'courses': [], 'remarks': '不参加'},
    # 四郎: 2講座
    {'courses': ['名古屋Ⅰ（動画のみ）', '愛知淑徳Ⅰ（御器所校）'], 'remarks': '遠方のため動画と対面'}
]

def build_selection_form_html(student, sample_info):
    barcode_svg = generate_code39_svg(student['nichinoken_id'])
    name_style = get_name_style(student['name'])
    selected_courses = sample_info.get('courses', [])
    remarks = sample_info.get('remarks', '')

    course_rows_html = []
    for c in COURSES_LIST:
        is_chk = c in selected_courses
        chk_mark = '<span class="check-mark">✔</span>' if is_chk else ''
        chk_class = 'checked-box' if is_chk else ''
        course_rows_html.append(f'''
            <tr class="row-course">
                <td class="cell-chk">
                    <div class="checkbox-box {chk_class}">{chk_mark}</div>
                </td>
                <td class="cell-course-name">
                    <span class="course-label">{c}</span>
                </td>
                <td class="cell-course-status">
                    <span class="status-tag {'tag-selected' if is_chk else 'tag-none'}">{'希望する' if is_chk else '希望しない'}</span>
                </td>
            </tr>
        ''')

    return f'''
    <div class="form-page">
        <div class="cut-line-container">
            <div class="cut-line-left"></div>
            <span class="cut-label">キリトリ</span>
            <div class="cut-line-right"></div>
        </div>

        <div class="form-wrapper">
            <div class="form-header">
                <div class="header-left">
                    <div class="barcode-box">
                        {barcode_svg}
                    </div>
                </div>
                <div class="header-center">
                    <h1 class="form-title">2026年度　志望校別対策講座 受講確認票</h1>
                </div>
                <div class="header-right">
                    <div class="submit-date">提出日：　 7 　月　 15 　日</div>
                </div>
            </div>

            <table class="form-table">
                <tr class="row-student-info">
                    <td class="cell-id">
                        <div class="cell-label">日能研番号</div>
                        <div class="cell-value-id">{student['nichinoken_id']}</div>
                    </td>
                    <td class="cell-name">
                        <div class="name-container">
                            <span class="cell-label-name">氏名</span>
                            <span class="cell-value-name" style="{name_style}">{student['name']}</span>
                            <span class="cell-honorific">様</span>
                        </div>
                    </td>
                    <td class="cell-class">
                        <div class="cell-label-class">所属クラス</div>
                        <div class="cell-value-class">{student['class_name']}</div>
                    </td>
                </tr>

                <tr class="row-notice">
                    <td colspan="3" class="cell-notice">
                        ※受講を希望される講座の□にチェック（✔）をご記入ください。複数講座の受講が可能です。受講されない場合はチェックを付けずにご提出ください。
                    </td>
                </tr>

                <tr class="row-course-header">
                    <td colspan="3" class="cell-course-table-container">
                        <table class="course-sub-table">
                            <thead>
                                <tr>
                                    <th style="width: 10%;">選択</th>
                                    <th style="width: 70%;">志望校別対策講座名（受講形式 / 校舎）</th>
                                    <th style="width: 20%;">申込区分</th>
                                </tr>
                            </thead>
                            <tbody>
                                {''.join(course_rows_html)}
                            </tbody>
                        </table>
                    </td>
                </tr>

                <tr class="row-footer-info">
                    <td colspan="3" class="cell-footer">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <div style="font-size: 9px; color: #444;">
                                備考: <span style="font-family: 'Yuji Boku', cursive; font-size: 11px;">{remarks}</span>
                            </div>
                            <div style="font-size: 9.5px; font-weight: bold;">
                                保護者氏名: ＿＿＿＿＿＿＿＿＿＿　印
                            </div>
                        </div>
                    </td>
                </tr>
            </table>
        </div>
    </div>
    '''

def build_selection_full_html(students):
    pages = []
    for i, s in enumerate(students):
        sample = SELECTION_SAMPLES[i % len(SELECTION_SAMPLES)]
        pages.append(build_selection_form_html(s, sample))
    
    body = "\n".join(pages)
    return f'''<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>2026年度 志望校別対策講座 受講確認票 - 記入済テスト用</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Yuji+Boku&display=swap');

        @page {{
            size: A5 landscape;
            margin: 0;
        }}

        *, *::before, *::after {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }}

        body {{
            font-family: "BIZ UDPGothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif;
            color: #000;
            background-color: #f1f5f9;
            -webkit-font-smoothing: antialiased;
        }}

        .form-page {{
            width: 210mm;
            height: 148mm;
            margin: 0 auto;
            background: #ffffff;
            padding: 6mm 10mm 5mm 10mm;
            page-break-after: always;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
        }}

        .cut-line-container {{
            display: flex;
            align-items: center;
            width: 100%;
            margin-bottom: 5px;
        }}

        .cut-line-left, .cut-line-right {{
            flex-grow: 1;
            border-top: 1px dashed #666;
        }}

        .cut-label {{
            padding: 0 10px;
            font-size: 9.5px;
            color: #333;
            letter-spacing: 3px;
            font-weight: 500;
        }}

        .form-wrapper {{
            width: 100%;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        }}

        .form-header {{
            display: grid;
            grid-template-columns: 110px 1fr 110px;
            align-items: flex-end;
            margin-bottom: 4px;
            padding: 0 2px;
        }}

        .header-left {{
            text-align: left;
        }}

        .barcode-box {{
            display: inline-block;
        }}

        .header-center {{
            text-align: center;
        }}

        .form-title {{
            font-size: 15.5px;
            font-weight: 900;
            letter-spacing: 1.5px;
            color: #000;
            white-space: nowrap;
        }}

        .header-right {{
            text-align: right;
            padding-bottom: 2px;
        }}

        .submit-date {{
            font-size: 9.5px;
            font-weight: bold;
            white-space: nowrap;
        }}

        .form-table {{
            width: 100%;
            border-collapse: collapse;
            border: 1.8px solid #000;
            flex-grow: 1;
        }}

        .form-table td {{
            border: 1px solid #000;
            vertical-align: middle;
        }}

        .row-student-info {{
            height: 34px;
        }}

        .cell-id {{
            width: 22%;
            text-align: center;
            padding: 2px 4px;
            background: #fafafa;
        }}

        .cell-label {{
            font-size: 8px;
            color: #444;
            margin-bottom: 1px;
        }}

        .cell-value-id {{
            font-family: "Consolas", "Courier New", monospace;
            font-size: 13px;
            font-weight: bold;
        }}

        .cell-name {{
            width: 55%;
            padding: 2px 8px;
        }}

        .name-container {{
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            width: 100%;
        }}

        .cell-label-name {{
            font-size: 8.5px;
            color: #444;
            width: 24px;
        }}

        .cell-value-name {{
            font-weight: bold;
            text-align: center;
            flex-grow: 1;
        }}

        .cell-honorific {{
            font-size: 11px;
            font-weight: bold;
            margin-left: 4px;
        }}

        .cell-class {{
            width: 23%;
            text-align: center;
            padding: 2px 4px;
            background: #fafafa;
        }}

        .cell-label-class {{
            font-size: 8px;
            color: #444;
            margin-bottom: 1px;
        }}

        .cell-value-class {{
            font-size: 13px;
            font-weight: bold;
        }}

        .row-notice {{
            background-color: #f1f3f5;
            height: 18px;
        }}

        .cell-notice {{
            padding: 2px 6px;
            font-size: 7.5px;
            color: #222;
        }}

        .cell-course-table-container {{
            padding: 0;
        }}

        .course-sub-table {{
            width: 100%;
            border-collapse: collapse;
        }}

        .course-sub-table th {{
            background: #f8fafc;
            border-bottom: 1px solid #000;
            border-right: 1px solid #ddd;
            font-size: 8px;
            padding: 2px 6px;
            font-weight: bold;
            text-align: center;
        }}

        .course-sub-table th:last-child {{
            border-right: none;
        }}

        .course-sub-table td {{
            border-bottom: 1px solid #ddd;
            border-right: 1px solid #ddd;
            padding: 3px 6px;
        }}

        .course-sub-table td:last-child {{
            border-right: none;
        }}

        .course-sub-table tr:last-child td {{
            border-bottom: none;
        }}

        .cell-chk {{
            text-align: center;
        }}

        .checkbox-box {{
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 15px;
            height: 15px;
            border: 1.5px solid #000;
            background: #fff;
            margin: 0 auto;
        }}

        .check-mark {{
            font-size: 14px;
            font-weight: 900;
            color: #000;
            line-height: 1;
            transform: translate(0.5px, -1px);
        }}

        .course-label {{
            font-size: 10px;
            font-weight: bold;
            color: #111;
        }}

        .cell-course-status {{
            text-align: center;
        }}

        .status-tag {{
            font-size: 8px;
            padding: 1px 6px;
            border-radius: 3px;
            font-weight: bold;
        }}

        .tag-selected {{
            background: #ede9fe;
            color: #6d28d9;
            border: 1px solid #c4b5fd;
        }}

        .tag-none {{
            color: #94a3b8;
        }}

        .cell-footer {{
            padding: 4px 8px;
            background: #fafafa;
            height: 24px;
        }}
    </style>
</head>
<body>
    {body}
</body>
</html>
'''

def main():
    repo_root = Path(__file__).resolve().parent.parent
    test_data_dir = repo_root / "test_data"
    test_data_dir.mkdir(parents=True, exist_ok=True)

    print(f"Creating test data in: {test_data_dir}")

    # 1. 受講確認モード CSV
    conf_csv_path = test_data_dir / "受講確認モード_生徒名簿.csv"
    with open(conf_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["日能研番号", "氏名", "氏名カナ", "クラス", "科目"])
        for s in STUDENTS:
            writer.writerow([s['nichinoken_id'], s['name'], s['kana'], s['class_name'], s['course']])
    print(f"Generated: {conf_csv_path.name}")

    # 2. 受講確認モード 記入済PDF
    src_conf_pdf = repo_root / "output" / "受講確認票_テストスキャン用_記入済.pdf"
    conf_pdf_path = test_data_dir / "受講確認モード_テストスキャン記入済.pdf"
    if src_conf_pdf.exists():
        shutil.copyfile(src_conf_pdf, conf_pdf_path)
        print(f"Copied: {conf_pdf_path.name}")
    else:
        print(f"Warning: {src_conf_pdf} not found. Running generate_forms.py...")
        subprocess.run([sys.executable, str(repo_root / "scripts" / "generate_forms.py")], check=True)
        shutil.copyfile(src_conf_pdf, conf_pdf_path)
        print(f"Generated and copied: {conf_pdf_path.name}")

    # 3. 講座選択モード CSV
    sel_csv_path = test_data_dir / "講座選択モード_生徒名簿.csv"
    with open(sel_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["日能研番号", "氏名", "氏名カナ", "クラス", "科目"])
        for s in STUDENTS:
            writer.writerow([s['nichinoken_id'], s['name'], s['kana'], s['class_name'], s['course']])
    print(f"Generated: {sel_csv_path.name}")

    # 4. 講座選択モード 記入済HTML & PDF
    sel_html = build_selection_full_html(STUDENTS)
    sel_html_path = test_data_dir / "講座選択_記入済プレビュー.html"
    with open(sel_html_path, "w", encoding="utf-8") as f:
        f.write(sel_html)

    sel_pdf_path = test_data_dir / "講座選択モード_テストスキャン記入済.pdf"

    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not os.path.exists(chrome_path):
        chrome_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

    print(f"Rendering PDF with: {chrome_path}...")
    cmd = [
        chrome_path,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={sel_pdf_path}",
        str(sel_html_path)
    ]
    subprocess.run(cmd, check=True)
    print(f"Generated: {sel_pdf_path.name}")

    # 5. テスト用説明テキストファイル
    desc_path = test_data_dir / "テストデータ説明.txt"
    with open(desc_path, "w", encoding="utf-8") as f:
        f.write("""■ 講義選択モード・受講確認モード テスト用模擬データ一式

【1. 受講確認モード（夏期講習等の通常モード）】
- 生徒名簿CSV: 受講確認モード_生徒名簿.csv (5名)
- テストスキャン用PDF: 受講確認モード_テストスキャン記入済.pdf (5ページ)
  ・1P (TDN60013 日能研太郎): 変更なし
  ・2P (TDN60026 日能研花子): 変更なし
  ・3P (TDN60039 日能研次郎): 変更あり（手書き変更内容あり）
  ・4P (TDN60052 日能研三郎): 変更なし
  ・5P (TDN60065 日能研四郎): 変更あり（手書き変更内容あり）

【2. 講座選択モード（志望校別対策講座）】
- 生徒名簿CSV: 講座選択モード_生徒名簿.csv (5名)
- テストスキャン用PDF: 講座選択モード_テストスキャン記入済.pdf (5ページ)
  ・1P (TDN60013 日能研太郎): 2講座選択 [名古屋Ⅰ（Zoom授業）, 東海Ⅰ（千種校）]
  ・2P (TDN60026 日能研花子): 3講座選択 [滝Ⅰ（御器所校）, 愛知淑徳Ⅰ（御器所校）, 金城学院（千種校）]
  ・3P (TDN60039 日能研次郎): 1講座選択 [東海Ⅰ（千種校）]
  ・4P (TDN60052 日能研三郎): 0講座選択 (未受講テスト)
  ・5P (TDN60065 日能研四郎): 2講座選択 [名古屋Ⅰ（動画のみ）, 愛知淑徳Ⅰ（御器所校）]
""")
    print(f"Generated: {desc_path.name}")

    print("\n=== ALL TEST DATA GENERATED SUCCESSFULLY ===")

if __name__ == "__main__":
    main()
