/**
 * スキャン読取位置（キャリブレーション）コンポーネント
 * プロジェクト作成ウィザードおよび書式設定モーダルで共通利用
 * チェックボックス枠を正方形（size）で管理し、内側収容＆高閾値（20%）判定に対応
 */

import { CheckboxEngine } from '../checkbox.js';
import { ScannerEngine } from '../scanner.js';
import { UI } from '../utils/ui.js';

export class TemplateCalibrator {
  /**
   * @param {HTMLElement} container 描画先要素
   * @param {object} initialTemplate 初期テンプレート設定
   * @param {(template: object) => void} onChange 設定変更時コールバック
   * @param {object} options オプション設定 { defaultResetTemplate, resetLabel, isSettingsMode }
   */
  constructor(container, initialTemplate = null, onChange = null, options = {}) {
    this.container = container;
    this.options = options || {};
    this.defaultResetTemplate = this.options.defaultResetTemplate || CheckboxEngine.getDefaultTemplate();
    this.template = initialTemplate ? JSON.parse(JSON.stringify(initialTemplate)) : JSON.parse(JSON.stringify(this.defaultResetTemplate));
    this.onChange = onChange;
    
    this.activeTab = 'noChange'; // 'noChange' | 'hasChange'
    this.canvas = null;
    this.sourceCanvas = null; // 原寸大画像Canvas
    this.barcodeBox = null;
    this.loadedPages = []; // [{ canvas, barcodeBox, pageNum }]
    this.currentPageIndex = 0;

    // ズーム＆パン状態
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    this.render();
    this.initDefaultSample();
  }

  getTemplate() {
    return JSON.parse(JSON.stringify(this.template));
  }

  setTemplate(newTemplate) {
    if (!newTemplate) return;
    this.template = JSON.parse(JSON.stringify(newTemplate));
    this.syncSlidersFromTemplate();
    this.drawOverlay();
    if (this.onChange) {
      this.onChange(this.template);
    }
  }

