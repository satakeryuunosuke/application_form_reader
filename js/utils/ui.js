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
      modal.className = 'modal-overlay';
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

