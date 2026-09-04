/**
 * CSV / Excel パースおよびエクスポートユーティリティ
 */

import { Validator } from './validator.js';

export const CsvUtil = {
  /**
   * CSV文字列をパースして生徒オブジェクトの配列を返す
   * 先頭列: 日能研番号, 氏名, 氏名カナ, クラス, 科目(4科/2科)
   * ヘッダー名による動的列判定および位置指定に対応
   * 
   * @param {string} csvText
   * @returns {{ students: Array<{ nichinokenId: string, name: string, nameKana: string, className: string, course: string }>, errors: Array<{ row: number, message: string }> }}
   */
  parseStudentsCsv(csvText) {
    const lines = csvText.split(/\r\n|\n|\r/).filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return { students: [], errors: [{ row: 0, message: 'CSVファイルが空です' }] };
    }

    const students = [];
    const errors = [];
    const seenIds = new Set();

    // 先頭行がヘッダーか判定
    let startIndex = 0;
    let colIndices = {
      id: 0,
      name: 1,
      kana: 2,
      class: 3,
      course: 4
    };

    const firstLineCols = this.parseCsvLine(lines[0]);
    const isHeader = (
      firstLineCols.some(c => c.includes('番号') || c.toLowerCase().includes('id') || c.includes('氏名') || c.includes('名前'))
    );

    if (isHeader) {
      startIndex = 1;
      // ヘッダー名から各列インデックスを動的に検索
      firstLineCols.forEach((col, idx) => {
        const clean = col.replace(/[\s　_（）\(\)［］\[\]]+/g, '');
        const cLower = clean.toLowerCase();

        // カナ判定キーワード: カナ, フリガナ, ふりがな, よみがな, かな, kana
        const isKanaHeader = clean.includes('カナ') || clean.includes('フリガナ') || 
                             clean.includes('ふりがな') || clean.includes('よみがな') || 
                             clean.includes('かな') || cLower.includes('kana');

        // 番号判定キーワード
        const isIdHeader = clean.includes('番号') || cLower.includes('id') || clean.includes('記号') || clean.includes('コード');

        // 氏名判定キーワード（カナを含まないこと）
        const isNameHeader = (clean.includes('氏名') || clean.includes('名前') || clean.includes('生徒名') || clean.includes('生徒') || cLower.includes('name')) && !isKanaHeader;

        // クラス判定キーワード
        const isClassHeader = clean.includes('クラス') || clean.includes('組') || cLower.includes('class');

        // 科目判定キーワード
        const isCourseHeader = clean.includes('科目') || clean.includes('コース') || clean.includes('4科') || clean.includes('2科') || cLower.includes('course');

        if (isIdHeader) {
          colIndices.id = idx;
        } else if (isKanaHeader) {
          colIndices.kana = idx;
        } else if (isNameHeader) {
          colIndices.name = idx;
        } else if (isClassHeader) {
          colIndices.class = idx;
        } else if (isCourseHeader) {
          colIndices.course = idx;
        }
      });
    }

    for (let i = startIndex; i < lines.length; i++) {
      const rowNum = i + 1;
      const cols = this.parseCsvLine(lines[i]);
      if (cols.length === 0 || cols.every(c => !c)) continue;

      const nichinokenId = (cols[colIndices.id] || cols[0] || '').trim().toUpperCase();
      let name = (cols[colIndices.name] || cols[1] || '').trim();
      let nameKana = (cols[colIndices.kana] || (cols.length > 2 ? cols[2] : '') || '').trim();
      const className = (cols[colIndices.class] || (cols.length > 3 ? cols[3] : '') || '').trim();
      const rawCourse = (cols[colIndices.course] !== undefined ? cols[colIndices.course] : (cols.length > 4 ? cols[4] : '')).trim();

      // 氏名とカナの自己補正（もしカナ側に漢字があり、氏名側がカナのみの場合は自動スワップ）
      const hasKanjiInKana = /[\u4e00-\u9faf]/.test(nameKana);
      const isKanaOnlyName = /^[ぁ-んァ-ヶー・\s　]+$/.test(name);
      if (hasKanjiInKana && isKanaOnlyName) {
        const tmp = name;
        name = nameKana;
        nameKana = tmp;
      }

      // 科目（4科 / 2科）の判定・正規化（未指定時はデフォルト4科）
      let course = '4科';
      if (rawCourse) {
        if (rawCourse.includes('2')) {
          course = '2科';
        } else if (rawCourse.includes('4')) {
          course = '4科';
        } else if (rawCourse === '2科' || rawCourse === '4科') {
          course = rawCourse;
        }
      }

      if (!nichinokenId) {
        errors.push({ row: rowNum, message: '日能研番号が空です' });
        continue;
      }
      if (!name) {
        errors.push({ row: rowNum, message: `${nichinokenId}: 氏名が空です` });
        continue;
      }
      if (!className) {
        errors.push({ row: rowNum, message: `${nichinokenId}: クラスが空です` });
        continue;
      }

      // バリデーション警告（チェックデジットの確認）
      const validation = Validator.validateNichinokenId(nichinokenId);
      if (!validation.isValid) {
        errors.push({ row: rowNum, message: `${nichinokenId}: ${validation.reason}` });
      }

      if (seenIds.has(nichinokenId)) {
        errors.push({ row: rowNum, message: `重複した日能研番号です: ${nichinokenId}` });
        continue;
      }
      seenIds.add(nichinokenId);

      students.push({
        nichinokenId,
        name,
        nameKana: nameKana || '',
        className,
        course
      });
    }

    return { students, errors };
  },

  /**
   * 1行のCSVテキストを配列に分解（カンマ区切りおよびダブルクォート対応）
   */
  parseCsvLine(text) {
    const result = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  },

  /**
   * 配布用生徒データCSVテンプレートのダウンロード
   */
  downloadTemplateCsv() {
    const header = ['日能研番号', '氏名', '氏名カナ', 'クラス', '科目', '', ''];
    const sample1 = ['TDN60013', '日能研太郎', 'ニチノウケンタロウ', 'W1', '4科', '', ''];
    const sample2 = ['TDN60026', '日能研花子', 'ニチノウケンハナコ', 'W1', '4科', '', ''];
    const sample3 = ['TDN60039', '日能研次郎', 'ニチノウケンジロウ', 'M1', '2科', '', ''];

    const csvContent = [header, sample1, sample2, sample3]
      .map(row => row.join(','))
      .join('\r\n');

    this.downloadFile(csvContent, '生徒データ取込テンプレート.csv', 'text/csv;charset=utf-8;');
  },

  /**
   * 提出状況一覧テーブルをCSVエクスポート（Excel文字化け防止のBOM付き）
   */
  exportSubmissionsCsv(rows, fileName = '受講確認票_提出集計.csv') {
    const headers = [
      '日能研番号',
      '氏名',
      '氏名カナ',
      '所属クラス',
      '所属科目',
      '提出ステータス',
      '受講クラス',
      '受講科目',
      '受付方法',
      '承認者',
      '受付・承認日時',
      '特記事項'
    ];

    const csvRows = [headers.join(',')];

    for (const r of rows) {
      const escape = val => `"${(val || '').toString().replace(/"/g, '""')}"`;
      csvRows.push([
        escape(r.nichinokenId),
        escape(r.name),
        escape(r.nameKana),
        escape(r.className),
        escape(r.course || '4科'),
        escape(r.status),
        escape(r.enrollmentClass || '-'),
        escape(r.enrollmentCourse || (r.status === '承認済' ? (r.enrollmentClass === '非受講' ? '非受講' : (r.course || '4科')) : '-')),
        escape(r.inputMethod || '-'),
        escape(r.approvedBy || '-'),
        escape(r.approvedAt || r.submittedAt || '-'),
        escape(r.remarks || '')
      ].join(','));
    }

    const csvContent = csvRows.join('\r\n');
    this.downloadFile(csvContent, fileName, 'text/csv;charset=utf-8;');
  },

  /**
   * SheetJS (XLSX) が利用可能な場合のExcel (.xlsx) エクスポート
   */
  exportSubmissionsExcel(rows, fileName = '受講確認票_提出集計.xlsx') {
    if (typeof XLSX === 'undefined') {
      // フォールバックでCSV出力
      this.exportSubmissionsCsv(rows, fileName.replace(/\.xlsx$/, '.csv'));
      return;
    }

    const data = [
      ['日能研番号', '氏名', '氏名カナ', '所属クラス', '所属科目', '提出ステータス', '受講クラス', '受講科目', '受付方法', '承認者', '受付・承認日時', '特記事項']
    ];

    for (const r of rows) {
      data.push([
        r.nichinokenId || '',
        r.name || '',
        r.nameKana || '',
        r.className || '',
        r.course || '4科',
        r.status || '',
        r.enrollmentClass || '-',
        r.enrollmentCourse || (r.status === '承認済' ? (r.enrollmentClass === '非受講' ? '非受講' : (r.course || '4科')) : '-'),
        r.inputMethod || '-',
        r.approvedBy || '-',
        r.approvedAt || r.submittedAt || '-',
        r.remarks || ''
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '提出集計');
    XLSX.writeFile(wb, fileName);
  },

  /**
   * ファイルダウンロードヘルパー（BOM付与）
   */
  downloadFile(content, fileName, mimeType) {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); // UTF-8 BOM
    const blob = new Blob([bom, content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
