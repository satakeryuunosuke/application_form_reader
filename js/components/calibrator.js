/**
 * スキャン読取位置（キャリブレーション）コンポーネント
 * プロジェクト作成ウィザードおよび書式設定モーダルで共通利用
 * チェックボックス枠を正方形（size）で管理し、内側収容＆高閾値（20%）判定に対応
 */

import { CheckboxEngine } from '../checkbox.js';
import { ScannerEngine } from '../scanner.js';
import { DB } from '../db.js';
import { UI } from '../utils/ui.js';

export class TemplateCalibrator {
  /**
   * @param {HTMLElement} container 描画先要素
   * @param {object} initialTemplate 初期テンプレート設定
   * @param {(template: object) => void} onChange 設定変更時コールバック
   * @param {object} options オプション設定 { defaultResetTemplate, resetLabel, isSettingsMode, codeType }
   */
  constructor(container, initialTemplate = null, onChange = null, options = {}) {
    this.container = container;
    this.options = options || {};
    this.codeType = this.options.codeType || 'code39';
    if (!this.options.codeType) {
      DB.getSettings().then(s => {
        if (s && s.codeType) {
          this.codeType = s.codeType;
        }
      }).catch(() => {});
    }
    this.defaultResetTemplate = this.options.defaultResetTemplate || CheckboxEngine.getDefaultTemplate();
    this.allowDeleteStandardBoxes = (this.options.allowDeleteStandardBoxes !== false);
    this.allowStandardBoxes = (this.options.allowStandardBoxes !== false);
    this.template = initialTemplate ? JSON.parse(JSON.stringify(initialTemplate)) : JSON.parse(JSON.stringify(this.defaultResetTemplate));
    if (!this.template.customBoxes) {
      this.template.customBoxes = [];
    }
    if (!this.allowStandardBoxes) {
      delete this.template.noChangeBox;
      delete this.template.hasChangeBox;
    }
    // すべての選択肢のマスの大きさを共通サイズに同期
    CheckboxEngine.syncBoxSizes(this.template);
    this.onChange = onChange;
    
    this.activeTab = this.allowStandardBoxes ? 'noChange' : (this.template.customBoxes[0]?.id || null);
    this.canvas = null;
    this.sourceCanvas = null; // 原寸大画像Canvas
    this.barcodeBox = null;
    this.bottomBorder = null; // パターンA: 外枠下端罫線情報
    this.loadedPages = []; // [{ canvas, barcodeBox, bottomBorder, pageNum }]
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

  /**
   * 読取コード規格（qr / code39 / auto）の動的変更を反映し、再検出
   */
  async updateCodeType(newCodeType) {
    this.codeType = newCodeType || 'code39';
    if (this.loadedPages && this.loadedPages.length > 0) {
      for (const page of this.loadedPages) {
        if (page.canvas) {
          const bcResult = await ScannerEngine.detectBarcode(page.canvas, { codeType: this.codeType });
          page.barcodeFound = bcResult.found;
          page.barcodeText = bcResult.text || '';
          page.barcodeType = bcResult.codeType || null;
          if (bcResult.box) {
            page.barcodeBox = bcResult.box;
            page.bottomBorder = ScannerEngine.detectBottomBorder(page.canvas, bcResult.box);
          }
        }
      }
      const cur = this.loadedPages[this.currentPageIndex];
      if (cur) {
        this.barcodeBox = cur.barcodeBox;
        this.bottomBorder = cur.bottomBorder || null;
        this.drawOverlay();
      }
    }
  }

  getTemplate() {
    const t = JSON.parse(JSON.stringify(this.template));
    // 外枠下端線が検出されている場合は、基準距離（refQrToBorderDist）および比率を自動保存
    if (this.bottomBorder && this.bottomBorder.found && this.bottomBorder.qrToBorderDist && this.sourceCanvas) {
      t.refQrToBorderDist = Math.round(this.bottomBorder.qrToBorderDist * 10) / 10;
      t.refQrToBorderRatio = this.bottomBorder.qrToBorderDist / this.sourceCanvas.height;
      t.refCanvasHeight = this.sourceCanvas.height;
    }
    return t;
  }

  setTemplate(newTemplate) {
    if (!newTemplate) return;
    this.template = JSON.parse(JSON.stringify(newTemplate));
    if (!this.template.customBoxes) {
      this.template.customBoxes = [];
    }
    if (!this.allowStandardBoxes) {
      delete this.template.noChangeBox;
      delete this.template.hasChangeBox;
    }
    CheckboxEngine.syncBoxSizes(this.template);
    this.updateTabsUI();
    this.syncSlidersFromTemplate();
    this.drawOverlay();
    this.updateLegend();
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
            <div class="calibrator-overlay-legend" id="calib-overlay-legend">
              <span class="legend-item"><span class="legend-box legend-barcode"></span> バーコード（基準点）</span>
              ${this.allowStandardBoxes ? `
                <span class="legend-item" id="legend-item-no-change" style="${this.template.noChangeBox ? '' : 'display: none;'}"><span class="legend-box legend-no-change"></span> 「変更なし」正方形読取枠</span>
                <span class="legend-item" id="legend-item-has-change" style="${this.template.hasChangeBox ? '' : 'display: none;'}"><span class="legend-box legend-has-change"></span> 「変更あり」正方形読取枠</span>
              ` : ''}
              <span class="legend-item" id="legend-item-custom" style="${this.template.customBoxes && this.template.customBoxes.length > 0 ? '' : 'display: none;'}"><span class="legend-box" style="background: #8b5cf6; border: 1px solid #7c3aed;"></span> 追加カスタム枠</span>
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

            <!-- タブ切り替え & 削除・再追加 -->
            <div class="calibrator-tabs" id="calib-tabs-container">
              ${this.renderTabsHtml()}
            </div>

            <!-- リアルタイム判定カード -->
            <div class="calibrator-eval-card" id="calib-eval-card-main">
              <!-- 選択中枠の注目判定バナー -->
              <div id="eval-active-focus-container" class="eval-active-focus" style="display: none;">
                <div style="min-width: 0;">
                  <div class="eval-active-focus-title" id="eval-active-title">🎯 選択中の枠</div>
                  <div class="text-mono" id="eval-active-ratio" style="font-size: 0.76rem; color: #4c1d95;">黒画素: -</div>
                </div>
                <div id="eval-active-badge">
                  <span class="badge badge-gray">-</span>
                </div>
              </div>

              ${this.allowStandardBoxes ? `
                <div class="eval-row" id="eval-overall-row" style="${(this.template.noChangeBox && this.template.hasChangeBox) ? '' : 'display: none;'} background: #f8fafc; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 5px 8px; margin-bottom: 6px;">
                  <span class="eval-label font-bold" style="font-size: 0.82rem; color: var(--gray-800);">総合自動判定:</span>
                  <span id="eval-overall-status" class="badge badge-success font-bold" style="font-size: 0.82rem;">-</span>
                </div>
                <div class="eval-row" id="eval-no-change-row" style="${this.template.noChangeBox ? '' : 'display: none;'}">
                  <span class="eval-label">変更なし判定:</span>
                  <span id="eval-no-change-status" class="badge badge-gray">-</span>
                  <span class="text-mono eval-ratio" id="eval-no-change-ratio">黒画素: 0%</span>
                </div>
                <div class="eval-row" id="eval-has-change-row" style="${this.template.hasChangeBox ? '' : 'display: none;'}">
                  <span class="eval-label">変更あり判定:</span>
                  <span id="eval-has-change-status" class="badge badge-gray">-</span>
                  <span class="text-mono eval-ratio" id="eval-has-change-ratio">黒画素: 0%</span>
                </div>
              ` : ''}

              <!-- 講座選択モード・多数枠用 アコーディオン展開 -->
              <div id="eval-custom-summary-bar" class="eval-summary-bar" style="display: none;">
                <span id="eval-summary-text">全 0 枠</span>
                <button type="button" id="btn-toggle-eval-list" class="eval-accordion-toggle">
                  <span id="eval-toggle-label">📋 全件判定一覧を表示</span>
                  <span id="eval-toggle-icon">▼</span>
                </button>
              </div>
              <div id="eval-accordion-body" class="eval-accordion-body" style="display: none;">
                <div id="eval-custom-rows"></div>
              </div>

              <div id="eval-empty-row" style="${!this.template.noChangeBox && !this.template.hasChangeBox && (!this.template.customBoxes || this.template.customBoxes.length === 0) ? '' : 'display: none;'} font-size: 0.8rem; color: var(--gray-500); text-align: center; padding: 4px;">
                読取枠がありません
              </div>
            </div>

            <!-- スライダーグループ -->
            <div class="calibrator-sliders-card">
              <div id="calib-no-target-msg" style="${this.getTargetBox() ? 'display: none;' : 'display: block;'} padding: 18px 12px; text-align: center; color: var(--gray-500); font-size: 0.85rem;">
                ⚠️ 読取対象の枠がありません。<br>
                ${this.allowStandardBoxes ? '上の「➕ 枠を追加」ボタン、または管理パネルから追加してください。' : '管理パネルから講座・チェック項目を追加してください。'}
              </div>

              <div id="calib-sliders-body" style="${this.getTargetBox() ? 'display: block;' : 'display: none;'}">
                <div class="calib-field">
                  <div class="calib-field-header">
                    <label class="form-label">左右位置（Xオフセット）</label>
                    <span class="calib-val-badge text-mono" id="val-dx">0.0%</span>
                  </div>
                  <div class="calib-input-row">
                    <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="dx" data-delta="-0.002">◀</button>
                    <input type="range" id="rng-dx" min="-1.00" max="1.00" step="0.001" class="form-range">
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
                    <input type="range" id="rng-dy" min="-1.00" max="1.00" step="0.001" class="form-range">
                    <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="dy" data-delta="0.002">▼</button>
                  </div>
                </div>

                <!-- 正方形サイズ 1パラメータ（全選択肢で同期） -->
                <div class="calib-field">
                  <div class="calib-field-header">
                    <label class="form-label" title="黒画素割合の判定基準を均一にするため、すべての選択肢で同一サイズに同期されます">
                      マスの大きさ（全選択肢で同期）
                    </label>
                    <span class="calib-val-badge text-mono" id="val-size">3.2%</span>
                  </div>
                  <div class="calib-input-row">
                    <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="size" data-delta="-0.001" title="マスの大きさを縮小">➖</button>
                    <input type="range" id="rng-size" min="0.005" max="0.150" step="0.001" class="form-range">
                    <button type="button" class="btn btn-secondary btn-sm btn-nudge" data-target="size" data-delta="0.001" title="マスの大きさを拡大">➕</button>
                  </div>
                  <div style="font-size: 0.72rem; color: var(--gray-500); margin-top: 2px;">
                    ※ 黒画素割合の判定基準を均一化するため、すべての選択肢の大きさが自動で同期されます
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

                <!-- 選択中の枠の削除アクションバー -->
                <div id="calib-box-action-bar" style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--gray-200); padding-top: 8px;">
                  <span style="font-size: 0.78rem; color: var(--gray-600);">調整中: <strong id="calib-active-box-name">-</strong></span>
                  <button type="button" id="btn-calib-del-active" class="btn btn-ghost btn-sm" style="color: var(--danger-solid); font-size: 0.78rem; padding: 2px 8px;" title="選択中の読取枠を削除">
                    🗑️ この枠を削除
                  </button>
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

  getTargetBox() {
    if (this.allowStandardBoxes) {
      if (this.activeTab === 'noChange' && this.template.noChangeBox) return this.template.noChangeBox;
      if (this.activeTab === 'hasChange' && this.template.hasChangeBox) return this.template.hasChangeBox;
    }
    if (this.template.customBoxes && this.template.customBoxes.length > 0) {
      const found = this.template.customBoxes.find(b => b.id === this.activeTab);
      if (found) return found;
    }
    // activeTabが見つからない場合、存在する最初の枠をフォールバック
    if (this.allowStandardBoxes && this.template.noChangeBox) {
      this.activeTab = 'noChange';
      return this.template.noChangeBox;
    }
    if (this.allowStandardBoxes && this.template.hasChangeBox) {
      this.activeTab = 'hasChange';
      return this.template.hasChangeBox;
    }
    if (this.template.customBoxes && this.template.customBoxes.length > 0) {
      this.activeTab = this.template.customBoxes[0].id;
      return this.template.customBoxes[0];
    }
    this.activeTab = null;
    return null;
  }

  getActiveBoxLabel() {
    if (this.allowStandardBoxes) {
      if (this.activeTab === 'noChange' && this.template.noChangeBox) return '🟩 「変更なし」枠';
      if (this.activeTab === 'hasChange' && this.template.hasChangeBox) return '🟧 「変更あり」枠';
    }
    if (this.template.customBoxes) {
      const found = this.template.customBoxes.find(b => b.id === this.activeTab);
      if (found) return `🟪 「${found.label}」枠`;
    }
    return '';
  }

  getAllBoxesList() {
    const list = [];
    if (this.allowStandardBoxes && this.template.noChangeBox) {
      list.push({ id: 'noChange', label: '「変更なし」枠', type: 'standard', color: '#16a34a', icon: '🟩' });
    }
    if (this.allowStandardBoxes && this.template.hasChangeBox) {
      list.push({ id: 'hasChange', label: '「変更あり」枠', type: 'standard', color: '#ea580c', icon: '🟧' });
    }
    if (this.template.customBoxes) {
      this.template.customBoxes.forEach((b, idx) => {
        list.push({ id: b.id, label: b.label, type: 'custom', color: '#8b5cf6', icon: '🟪', customIndex: idx });
      });
    }
    return list;
  }

  renderTabsHtml() {
    const hasNoChange = this.allowStandardBoxes && !!this.template.noChangeBox;
    const hasHasChange = this.allowStandardBoxes && !!this.template.hasChangeBox;
    const customBoxes = this.template.customBoxes || [];
    const allBoxes = this.getAllBoxesList();

    // 講座選択モード、または全項目数が4個以上ある場合は「スマート枠セレクタ」を表示
    const useSmartSelector = !this.allowStandardBoxes || allBoxes.length >= 4;

    if (useSmartSelector) {
      const currentIndex = allBoxes.findIndex(b => b.id === this.activeTab);
      const activeItem = allBoxes[currentIndex];
      const isCustom = activeItem && activeItem.type === 'custom';
      const customIdx = isCustom ? customBoxes.findIndex(b => b.id === activeItem.id) : -1;

      return `
        <div class="calib-smart-selector">
          <div class="calib-smart-selector-header">
            <div style="font-size: 0.8rem; font-weight: 700; color: var(--gray-800); display: flex; align-items: center; gap: 6px;">
              <span>🎯 調整枠を選択</span>
              <span class="badge badge-purple" style="font-size: 0.72rem;">${allBoxes.length > 0 ? (currentIndex >= 0 ? currentIndex + 1 : 1) : 0} / ${allBoxes.length}</span>
            </div>
            <div class="calib-smart-selector-nav">
              <button type="button" class="btn-nav" id="btn-calib-prev-target" ${currentIndex <= 0 ? 'disabled' : ''} title="前の枠へ切り替え (◀)">◀ 前へ</button>
              <button type="button" class="btn-nav" id="btn-calib-next-target" ${currentIndex < 0 || currentIndex >= allBoxes.length - 1 ? 'disabled' : ''} title="次の枠へ切り替え (▶)">次へ ▶</button>
            </div>
          </div>

          <div class="calib-smart-select-wrapper">
            <select id="calib-smart-box-select" class="calib-smart-select">
              ${allBoxes.map((b, idx) => `
                <option value="${b.id}" ${b.id === this.activeTab ? 'selected' : ''}>
                  ${idx + 1}. ${b.icon} ${b.label}
                </option>
              `).join('')}
            </select>
            <div class="calib-order-btns">
              <button type="button" class="calib-order-btn" id="btn-calib-box-up" ${!isCustom || customIdx <= 0 ? 'disabled' : ''} title="選択中の講座の順番を上へ移動">▲</button>
              <button type="button" class="calib-order-btn" id="btn-calib-box-down" ${!isCustom || customIdx >= customBoxes.length - 1 ? 'disabled' : ''} title="選択中の講座の順番を下へ移動">▼</button>
              <button type="button" class="calib-order-btn" id="btn-calib-box-sort" ${customBoxes.length <= 1 ? 'disabled' : ''} title="全講座を名前順（昇順）に並び替え">🔤</button>
            </div>
          </div>
        </div>
      `;
    }

    // 従来の受講確認モード（項目数が少数（3個以下）の場合）
    let tabsHtml = '';
    if (hasNoChange) {
      tabsHtml += `
        <div class="calib-tab-item ${this.activeTab === 'noChange' ? 'active' : ''}" style="${this.activeTab === 'noChange' ? 'border-color: #16a34a;' : ''}">
          <button type="button" class="calib-tab-btn" data-tab="noChange">🟩 「変更なし」枠</button>
          ${this.allowDeleteStandardBoxes ? `
            <button type="button" class="calib-tab-del-btn" data-del="noChange" title="「変更なし」読取枠を削除">✕</button>
          ` : ''}
        </div>
      `;
    }
    if (hasHasChange) {
      tabsHtml += `
        <div class="calib-tab-item ${this.activeTab === 'hasChange' ? 'active' : ''}" style="${this.activeTab === 'hasChange' ? 'border-color: #ea580c;' : ''}">
          <button type="button" class="calib-tab-btn" data-tab="hasChange">🟧 「変更あり」枠</button>
          ${this.allowDeleteStandardBoxes ? `
            <button type="button" class="calib-tab-del-btn" data-del="hasChange" title="「変更あり」読取枠を削除">✕</button>
          ` : ''}
        </div>
      `;
    }
    tabsHtml += customBoxes.map(box => `
      <div class="calib-tab-item ${this.activeTab === box.id ? 'active' : ''}" style="${this.activeTab === box.id ? 'border-color: #8b5cf6;' : ''}">
        <button type="button" class="calib-tab-btn" data-tab="${box.id}">🟪 ${box.label}</button>
        <button type="button" class="calib-tab-del-btn" data-del="${box.id}" title="「${box.label}」読取枠を削除">✕</button>
      </div>
    `).join('');

    if (!hasNoChange && !hasHasChange && customBoxes.length === 0) {
      tabsHtml = `<div style="font-size: 0.8rem; color: var(--gray-500); padding: 4px 8px;">読取枠が登録されていません</div>`;
    }

    let actionsHtml = '';
    if (this.allowStandardBoxes) {
      if (!hasNoChange) {
        actionsHtml += `
          <button type="button" class="btn btn-secondary btn-sm calib-btn-restore-box" data-restore="noChange" style="font-size: 0.72rem; padding: 2px 8px; color: #16a34a; border-color: #86efac;" title="「変更なし」読取枠を標準位置で再追加">
            ➕ 「変更なし」枠を追加
          </button>
        `;
      }
      if (!hasHasChange) {
        actionsHtml += `
          <button type="button" class="btn btn-secondary btn-sm calib-btn-restore-box" data-restore="hasChange" style="font-size: 0.72rem; padding: 2px 8px; color: #ea580c; border-color: #fdba74;" title="「変更あり」読取枠を標準位置で再追加">
            ➕ 「変更あり」枠を追加
          </button>
        `;
      }
    }

    return `
      <div class="calib-tabs-list">
        ${tabsHtml}
      </div>
      ${actionsHtml ? `<div class="calib-tabs-actions">${actionsHtml}</div>` : ''}
    `;
  }

  updateTabsUI() {
    const container = this.container.querySelector('#calib-tabs-container');
    if (container) {
      container.innerHTML = this.renderTabsHtml();
      this.bindTabEvents();
    }
  }

  bindTabEvents() {
    const allBoxes = this.getAllBoxesList();
    const currentIndex = allBoxes.findIndex(b => b.id === this.activeTab);

    // スマートセレクタ：ドロップダウン切り替え
    const smartSelect = this.container.querySelector('#calib-smart-box-select');
    if (smartSelect) {
      smartSelect.onchange = () => {
        this.activeTab = smartSelect.value;
        this.updateTabsUI();
        this.syncSlidersFromTemplate();
        this.drawOverlay();
      };
    }

    // スマートセレクタ：前へボタン
    const prevTargetBtn = this.container.querySelector('#btn-calib-prev-target');
    if (prevTargetBtn) {
      prevTargetBtn.onclick = (e) => {
        e.stopPropagation();
        if (currentIndex > 0) {
          this.activeTab = allBoxes[currentIndex - 1].id;
          this.updateTabsUI();
          this.syncSlidersFromTemplate();
          this.drawOverlay();
        }
      };
    }

    // スマートセレクタ：次へボタン
    const nextTargetBtn = this.container.querySelector('#btn-calib-next-target');
    if (nextTargetBtn) {
      nextTargetBtn.onclick = (e) => {
        e.stopPropagation();
        if (currentIndex < allBoxes.length - 1) {
          this.activeTab = allBoxes[currentIndex + 1].id;
          this.updateTabsUI();
          this.syncSlidersFromTemplate();
          this.drawOverlay();
        }
      };
    }

    // 並び替え：上へ
    const moveUpBtn = this.container.querySelector('#btn-calib-box-up');
    if (moveUpBtn) {
      moveUpBtn.onclick = (e) => {
        e.stopPropagation();
        this.moveCustomBox(this.activeTab, -1);
      };
    }

    // 並び替え：下へ
    const moveDownBtn = this.container.querySelector('#btn-calib-box-down');
    if (moveDownBtn) {
      moveDownBtn.onclick = (e) => {
        e.stopPropagation();
        this.moveCustomBox(this.activeTab, 1);
      };
    }

    // 並び替え：名前順ソート
    const sortBtn = this.container.querySelector('#btn-calib-box-sort');
    if (sortBtn) {
      sortBtn.onclick = (e) => {
        e.stopPropagation();
        this.sortCustomBoxes();
      };
    }

    // 従来のタブ切り替えボタン
    const tabBtns = this.container.querySelectorAll('.calib-tab-btn');
    tabBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.activeTab = btn.dataset.tab;
        this.updateTabsUI();
        this.syncSlidersFromTemplate();
        this.drawOverlay();
      };
    });

    // タブ内個別削除ボタン (✕)
    const delBtns = this.container.querySelectorAll('.calib-tab-del-btn');
    delBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.deleteBox(btn.dataset.del);
      };
    });

    // 削除済み標準枠の再追加ボタン
    const restoreBtns = this.container.querySelectorAll('.calib-btn-restore-box');
    restoreBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.addStandardBox(btn.dataset.restore);
      };
    });
  }

  moveCustomBox(id, delta) {
    if (!this.template.customBoxes || this.template.customBoxes.length <= 1) return;
    const idx = this.template.customBoxes.findIndex(b => b.id === id);
    if (idx < 0) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= this.template.customBoxes.length) return;

    const [item] = this.template.customBoxes.splice(idx, 1);
    this.template.customBoxes.splice(targetIdx, 0, item);
    this.activeTab = item.id;

    this.updateTabsUI();
    this.syncSlidersFromTemplate();
    this.drawOverlay();
    if (this.onChange) {
      this.onChange(this.template);
    }
  }

  sortCustomBoxes() {
    if (!this.template.customBoxes || this.template.customBoxes.length <= 1) return;
    this.template.customBoxes.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja'));
    this.updateTabsUI();
    this.syncSlidersFromTemplate();
    this.drawOverlay();
    if (this.onChange) {
      this.onChange(this.template);
    }
    UI.showToast('全講座を名前順に並び替えました', 'success');
  }

  deleteBox(typeOrId) {
    if (!this.allowStandardBoxes && (typeOrId === 'noChange' || typeOrId === 'hasChange')) {
      return;
    }
    if (!this.allowDeleteStandardBoxes && (typeOrId === 'noChange' || typeOrId === 'hasChange')) {
      return;
    }
    let label = '';
    if (typeOrId === 'noChange') {
      if (!this.template.noChangeBox) return;
      delete this.template.noChangeBox;
      label = '変更なし';
    } else if (typeOrId === 'hasChange') {
      if (!this.template.hasChangeBox) return;
      delete this.template.hasChangeBox;
      label = '変更あり';
    } else {
      const found = (this.template.customBoxes || []).find(b => b.id === typeOrId);
      label = found ? found.label : typeOrId;
      this.template.customBoxes = (this.template.customBoxes || []).filter(b => b.id !== typeOrId);
    }

    // activeTab の更新
    if (this.activeTab === typeOrId) {
      if (this.allowStandardBoxes && this.template.noChangeBox) {
        this.activeTab = 'noChange';
      } else if (this.allowStandardBoxes && this.template.hasChangeBox) {
        this.activeTab = 'hasChange';
      } else if (this.template.customBoxes && this.template.customBoxes.length > 0) {
        this.activeTab = this.template.customBoxes[0].id;
      } else {
        this.activeTab = null;
      }
    }

    this.updateTabsUI();
    this.syncSlidersFromTemplate();
    this.drawOverlay();
    this.updateLegend();

    if (this.onChange) {
      this.onChange(this.template);
    }
    UI.showToast(`「${label}」チェックボックスを削除しました`, 'info');
  }

  addStandardBox(type) {
    if (!this.allowStandardBoxes) return;
    const def = CheckboxEngine.getDefaultTemplate();
    const commonSize = CheckboxEngine.getCommonBoxSize(this.template);
    if (type === 'noChange') {
      this.template.noChangeBox = JSON.parse(JSON.stringify(def.noChangeBox));
      this.template.noChangeBox.size = commonSize;
      this.activeTab = 'noChange';
      UI.showToast('「変更なし」読取枠を追加しました', 'success');
    } else if (type === 'hasChange') {
      this.template.hasChangeBox = JSON.parse(JSON.stringify(def.hasChangeBox));
      this.template.hasChangeBox.size = commonSize;
      this.activeTab = 'hasChange';
      UI.showToast('「変更あり」読取枠を追加しました', 'success');
    }

    this.updateTabsUI();
    this.syncSlidersFromTemplate();
    this.drawOverlay();
    this.updateLegend();

    if (this.onChange) {
      this.onChange(this.template);
    }
  }

  updateLegend() {
    const legend = this.container.querySelector('#calib-overlay-legend');
    if (!legend) return;
    let html = `<span class="legend-item"><span class="legend-box legend-barcode"></span> バーコード（基準点）</span>`;
    if (this.allowStandardBoxes && this.template.noChangeBox) {
      html += `<span class="legend-item"><span class="legend-box legend-no-change"></span> 「変更なし」正方形読取枠</span>`;
    }
    if (this.allowStandardBoxes && this.template.hasChangeBox) {
      html += `<span class="legend-item"><span class="legend-box legend-has-change"></span> 「変更あり」正方形読取枠</span>`;
    }
    if (this.template.customBoxes && this.template.customBoxes.length > 0) {
      html += `<span class="legend-item"><span class="legend-box" style="background: #8b5cf6; border: 1px solid #7c3aed;"></span> 追加カスタム枠</span>`;
    }
    if (this.bottomBorder && this.bottomBorder.found) {
      html += `<span class="legend-item"><span class="legend-box" style="background: #06b6d4; border: 1px dashed #0891b2;"></span> 📐 外枠下端線 (傾き: ${this.bottomBorder.angleDeg}° 補正有効)</span>`;
    }
    legend.innerHTML = html;
  }

  /**
   * イベントバインド
   */
  bindEvents() {
    // タブ切り替え
    this.bindTabEvents();

    // 判定一覧アコーディオン開閉
    this.isEvalListOpen = false;
    const toggleBtn = this.container.querySelector('#btn-toggle-eval-list');
    const accordionBody = this.container.querySelector('#eval-accordion-body');
    const toggleLabel = this.container.querySelector('#eval-toggle-label');
    const toggleIcon = this.container.querySelector('#eval-toggle-icon');
    if (toggleBtn && accordionBody) {
      toggleBtn.onclick = () => {
        this.isEvalListOpen = !this.isEvalListOpen;
        accordionBody.style.display = this.isEvalListOpen ? 'flex' : 'none';
        if (toggleLabel) toggleLabel.textContent = this.isEvalListOpen ? '折りたたむ' : '📋 全件判定一覧を表示';
        if (toggleIcon) toggleIcon.textContent = this.isEvalListOpen ? '▲' : '▼';
      };
    }

    // スライダー変更
    const rngDx = this.container.querySelector('#rng-dx');
    const rngDy = this.container.querySelector('#rng-dy');
    const rngSize = this.container.querySelector('#rng-size');
    const rngTh = this.container.querySelector('#rng-threshold');

    const handleSliderInput = () => {
      const targetBox = this.getTargetBox();
      if (!targetBox) return;
      targetBox.dx = parseFloat(rngDx.value);
      targetBox.dy = parseFloat(rngDy.value);
      const newSize = parseFloat(rngSize.value);
      CheckboxEngine.syncBoxSizes(this.template, newSize);
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
        const targetBox = this.getTargetBox();
        if (!targetBox) return;

        if (target === 'size') {
          const currentVal = targetBox.size || targetBox.w || 0.032;
          let newVal = Math.round((currentVal + delta) * 1000) / 1000;
          newVal = Math.max(0.005, Math.min(0.150, newVal));
          CheckboxEngine.syncBoxSizes(this.template, newVal);
          this.syncSlidersFromTemplate();
          this.drawOverlay();
          if (this.onChange) this.onChange(this.template);
          return;
        }

        const currentVal = targetBox[target];
        let newVal = Math.round((currentVal + delta) * 1000) / 1000;
        if (target === 'dx' || target === 'dy') {
          newVal = Math.max(-1.00, Math.min(1.00, newVal));
        }
        targetBox[target] = newVal;
        this.syncSlidersFromTemplate();
        this.drawOverlay();
        if (this.onChange) this.onChange(this.template);
      };
    });

    // 選択中の枠を削除するボタン
    const delActiveBtn = this.container.querySelector('#btn-calib-del-active');
    if (delActiveBtn) {
      delActiveBtn.onclick = () => {
        if (!this.activeTab) return;
        this.deleteBox(this.activeTab);
      };
    }

    // デフォルトに戻す
    const resetBtn = this.container.querySelector('#btn-calib-reset');
    if (resetBtn) {
      resetBtn.onclick = () => {
        this.template = JSON.parse(JSON.stringify(this.defaultResetTemplate));
        if (!this.template.customBoxes) this.template.customBoxes = [];
        if (!this.allowStandardBoxes) {
          delete this.template.noChangeBox;
          delete this.template.hasChangeBox;
        }
        if (this.allowStandardBoxes) {
          this.activeTab = this.template.noChangeBox ? 'noChange' : (this.template.hasChangeBox ? 'hasChange' : null);
        } else {
          this.activeTab = (this.template.customBoxes && this.template.customBoxes.length > 0) ? this.template.customBoxes[0].id : null;
        }
        this.updateTabsUI();
        this.syncSlidersFromTemplate();
        this.drawOverlay();
        this.updateLegend();
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
    const targetBox = this.getTargetBox();
    if (!this.sourceCanvas || !this.barcodeBox || !targetBox) {
      this.zoomLevel = 2.2;
      this.panX = 0;
      this.panY = 0;
      this.applyCanvasTransform();
      return;
    }

    const cvW = this.sourceCanvas.width;
    const cvH = this.sourceCanvas.height;
    const bc = this.barcodeBox;

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
    const targetBox = this.getTargetBox();
    const slidersBody = this.container.querySelector('#calib-sliders-body');
    const noTargetMsg = this.container.querySelector('#calib-no-target-msg');

    if (!targetBox) {
      if (slidersBody) slidersBody.style.display = 'none';
      if (noTargetMsg) noTargetMsg.style.display = 'block';
      return;
    }

    if (slidersBody) slidersBody.style.display = 'block';
    if (noTargetMsg) noTargetMsg.style.display = 'none';

    const activeBoxNameEl = this.container.querySelector('#calib-active-box-name');
    if (activeBoxNameEl) {
      activeBoxNameEl.textContent = this.getActiveBoxLabel();
    }
    
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
    const targetBox = this.getTargetBox();
    const activeBoxNameEl = this.container.querySelector('#calib-active-box-name');
    if (activeBoxNameEl) {
      activeBoxNameEl.textContent = this.getActiveBoxLabel();
    }
    if (!targetBox) return;
    
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

          const bcResult = await ScannerEngine.detectBarcode(cv, { codeType: this.codeType });
          const isQR = bcResult.codeType === 'QR' || this.codeType === 'qr';
          const barcodeBox = bcResult.box || {
            centerX: cv.width * 0.13,
            centerY: cv.height * 0.10,
            width: isQR ? Math.round(cv.width * 0.08) : Math.round(cv.width * 0.15),
            height: isQR ? Math.round(cv.width * 0.08) : Math.round(cv.height * 0.05),
            angle: 0,
            angleDeg: 0
          };
          const bottomBorder = barcodeBox ? ScannerEngine.detectBottomBorder(cv, barcodeBox) : null;

          this.loadedPages.push({
            canvas: cv,
            barcodeFound: bcResult.found,
            barcodeType: bcResult.codeType || (isQR ? 'QR' : 'CODE39'),
            barcodeBox,
            bottomBorder,
            barcodeText: bcResult.text || '',
            pageNum: i
          });
        }

        this.updatePaginationUI();
        this.setPage(0);

        const foundCount = this.loadedPages.filter(p => p.barcodeFound).length;
        const codeLabel = (this.codeType === 'qr') ? 'QRコード' : ((this.codeType === 'auto') ? 'コード (QR/バーコード)' : 'バーコード');
        if (foundCount === 0) {
          UI.showToast(`⚠️ ${codeLabel}を検出できませんでした。画像の向き・鮮明さ・規格設定をご確認ください。`, 'warning');
        } else if (foundCount === this.loadedPages.length) {
          const first = this.loadedPages[0];
          const detectedLabel = first.barcodeType === 'QR' ? 'QRコード' : 'バーコード';
          UI.showToast(`${detectedLabel}「${first.barcodeText}」を検出しました（全${this.loadedPages.length}ページ）`, 'success');
        } else {
          UI.showToast(`${this.loadedPages.length} ページ中 ${foundCount} ページの${codeLabel}を検出しました`, 'warning');
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
          const bcResult = await ScannerEngine.detectBarcode(cv, { codeType: this.codeType });
          const isQR = bcResult.codeType === 'QR' || this.codeType === 'qr';
          const barcodeBox = bcResult.box || {
            centerX: cv.width * 0.13,
            centerY: cv.height * 0.10,
            width: isQR ? Math.round(cv.width * 0.08) : Math.round(cv.width * 0.15),
            height: isQR ? Math.round(cv.width * 0.08) : Math.round(cv.height * 0.05),
            angle: 0,
            angleDeg: 0
          };
          const bottomBorder = barcodeBox ? ScannerEngine.detectBottomBorder(cv, barcodeBox) : null;

          this.loadedPages = [{
            canvas: cv,
            barcodeFound: bcResult.found,
            barcodeType: bcResult.codeType || (isQR ? 'QR' : 'CODE39'),
            barcodeBox,
            bottomBorder,
            barcodeText: bcResult.text || '',
            pageNum: 1
          }];

          this.updatePaginationUI();
          this.setPage(0);

          if (bcResult.found) {
            const detectedLabel = bcResult.codeType === 'QR' ? 'QRコード' : 'バーコード';
            UI.showToast(`${detectedLabel}「${bcResult.text}」を検出しました`, 'success');
          } else {
            const codeLabel = (this.codeType === 'qr') ? 'QRコード' : ((this.codeType === 'auto') ? 'コード (QR/バーコード)' : 'バーコード');
            UI.showToast(`⚠️ ${codeLabel}を検出できませんでした。画像の向き・鮮明さ・規格設定をご確認ください。`, 'warning');
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
    this.bottomBorder = cur.bottomBorder || null;
    // 書式設定中の帳票自身をリファレンス基準に同期し、編集画面でのスケールを1.0（基準100%）に保持
    if (this.bottomBorder && this.bottomBorder.found && this.bottomBorder.qrToBorderDist && cur.canvas) {
      this.template.refQrToBorderDist = Math.round(this.bottomBorder.qrToBorderDist * 10) / 10;
      this.template.refQrToBorderRatio = this.bottomBorder.qrToBorderDist / cur.canvas.height;
      this.template.refCanvasHeight = cur.canvas.height;
    }
    this.updatePaginationUI();
    this.drawOverlay();
    this.updateLegend();
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

      const codeLabel = (this.codeType === 'qr') ? 'QRコード' : 'コード';
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠️ ${codeLabel}未検出（位置未確定）`, bc.centerX, bc.centerY + 5);
    }
    ctx.restore();

    // 未検出時の上部警告バナー
    if (!isDetected) {
      const codeLabel = (this.codeType === 'qr') ? 'QRコード' : 'コード（バーコード/QR）';
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.90)';
      ctx.fillRect(0, 0, srcW, 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠️ ${codeLabel}が読み取れていません。鮮明なファイルを選択するか、規格設定をご確認ください。`, srcW / 2, 23);
      ctx.restore();
    }

    // 2.5. パターンA: 検出された外枠下端線の描画（水色ライン）
    if (this.bottomBorder && this.bottomBorder.found) {
      ctx.save();
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = Math.max(2.5, Math.round(srcW * 0.0028));
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      const x1 = srcW * 0.06;
      const y1 = this.bottomBorder.slope * x1 + this.bottomBorder.intercept;
      const x2 = srcW * 0.94;
      const y2 = this.bottomBorder.slope * x2 + this.bottomBorder.intercept;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // 外枠線ラベル
      ctx.fillStyle = '#0891b2';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`📐 外枠下端線検出（傾き: ${this.bottomBorder.angleDeg}° 補正有効）`, x1 + 8, y1 - 8);
      ctx.restore();
    }

    // 3. 読取枠の計算（完全な正方形＋外枠罫線アシスト補正）
    const rects = CheckboxEngine.calculateTargetRects(this.sourceCanvas, this.barcodeBox, this.template, this.bottomBorder);

    // 4. 黒画素率の評価
    const threshold = this.template.threshold !== undefined ? this.template.threshold : 0.25;
    const noChangeEval = (this.allowStandardBoxes && rects.noChangeRect) ? CheckboxEngine.evaluateCheckbox(this.sourceCanvas, rects.noChangeRect, threshold) : null;
    const hasChangeEval = (this.allowStandardBoxes && rects.hasChangeRect) ? CheckboxEngine.evaluateCheckbox(this.sourceCanvas, rects.hasChangeRect, threshold) : null;

    // 5. 「変更なし」枠（緑）
    if (this.allowStandardBoxes && rects.noChangeRect) {
      const isNoChangeActive = this.activeTab === 'noChange';
      this.drawTargetBox(ctx, rects.noChangeRect, '#16a34a', 'rgba(22, 163, 74, 0.18)', '変更なし (正方形)', isNoChangeActive);
    }

    // 6. 「変更あり」枠（橙）
    if (this.allowStandardBoxes && rects.hasChangeRect) {
      const isHasChangeActive = this.activeTab === 'hasChange';
      this.drawTargetBox(ctx, rects.hasChangeRect, '#ea580c', 'rgba(234, 88, 12, 0.18)', '変更あり (正方形)', isHasChangeActive);
    }

    // 7. カスタム追加枠（紫）
    const customEvals = [];
    if (rects.customRects && rects.customRects.length > 0) {
      for (const item of rects.customRects) {
        const ev = CheckboxEngine.evaluateCheckbox(this.sourceCanvas, item.rect, threshold);
        const isCustomActive = this.activeTab === item.id;
        this.drawTargetBox(ctx, item.rect, '#8b5cf6', 'rgba(139, 92, 246, 0.18)', `${item.label} (正方形)`, isCustomActive);
        customEvals.push({
          id: item.id,
          label: item.label,
          eval: ev,
          isActive: isCustomActive
        });
      }
    }

    // 8. 判定UIの更新
    this.updateEvalStatus(noChangeEval, hasChangeEval, customEvals, isDetected);

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

  updateEvalStatus(noChangeEval, hasChangeEval, customEvals = [], isDetected = true) {
    const noRow = this.container.querySelector('#eval-no-change-row');
    const hasRow = this.container.querySelector('#eval-has-change-row');
    const emptyRow = this.container.querySelector('#eval-empty-row');
    const noStatusEl = this.container.querySelector('#eval-no-change-status');
    const noRatioEl = this.container.querySelector('#eval-no-change-ratio');
    const hasStatusEl = this.container.querySelector('#eval-has-change-status');
    const hasRatioEl = this.container.querySelector('#eval-has-change-ratio');
    const customRowsEl = this.container.querySelector('#eval-custom-rows');
    const activeFocusContainer = this.container.querySelector('#eval-active-focus-container');
    const activeTitleEl = this.container.querySelector('#eval-active-title');
    const activeRatioEl = this.container.querySelector('#eval-active-ratio');
    const activeBadgeEl = this.container.querySelector('#eval-active-badge');
    const summaryBar = this.container.querySelector('#eval-custom-summary-bar');
    const summaryText = this.container.querySelector('#eval-summary-text');

    const overallRow = this.container.querySelector('#eval-overall-row');
    const overallStatusEl = this.container.querySelector('#eval-overall-status');

    if (noRow) noRow.style.display = noChangeEval ? '' : 'none';
    if (hasRow) hasRow.style.display = hasChangeEval ? '' : 'none';
    if (emptyRow) emptyRow.style.display = (!noChangeEval && !hasChangeEval && customEvals.length === 0) ? '' : 'none';

    if (!isDetected) {
      if (overallRow && overallStatusEl) {
        overallStatusEl.className = 'badge badge-danger';
        overallStatusEl.textContent = '未検出';
      }
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
      if (customRowsEl) customRowsEl.innerHTML = '';
      if (activeFocusContainer) activeFocusContainer.style.display = 'none';
      if (summaryBar) summaryBar.style.display = 'none';
      return;
    }

    // 受講確認モードの総合自動判定（変更なし / 変更あり の二者択一大小比較）
    if (this.allowStandardBoxes && noChangeEval && hasChangeEval && overallRow && overallStatusEl) {
      overallRow.style.display = 'flex';
      const hasDark = hasChangeEval.darkRatio || 0;
      const noDark = noChangeEval.darkRatio || 0;
      const threshold = this.template.threshold !== undefined ? this.template.threshold : 0.25;
      const minThreshold = threshold * 0.7;

      if (hasDark >= minThreshold || noDark >= minThreshold) {
        if (hasDark > noDark) {
          overallStatusEl.className = 'badge badge-warning font-bold';
          overallStatusEl.textContent = '⚠️ 変更あり (受講変更)';
        } else {
          overallStatusEl.className = 'badge badge-success font-bold';
          overallStatusEl.textContent = '✅ 変更なし (所属受講)';
        }
      } else {
        overallStatusEl.className = 'badge badge-gray font-bold';
        overallStatusEl.textContent = '⬜ 変更なし (未記入)';
      }
    } else if (overallRow) {
      overallRow.style.display = 'none';
    }

    if (noChangeEval && noStatusEl && noRatioEl) {
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

    if (hasChangeEval && hasStatusEl && hasRatioEl) {
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

    // 講座選択モード または customEvals がある場合のサマリーバー & 選択中枠ハイライト表示
    const allBoxes = this.getAllBoxesList();
    const useSmart = !this.allowStandardBoxes || allBoxes.length >= 4;

    if (useSmart && activeFocusContainer && activeTitleEl && activeRatioEl && activeBadgeEl) {
      activeFocusContainer.style.display = 'flex';
      let activeLabel = '未選択';
      let activePct = 0;
      let isChk = false;

      if (this.activeTab === 'noChange' && noChangeEval) {
        activeLabel = '🟩 「変更なし」枠';
        activePct = Math.round(noChangeEval.darkRatio * 100);
        isChk = noChangeEval.isChecked;
      } else if (this.activeTab === 'hasChange' && hasChangeEval) {
        activeLabel = '🟧 「変更あり」枠';
        activePct = Math.round(hasChangeEval.darkRatio * 100);
        isChk = hasChangeEval.isChecked;
      } else {
        const found = customEvals.find(c => c.id === this.activeTab);
        if (found) {
          activeLabel = `🟪 ${found.label}`;
          activePct = Math.round(found.eval.darkRatio * 100);
          isChk = found.eval.isChecked;
        }
      }

      activeTitleEl.textContent = activeLabel;
      activeRatioEl.textContent = `黒画素率: ${activePct}%（判定閾値: ${Math.round((this.template.threshold || 0.25) * 100)}%）`;
      activeBadgeEl.innerHTML = isChk
        ? `<span class="badge badge-purple font-bold" style="background:#8b5cf6; color:#fff; font-size: 0.8rem; padding: 4px 8px;">✅ あり</span>`
        : `<span class="badge badge-gray" style="font-size: 0.8rem; padding: 4px 8px;">⬜ なし</span>`;
    } else if (activeFocusContainer) {
      activeFocusContainer.style.display = 'none';
    }

    // サマリーバーの表示
    if (summaryBar && summaryText) {
      if (customEvals.length > 0) {
        summaryBar.style.display = 'flex';
        const checkedCount = customEvals.filter(c => c.eval.isChecked).length;
        summaryText.innerHTML = `全 <strong>${customEvals.length}</strong> 枠（✅ あり: <strong style="color: #6d28d9;">${checkedCount}</strong> 件）`;
      } else {
        summaryBar.style.display = 'none';
      }
    }

    if (customRowsEl) {
      if (customEvals.length === 0) {
        customRowsEl.innerHTML = '';
      } else {
        customRowsEl.innerHTML = customEvals.map(item => {
          const pct = Math.round(item.eval.darkRatio * 100);
          const isChk = item.eval.isChecked;
          const statusBadge = isChk
            ? `<span class="badge badge-purple font-bold" style="background:#8b5cf6; color:#fff;">✅ あり</span>`
            : `<span class="badge badge-gray">⬜ なし</span>`;
          return `
            <div class="eval-row" style="${item.isActive ? 'background: rgba(139, 92, 246, 0.08); border-radius: 4px; padding: 2px 4px;' : ''}">
              <span class="eval-label" style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.label}">
                🟪 ${item.label}:
              </span>
              ${statusBadge}
              <span class="text-mono eval-ratio">黒画素: ${pct}%</span>
            </div>
          `;
        }).join('');
      }
    }
  }
}
