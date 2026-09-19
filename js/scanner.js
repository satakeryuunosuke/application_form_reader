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
   * ZXing 1Dバーコード（CODE_39 / CODE_128）専用リーダー初期化
   */
  init1DReader() {
    if (this.reader1D) return this.reader1D;
    if (typeof ZXing !== 'undefined') {
      try {
        const hints = new Map();
        if (ZXing.BarcodeFormat && ZXing.BarcodeFormat.CODE_39 !== undefined) {
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
            ZXing.BarcodeFormat.CODE_39,
            ZXing.BarcodeFormat.CODE_128
          ]);
        }
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        this.reader1D = new ZXing.BrowserMultiFormatReader(hints);
      } catch (e) {
        console.warn('ZXing 1D reader initialization warning:', e);
      }
    }
    return this.reader1D;
  },

  /**
   * ZXing 専用 QRコードリーダー初期化（QRコードに特化して高速探索）
   */
  initQRReader() {
    if (this.qrReader) return this.qrReader;
    if (typeof ZXing !== 'undefined') {
      try {
        const hints = new Map();
        if (ZXing.BarcodeFormat && ZXing.BarcodeFormat.QR_CODE !== undefined) {
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE]);
        }
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        this.qrReader = new ZXing.BrowserMultiFormatReader(hints);
      } catch (e) {
        console.warn('ZXing QR reader initialization warning:', e);
      }
    }
    return this.qrReader;
  },

  /**
   * QRコードのResultPoints（Finder Pattern 3点）から中心座標・外接枠・傾き角度（angle）を高精度に算出
   */
  calculateQRBox(points, regX, regY, canvasWidth, canvasHeight) {
    const pts = (points || []).map(p => ({ x: p.getX() + regX, y: p.getY() + regY }));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    let centerX = (minX + maxX) / 2;
    let centerY = (minY + maxY) / 2;
    let angleRad = 0;
    let qrWidth = maxX - minX;
    let qrHeight = maxY - minY;

    if (pts.length >= 3) {
      // 3点間の距離を算出
      const d01 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const d12 = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y);
      const d20 = Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y);

      // 最長対角線の向かいにある点が直角頂点（Top-Left）
      let tl, pA, pB;
      if (d01 >= d12 && d01 >= d20) {
        tl = pts[2]; pA = pts[0]; pB = pts[1];
      } else if (d12 >= d01 && d12 >= d20) {
        tl = pts[0]; pA = pts[1]; pB = pts[2];
      } else {
        tl = pts[1]; pA = pts[2]; pB = pts[0];
      }

      // 2D外積により Top-Right と Bottom-Left を判定
      const vAx = pA.x - tl.x;
      const vAy = pA.y - tl.y;
      const vBx = pB.x - tl.x;
      const vBy = pB.y - tl.y;
      const cross = vAx * vBy - vAy * vBx;

      let tr, bl;
      if (cross > 0) {
        tr = pA; bl = pB;
      } else {
        tr = pB; bl = pA;
      }

      // QRコードによる傾き角補正の無効化（水平固定）:
      // A4縦全体などの長距離チェックボックスにおいて、小さなQRコードのファインダパターンから算出される
      // 微小な検出誤差（0.5°〜1°）がテコの原理（レバーアーム効果）により大きな横ズレを引き起こすため、
      // QRコード時は角度補正を行わず水平固定（angle = 0）とします。
      angleRad = 0;

      // QR中心座標: tl + 0.5 * ((tr - tl) + (bl - tl))
      centerX = tl.x + 0.5 * ((tr.x - tl.x) + (bl.x - tl.x));
      centerY = tl.y + 0.5 * ((tr.y - tl.y) + (bl.y - tl.y));

      // QRコードの1辺の推定サイズ（Finder Pattern間距離はおよそ外枠幅の (N-7)/N）
      const side = Math.hypot(tr.x - tl.x, tr.y - tl.y);
      const estSide = Math.max(side * 1.30, 40);
      qrWidth = estSide;
      qrHeight = estSide;

      minX = Math.max(0, centerX - qrWidth / 2);
      maxX = Math.min(canvasWidth, centerX + qrWidth / 2);
      minY = Math.max(0, centerY - qrHeight / 2);
      maxY = Math.min(canvasHeight, centerY + qrHeight / 2);
    } else {
      qrWidth = Math.max(qrWidth, 40);
      qrHeight = Math.max(qrHeight, 40);
    }

    const angleDeg = 0;

    return {
      x: minX,
      y: minY,
      minX,
      maxX,
      minY,
      maxY,
      width: qrWidth,
      height: qrHeight,
      centerX,
      centerY,
      angle: 0,
      angleDeg: 0,
      isSquare: true
    };
  },

  /**
   * ZXing による高速 QR コード探索（上部領域優先 & 全体フォールバック）
   */
  async scanQRCodeZXing(canvas) {
    const reader = this.initQRReader() || this.initReader();
    if (!reader) return null;

    const cw = canvas.width;
    const ch = canvas.height;

    // 帳票上部優先（上部52%）、必要に応じて全体
    const regions = [
      { name: 'top-half', x: 0, y: 0, w: cw, h: Math.min(ch, Math.round(ch * 0.52)) },
      { name: 'full', x: 0, y: 0, w: cw, h: ch }
    ];

    for (const reg of regions) {
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = reg.w;
      cropCanvas.height = reg.h;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.drawImage(canvas, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);

      // 通常画像とコントラスト強調画像の2パターン
      const attempts = [cropCanvas];
      try {
        const enhancedCanvas = document.createElement('canvas');
        enhancedCanvas.width = reg.w;
        enhancedCanvas.height = reg.h;
        const eCtx = enhancedCanvas.getContext('2d');
        eCtx.drawImage(cropCanvas, 0, 0);
        const imgData = eCtx.getImageData(0, 0, reg.w, reg.h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = lum < 135 ? 0 : 255;
          d[i] = val; d[i + 1] = val; d[i + 2] = val;
        }
        eCtx.putImageData(imgData, 0, 0);
        attempts.push(enhancedCanvas);
      } catch (e) {}

      for (const targetCanvas of attempts) {
        try {
          const dataUrl = targetCanvas.toDataURL('image/png');
          const img = new Image();
          img.src = dataUrl;
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
          });

          const result = await reader.decodeFromImageElement(img);
          if (result) {
            const rawText = (result.getText() || '').trim();
            const points = result.getResultPoints() || [];
            const box = this.calculateQRBox(points, reg.x, reg.y, cw, ch);

            return {
              found: true,
              codeType: 'QR',
              text: rawText,
              rawText: rawText,
              box
            };
          }
        } catch (e) {
          // 次のパターンへ
        }
      }
    }

    return null;
  },

  /**
   * PDFファイルを全ページ解析してスキャン結果リストを返す
   * 
   * @param {File|ArrayBuffer} pdfSource
   * @param {object} template 読取テンプレート
   * @param {(progress: { current: number, total: number, pageStatus: string }) => void} onProgress
   * @param {object} [options] オプション ({ codeType: 'code39'|'qr'|'auto' })
   * @returns {Promise<Array<object>>}
   */
  async processPdf(pdfSource, template, onProgress, options = {}) {
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
      // 解像度（A5や低解像度スキャンでもバーコードの細線を鮮明に捉えるため、最適解像度スケールを自動算出）
      const unscaled = page.getViewport({ scale: 1.0 });
      const maxDim = Math.max(unscaled.width, unscaled.height);
      const scale = Math.max(2.5, Math.min(3.5, 2200 / maxDim));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const pageResult = await this.analyzeCanvas(canvas, template, options);
      pageResult.pageNum = pageNum;
      results.push(pageResult);
    }

    return results;
  },

  /**
   * 画像ファイル（File/Blob）から Canvas を生成
   */
  async imageToCanvas(fileOrBlob) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(fileOrBlob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        return canvas;
      } catch (e) {
        console.warn('createImageBitmap failed, fallback to Image:', e);
      }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(fileOrBlob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  },

  /**
   * 単一画像ファイル（JPEG / PNG等）を解析してスキャン結果を返す
   * 
   * @param {File|Blob} imageFile
   * @param {object} template 読取テンプレート
   * @param {object} [options] オプション ({ codeType: 'code39'|'qr'|'auto' })
   * @returns {Promise<object>}
   */
  async processImage(imageFile, template, options = {}) {
    const canvas = await this.imageToCanvas(imageFile);
    const result = await this.analyzeCanvas(canvas, template, options);
    result.pageNum = 1;
    result.fileName = imageFile.name || '画像ファイル';
    return result;
  },

  /**
   * PDFおよび画像ファイルをまとめて順次解析し、全スキャン結果リストを返す
   * 
   * @param {FileList|Array<File>} fileList
   * @param {object} template 読取テンプレート
   * @param {(progress: { current: number, total: number, status: string }) => void} onProgress
   * @param {object} [options] オプション ({ codeType: 'code39'|'qr'|'auto' })
   * @returns {Promise<Array<object>>}
   */
  async processFiles(fileList, template, onProgress, options = {}) {
    const results = [];
    const files = Array.from(fileList);
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const pdfResults = await this.processPdf(file, template, (prog) => {
          if (onProgress) {
            onProgress({
              current: results.length + prog.current,
              total: results.length + (prog.total - prog.current + 1),
              status: `[${i + 1}/${totalFiles}] ${file.name} (ページ ${prog.current} / ${prog.total})...`
            });
          }
        }, options);
        results.push(...pdfResults);
      } else if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)) {
        if (onProgress) {
          onProgress({
            current: results.length + 1,
            total: Math.max(results.length + 1, totalFiles),
            status: `[${i + 1}/${totalFiles}] ${file.name} を解析中...`
          });
        }
        const imgResult = await this.processImage(file, template, options);
        imgResult.pageNum = results.length + 1;
        results.push(imgResult);
      }
    }

    // 連番を再付与
    results.forEach((r, idx) => {
      r.pageNum = idx + 1;
    });

    return results;
  },

  /**
   * 単一 Canvas に対するコード検出（QR / バーコード）・チェックボックス判定の共通コアロジック
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {object} template
   * @param {object} [options] オプション ({ codeType: 'code39'|'qr'|'auto' })
   * @returns {Promise<object>}
   */
  async analyzeCanvas(canvas, template, options = {}) {
    this.initReader();

    // 1. コード検出（QRコード / CODE 39 / 自動判別）
    const barcodeResult = await this.detectBarcode(canvas, options);

    // 2. チェックボックス判定
    let checkResult = { hasChange: false, noChangeChecked: false, hasChangeChecked: false, customChecks: {} };
    let templateApplied = false;
    let targetRects = null;

    if (barcodeResult.found && template) {
      targetRects = CheckboxEngine.calculateTargetRects(canvas, barcodeResult.box, template);
      const noChangeEval = targetRects.noChangeRect
        ? CheckboxEngine.evaluateCheckbox(canvas, targetRects.noChangeRect, targetRects.threshold)
        : { isChecked: false, darkRatio: 0 };
      const hasChangeEval = targetRects.hasChangeRect
        ? CheckboxEngine.evaluateCheckbox(canvas, targetRects.hasChangeRect, targetRects.threshold)
        : { isChecked: false, darkRatio: 0 };

      const customChecks = {};
      if (targetRects.customRects && targetRects.customRects.length > 0) {
        for (const item of targetRects.customRects) {
          const ev = CheckboxEngine.evaluateCheckbox(canvas, item.rect, targetRects.threshold);
          customChecks[item.id] = {
            id: item.id,
            label: item.label,
            isChecked: ev.isChecked,
            darkRatio: ev.darkRatio
          };
        }
      }

      let hasChange = false;
      if (targetRects.hasChangeRect && targetRects.noChangeRect) {
        hasChange = hasChangeEval.isChecked && !noChangeEval.isChecked;
      } else if (targetRects.hasChangeRect) {
        hasChange = hasChangeEval.isChecked;
      } else if (targetRects.noChangeRect) {
        hasChange = !noChangeEval.isChecked;
      } else {
        hasChange = false;
      }

      checkResult = {
        hasChange,
        noChangeChecked: noChangeEval.isChecked,
        hasChangeChecked: hasChangeEval.isChecked,
        noChangeDarkRatio: noChangeEval.darkRatio,
        hasChangeDarkRatio: hasChangeEval.darkRatio,
        customChecks
      };
      templateApplied = true;
    }

    // 3. ページ画像データURL（生画像 & 枠線オーバーレイ画像）
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    let overlayDataUrl = dataUrl;
    try {
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      const pctx = previewCanvas.getContext('2d');
      pctx.drawImage(canvas, 0, 0);

      // コード検出枠の描画（緑）
      if (barcodeResult.found && barcodeResult.box) {
        const b = barcodeResult.box;
        const bx = b.x !== undefined ? b.x : (b.centerX - b.width / 2);
        const by = b.y !== undefined ? b.y : (b.centerY - b.height / 2);
        pctx.save();
        if (b.angle) {
          pctx.translate(b.centerX, b.centerY);
          pctx.rotate(b.angle);
          pctx.strokeStyle = '#22c55e';
          pctx.lineWidth = Math.max(3, Math.round(canvas.width * 0.0035));
          pctx.strokeRect(-b.width / 2, -b.height / 2, b.width, b.height);
          pctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
          pctx.fillRect(-b.width / 2, -b.height / 2, b.width, b.height);
        } else {
          pctx.strokeStyle = '#22c55e';
          pctx.lineWidth = Math.max(3, Math.round(canvas.width * 0.0035));
          pctx.strokeRect(bx, by, b.width, b.height);
          pctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
          pctx.fillRect(bx, by, b.width, b.height);
        }
        pctx.restore();
      }

      // 標準チェックボックス枠の描画
      if (targetRects) {
        if (targetRects.noChangeRect) {
          const r = targetRects.noChangeRect;
          const isChk = checkResult.noChangeChecked;
          pctx.strokeStyle = isChk ? '#22c55e' : '#94a3b8';
          pctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0025));
          pctx.strokeRect(r.x, r.y, r.width, r.height);
          pctx.fillStyle = isChk ? 'rgba(34, 197, 94, 0.25)' : 'rgba(148, 163, 184, 0.1)';
          pctx.fillRect(r.x, r.y, r.width, r.height);
        }
        if (targetRects.hasChangeRect) {
          const r = targetRects.hasChangeRect;
          const isChk = checkResult.hasChangeChecked;
          pctx.strokeStyle = isChk ? '#eab308' : '#94a3b8';
          pctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0025));
          pctx.strokeRect(r.x, r.y, r.width, r.height);
          pctx.fillStyle = isChk ? 'rgba(234, 179, 8, 0.25)' : 'rgba(148, 163, 184, 0.1)';
          pctx.fillRect(r.x, r.y, r.width, r.height);
        }

        // 講座/カスタムチェックボックス枠の描画（選択: 紫、未選択: スレート）
        if (targetRects.customRects && targetRects.customRects.length > 0) {
          targetRects.customRects.forEach(item => {
            const r = item.rect;
            const isChk = checkResult.customChecks?.[item.id]?.isChecked;
            pctx.strokeStyle = isChk ? '#8b5cf6' : '#64748b';
            pctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0028));
            pctx.strokeRect(r.x, r.y, r.width, r.height);
            pctx.fillStyle = isChk ? 'rgba(139, 92, 246, 0.28)' : 'rgba(100, 116, 139, 0.08)';
            pctx.fillRect(r.x, r.y, r.width, r.height);
          });
        }
      }
      overlayDataUrl = previewCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn('Overlay preview generation failed:', e);
    }

    // 4. バリデーションチェック（前後の*をトリムして評価）
    const rawText = barcodeResult.text || '';
    const validation = rawText ? Validator.validateNichinokenId(rawText) : { isValid: false };

    return {
      barcodeFound: barcodeResult.found,
      codeType: barcodeResult.codeType || (barcodeResult.found ? 'CODE39' : null),
      rawNichinokenId: validation.cleaned || rawText.replace(/^\*+|\*+$/g, ''),
      validatedId: validation.isValid ? validation.cleaned : (validation.cleaned || rawText.replace(/^\*+|\*+$/g, '')),
      isIdValid: validation.isValid,
      idValidationReason: validation.reason || '',
      barcodeBox: barcodeResult.box,
      targetRects,
      checkResult,
      templateApplied,
      imageDataUrl: dataUrl,
      overlayDataUrl: overlayDataUrl,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    };
  },

  /**
   * Canvasからコード（QRコード / CODE 39）を検出
   * options.codeType ('qr' | 'code39' | 'auto') に応じて最適な探索パスを実行
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options] オプション ({ codeType: 'qr'|'code39'|'auto' })
   * @returns {Promise<{ found: boolean, codeType: string|null, text: string, rawText?: string, box: object|null }>}
   */
  async detectBarcode(canvas, options = {}) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return { found: false, codeType: null, text: '', box: null };
    }

    const codeType = options.codeType || 'code39';

    // 1. QRコード専用モード (最速・Code39探索スキップ)
    if (codeType === 'qr') {
      const qrResult = await this.scanQRCodeZXing(canvas);
      if (qrResult && qrResult.found) {
        return qrResult;
      }
      return { found: false, codeType: 'QR', text: '', box: null };
    }

    // 2. CODE 39 専用モード (従来ロジック・QRコード誤認識を防止)
    if (codeType === 'code39') {
      const pureResult = this.scanCode39Dense(canvas);
      if (pureResult && pureResult.found) {
        pureResult.codeType = 'CODE39';
        return pureResult;
      }
      const zxingResult = await this.scanZXingMultiStage(canvas, '1d');
      if (zxingResult && zxingResult.found) {
        zxingResult.codeType = 'CODE39';
        return zxingResult;
      }
      return { found: false, codeType: 'CODE39', text: '', box: null };
    }

    // 3. 自動判別モード (QRコード優先探索 -> 見つからなければ CODE 39)
    const qrResult = await this.scanQRCodeZXing(canvas);
    if (qrResult && qrResult.found) {
      return qrResult;
    }

    const pureResult = this.scanCode39Dense(canvas);
    if (pureResult && pureResult.found) {
      pureResult.codeType = 'CODE39';
      return pureResult;
    }

    const zxingResult = await this.scanZXingMultiStage(canvas);
    if (zxingResult && zxingResult.found) {
      zxingResult.codeType = zxingResult.codeType || 'CODE39';
      return zxingResult;
    }

    return { found: false, codeType: null, text: '', box: null };
  },

  /**
   * Pure JS 高密度・高堅牢 Code 39 デコーダ
   * 1. 垂直バンド列射影（Band Projection）によりスキャン帳票のモアレや量子化ノイズを平滑化
   * 2. バー（5本中2本）とスペース（4本中1本）を独立ランク判定し、インク滲み・白飛びを数学的に完全補正
   * 3. 複数バンドのヒットから線形回帰により高精度な傾き角（angle）とバウンディングボックスを算出
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
    const hits = []; // [{ text, startX, endX, y, midX }]

    // --- ステージA: 垂直バンド列射影（Sliding Band Projection）走査 ---
    // バンドの高さ (20~28px) ごとに垂直平均を計算することで、スキャンモアレ・ノイズを強力に平滑化
    const bandHeight = Math.max(16, Math.min(30, Math.round(height * 0.025)));
    const stepY = Math.max(4, Math.round(bandHeight / 4));

    for (let y = 10; y <= scanHeight - bandHeight; y += stepY) {
      const profile = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        let sumB = 0;
        for (let dy = 0; dy < bandHeight; dy++) {
          sumB += getBrightness(x, y + dy);
        }
        profile[x] = sumB / bandHeight;
      }

      const decoded = this.decodeProfileCode39(profile, width);
      if (decoded) {
        const midY = y + bandHeight / 2;
        hits.push({
          text: decoded.text,
          startX: decoded.startX,
          endX: decoded.endX,
          y: midY,
          width: decoded.endX - decoded.startX,
          midX: (decoded.startX + decoded.endX) / 2
        });
      }
    }

    // --- ステージB: バンド射影でヒットしない場合の単一スキャンライン走査フォールバック ---
    if (hits.length === 0) {
      for (let y = 10; y < scanHeight - 5; y += 2) {
        const grayLine = new Float32Array(width);
        for (let x = 0; x < width; x++) {
          grayLine[x] = getBrightness(x, y);
        }
        const decoded = this.decodeProfileCode39(grayLine, width);
        if (decoded) {
          hits.push({
            text: decoded.text,
            startX: decoded.startX,
            endX: decoded.endX,
            y: y,
            width: decoded.endX - decoded.startX,
            midX: (decoded.startX + decoded.endX) / 2
          });
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

    // ベストなヒット群からバウンディングボックスおよび傾き角を精密算出
    const validHits = hits.filter(h => h.text === bestText);
    let minX = width, maxX = 0, minY = height, maxY = 0;

    let sumY = 0;
    let sumMidX = 0;
    for (const h of validHits) {
      if (h.startX < minX) minX = h.startX;
      if (h.endX > maxX) maxX = h.endX;
      if (h.y < minY) minY = h.y;
      if (h.y > maxY) maxY = h.y;
      sumY += h.y;
      sumMidX += h.midX;
    }

    // 線形回帰によるバーコード傾き（スキュー角）の算出
    let angleRad = 0;
    if (validHits.length >= 3) {
      const avgY = sumY / validHits.length;
      const avgMidX = sumMidX / validHits.length;
      let num = 0;
      let den = 0;
      for (const h of validHits) {
        const dy = h.y - avgY;
        const dx = h.midX - avgMidX;
        num += dy * dx;
        den += dy * dy;
      }
      if (den > 0.001) {
        const slope = num / den;
        const estAngle = -Math.atan(slope);
        if (Math.abs(estAngle) < (25 * Math.PI / 180)) {
          angleRad = estAngle;
        }
      }
    }

    // バーコード上下マージン補正
    minY = Math.max(0, minY - Math.round(bandHeight / 2));
    maxY = Math.min(height, maxY + Math.round(bandHeight / 2));

    const bWidth = Math.max(maxX - minX, 40);
    const bHeight = Math.max(maxY - minY, 20);
    const centerX = minX + bWidth / 2;
    const centerY = minY + bHeight / 2;

    const cleanedText = bestText.replace(/^\*+|\*+$/g, '');
    const angleDeg = angleRad * (180 / Math.PI);

    return {
      found: true,
      text: cleanedText,
      rawText: bestText,
      box: {
        x: minX,
        y: minY,
        minX,
        maxX,
        minY,
        maxY,
        width: bWidth,
        height: bHeight,
        centerX,
        centerY,
        angle: angleRad,
        angleDeg: angleDeg
      }
    };
  },

  /**
   * 垂直バンド射影プロファイル（または水平ライン）から堅牢に Code 39 をデコード
   * 黒バー5本中上位2本、白スペース4本中上位1本を Wide とする相対ランク判定
   */
  decodeProfileCode39(profile, width) {
    let minB = 255, maxB = 0;
    for (let x = 0; x < width; x++) {
      const b = profile[x];
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
    if (maxB - minB < 35) return null;

    const midTh = Math.round((minB + maxB) / 2);
    const testThresholds = [midTh, 140, 125, 155, 110, 170];

    const barIndices = [0, 2, 4, 6, 8];
    const spaceIndices = [1, 3, 5, 7];

    for (const th of testThresholds) {
      const runs = [];
      let currentIsBlack = profile[0] < th;
      let currentLen = 1;
      let currentStart = 0;

      for (let x = 1; x < width; x++) {
        const isBlack = profile[x] < th;
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

      if (runs.length < 10) continue;

      // スタートキャラクタ '*' (010010100) を探索
      for (let i = 1; i <= runs.length - 9; i++) {
        if (!runs[i].isBlack) continue;
        if (runs[i - 1].len < 5) continue; // クワイエットゾーン

        const elemLengths = runs.slice(i, i + 9).map(r => r.len);
        const bars = barIndices.map(k => ({ len: elemLengths[k], idx: k })).sort((a, b) => a.len - b.len);
        const spaces = spaceIndices.map(k => ({ len: elemLengths[k], idx: k })).sort((a, b) => a.len - b.len);

        if (bars[3].len <= bars[2].len || spaces[3].len <= spaces[2].len) continue;

        const wideSet = new Set([bars[3].idx, bars[4].idx, spaces[3].idx]);
        let startPat = '';
        for (let k = 0; k < 9; k++) {
          startPat += wideSet.has(k) ? '1' : '0';
        }

        if (startPat === CODE39_PATTERNS['*']) {
          // スタートキャラクタ検出！後続文字をデコード
          const decodedChars = ['*'];
          let charIdx = i + 9;
          let lastCharEnd = runs[i + 8].endX;
          const startX = runs[i].startX;

          while (charIdx + 9 <= runs.length) {
            // キャラクタ間ギャップ（白スペース）の検証
            if (runs[charIdx].isBlack) break;

            const nextStart = charIdx + 1;
            if (nextStart + 9 > runs.length || !runs[nextStart].isBlack) break;

            const nextElems = runs.slice(nextStart, nextStart + 9).map(r => r.len);
            const nextBars = barIndices.map(k => ({ len: nextElems[k], idx: k })).sort((a, b) => a.len - b.len);
            const nextSpaces = spaceIndices.map(k => ({ len: nextElems[k], idx: k })).sort((a, b) => a.len - b.len);

            if (nextBars[3].len <= nextBars[2].len || nextSpaces[3].len <= nextSpaces[2].len) break;

            const nextWide = new Set([nextBars[3].idx, nextBars[4].idx, nextSpaces[3].idx]);
            let nextPat = '';
            for (let k = 0; k < 9; k++) {
              nextPat += nextWide.has(k) ? '1' : '0';
            }

            const char = REV_CODE39[nextPat];
            if (!char) break;

            decodedChars.push(char);
            lastCharEnd = runs[nextStart + 8].endX;

            if (char === '*' && decodedChars.length >= 3) {
              return {
                text: decodedChars.join(''),
                startX,
                endX: lastCharEnd
              };
            }

            charIdx = nextStart + 9;
          }
        }
      }
    }

    return null;
  },

  /**
   * ZXing によるマルチステージ探索（ROI クロップ & コントラスト強調リトライ）
   * decodeFromImageElement により安定呼び出し
   */
  async scanZXingMultiStage(canvas, readerMode = 'auto') {
    const reader = (readerMode === '1d')
      ? (this.init1DReader() || this.initReader())
      : (this.initReader());
    if (!reader) return null;

    const cw = canvas.width;
    const ch = canvas.height;

    // 試行する領域リスト (左上、上部全幅、全体)
    const regions = [
      { name: 'top-left', x: 0, y: 0, w: Math.round(cw * 0.60), h: Math.round(ch * 0.35) },
      { name: 'top-full', x: 0, y: 0, w: cw, h: Math.round(ch * 0.40) },
      { name: 'full', x: 0, y: 0, w: cw, h: ch }
    ];

    for (const reg of regions) {
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = reg.w;
      cropCanvas.height = reg.h;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.drawImage(canvas, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);

      // 通常画像とコントラスト強調画像の2パターンを試行
      const attempts = [cropCanvas];
      try {
        const enhancedCanvas = document.createElement('canvas');
        enhancedCanvas.width = reg.w;
        enhancedCanvas.height = reg.h;
        const eCtx = enhancedCanvas.getContext('2d');
        eCtx.drawImage(cropCanvas, 0, 0);
        const imgData = eCtx.getImageData(0, 0, reg.w, reg.h);
        const d = imgData.data;
        // 高コントラスト二値化フィルタ
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = lum < 140 ? 0 : 255;
          d[i] = val; d[i + 1] = val; d[i + 2] = val;
        }
        eCtx.putImageData(imgData, 0, 0);
        attempts.push(enhancedCanvas);
      } catch (e) {
        // 画像処理エラー時は通常画像のみ
      }

      for (const targetCanvas of attempts) {
        try {
          const dataUrl = targetCanvas.toDataURL('image/png');
          const img = new Image();
          img.src = dataUrl;
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
          });

          const result = await reader.decodeFromImageElement(img);
          if (result) {
            const rawText = result.getText() || '';
            const points = result.getResultPoints() || [];
            const format = result.getBarcodeFormat ? result.getBarcodeFormat() : null;
            const isQR = (format === ZXing.BarcodeFormat.QR_CODE);

            if (isQR) {
              const box = this.calculateQRBox(points, reg.x, reg.y, cw, ch);
              return {
                found: true,
                codeType: 'QR',
                text: rawText.trim(),
                rawText: rawText,
                box
              };
            }

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

            // 傾き角の算出
            let angleRad = 0;
            if (points.length >= 2) {
              let p1 = points[0];
              let p2 = points[points.length - 1];
              if (p1.getX() > p2.getX()) {
                const tmp = p1; p1 = p2; p2 = tmp;
              }
              const pdx = p2.getX() - p1.getX();
              const pdy = p2.getY() - p1.getY();
              if (pdx > 10) {
                const estAngle = Math.atan2(pdy, pdx);
                if (Math.abs(estAngle) < (25 * Math.PI / 180)) {
                  angleRad = estAngle;
                }
              }
            }
            const angleDeg = Math.round(angleRad * (180 / Math.PI) * 10) / 10;

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
              codeType: 'CODE39',
              text: cleanedText,
              rawText: rawText,
              box: {
                x: gMinX,
                y: gMinY,
                minX: gMinX,
                maxX: gMaxX,
                minY: gMinY,
                maxY: gMaxY,
                width,
                height,
                centerX,
                centerY,
                angle: angleRad,
                angleDeg: angleDeg
              }
            };
          }
        } catch (e) {
          // 次の試行へ
        }
      }
    }

    return null;
  }
};
