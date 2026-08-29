/**
 * PDF レンダリング & 高精度 CODE 39 / 1D バーコードスキャン & チェックボックス解析エンジン
 */

import { CheckboxEngine } from './checkbox.js';
import { Validator } from './utils/validator.js';

// --- CODE 39 PATTERNS (Standard Code 39) ---
const CODE39_PATTERNS = {
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
};

const REV_CODE39 = {};
for (const [char, pat] of Object.entries(CODE39_PATTERNS)) {
  REV_CODE39[pat] = char;
}

export const ScannerEngine = {
  reader: null,

  /**
   * ZXing バーコードリーダー初期化
   */
  initReader() {
    if (this.reader) return this.reader;
    if (typeof ZXing !== 'undefined') {
      try {
        const hints = new Map();
        if (ZXing.BarcodeFormat && ZXing.BarcodeFormat.CODE_39 !== undefined) {
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
            ZXing.BarcodeFormat.CODE_39,
            ZXing.BarcodeFormat.CODE_128,
            ZXing.BarcodeFormat.QR_CODE
          ]);
        }
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        this.reader = new ZXing.BrowserMultiFormatReader(hints);
      } catch (e) {
        console.warn('ZXing initialization warning:', e);
      }
    }
    return this.reader;
  },

  /**
   * PDFファイルを全ページ解析してスキャン結果リストを返す
   * 
   * @param {File|ArrayBuffer} pdfSource
   * @param {object} template 読取テンプレート
   * @param {(progress: { current: number, total: number, pageStatus: string }) => void} onProgress
   * @returns {Promise<Array<object>>}
   */
  async processPdf(pdfSource, template, onProgress) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('pdf.js ライブラリが読み込まれていません');
    }

    // pdf.worker の設定
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
    }

    let arrayBuffer;
    if (pdfSource instanceof File) {
      arrayBuffer = await pdfSource.arrayBuffer();
    } else {
      arrayBuffer = pdfSource;
    }

    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdfDoc.numPages;
    const results = [];

    this.initReader();

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onProgress) {
        onProgress({ current: pageNum, total: numPages, status: `ページ ${pageNum} / ${numPages} を解析中...` });
      }

      const page = await pdfDoc.getPage(pageNum);
      // 解像度（高精度認識のため 2.0 スケール）
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // 1. バーコード検出（Pure 1D 高速スキャン + ZXing ROI ハイブリッド）
      const barcodeResult = await this.detectBarcode(canvas);

      // 2. チェックボックス判定
      let checkResult = { hasChange: false, noChangeChecked: false, hasChangeChecked: false };
      let templateApplied = false;

      let targetRects = null;
      if (barcodeResult.found && template) {
        targetRects = CheckboxEngine.calculateTargetRects(canvas, barcodeResult.box, template);
        const noChangeEval = CheckboxEngine.evaluateCheckbox(canvas, targetRects.noChangeRect, targetRects.threshold);
        const hasChangeEval = CheckboxEngine.evaluateCheckbox(canvas, targetRects.hasChangeRect, targetRects.threshold);

        checkResult = {
          noChangeChecked: noChangeEval.isChecked,
          hasChangeChecked: hasChangeEval.isChecked,
          noChangeRatio: noChangeEval.darkRatio,
          hasChangeRatio: hasChangeEval.darkRatio,
          // 「変更あり」にチェックがあれば変更あり、そうでなければ変更なし
          hasChange: hasChangeEval.isChecked && !noChangeEval.isChecked
        };
        templateApplied = true;
      }

      // 3. ページ画像データURL（プレビュー用）
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      // 4. バリデーションチェック（前後の*をトリムして評価）
      const rawText = barcodeResult.text || '';
      const validation = rawText ? Validator.validateNichinokenId(rawText) : { isValid: false };

      results.push({
        pageNum,
        barcodeFound: barcodeResult.found,
        rawNichinokenId: validation.cleaned || rawText.replace(/^\*+|\*+$/g, ''),
        validatedId: validation.isValid ? validation.cleaned : (validation.cleaned || rawText.replace(/^\*+|\*+$/g, '')),
        isIdValid: validation.isValid,
        idValidationReason: validation.reason || '',
        barcodeBox: barcodeResult.box,
        targetRects,
        checkResult,
        templateApplied,
        imageDataUrl: dataUrl,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      });
    }

    return results;
  },

  /**
   * CanvasからCODE 39バーコードを高速・高精度に検出
   * 
   * 1. 帳票上部領域を高密度水平スキャンライン解析（Pure JS Code39 Engine）
   * 2. 必要に応じてZXingによるROI局所探索
   * 3. 確実なバウンディングボックスとデコード文字列を返却
   */
  async detectBarcode(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return { found: false, text: '', box: null };
    }

    // --- ステージ1: Pure 1D 高密度スキャンライン探索 ---
    const pureResult = this.scanCode39Dense(canvas);
    if (pureResult && pureResult.found) {
      return pureResult;
    }

    // --- ステージ2: ZXing による局所ROIマルチステージ探索 ---
    const zxingResult = await this.scanZXingMultiStage(canvas);
    if (zxingResult && zxingResult.found) {
      return zxingResult;
    }

    return { found: false, text: '', box: null };
  },

  /**
   * Pure JS 高密度スキャンライン Code 39 デコーダ
   * 画像の上部（y: 0%〜45%）を2ピクセル刻みで走査し、ノイズに影響されずに瞬時に検出
   */
  scanCode39Dense(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // 上部 45% の領域をサンプリング
    const scanHeight = Math.min(height, Math.round(height * 0.45));
    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, width, scanHeight);
    } catch (e) {
      console.warn('getImageData error:', e);
      return null;
    }

    const data = imgData.data;

    // グレースケール輝度変換ヘルパー
    const getBrightness = (x, y) => {
      const idx = (y * width + x) * 4;
      return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    };

    // 検出結果の集計コンテナ
    const hits = []; // [{ text, startX, endX, y, width }]

    // 複数の二値化閾値でテスト（標準、暗め、明るめ）
    const thresholds = [135, 120, 150];

    // 水平スキャンライン走査（上から下へ 2px 刻み）
    for (let y = 10; y < scanHeight - 5; y += 2) {
      // 輝度ライン抽出
      const grayLine = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        grayLine[x] = getBrightness(x, y);
      }

      for (const th of thresholds) {
        const decoded = this.decodeSingleLineCode39(grayLine, th, width);
        if (decoded) {
          hits.push({
            text: decoded.text,
            startX: decoded.startX,
            endX: decoded.endX,
            y: y,
            width: decoded.endX - decoded.startX
          });
          // この行でヒットしたら次の閾値はスキップ
          break;
        }
      }
    }

    if (hits.length === 0) {
      return null;
    }

    // 最も多くヒットした文字列を集計
    const textCounts = {};
    for (const h of hits) {
      textCounts[h.text] = (textCounts[h.text] || 0) + 1;
    }

    let bestText = '';
    let maxCount = 0;
    for (const [txt, cnt] of Object.entries(textCounts)) {
      if (cnt > maxCount) {
        maxCount = cnt;
        bestText = txt;
      }
    }

    // ベストなヒット群からバウンディングボックスを精密算出
    const validHits = hits.filter(h => h.text === bestText);
    let minX = width, maxX = 0, minY = height, maxY = 0;

    for (const h of validHits) {
      if (h.startX < minX) minX = h.startX;
      if (h.endX > maxX) maxX = h.endX;
      if (h.y < minY) minY = h.y;
      if (h.y > maxY) maxY = h.y;
    }

    // バーコードの上下マージン補正（スキャンライン範囲より実際のバーは数px上下に伸びている）
    const barHeight = Math.max(maxY - minY, 20);
    minY = Math.max(0, minY - 2);
    maxY = Math.min(height, maxY + 2);

    const bWidth = Math.max(maxX - minX, 40);
    const bHeight = Math.max(maxY - minY, 20);
    const centerX = minX + bWidth / 2;
    const centerY = minY + bHeight / 2;

    const cleanedText = bestText.replace(/^\*+|\*+$/g, '');

    return {
      found: true,
      text: cleanedText,
      rawText: bestText,
      box: {
        minX,
        maxX,
        minY,
        maxY,
        width: bWidth,
        height: bHeight,
        centerX,
        centerY
      }
    };
  },

  /**
   * 1本の水平輝度ラインから Code 39 をデコード
   */
  decodeSingleLineCode39(grayLine, threshold, width) {
    // ランレングス（白黒の連続区間）を計算
    const runs = []; // [{ isBlack: boolean, len: number, startX: number, endX: number }]
    let currentIsBlack = grayLine[0] < threshold;
    let currentLen = 1;
    let currentStart = 0;

    for (let x = 1; x < width; x++) {
      const isBlack = grayLine[x] < threshold;
      if (isBlack === currentIsBlack) {
        currentLen++;
      } else {
        runs.push({
          isBlack: currentIsBlack,
          len: currentLen,
          startX: currentStart,
          endX: x
        });
        currentIsBlack = isBlack;
        currentLen = 1;
        currentStart = x;
      }
    }
    runs.push({
      isBlack: currentIsBlack,
      len: currentLen,
      startX: currentStart,
      endX: width
    });

    if (runs.length < 10) return null;

    // Code 39 のスタートキャラクタ '*' (010010100) を探索
    // 9エレメント (バー5本, スペース4本)
    for (let i = 0; i <= runs.length - 9; i++) {
      if (!runs[i].isBlack) continue; // バーコードは黒バーから開始

      // 9エレメントの長さを取得
      const elemLengths = runs.slice(i, i + 9).map(r => r.len);
      const sorted = [...elemLengths].sort((a, b) => a - b);
      // Code 39 は 3 wide, 6 narrow
      const narrowMax = sorted[5];
      const wideMin = sorted[6];

      // wide は narrow の少なくとも 1.3 倍以上
      if (wideMin <= narrowMax * 1.3) continue;

      const th = (narrowMax + wideMin) / 2.0;
      let pattern = '';
      for (let j = 0; j < 9; j++) {
        pattern += elemLengths[j] > th ? '1' : '0';
      }

      if (pattern === CODE39_PATTERNS['*']) {
        // スタートキャラクタ検出！以降の文字を連続デコード
        const decodedChars = ['*'];
        let charIdx = i + 9;
        let lastCharEnd = runs[i + 8].endX;
        let startX = runs[i].startX;

        while (charIdx + 9 <= runs.length) {
          // キャラクタ間ギャップ（白スペース1つ）を検証
          const gapRun = runs[charIdx];
          if (gapRun.isBlack) {
            // ギャップがスキップされているか不正
            break;
          }
          // ギャップの次の黒バーから9エレメント
          const charStartIdx = charIdx + 1;
          if (charStartIdx + 9 > runs.length) break;
          if (!runs[charStartIdx].isBlack) break;

          const nextElemLengths = runs.slice(charStartIdx, charStartIdx + 9).map(r => r.len);
          const nextSorted = [...nextElemLengths].sort((a, b) => a - b);
          const nMax = nextSorted[5];
          const wMin = nextSorted[6];

          if (wMin <= nMax * 1.25) break;

          const charTh = (nMax + wMin) / 2.0;
          let charPat = '';
          for (let k = 0; k < 9; k++) {
            charPat += nextElemLengths[k] > charTh ? '1' : '0';
          }

          const char = REV_CODE39[charPat];
          if (!char) break;

          decodedChars.push(char);
          lastCharEnd = runs[charStartIdx + 8].endX;

          if (char === '*' && decodedChars.length >= 3) {
            // ストップキャラクタに到達！
            return {
              text: decodedChars.join(''),
              startX: startX,
              endX: lastCharEnd
            };
          }

          charIdx = charStartIdx + 9;
        }
      }
    }

    return null;
  },

  /**
   * ZXing によるマルチステージ探索（ROI クロップ）
   */
  async scanZXingMultiStage(canvas) {
    if (!this.reader) {
      this.initReader();
    }
    if (!this.reader) return null;

    const cw = canvas.width;
    const ch = canvas.height;

    // 試行する領域リスト (左上、上部全幅、全体)
    const regions = [
      { name: 'top-left', x: 0, y: 0, w: Math.round(cw * 0.60), h: Math.round(ch * 0.35) },
      { name: 'top-full', x: 0, y: 0, w: cw, h: Math.round(ch * 0.40) },
      { name: 'full', x: 0, y: 0, w: cw, h: ch }
    ];

    for (const reg of regions) {
      try {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = reg.w;
        cropCanvas.height = reg.h;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);

        const result = await this.reader.decodeFromCanvas(cropCanvas);
        if (result) {
          const rawText = result.getText() || '';
          const points = result.getResultPoints() || [];

          let minX = reg.w, maxX = 0, minY = reg.h, maxY = 0;
          for (const pt of points) {
            const px = pt.getX();
            const py = pt.getY();
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }

          if (minX > maxX) {
            minX = 0;
            maxX = reg.w;
            minY = 0;
            maxY = reg.h;
          }

          // 親キャンバスのグローバル座標系に変換
          const gMinX = reg.x + minX;
          const gMaxX = reg.x + maxX;
          const gMinY = reg.y + minY;
          const gMaxY = reg.y + maxY;

          const width = Math.max(gMaxX - gMinX, 40);
          const height = Math.max(gMaxY - gMinY, 20);
          const centerX = gMinX + width / 2;
          const centerY = gMinY + height / 2;

          const cleanedText = rawText.replace(/^\*+|\*+$/g, '');

          return {
            found: true,
            text: cleanedText,
            rawText: rawText,
            box: { minX: gMinX, maxX: gMaxX, minY: gMinY, maxY: gMaxY, width, height, centerX, centerY }
          };
        }
      } catch (e) {
        // 次の領域を試行
      }
    }

    return null;
  }
};
