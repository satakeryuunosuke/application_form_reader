/**
 * UI ヘルパー（トースト、モーダル、ローディング）
 */

export const UI = {
  /**
   * トースト通知を表示
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {number} duration
   */
  showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconMap = {
      success: '✅',
      error: '⚠️',
      info: 'ℹ️',
      warning: '🔔'
    };

    toast.innerHTML = `<span>${iconMap[type] || 'ℹ️'}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease-out';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  },

  /* ================= ローディング & 連打防止オーバーレイ ================= */
  _loadingDepth: 0,
  _loadingTimerId: null,
  _loadingStartTime: 0,
  _loadingRafId: null,

  /**
   * 全画面ローディングオーバーレイを表示（画面操作を完全遮断して連打を防止）
   * @param {Object} options
   * @param {string} [options.title='ファイルサーバーと通信中...']
   * @param {string} [options.message='差分データを取得・反映しています。画面を閉じずにお待ちください。']
   * @param {string} [options.icon='🔄']
   * @param {number} [options.timeoutSec=10] キャンセルボタンを表示するまでの秒数
   * @param {Function} [options.onCancel=null] キャンセル時コールバック
   */
  showLoading(options = {}) {
    const {
      title = 'ファイルサーバーと通信中...',
      message = '差分データを取得・反映しています。画面を閉じずにお待ちください。',
      icon = '🔄',
      timeoutSec = 10,
      onCancel = null
    } = typeof options === 'string' ? { message: options } : options;

    this._loadingDepth++;

    let overlay = document.getElementById('app-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'app-loading-overlay';
      overlay.className = 'app-loading-overlay';
      overlay.innerHTML = `
        <div class="loading-card">
          <div class="loading-spinner-wrapper">
            <div class="loading-spinner-ring"></div>
            <div class="loading-spinner-inner"></div>
            <div class="loading-spinner-icon" id="app-loading-icon">${icon}</div>
          </div>
          <div class="loading-title" id="app-loading-title">${title}</div>
          <div class="loading-msg" id="app-loading-msg">${message}</div>
          <div class="loading-timer" id="app-loading-timer">通信中... (0秒)</div>
          <div class="loading-cancel-area" id="app-loading-cancel-area">
            <button class="btn btn-secondary btn-sm" id="btn-app-loading-cancel" style="color: var(--danger-solid); border-color: var(--danger-border, #fca5a5);">
              ⚠️ 通信を中断して閉じる
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // キャンセルボタン
      const cancelBtn = overlay.querySelector('#btn-app-loading-cancel');
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          if (typeof onCancel === 'function') {
            try { onCancel(); } catch (e) { console.warn(e); }
          }
          this.hideLoading(true);
          this.showToast('通信待機を強制解除しました', 'warning');
        };
      }
    } else {
      // 既存更新
      const iconEl = overlay.querySelector('#app-loading-icon');
      const titleEl = overlay.querySelector('#app-loading-title');
      const msgEl = overlay.querySelector('#app-loading-msg');
      if (iconEl) iconEl.textContent = icon;
      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
    }

    // タイマー開始
    this._loadingStartTime = Date.now();
    const timerEl = overlay.querySelector('#app-loading-timer');
    if (timerEl) {
      timerEl.textContent = '通信中... (0秒)';
    }
    const cancelArea = overlay.querySelector('#app-loading-cancel-area');
    if (cancelArea) cancelArea.classList.remove('is-visible');

    if (this._loadingTimerId) {
      clearInterval(this._loadingTimerId);
      this._loadingTimerId = null;
    }
    this._loadingTimerId = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this._loadingStartTime) / 1000);
      if (timerEl) {
        timerEl.textContent = `通信中... (${elapsedSec}秒)`;
      }
      if (elapsedSec >= timeoutSec && cancelArea) {
        cancelArea.classList.add('is-visible');
      }
    }, 1000);

    // 未消化の遅延アニメーションフレームがあればキャンセル
    if (this._loadingRafId) {
      cancelAnimationFrame(this._loadingRafId);
      this._loadingRafId = null;
    }

    // 強制リフローを起こして同期的に is-active を付与
    // （requestAnimationFrame の遅延による hideLoading との順序逆転を完全に防止）
    void overlay.offsetWidth;
    overlay.classList.add('is-active');
  },

  /**
   * 全画面ローディングオーバーレイを解除
   * @param {boolean} [force=false] 多重階層を無視して強制解除するかどうか
   */
  hideLoading(force = false) {
    if (force) {
      this._loadingDepth = 0;
    } else {
      this._loadingDepth = Math.max(0, this._loadingDepth - 1);
    }

    // 予約されている requestAnimationFrame があれば確実にキャンセル
    if (this._loadingRafId) {
      cancelAnimationFrame(this._loadingRafId);
      this._loadingRafId = null;
    }

    if (this._loadingDepth === 0) {
      if (this._loadingTimerId) {
        clearInterval(this._loadingTimerId);
        this._loadingTimerId = null;
      }
      const overlay = document.getElementById('app-loading-overlay');
      if (overlay) {
        overlay.classList.remove('is-active');
      }
    }
  },

  /**
   * 非同期処理をローディングオーバーレイ & 連打防止付きで実行
   * @param {Function} asyncFn
   * @param {Object|string} [options]
   */
  async withLoading(asyncFn, options = {}) {
    this.showLoading(options);
    try {
      return await asyncFn();
    } finally {
      this.hideLoading();
    }
  },

  /**
   * 個別ボタンのローディング状態・スピナーアニメーション・連打防止制御
   * @param {HTMLElement} btn
   * @param {boolean} isLoading
   * @param {string} [loadingText='処理中...']
   */
  setButtonLoading(btn, isLoading, loadingText = '処理中...') {
    if (!btn) return;

    if (isLoading) {
      btn.disabled = true;
      btn.classList.add('is-loading');
      if (!btn.dataset.origHtml) {
        btn.dataset.origHtml = btn.innerHTML;
      }
      btn.innerHTML = `<span class="btn-spinner"></span> <span>${loadingText}</span>`;
    } else {
      btn.classList.remove('is-loading');
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
      btn.disabled = false;
    }
  },

  /**
   * 確認モーダルダイアログ
   * @param {string} title
   * @param {string} message
   * @param {string} confirmText
   * @param {'danger'|'primary'} confirmType
   * @returns {Promise<boolean>}
   */
  confirm(title, message, confirmText = '実行する', confirmType = 'primary') {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay modal-confirm-overlay';
      modal.style.zIndex = '3000';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header">
            <h3 class="modal-title font-bold" style="font-size: 1.1rem;">${title}</h3>
          </div>
          <div class="modal-body">
            <p style="color: var(--gray-700); line-height: 1.6;">${message}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-cancel">キャンセル</button>
            <button class="btn btn-${confirmType} btn-confirm">${confirmText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const cleanup = (result) => {
        modal.remove();
        resolve(result);
      };

      modal.querySelector('.btn-cancel').onclick = () => cleanup(false);
      modal.querySelector('.btn-confirm').onclick = () => cleanup(true);
      modal.onclick = (e) => {
        if (e.target === modal) cleanup(false);
      };
    });
  },

  /**
   * 日時をフォーマット（例: 2026/08/29 13:30）
   */
  formatDate(isoString) {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${y}/${m}/${day} ${h}:${min}`;
    } catch {
      return isoString;
    }
  },

  /**
   * 講習名・受講期を表示用に整形（例: "夏期" -> "夏期講習", "前期" -> "前期", "前期講習" -> "前期"）
   * @param {string} sessionName
   * @returns {string}
   */
  formatSession(sessionName) {
    if (!sessionName) return '';
    const clean = String(sessionName).trim();
    if (clean === '前期' || clean === '前期講習' || clean.startsWith('前期')) return '前期';
    if (clean === '後期' || clean === '後期講習' || clean.startsWith('後期')) return '後期';
    if (clean.includes('講習')) return clean;
    return `${clean}講習`;
  },

  /**
   * プロジェクトタイトルの表示整形（「前期講習」->「前期」、「後期講習」->「後期」）
   * @param {string} title
   * @returns {string}
   */
  formatProjectTitle(title) {
    if (!title) return '';
    return String(title)
      .replace(/前期講習/g, '前期')
      .replace(/後期講習/g, '後期');
  },

  /**
   * スキャン確認票などの高精細拡大ライトボックスモーダル
   * ホイールズーム・ドラッグパン・リセット対応
   * @param {string} imgSrc 画像のデータURLまたはパス
   * @param {string} title モーダルタイトル
   */
  showImageLightbox(imgSrc, title = 'スキャン画像原本プレビュー') {
    if (!imgSrc) return;

    // 既存のライトボックスがあれば削除
    const existing = document.querySelector('.image-lightbox-overlay');
    if (existing) existing.remove();

    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox-overlay';

    let zoom = 1.0;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const safeTitle = title || 'スキャン確認票';
    const downloadName = (safeTitle).replace(/[\\\/:*?"<>|\s]+/g, '_') + '.png';

    lightbox.innerHTML = `
      <div class="image-lightbox-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.25rem;">📑</span>
          <span class="font-bold" style="font-size: 1.05rem; letter-spacing: 0.02em;">${safeTitle}</span>
        </div>
        <div class="image-lightbox-controls">
          <div style="display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: var(--radius-sm); margin-right: 8px;">
            <button id="lb-zoom-out" class="btn btn-ghost btn-sm" style="color: #fff; padding: 2px 6px;" title="縮小 (Alt + ホイール下)">🔍-</button>
            <span id="lb-zoom-val" style="font-size: 0.8rem; font-family: var(--font-mono); min-width: 48px; text-align: center;">100%</span>
            <button id="lb-zoom-in" class="btn btn-ghost btn-sm" style="color: #fff; padding: 2px 6px;" title="拡大 (Alt + ホイール上)">🔍+</button>
            <button id="lb-zoom-fit" class="btn btn-ghost btn-sm" style="color: #fff; padding: 2px 6px;" title="画面に合わせる">全体</button>
            <button id="lb-zoom-reset" class="btn btn-ghost btn-sm" style="color: #fff; padding: 2px 6px;" title="原寸大 (100%)">100%</button>
          </div>
          <a href="${imgSrc}" download="${downloadName}" class="btn btn-ghost btn-sm" style="color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 4px 10px;" title="画像をローカルに保存">
            💾 画像保存
          </a>
          <button class="btn btn-ghost btn-sm btn-close-lightbox" style="color: #fff; font-size: 1.3rem; line-height: 1; padding: 2px 8px;" title="閉じる (Esc)">✕</button>
        </div>
      </div>
      <div class="image-lightbox-body" id="lb-body">
        <img src="${imgSrc}" class="image-lightbox-img" id="lb-img" alt="確認票拡大原本" draggable="false">
        <div class="lightbox-hint">💡 マウスホイールで拡大縮小 / ドラッグで移動 / Escで閉じる</div>
      </div>
    `;

    document.body.appendChild(lightbox);

    const bodyEl = lightbox.querySelector('#lb-body');
    const imgEl = lightbox.querySelector('#lb-img');
    const zoomValEl = lightbox.querySelector('#lb-zoom-val');

    const updateTransform = () => {
      imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      zoomValEl.textContent = `${Math.round(zoom * 100)}%`;
    };

    const applyZoom = (newZoom, centerX = null, centerY = null) => {
      const clamped = Math.max(0.3, Math.min(5.0, newZoom));
      if (centerX !== null && centerY !== null) {
        // マウス位置を中心としたズーム
        const rect = bodyEl.getBoundingClientRect();
        const offsetX = centerX - (rect.left + rect.width / 2);
        const offsetY = centerY - (rect.top + rect.height / 2);
        panX -= (offsetX - panX) * (clamped / zoom - 1);
        panY -= (offsetY - panY) * (clamped / zoom - 1);
      }
      zoom = clamped;
      updateTransform();
    };

    lightbox.querySelector('#lb-zoom-in').onclick = (e) => {
      e.stopPropagation();
      applyZoom(zoom + 0.25);
    };
    lightbox.querySelector('#lb-zoom-out').onclick = (e) => {
      e.stopPropagation();
      applyZoom(zoom - 0.25);
    };
    lightbox.querySelector('#lb-zoom-fit').onclick = (e) => {
      e.stopPropagation();
      zoom = 1.0;
      panX = 0;
      panY = 0;
      updateTransform();
    };
    lightbox.querySelector('#lb-zoom-reset').onclick = (e) => {
      e.stopPropagation();
      zoom = 1.5;
      panX = 0;
      panY = 0;
      updateTransform();
    };

    // マウスホイール操作
    bodyEl.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      applyZoom(zoom + delta, e.clientX, e.clientY);
    };

    // ドラッグによるパン操作
    bodyEl.onmousedown = (e) => {
      if (e.button !== 0) return; // 左クリックのみ
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      bodyEl.classList.add('is-dragging');
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform();
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        bodyEl.classList.remove('is-dragging');
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    const closeLightbox = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', escHandler);
      lightbox.remove();
    };

    lightbox.querySelector('.btn-close-lightbox').onclick = closeLightbox;
    lightbox.onclick = (e) => {
      if (e.target === lightbox) closeLightbox();
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
      }
    };
    document.addEventListener('keydown', escHandler);
  }
};

