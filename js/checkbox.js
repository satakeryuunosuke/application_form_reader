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
   * 角度（rect.angle）がある場合は回転アフィン変換により傾き補正してサンプリング
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {{ x: number, y: number, w: number, h: number, cx?: number, cy?: number, angle?: number }} rect ピクセル座標
   * @param {number} checkThreshold 判定閾値 (デフォルト: 0.25)
   * @param {number} darknessThreshold 輝度閾値 (0~255, 140以下を黒とみなす)
   * @returns {{ darkRatio: number, isChecked: boolean, totalPixels: number, darkPixels: number }}
   */
  evaluateCheckbox(canvas, rect, checkThreshold = 0.25, darknessThreshold = 140) {
    const width = canvas.width;
    const height = canvas.height;
    const w = Math.max(1, Math.round(rect.w));
    const h = Math.max(1, Math.round(rect.h));
    const cx = rect.cx !== undefined ? rect.cx : (rect.x + rect.w / 2);
    const cy = rect.cy !== undefined ? rect.cy : (rect.y + rect.h / 2);
    const angle = rect.angle || 0;

    try {
      let data;
      let totalPixels = w * h;
      let darkPixels = 0;

      // 傾きがある場合（約0.2度以上）、一時Canvasで逆回転サンプリング
      if (Math.abs(angle) > 0.003) {
        const sampleCv = document.createElement('canvas');
        sampleCv.width = w;
        sampleCv.height = h;
        const sCtx = sampleCv.getContext('2d');
        sCtx.translate(w / 2, h / 2);
        sCtx.rotate(-angle);
        sCtx.drawImage(canvas, -cx, -cy);

        const imgData = sCtx.getImageData(0, 0, w, h);
        data = imgData.data;
      } else {
        // 軸平行サンプリング
        const ctx = canvas.getContext('2d');
        const x = Math.max(0, Math.min(Math.round(rect.x), width - 1));
        const y = Math.max(0, Math.min(Math.round(rect.y), height - 1));
        const sampleW = Math.max(1, Math.min(w, width - x));
        const sampleH = Math.max(1, Math.min(h, height - y));
        const imgData = ctx.getImageData(x, y, sampleW, sampleH);
        data = imgData.data;
        totalPixels = sampleW * sampleH;
      }

      // チェックボックス領域内の黒画素数を集計
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        if (brightness < darknessThreshold) {
          darkPixels++;
        }
      }

      const darkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
      const isChecked = darkRatio >= checkThreshold;

      return {
        darkRatio,
        isChecked,
        totalPixels,
        darkPixels,
        rect: { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, angle }
      };
    } catch (e) {
      console.warn('Checkbox evaluation error:', e);
      return { darkRatio: 0, isChecked: false, totalPixels: 0, darkPixels: 0, rect };
    }
  },

  /**
   * バーコード位置をアンカーとして、チェックボックスのピクセル矩形（正方形）を計算
   * バーコードの傾き角度（barcodeBox.angle）による回転変換を自動適用
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {{ centerX: number, centerY: number, width: number, height: number, angle?: number }} barcodeBox
   * @param {object} template テンプレート設定 (noChangeBox, hasChangeBox)
   */
  calculateTargetRects(canvas, barcodeBox, template) {
    const cw = canvas.width;
    const ch = canvas.height;
    const t = template || this.getDefaultTemplate();

    // アンカー基準点（バーコードの中心ピクセル座標）
    const anchorX = barcodeBox.centerX;
    const anchorY = barcodeBox.centerY;
    const angle = barcodeBox.angle || 0; // ラジアン（時計回り正）

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const getPixelRect = (def) => {
      // 縦横同サイズの完全な正方形を算出（ページ幅比率基準）
      const side = (def.size || def.w || 0.022) * cw;
      const w = side;
      const h = side;

      // 未回転オフセット
      const unrotDx = def.dx * cw;
      const unrotDy = def.dy * ch;

      // 回転行列による座標変換
      const rotDx = unrotDx * cosA - unrotDy * sinA;
      const rotDy = unrotDx * sinA + unrotDy * cosA;

      const cx = anchorX + rotDx;
      const cy = anchorY + rotDy;

      return {
        x: cx - w / 2,
        y: cy - h / 2,
        cx,
        cy,
        w,
        h,
        angle
      };
    };

    return {
      noChangeRect: getPixelRect(t.noChangeBox),
      hasChangeRect: getPixelRect(t.hasChangeBox),
      threshold: t.threshold !== undefined ? t.threshold : 0.20,
      angle
    };
  }
};
