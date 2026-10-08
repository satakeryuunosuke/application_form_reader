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
      // 志望校別対策講座等の追加カスタムチェックボックス定義 [{ id, label, dx, dy, size }]
      customBoxes: [],
      threshold: 0.25 // 黒画素率 25% 以上でチェック有りと判定（枠線全体の黒画素を含むため高めに設定）
    };
  },

  /**
   * 継続確認モード用のデフォルト読取テンプレート相対定義
   * @param {number|string} grade 学年 (1〜6)
   */
  getDefaultContinuationTemplate(grade = 3) {
    const numGrade = parseInt(grade, 10);
    const customFieldDefs = [];

    if (numGrade === 3 || numGrade === 4) {
      customFieldDefs.push({
        id: 'field_course_days',
        name: '通室コース',
        type: 'single', // 単一選択（大小比較）
        options: [
          { id: 'opt_mon_thu', label: '月木コース', box: { dx: 0.05, dy: 0.225, size: 0.032 } },
          { id: 'opt_tue_fri', label: '火金コース', box: { dx: 0.05, dy: 0.292, size: 0.032 } }
        ]
      });
    } else if (numGrade === 6) {
      customFieldDefs.push({
        id: 'field_nittoku',
        name: '日特',
        type: 'single',
        options: [
          { id: 'opt_nittoku_yes', label: '受講', box: { dx: 0.15, dy: 0.225, size: 0.032 } },
          { id: 'opt_nittoku_change', label: '変更あり', box: { dx: 0.15, dy: 0.292, size: 0.032 } }
        ]
      });
    }

    return {
      // 1. 基本受講可否枠
      participateBox: {
        dx: -0.058,
        dy: 0.225,
        size: 0.032,
        label: '受講する'
      },
      otherBox: {
        dx: -0.058,
        dy: 0.292,
        size: 0.032,
        label: 'その他'
      },
      // 2. 科目数枠
      subject4Box: {
        dx: -0.058,
        dy: 0.360,
        size: 0.032,
        label: '4科目'
      },
      subject2Box: {
        dx: -0.058,
        dy: 0.425,
        size: 0.032,
        label: '2科目'
      },
      // 3. 学年別カスタム項目定義
      customFieldDefs,
      threshold: 0.25
    };
  },

  /**
   * テンプレートから学年別カスタム項目定義を正規化して取得
   * @param {object} template テンプレートオブジェクト
   * @returns {Array} [{ id, name, type, options: [{ id, label, box }] }]
   */
  getContinuationCustomFields(template) {
    if (!template) return [];
    const fields = template.customFieldDefs || template.continuationCustomFields || [];
    return fields.map(f => {
      const opts = (f.options || []).map(opt => {
        if (typeof opt === 'string') {
          return { id: opt, label: opt };
        }
        return opt;
      });
      return {
        ...f,
        options: opts
      };
    });
  },

  /**
   * テンプレート内の共通ボックスサイズ（マスの大きさ）を取得
   * @param {object} template テンプレートオブジェクト
   * @returns {number}
   */
  getCommonBoxSize(template) {
    if (!template) return 0.032;
    if (template.noChangeBox && (template.noChangeBox.size || template.noChangeBox.w)) {
      return template.noChangeBox.size || template.noChangeBox.w;
    }
    if (template.hasChangeBox && (template.hasChangeBox.size || template.hasChangeBox.w)) {
      return template.hasChangeBox.size || template.hasChangeBox.w;
    }
    if (template.participateBox && (template.participateBox.size || template.participateBox.w)) {
      return template.participateBox.size || template.participateBox.w;
    }
    if (template.otherBox && (template.otherBox.size || template.otherBox.w)) {
      return template.otherBox.size || template.otherBox.w;
    }
    if (template.subject4Box && (template.subject4Box.size || template.subject4Box.w)) {
      return template.subject4Box.size || template.subject4Box.w;
    }
    if (template.subject2Box && (template.subject2Box.size || template.subject2Box.w)) {
      return template.subject2Box.size || template.subject2Box.w;
    }
    if (template.customBoxes && template.customBoxes.length > 0) {
      for (const box of template.customBoxes) {
        if (box && (box.size || box.w)) return box.size || box.w;
      }
    }
    if (template.customFieldDefs && template.customFieldDefs.length > 0) {
      for (const f of template.customFieldDefs) {
        if (f.options) {
          for (const opt of f.options) {
            if (opt.box && (opt.box.size || opt.box.w)) return opt.box.size || opt.box.w;
          }
        }
      }
    }
    return 0.032;
  },

  /**
   * テンプレート内のすべてのボックス（標準枠・継続確認枠・カスタム枠すべて）のマスの大きさを同期
   * @param {object} template テンプレートオブジェクト
   * @param {number} [targetSize] 同期するサイズ（省略時は現在の共通サイズを採用）
   */
  syncBoxSizes(template, targetSize = null) {
    if (!template) return;
    const s = (typeof targetSize === 'number' && !isNaN(targetSize))
      ? targetSize
      : this.getCommonBoxSize(template);

    const updateBox = (b) => {
      if (b) {
        b.size = s;
        delete b.w;
        delete b.h;
      }
    };

    updateBox(template.noChangeBox);
    updateBox(template.hasChangeBox);
    updateBox(template.participateBox);
    updateBox(template.otherBox);
    updateBox(template.subject4Box);
    updateBox(template.subject2Box);

    if (template.customBoxes && Array.isArray(template.customBoxes)) {
      template.customBoxes.forEach(b => updateBox(b));
    }
    if (template.customFieldDefs && Array.isArray(template.customFieldDefs)) {
      template.customFieldDefs.forEach(f => {
        if (f && Array.isArray(f.options)) {
          f.options.forEach(opt => updateBox(opt.box));
        }
      });
    }
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
   * @param {object} [bottomBorder] パターンA 外枠下端罫線の検出結果
   */
  calculateTargetRects(canvas, barcodeBox, template, bottomBorder = null) {
    const cw = canvas.width;
    const ch = canvas.height;
    const t = template || this.getDefaultTemplate();

    // アンカー基準点（バーコードの中心ピクセル座標）
    const anchorX = barcodeBox.centerX;
    const anchorY = barcodeBox.centerY;

    // パターンA: 外枠下端罫線（bottomBorder）による傾き・縦スケール補正
    // 1. 傾き角度: 外枠線が検出されている場合はその超長基線長（1000px以上）傾き角を採用、無ければ barcodeBox.angle（水平固定時は0）
    const angle = (bottomBorder && bottomBorder.found && bottomBorder.angle !== undefined)
      ? bottomBorder.angle
      : (barcodeBox.angle || 0);

    // 2. 縦スケール比率: テンプレートに基準外枠距離があり、今回も外枠線が検出された場合
    let scaleY = 1.0;
    if (bottomBorder && bottomBorder.found && bottomBorder.qrToBorderDist) {
      const currentDist = bottomBorder.qrToBorderDist;
      if (t.refQrToBorderRatio) {
        // 用紙高さ比率での比較（解像度DPIの違いを完全吸収）
        const currentRatio = currentDist / ch;
        const ratio = currentRatio / t.refQrToBorderRatio;
        if (ratio >= 0.85 && ratio <= 1.15) {
          scaleY = ratio;
        }
      } else if (t.refQrToBorderDist) {
        const ratio = currentDist / t.refQrToBorderDist;
        if (ratio >= 0.85 && ratio <= 1.15) {
          scaleY = ratio;
        }
      }
    }

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const getPixelRect = (def) => {
      // 縦横同サイズの完全な正方形を算出（ページ幅比率基準）
      const side = (def.size || def.w || 0.022) * cw;
      const w = side;
      const h = side;

      // 未回転オフセット（縦方向は外枠線スケーリング比率 scaleY を適用して余白差を完全吸収）
      const unrotDx = def.dx * cw;
      const unrotDy = def.dy * ch * scaleY;

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

    const customRects = (t.customBoxes || []).map(box => ({
      id: box.id,
      label: box.label,
      rect: getPixelRect(box)
    }));

    // 継続確認モード: 学年別カスタム項目の矩形計算
    const customFieldRects = (t.customFieldDefs || []).map(field => ({
      id: field.id,
      name: field.name,
      type: field.type || 'single',
      options: (field.options || []).map(opt => ({
        id: opt.id,
        label: opt.label,
        rect: opt.box ? getPixelRect(opt.box) : null
      }))
    }));

    return {
      noChangeRect: t.noChangeBox ? getPixelRect(t.noChangeBox) : null,
      hasChangeRect: t.hasChangeBox ? getPixelRect(t.hasChangeBox) : null,
      // 継続確認モード枠
      participateRect: t.participateBox ? getPixelRect(t.participateBox) : null,
      otherRect: t.otherBox ? getPixelRect(t.otherBox) : null,
      subject4Rect: t.subject4Box ? getPixelRect(t.subject4Box) : null,
      subject2Rect: t.subject2Box ? getPixelRect(t.subject2Box) : null,
      customFieldRects,
      customRects,
      threshold: t.threshold !== undefined ? t.threshold : 0.20,
      bottomBorder,
      scaleY,
      angle
    };
  },

  /**
   * 複数チェックボックス群（講座選択モード等）の適応的動的2グループ判定
   * 
   * 1. 各項目の黒画素率（darkRatio）をサンプリング
   * 2. 突出した外れ値（塗りつぶしによる取消訂正枠）を検知し、非受講（isChecked: false）として除外
   * 3. 残りの項目群に対して大津の判別分析法（1次元2クラスタリング）を適用し、用紙の明暗（全体的に白／黒）に適応した動的しきい値を決定
   * 4. セーフティガード（最小分離度・最小ギャップ検証）により、全件未記入・全件受講時の誤判定を防止
   * 
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{ id: string, label: string, rect: object, eval?: object }>} items
   * @param {number} baseThreshold 基準フォールバック閾値 (デフォルト: 0.25)
   * @returns {{
   *   results: Object<string, { id: string, label: string, isChecked: boolean, darkRatio: number, isFilledCancellation: boolean, dynamicThreshold: number, isDynamicApplied: boolean }>,
   *   dynamicThreshold: number,
   *   isDynamicApplied: boolean,
   *   cancelledOutliers: Array<string>
   * }}
   */
  evaluateGroupCheckboxes(canvas, items, baseThreshold = 0.25) {
    if (!items || items.length === 0) {
      return { results: {}, dynamicThreshold: baseThreshold, isDynamicApplied: false, cancelledOutliers: [] };
    }

    // 1. 各項目の単体黒画素率を評価
    const evals = items.map(item => {
      const ev = (item.eval && item.eval.darkRatio !== undefined)
        ? item.eval
        : this.evaluateCheckbox(canvas, item.rect, baseThreshold);
      return {
        id: item.id,
        label: item.label,
        rect: item.rect,
        eval: ev,
        darkRatio: ev.darkRatio || 0
      };
    });

    const results = {};
    const n = evals.length;

    // 項目数が1個の場合は単体しきい値で判定
    if (n === 1) {
      const it = evals[0];
      const isChk = it.darkRatio >= baseThreshold;
      results[it.id] = {
        id: it.id,
        label: it.label,
        isChecked: isChk,
        darkRatio: it.darkRatio,
        isFilledCancellation: false,
        dynamicThreshold: baseThreshold,
        isDynamicApplied: false
      };
      return { results, dynamicThreshold: baseThreshold, isDynamicApplied: false, cancelledOutliers: [] };
    }

    // 2. 突出した外れ値（塗りつぶしによる取消訂正枠）の検知
    // ※「すべて塗りつぶし」なら普通に判定できるため、特定少数（1〜2個かつ25%以下）が突出して黒い場合のみ外れ値（取消）と判定
    const sortedDesc = [...evals].sort((a, b) => b.darkRatio - a.darkRatio);
    const sortedRatios = sortedDesc.map(e => e.darkRatio);
    
    // 中央値の計算
    const sortedAscRatios = [...sortedRatios].reverse();
    const midIdx = Math.floor(n / 2);
    const medianRatio = (n % 2 !== 0)
      ? sortedAscRatios[midIdx]
      : (sortedAscRatios[midIdx - 1] + sortedAscRatios[midIdx]) / 2;

    const cancelledOutliers = [];
    const outlierIds = new Set();

    // 外れ値の候補走査（黒画素率が 0.55 以上かつ中央値や他項目から大きく突出しているか）
    for (let i = 0; i < sortedDesc.length; i++) {
      const cur = sortedDesc[i];
      // 0.55 未満は通常のチェックマークの範囲内（外れ値ではない）
      if (cur.darkRatio < 0.55) break;

      // 塗りつぶしが全体の過半数を占める場合は「全体塗りつぶしスタイル」なので外れ値扱いにしない
      if (i >= Math.max(1, Math.floor(n * 0.35))) break;

      // 次の値（または直近の非外れ値候補）との差を検証
      const nextRatio = (i + 1 < sortedDesc.length) ? sortedDesc[i + 1].darkRatio : 0;
      const gapToNext = cur.darkRatio - nextRatio;
      const gapToMedian = cur.darkRatio - medianRatio;

      // 突出判定:
      // (A) 次の項目との間に 0.14 以上の大きな段差がある
      // または (B) 中央値から 0.30 以上乖離し、かつ次の項目との間に 0.08 以上のギャップがある
      if ((gapToNext >= 0.14) || (gapToMedian >= 0.30 && gapToNext >= 0.08)) {
        outlierIds.add(cur.id);
        cancelledOutliers.push(cur.id);
      } else {
        // 連番で同水準の黒さがある場合は「複数受講の塗りつぶし」の可能性が高いため、以降は外れ値としない
        break;
      }
    }

    // 外れ値として判定された項目は「非受講（isChecked: false）」として登録
    cancelledOutliers.forEach(id => {
      const it = evals.find(e => e.id === id);
      results[id] = {
        id: it.id,
        label: it.label,
        isChecked: false, // 訂正塗りつぶしのため非受講
        darkRatio: it.darkRatio,
        isFilledCancellation: true,
        dynamicThreshold: baseThreshold,
        isDynamicApplied: true
      };
    });

    // 3. 残りの項目群で大津の2グループ動的しきい値判定（クラスタリング）
    const validItems = evals.filter(e => !outlierIds.has(e.id));
    const validCount = validItems.length;

    if (validCount === 0) {
      return { results, dynamicThreshold: baseThreshold, isDynamicApplied: true, cancelledOutliers };
    }

    if (validCount === 1) {
      const it = validItems[0];
      const isChk = it.darkRatio >= baseThreshold;
      results[it.id] = {
        id: it.id,
        label: it.label,
        isChecked: isChk,
        darkRatio: it.darkRatio,
        isFilledCancellation: false,
        dynamicThreshold: baseThreshold,
        isDynamicApplied: false
      };
      return { results, dynamicThreshold: baseThreshold, isDynamicApplied: false, cancelledOutliers };
    }

    // 昇順ソート
    const sortedValid = [...validItems].sort((a, b) => a.darkRatio - b.darkRatio);
    const vals = sortedValid.map(v => v.darkRatio);

    const totalSum = vals.reduce((s, v) => s + v, 0);
    const meanTotal = totalSum / validCount;
    const totalVar = vals.reduce((s, v) => s + Math.pow(v - meanTotal, 2), 0) / validCount;

    let bestK = -1;
    let maxBetweenVar = -1;
    let sum0 = 0;

    // 境界 k の探索（クラス0: 0..k, クラス1: k+1..validCount-1）
    for (let k = 0; k < validCount - 1; k++) {
      sum0 += vals[k];
      const count0 = k + 1;
      const count1 = validCount - count0;

      const m0 = sum0 / count0;
      const m1 = (totalSum - sum0) / count1;

      const betweenVar = (count0 * count1 / (validCount * validCount)) * Math.pow(m1 - m0, 2);
      if (betweenVar > maxBetweenVar) {
        maxBetweenVar = betweenVar;
        bestK = k;
      }
    }

    // セーフティガードの検証
    let isDynamicApplied = false;
    let dynamicThreshold = baseThreshold;

    if (bestK >= 0) {
      const count0 = bestK + 1;
      const count1 = validCount - count0;
      const sumClass0 = vals.slice(0, count0).reduce((s, v) => s + v, 0);
      const sumClass1 = vals.slice(count0).reduce((s, v) => s + v, 0);

      const m0 = sumClass0 / count0;
      const m1 = sumClass1 / count1;

      const deltaMean = m1 - m0;
      const borderGap = vals[bestK + 1] - vals[bestK];
      const separability = totalVar > 0 ? (maxBetweenVar / totalVar) : 0;

      // セーフティ条件:
      // 1. クラス間平均差 ≧ 5%
      // 2. 境界ギャップ ≧ 2.5%
      // 3. 分離度 ≧ 0.45
      if (deltaMean >= 0.05 && borderGap >= 0.025 && separability >= 0.45) {
        // 動的境界しきい値を決定（境界2値の中間点）
        dynamicThreshold = Math.round(((vals[bestK] + vals[bestK + 1]) / 2) * 1000) / 1000;
        isDynamicApplied = true;
      }
    }

    // 各アイテムの判定
    for (const item of validItems) {
      let isChecked = false;
      if (isDynamicApplied) {
        isChecked = item.darkRatio > dynamicThreshold;
      } else {
        // セーフティガード不成立（全件未記入または全件受講などの均一状態）
        // 全体平均が 0.35 未満であれば安全に全件未受講（チェックなし）
        if (meanTotal < 0.35) {
          isChecked = false;
        } else {
          isChecked = item.darkRatio >= baseThreshold;
        }
      }

      results[item.id] = {
        id: item.id,
        label: item.label,
        isChecked,
        darkRatio: item.darkRatio,
        isFilledCancellation: false,
        dynamicThreshold,
        isDynamicApplied
      };
    }

    return {
      results,
      dynamicThreshold,
      isDynamicApplied,
      cancelledOutliers
    };
  }
};
