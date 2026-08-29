/**
 * チェックボックス判定モジュール（バーコードアンカー相対座標方式）
 */

export const CheckboxEngine = {
  /**
   * デフォルトの読取テンプレート相対定義
   * （バーコード中心位置を原点(0,0)としたときの相対オフセットとサイズ）
   * dx, dy, size はページ全体の幅/高さを1.0とした比率（枠は正方形）
   */
  getDefaultTemplate() {
    return {
      // 変更なしチェックボックス（バーコード中心からの相対距離）
      noChangeBox: {
        dx: -0.058, // 左右オフセット（ページ幅比率）
        dy: 0.225,  // 上下オフセット（ページ高比率）
        size: 0.032 // 正方形の一辺のサイズ（枠線全体が完全に収まる大きさ）
      },
      // 変更ありチェックボックス
      hasChangeBox: {
        dx: -0.058,
        dy: 0.292,
        size: 0.032
      },
      threshold: 0.25 // 黒画素率 25% 以上でチェック有りと判定（枠線全体の黒画素を含むため高めに設定）
    };
  },

  /**
   * 指定Canvas内のROI領域における黒画素率（ダークピクセル割合）を計算
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {{ x: number, y: number, w: number, h: number }} rect ピクセル座標
   * @param {number} checkThreshold 判定閾値 (デフォルト: 0.25)
   * @param {number} darknessThreshold 輝度閾値 (0~255, 140以下を黒とみなす)
   * @returns {{ darkRatio: number, isChecked: boolean, totalPixels: number, darkPixels: number }}
   */
  evaluateCheckbox(canvas, rect, checkThreshold = 0.25, darknessThreshold = 140) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 境界クランプ
    const x = Math.max(0, Math.min(Math.round(rect.x), width - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), height - 1));
    const w = Math.max(1, Math.min(Math.round(rect.w), width - x));
    const h = Math.max(1, Math.min(Math.round(rect.h), height - y));

    try {
      const imageData = ctx.getImageData(x, y, w, h);
      const data = imageData.data;
      const totalPixels = w * h;
      let darkPixels = 0;

      // チェックボックスの枠線全体を領域内に含めてそのままサンプリング
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const idx = (py * w + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          // グレースケール輝度
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          if (brightness < darknessThreshold) {
            darkPixels++;
          }
        }
      }

      const darkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
      const isChecked = darkRatio >= checkThreshold;

      return {
        darkRatio,
        isChecked,
        totalPixels,
        darkPixels,
        rect: { x, y, w, h }
      };
    } catch (e) {
      console.warn('Checkbox evaluation error:', e);
      return { darkRatio: 0, isChecked: false, totalPixels: 0, darkPixels: 0, rect: { x, y, w, h } };
    }
  },

  /**
   * バーコード位置をアンカーとして、チェックボックスのピクセル矩形（正方形）を計算
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {{ centerX: number, centerY: number, width: number, height: number }} barcodeBox
   * @param {object} template テンプレート設定 (noChangeBox, hasChangeBox)
   */
  calculateTargetRects(canvas, barcodeBox, template) {
    const cw = canvas.width;
    const ch = canvas.height;
    const t = template || this.getDefaultTemplate();

    // アンカー基準点（バーコードの中心ピクセル座標）
    const anchorX = barcodeBox.centerX;
    const anchorY = barcodeBox.centerY;

    const getPixelRect = (def) => {
      // 縦横同サイズの完全な正方形を算出（ページ幅比率基準）
      const side = (def.size || def.w || 0.022) * cw;
      const w = side;
      const h = side;
      const x = anchorX + def.dx * cw - w / 2;
      const y = anchorY + def.dy * ch - h / 2;
      return { x, y, w, h };
    };

    return {
      noChangeRect: getPixelRect(t.noChangeBox),
      hasChangeRect: getPixelRect(t.hasChangeBox),
      threshold: t.threshold !== undefined ? t.threshold : 0.20
    };
  }
};