  /**
   * UI描画
   */
  render() {
    this.container.innerHTML = `
      <div class="calibrator-container">
        <!-- 上部：サンプルファイル読み込みエリア -->
        <div class="calibrator-top-bar">
          <div class="calibrator-sample-info">
            <span class="badge badge-info" id="calib-page-badge">📄 標準サンプル帳票</span>
            <span style="font-size: 0.82rem; color: var(--gray-600);">
              プロジェクト固有の受講票PDF・画像をドラッグ＆ドロップして位置を合わせられます
            </span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button type="button" id="btn-calib-prev-page" class="btn btn-secondary btn-sm" style="display: none;">◀ 前ページ</button>
            <span id="calib-page-num" style="font-size: 0.82rem; font-weight: bold; display: none;">1 / 1</span>
            <button type="button" id="btn-calib-next-page" class="btn btn-secondary btn-sm" style="display: none;">次ページ ▶</button>
            <button type="button" id="btn-calib-upload-trigger" class="btn btn-secondary btn-sm">
              📁 PDF/画像を開く
            </button>
            <input type="file" id="calib-file-input" accept=".pdf,image/*" style="display: none;">
          </div>
        </div>

        <div class="calibrator-layout">
          <!-- 左ペイン：帳票プレビュー & 判定枠オーバーレイ -->
          <div class="calibrator-preview-wrapper" id="calib-dropzone">
            <!-- プレビュー拡大・縮小ツールバー -->
            <div class="calibrator-zoom-bar">
              <div class="calibrator-zoom-controls">
                <span style="font-weight: 700; color: #93c5fd; font-size: 0.78rem;">🔍 プレビュー表示:</span>
                <button type="button" id="btn-calib-zoom-out" class="calibrator-zoom-btn" title="縮小 (マウスホイール下)">🔍-</button>
                <span id="calib-zoom-val" style="font-family: var(--font-mono); min-width: 44px; text-align: center; font-size: 0.78rem;">100%</span>
                <button type="button" id="btn-calib-zoom-in" class="calibrator-zoom-btn" title="拡大 (マウスホイール上)">🔍+</button>
                <button type="button" id="btn-calib-zoom-fit" class="calibrator-zoom-btn" title="画面全体に合わせる">全体</button>
                <button type="button" id="btn-calib-zoom-reset" class="calibrator-zoom-btn" title="原寸大 (100%)">100%</button>
              </div>
              <div class="calibrator-zoom-controls">
                <button type="button" id="btn-calib-focus-target" class="calibrator-zoom-btn btn-focus-target" title="チェックボックス判定エリアを特大フォーカス表示">
                  🎯 判定枠へズーム
                </button>
              </div>
            </div>

            <div class="calibrator-canvas-container" id="calib-canvas-container" title="ホイールで拡大縮小 / ドラッグで移動 / ダブルクリックで判定枠へズーム">
              <canvas id="calib-canvas"></canvas>
            </div>
            <div class="calibrator-overlay-legend">
              <span class="legend-item"><span class="legend-box legend-barcode"></span> バーコード（基準点）</span>
              <span class="legend-item"><span class="legend-box legend-no-change"></span> 「変更なし」正方形読取枠</span>
              <span class="legend-item"><span class="legend-box legend-has-change"></span> 「変更あり」正方形読取枠</span>
            </div>
          </div>

          <!-- 右ペイン：微調整スライダー & リアルタイム判定結果 -->
          <div class="calibrator-controls-wrapper">
            <!-- 調整ポイントのガイドバナー -->
            <div class="calibrator-hint-card">
              <div class="hint-title">💡 領域設定のポイント</div>
              <div class="hint-body">
                チェックボックスの<strong>【枠線全体が判定領域（正方形）の中に完全に収まる】</strong>ように設定してください。<br>
                ※ 枠線の黒画素が含まれるため、判定閾値は高め（推奨: <strong>25%〜30%</strong>、デフォルト: 25%）に設定されています。
              </div>
            </div>

            <!-- タブ切り替え -->
            <div class="calibrator-tabs">
              <button type="button" class="calib-tab-btn ${this.activeTab === 'noChange' ? 'active' : ''}" data-tab="noChange">
                🟩 「変更なし」枠
              </button>
              <button type="button" class="calib-tab-btn ${this.activeTab === 'hasChange' ? 'active' : ''}" data-tab="hasChange">
                🟧 「変更あり」枠
              </button>
            </div>

            <!-- リアルタイム判定カード -->
            <div class="calibrator-eval-card">
              <div class="eval-row">
                <span class="eval-label">変更なし判定:</span>
                <span id="eval-no-change-status" class="badge badge-gray">-</span>
                <span class="text-mono eval-ratio" id="eval-no-change-ratio">黒画素: 0%</span>
              </div>
              <div class="eval-row">
                <span class="eval-label">変更あり判定:</span>
                <span id="eval-has-change-status" class="badge badge-gray">-</span>
                <span class="text-mono eval-ratio" id="eval-has-change-ratio">黒画素: 0%</span>
              </div>
            </div>

            <!-- スライダーグループ -->
            <div class="calibrator-sliders-card">
              <div class="calib-field">
                <div class="calib-field-header">
                  <label class="form-label">左右位置（Xオフセット）</label>
                  <span class="calib-val-badge text-mono" id="val-dx">0.0%</span>
                </div>
                <div class="calib-input-row">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="dx" data-delta="-0.002">◀</button>
                  <input type="range" id="rng-dx" min="-0.30" max="0.30" step="0.001" class="form-range">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="dx" data-delta="0.002">▶</button>
                </div>
              </div>

              <div class="calib-field">
                <div class="calib-field-header">
                  <label class="form-label">上下位置（Yオフセット）</label>
                  <span class="calib-val-badge text-mono" id="val-dy">0.0%</span>
                </div>
                <div class="calib-input-row">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="dy" data-delta="-0.002">▲</button>
                  <input type="range" id="rng-dy" min="0.05" max="0.60" step="0.001" class="form-range">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="dy" data-delta="0.002">▼</button>
                </div>
              </div>

              <!-- 正方形サイズ 1パラメータ -->
              <div class="calib-field">
                <div class="calib-field-header">
                  <label class="form-label">正方形サイズ（一辺の長さ）</label>
                  <span class="calib-val-badge text-mono" id="val-size">3.2%</span>
                </div>
                <div class="calib-input-row">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="size" data-delta="-0.001">➖</button>
                  <input type="range" id="rng-size" min="0.015" max="0.070" step="0.001" class="form-range">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="size" data-delta="0.001">➕</button>
                </div>
              </div>

              <div class="calib-field" style="margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--gray-200);">
                <div class="calib-field-header">
                  <label class="form-label">判定感度（黒画素率 閾値）</label>
                  <span class="calib-val-badge text-mono" id="val-threshold">25%</span>
                </div>
                <div class="calib-input-row">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="threshold" data-delta="-0.01">➖</button>
                  <input type="range" id="rng-threshold" min="0.00" max="0.60" step="0.01" class="form-range">
                  <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="threshold" data-delta="0.01">➕</button>
                </div>
                <div style="font-size: 0.72rem; color: var(--gray-500); margin-top: 2px;">
                  ※ 枠線全体の黒画素を含むため、通常は 25%〜30% が推奨です
                </div>
              </div>
            </div>

            <!-- リセットボタン -->
            <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
              ${this.options.hideReset ? '' : `
                <button type="button" id="btn-calib-reset" class="btn btn-ghost btn-sm" style="color: var(--gray-600);">
                  ${this.options.resetLabel || '🔄 標準デフォルト位置に戻す'}
                </button>
              `}
            </div>
          </div>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('#calib-canvas');
    this.bindEvents();
  }

  /**
   * イベントバインド
   */
  bindEvents() {
    // タブ切り替え
    const tabs = this.container.querySelectorAll('.calib-tab-btn');
    tabs.forEach(t => {
      t.onclick = () => {
        tabs.forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        this.activeTab = t.dataset.tab;
        this.syncSlidersFromTemplate();
        this.drawOverlay();
      };
    });

    // スライダー変更
    const rngDx = this.container.querySelector('#rng-dx');
    const rngDy = this.container.querySelector('#rng-dy');
    const rngSize = this.container.querySelector('#rng-size');
    const rngTh = this.container.querySelector('#rng-threshold');

    const handleSliderInput = () => {
      const targetBox = this.activeTab === 'noChange' ? this.template.noChangeBox : this.template.hasChangeBox;
      targetBox.dx = parseFloat(rngDx.value);
      targetBox.dy = parseFloat(rngDy.value);
      targetBox.size = parseFloat(rngSize.value);
      delete targetBox.w;
      delete targetBox.h;
      this.template.threshold = parseFloat(rngTh.value);

      this.updateValueLabels();
      this.drawOverlay();

      if (this.onChange) {
        this.onChange(this.template);
      }
    };

    rngDx.oninput = handleSliderInput;
    rngDy.oninput = handleSliderInput;
    rngSize.oninput = handleSliderInput;
    rngTh.oninput = handleSliderInput;

    // 微調整ボタン (◀ ▶ ▲ ▼ ➖ ➕)
    this.container.querySelectorAll('.btn-nudge').forEach(btn => {
      btn.onclick = () => {
        const target = btn.dataset.target;
        const delta = parseFloat(btn.dataset.delta);
        if (target === 'threshold') {
          const currentVal = this.template.threshold !== undefined ? this.template.threshold : 0.25;
          this.template.threshold = Math.max(0.00, Math.min(0.60, Math.round((currentVal + delta) * 100) / 100));
          this.syncSlidersFromTemplate();
          this.drawOverlay();
          if (this.onChange) this.onChange(this.template);
          return;
        }
        const targetBox = this.activeTab === 'noChange' ? this.template.noChangeBox : this.template.hasChangeBox;
        const currentVal = target === 'size' ? (targetBox.size || targetBox.w || 0.022) : targetBox[target];
        targetBox[target] = Math.round((currentVal + delta) * 1000) / 1000;
        if (target === 'size') {
          delete targetBox.w;
          delete targetBox.h;
        }
        this.syncSlidersFromTemplate();
        this.drawOverlay();
        if (this.onChange) this.onChange(this.template);
      };
    });

    // デフォルトに戻す
    const resetBtn = this.container.querySelector('#btn-calib-reset');
    if (resetBtn) {
      resetBtn.onclick = () => {
        this.template = JSON.parse(JSON.stringify(this.defaultResetTemplate));
        this.syncSlidersFromTemplate();
        this.drawOverlay();
        UI.showToast(this.options.resetToastMsg || '標準デフォルト位置に復元しました', 'info');
        if (this.onChange) this.onChange(this.template);
      };
    }

    // ファイルアップロード
    const uploadTrigger = this.container.querySelector('#btn-calib-upload-trigger');
    const fileInput = this.container.querySelector('#calib-file-input');
    const dropzone = this.container.querySelector('#calib-dropzone');

    uploadTrigger.onclick = () => fileInput.click();

    fileInput.onchange = () => {
      if (fileInput.files.length > 0) {
        this.loadFile(fileInput.files[0]);
      }
    };

    dropzone.ondragover = (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.loadFile(e.dataTransfer.files[0]);
      }
    };

    // ページ送り
    const prevBtn = this.container.querySelector('#btn-calib-prev-page');
    const nextBtn = this.container.querySelector('#btn-calib-next-page');

    prevBtn.onclick = () => {
      if (this.currentPageIndex > 0) {
        this.setPage(this.currentPageIndex - 1);
      }
    };
    nextBtn.onclick = () => {
      if (this.currentPageIndex < this.loadedPages.length - 1) {
        this.setPage(this.currentPageIndex + 1);
      }
    };

    // --- プレビューズーム＆パン制御 ---
    const zoomInBtn = this.container.querySelector('#btn-calib-zoom-in');
    const zoomOutBtn = this.container.querySelector('#btn-calib-zoom-out');
    const zoomFitBtn = this.container.querySelector('#btn-calib-zoom-fit');
    const zoomResetBtn = this.container.querySelector('#btn-calib-zoom-reset');
    const focusTargetBtn = this.container.querySelector('#btn-calib-focus-target');
    const canvasWrap = this.container.querySelector('#calib-canvas-container');

    const updateZoom = (newZoom, cx = null, cy = null) => {
      const clamped = Math.max(0.4, Math.min(4.5, newZoom));
      if (cx !== null && cy !== null && canvasWrap) {
        const rect = canvasWrap.getBoundingClientRect();
        const ox = cx - (rect.left + rect.width / 2);
        const oy = cy - (rect.top + rect.height / 2);
        this.panX -= (ox - this.panX) * (clamped / this.zoomLevel - 1);
        this.panY -= (oy - this.panY) * (clamped / this.zoomLevel - 1);
      }
      this.zoomLevel = clamped;
      this.applyCanvasTransform();
    };

    if (zoomInBtn) zoomInBtn.onclick = () => updateZoom(this.zoomLevel + 0.25);
    if (zoomOutBtn) zoomOutBtn.onclick = () => updateZoom(this.zoomLevel - 0.25);
    if (zoomFitBtn) {
      zoomFitBtn.onclick = () => {
        this.zoomLevel = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.applyCanvasTransform();
      };
    }
    if (zoomResetBtn) {
      zoomResetBtn.onclick = () => {
        this.zoomLevel = 1.6;
        this.panX = 0;
        this.panY = 0;
        this.applyCanvasTransform();
      };
    }

    if (focusTargetBtn) {
      focusTargetBtn.onclick = () => this.focusTargetArea();
    }

    if (canvasWrap) {
      // マウスホイールによるズーム
      canvasWrap.onwheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        updateZoom(this.zoomLevel + delta, e.clientX, e.clientY);
      };

      // ドラッグによるパン操作
      canvasWrap.onmousedown = (e) => {
        if (e.button !== 0) return;
        this.isDragging = true;
        this.dragStartX = e.clientX - this.panX;
        this.dragStartY = e.clientY - this.panY;
        canvasWrap.classList.add('is-dragging');
      };

      // ダブルクリックで判定枠フォーカス ⇔ フィットのトグル
      canvasWrap.ondblclick = () => {
        if (this.zoomLevel > 1.4) {
          this.zoomLevel = 1.0;
          this.panX = 0;
          this.panY = 0;
          this.applyCanvasTransform();
        } else {
          this.focusTargetArea();
        }
      };
    }

    const onMouseMove = (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this.applyCanvasTransform();
    };

    const onMouseUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        if (canvasWrap) canvasWrap.classList.remove('is-dragging');
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  /**
   * プレビューCanvasのトランスフォームを適用
   */
  applyCanvasTransform() {
    if (!this.canvas) return;
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
    const zoomValEl = this.container.querySelector('#calib-zoom-val');
    if (zoomValEl) zoomValEl.textContent = `${Math.round(this.zoomLevel * 100)}%`;
  }

  /**
   * 判定対象エリア（バーコード〜チェックボックス付近）へ自動ズーム＆フォーカス
   */
  focusTargetArea() {
    if (!this.sourceCanvas || !this.barcodeBox) {
      this.zoomLevel = 2.2;
      this.panX = 0;
      this.panY = 0;
      this.applyCanvasTransform();
      return;
    }

    const cvW = this.sourceCanvas.width;
    const cvH = this.sourceCanvas.height;
    const bc = this.barcodeBox;

    const targetBox = this.activeTab === 'noChange' ? this.template.noChangeBox : this.template.hasChangeBox;
    const targetX = bc.centerX + (targetBox.dx || 0) * cvW;
    const targetY = bc.centerY + (targetBox.dy || 0) * cvH;

    const midX = (bc.centerX + targetX) / 2;
    const midY = (bc.centerY + targetY) / 2;

    this.zoomLevel = 2.4;

    const normOffsetX = (midX / cvW) - 0.5;
    const normOffsetY = (midY / cvH) - 0.5;

    const canvasWrap = this.container.querySelector('#calib-canvas-container');
    const wrapW = canvasWrap ? canvasWrap.clientWidth : 700;
    const wrapH = canvasWrap ? canvasWrap.clientHeight : 500;

    const scaleFit = Math.min(wrapW / cvW, wrapH / cvH);
    const displayedW = cvW * scaleFit;
    const displayedH = cvH * scaleFit;

    this.panX = -normOffsetX * displayedW * this.zoomLevel;
    this.panY = -normOffsetY * displayedH * this.zoomLevel;

    this.applyCanvasTransform();
    UI.showToast('🎯 判定枠エリアにズームしました（ドラッグで移動可能）', 'info', 2000);
  }

  /**
   * テンプレートからスライダー値を同期
   */
  syncSlidersFromTemplate() {
    const targetBox = this.activeTab === 'noChange' ? this.template.noChangeBox : this.template.hasChangeBox;
    
    const rngDx = this.container.querySelector('#rng-dx');
    const rngDy = this.container.querySelector('#rng-dy');
    const rngSize = this.container.querySelector('#rng-size');
    const rngTh = this.container.querySelector('#rng-threshold');

    if (rngDx) rngDx.value = targetBox.dx;
    if (rngDy) rngDy.value = targetBox.dy;
    if (rngSize) rngSize.value = targetBox.size || targetBox.w || 0.032;
    if (rngTh) rngTh.value = this.template.threshold !== undefined ? this.template.threshold : 0.25;

    this.updateValueLabels();
  }

  updateValueLabels() {
    const targetBox = this.activeTab === 'noChange' ? this.template.noChangeBox : this.template.hasChangeBox;
    
    const valDx = this.container.querySelector('#val-dx');
    const valDy = this.container.querySelector('#val-dy');
    const valSize = this.container.querySelector('#val-size');
    const valTh = this.container.querySelector('#val-threshold');

    const sizeVal = targetBox.size || targetBox.w || 0.032;

    if (valDx) valDx.textContent = `${(targetBox.dx * 100).toFixed(1)}%`;
    if (valDy) valDy.textContent = `${(targetBox.dy * 100).toFixed(1)}%`;
    if (valSize) valSize.textContent = `${(sizeVal * 100).toFixed(1)}%`;
    if (valTh) valTh.textContent = `${Math.round((this.template.threshold !== undefined ? this.template.threshold : 0.25) * 100)}%`;
  }

  /**
   * 標準サンプル帳票を描画
   */
  initDefaultSample() {
    const width = 1190;  // A5 Landscape @ 144 DPI
    const height = 840;

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const ctx = sampleCanvas.getContext('2d');

    // 白背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // キリトリ線
    ctx.strokeStyle = '#888888';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(56, 30);
    ctx.lineTo(width - 56, 30);
    ctx.stroke();
    ctx.setLineDash([]);

    // タイトル
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 22px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('2026年度　夏期講習受講確認票', width / 2, 70);

    // バーコード（CODE 39のシミュレーション）
    const bcX = 60;
    const bcY = 46;
    const bcW = 160;
    const bcH = 45;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bcX, bcY, bcW, bcH);

    // バーコードの縦線を描画
    ctx.fillStyle = '#000000';
    let curX = bcX + 6;
    const pattern = [3,1,1,3,1,1,3,1,1,1,3,1,3,1,1,1,3,1,1,3,1,1,3,1,1,3,1,1,1,3,1,3,1,1,1,3,1,1,3,1,1,3,1,1,3,1,1,1,3,1,3,1];
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern[i];
      if (i % 2 === 0) {
        ctx.fillRect(curX, bcY + 4, w * 2.2, bcH - 18);
      }
      curX += w * 2.2;
      if (curX > bcX + bcW - 10) break;
    }
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('*TDN60013*', bcX + bcW / 2, bcY + bcH - 2);

    // メインテーブル枠
    const tblX = 56;
    const tblY = 100;
    const tblW = width - 112;
    const tblH = height - 130;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(tblX, tblY, tblW, tblH);

    // 生徒情報行 (Row 1)
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tblX, tblY + 54);
    ctx.lineTo(tblX + tblW, tblY + 54);
    ctx.moveTo(tblX + 220, tblY);
    ctx.lineTo(tblX + 220, tblY + 54);
    ctx.moveTo(tblX + tblW - 200, tblY);
    ctx.lineTo(tblX + tblW - 200, tblY + 54);
    ctx.stroke();

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('日能研番号', tblX + 12, tblY + 20);
    ctx.font = 'bold 18px monospace';
    ctx.fillText('TDN60013', tblX + 12, tblY + 44);

    ctx.font = '12px sans-serif';
    ctx.fillText('氏名', tblX + 232, tblY + 20);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('日能研 太郎　様', tblX + 320, tblY + 38);

    ctx.font = '12px sans-serif';
    ctx.fillText('5月度クラス', tblX + tblW - 188, tblY + 20);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('W1', tblX + tblW - 188, tblY + 44);

    // 注意書き (Row 2)
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(tblX + 1, tblY + 55, tblW - 2, 28);
    ctx.fillStyle = '#222222';
    ctx.font = '11px sans-serif';
    ctx.fillText('※3年予科教室生の夏期講習は4科目での受講を原則とします。', tblX + 10, tblY + 73);

    ctx.strokeStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(tblX, tblY + 84);
    ctx.lineTo(tblX + tblW, tblY + 84);
    ctx.stroke();

    // 変更なし行 (Row 3)
    const row3Y = tblY + 84;
    ctx.beginPath();
    ctx.moveTo(tblX, row3Y + 46);
    ctx.lineTo(tblX + tblW, row3Y + 46);
    ctx.stroke();

    // チェックボックス「変更なし」
    const cbNoX = tblX + 16;
    const cbNoY = row3Y + 12;
    ctx.strokeRect(cbNoX, cbNoY, 22, 22);

    // チェックマーク（サンプル用: レ点）
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#000000';
    ctx.fillText('✔', cbNoX + 2, cbNoY + 19);

    ctx.font = '14px sans-serif';
    ctx.fillText('夏期講習の受講内容に変更が「ない」（所属クラスの期間で受講）', cbNoX + 34, cbNoY + 17);

    // 変更あり行 (Row 4)
    const row4Y = row3Y + 46;
    ctx.beginPath();
    ctx.moveTo(tblX, row4Y + 46);
    ctx.lineTo(tblX + tblW, row4Y + 46);
    ctx.stroke();

    // チェックボックス「変更あり」
    const cbHasX = tblX + 16;
    const cbHasY = row4Y + 12;
    ctx.strokeRect(cbHasX, cbHasY, 22, 22);
    ctx.font = '14px sans-serif';
    ctx.fillText('夏期講習の受講内容に変更が「ある」', cbHasX + 34, cbHasY + 17);

    // 変更申請詳細枠
    const row5Y = row4Y + 46;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(tblX + 1, row5Y + 1, 40, tblH - (row5Y - tblY) - 2);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('変', tblX + 14, row5Y + 50);
    ctx.fillText('更', tblX + 14, row5Y + 80);
    ctx.fillText('申', tblX + 14, row5Y + 110);
    ctx.fillText('請', tblX + 14, row5Y + 140);

    this.sourceCanvas = sampleCanvas;
    this.barcodeBox = {
      centerX: bcX + bcW / 2,
      centerY: bcY + bcH / 2,
      width: bcW,
      height: bcH,
      angle: 0,
      angleDeg: 0
    };

    this.loadedPages = [{
      canvas: sampleCanvas,
      barcodeBox: this.barcodeBox,
      barcodeText: 'TDN60013',
      barcodeFound: true,
      pageNum: 1
    }];

    this.syncSlidersFromTemplate();
    this.drawOverlay();
  }

  /**
   * 現在のページでバーコードが正常に検出されているか
   */
  isBarcodeDetected() {
    if (!this.loadedPages || this.loadedPages.length === 0) return false;
    const cur = this.loadedPages[this.currentPageIndex];
    return !!(cur && cur.barcodeFound);
  }

  /**
   * ユーザー指定のファイル（PDFまたは画像）を読み込み
   */
  async loadFile(file) {
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    UI.showToast('ファイルを解析中...', 'info');

    try {
      if (isPdf) {
        if (typeof pdfjsLib === 'undefined') {
          throw new Error('pdf.js が読み込まれていません');
        }
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdfDoc.numPages;

        this.loadedPages = [];
        ScannerEngine.initReader();

        for (let i = 1; i <= Math.min(numPages, 10); i++) {
          const page = await pdfDoc.getPage(i);
          // A5や低解像度スキャンでもバーコードの細線を鮮明に捉えるため、最適解像度スケールを自動算出
          const unscaled = page.getViewport({ scale: 1.0 });
          const maxDim = Math.max(unscaled.width, unscaled.height);
          const scale = Math.max(2.5, Math.min(3.5, 2200 / maxDim));
          const viewport = page.getViewport({ scale });

          const cv = document.createElement('canvas');
          cv.width = viewport.width;
          cv.height = viewport.height;
          const ctx = cv.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          const bcResult = await ScannerEngine.detectBarcode(cv);
          this.loadedPages.push({
            canvas: cv,
            barcodeFound: bcResult.found,
            barcodeBox: bcResult.box || {
              centerX: cv.width * 0.13,
              centerY: cv.height * 0.10,
              width: cv.width * 0.15,
              height: cv.height * 0.05,
              angle: 0,
              angleDeg: 0
            },
            barcodeText: bcResult.text || '',
            pageNum: i
          });
        }

        this.updatePaginationUI();
        this.setPage(0);

        const foundCount = this.loadedPages.filter(p => p.barcodeFound).length;
        if (foundCount === 0) {
          UI.showToast('⚠️ バーコードを検出できませんでした。画像の向き・鮮明さ・傾きをご確認ください。', 'warning');
        } else if (foundCount === this.loadedPages.length) {
          const first = this.loadedPages[0];
          UI.showToast(`バーコード「${first.barcodeText}」を検出しました（全${this.loadedPages.length}ページ）`, 'success');
        } else {
          UI.showToast(`${this.loadedPages.length} ページ中 ${foundCount} ページのバーコードを検出しました`, 'warning');
        }
      } else {
        // 画像ファイル
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = async () => {
          const cv = document.createElement('canvas');
          cv.width = img.naturalWidth;
          cv.height = img.naturalHeight;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);

          ScannerEngine.initReader();
          const bcResult = await ScannerEngine.detectBarcode(cv);

          this.loadedPages = [{
            canvas: cv,
            barcodeFound: bcResult.found,
            barcodeBox: bcResult.box || {
              centerX: cv.width * 0.13,
              centerY: cv.height * 0.10,
              width: cv.width * 0.15,
              height: cv.height * 0.05,
              angle: 0,
              angleDeg: 0
            },
            barcodeText: bcResult.text || '',
            pageNum: 1
          }];

          this.updatePaginationUI();
          this.setPage(0);

          if (bcResult.found) {
            UI.showToast(`バーコード「${bcResult.text}」を検出しました`, 'success');
          } else {
            UI.showToast('⚠️ バーコードを検出できませんでした。画像の向き・鮮明さ・傾きをご確認ください。', 'warning');
          }
        };
        img.src = url;
      }
    } catch (err) {
      console.error(err);
      UI.showToast(`ファイル読み込みエラー: ${err.message}`, 'error');
    }
  }

  updatePaginationUI() {
    const prevBtn = this.container.querySelector('#btn-calib-prev-page');
    const nextBtn = this.container.querySelector('#btn-calib-next-page');
    const pageNumEl = this.container.querySelector('#calib-page-num');
    const pageBadge = this.container.querySelector('#calib-page-badge');

    if (this.loadedPages.length > 1) {
      prevBtn.style.display = 'inline-flex';
      nextBtn.style.display = 'inline-flex';
      pageNumEl.style.display = 'inline-block';
      pageNumEl.textContent = `${this.currentPageIndex + 1} / ${this.loadedPages.length}`;
    } else {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      pageNumEl.style.display = 'none';
    }

    if (pageBadge && this.loadedPages.length > 0) {
      const cur = this.loadedPages[this.currentPageIndex];
      if (cur.barcodeFound) {
        const deg = cur.barcodeBox && cur.barcodeBox.angleDeg !== undefined ? Math.round(cur.barcodeBox.angleDeg * 10) / 10 : 0;
        const degText = Math.abs(deg) >= 0.2 ? ` (傾き: ${deg > 0 ? '+' : ''}${deg}°)` : '';
        pageBadge.className = 'badge badge-success';
        pageBadge.textContent = `🏷️ バーコード: ${cur.barcodeText}${degText}`;
      } else {
        pageBadge.className = 'badge badge-danger font-bold';
        pageBadge.textContent = '⚠️ バーコード未検出';
      }
    }
  }

  setPage(index) {
    if (index < 0 || index >= this.loadedPages.length) return;
    this.currentPageIndex = index;
    const cur = this.loadedPages[index];
    this.sourceCanvas = cur.canvas;
    this.barcodeBox = cur.barcodeBox;
    this.updatePaginationUI();
    this.drawOverlay();
  }

  /**
   * プレビューCanvas上に帳票と判定枠を描画
   */
  drawOverlay() {
    if (!this.sourceCanvas || !this.canvas) return;

    const srcW = this.sourceCanvas.width;
    const srcH = this.sourceCanvas.height;
    const cur = this.loadedPages && this.loadedPages[this.currentPageIndex];
    const isDetected = cur ? cur.barcodeFound : false;

    // 表示用Canvasサイズ
    this.canvas.width = srcW;
    this.canvas.height = srcH;
    const ctx = this.canvas.getContext('2d');

    // 1. 元画像を描画
    ctx.drawImage(this.sourceCanvas, 0, 0);

    if (!this.barcodeBox) return;

    // 2. バーコード枠（検知時は青＋傾き回転、未検知時は赤破線警告）
    const bc = this.barcodeBox;
    ctx.save();
    if (isDetected) {
      ctx.translate(bc.centerX, bc.centerY);
      ctx.rotate(bc.angle || 0);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
      ctx.fillRect(-bc.width / 2, -bc.height / 2, bc.width, bc.height);
      ctx.strokeRect(-bc.width / 2, -bc.height / 2, bc.width, bc.height);

      // バーコード中心点
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 未検出時の警告表示
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.10)';
      const bcX = bc.centerX - bc.width / 2;
      const bcY = bc.centerY - bc.height / 2;
      ctx.fillRect(bcX, bcY, bc.width, bc.height);
      ctx.strokeRect(bcX, bcY, bc.width, bc.height);

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ バーコード未検出（位置未確定）', bc.centerX, bc.centerY + 5);
    }
    ctx.restore();

    // 未検出時の上部警告バナー
    if (!isDetected) {
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.90)';
      ctx.fillRect(0, 0, srcW, 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ バーコードが読み取れていません。鮮明なファイルを選択するか、向きをご確認ください。', srcW / 2, 23);
      ctx.restore();
    }

    // 3. 読取枠の計算（完全な正方形＋傾きアフィン変換）
    const rects = CheckboxEngine.calculateTargetRects(this.sourceCanvas, this.barcodeBox, this.template);

    // 4. 黒画素率の評価
    const threshold = this.template.threshold !== undefined ? this.template.threshold : 0.25;
    const noChangeEval = CheckboxEngine.evaluateCheckbox(this.sourceCanvas, rects.noChangeRect, threshold);
    const hasChangeEval = CheckboxEngine.evaluateCheckbox(this.sourceCanvas, rects.hasChangeRect, threshold);

    // 5. 「変更なし」枠（緑）
    const isNoChangeActive = this.activeTab === 'noChange';
    this.drawTargetBox(ctx, rects.noChangeRect, '#16a34a', 'rgba(22, 163, 74, 0.18)', '変更なし (正方形)', isNoChangeActive);

    // 6. 「変更あり」枠（橙）
    const isHasChangeActive = this.activeTab === 'hasChange';
    this.drawTargetBox(ctx, rects.hasChangeRect, '#ea580c', 'rgba(234, 88, 12, 0.18)', '変更あり (正方形)', isHasChangeActive);

    // 7. 判定UIの更新
    this.updateEvalStatus(noChangeEval, hasChangeEval, isDetected);

    // トランスフォーム（ズーム・パン）の再適用
    this.applyCanvasTransform();
  }

  drawTargetBox(ctx, rect, strokeColor, fillColor, label, isActive) {
    ctx.save();
    const cx = rect.cx !== undefined ? rect.cx : (rect.x + rect.w / 2);
    const cy = rect.cy !== undefined ? rect.cy : (rect.y + rect.h / 2);
    const angle = rect.angle || 0;

    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isActive ? 3.5 : 2;
    ctx.fillStyle = fillColor;

    if (isActive) {
      ctx.setLineDash([5, 3]);
    }

    const halfW = rect.w / 2;
    const halfH = rect.h / 2;

    ctx.fillRect(-halfW, -halfH, rect.w, rect.h);
    ctx.strokeRect(-halfW, -halfH, rect.w, rect.h);
    ctx.setLineDash([]);

    // ラベルタグ
    ctx.fillStyle = strokeColor;
    ctx.font = 'bold 12px sans-serif';
    const tagText = `${label}${isActive ? ' [選択中]' : ''}`;
    const tagW = ctx.measureText(tagText).width + 8;
    ctx.fillRect(-halfW, -halfH - 18, tagW, 17);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tagText, -halfW + 4, -halfH - 5);

    ctx.restore();
  }

  updateEvalStatus(noChangeEval, hasChangeEval, isDetected = true) {
    const noStatusEl = this.container.querySelector('#eval-no-change-status');
    const noRatioEl = this.container.querySelector('#eval-no-change-ratio');
    const hasStatusEl = this.container.querySelector('#eval-has-change-status');
    const hasRatioEl = this.container.querySelector('#eval-has-change-ratio');

    if (!isDetected) {
      if (noStatusEl) {
        noStatusEl.className = 'badge badge-danger';
        noStatusEl.textContent = '未検出';
      }
      if (noRatioEl) noRatioEl.textContent = '黒画素: -';
      if (hasStatusEl) {
        hasStatusEl.className = 'badge badge-danger';
        hasStatusEl.textContent = '未検出';
      }
      if (hasRatioEl) hasRatioEl.textContent = '黒画素: -';
      return;
    }

    if (noStatusEl && noRatioEl) {
      const pct = Math.round(noChangeEval.darkRatio * 100);
      noRatioEl.textContent = `黒画素: ${pct}%`;
      if (noChangeEval.isChecked) {
        noStatusEl.className = 'badge badge-success font-bold';
        noStatusEl.textContent = '✅ チェックあり';
      } else {
        noStatusEl.className = 'badge badge-gray';
        noStatusEl.textContent = '⬜ なし';
      }
    }

    if (hasStatusEl && hasRatioEl) {
      const pct = Math.round(hasChangeEval.darkRatio * 100);
      hasRatioEl.textContent = `黒画素: ${pct}%`;
      if (hasChangeEval.isChecked) {
        hasStatusEl.className = 'badge badge-warning font-bold';
        hasStatusEl.textContent = '✅ チェックあり';
      } else {
        hasStatusEl.className = 'badge badge-gray';
        hasStatusEl.textContent = '⬜ なし';
      }
    }
  }
}
