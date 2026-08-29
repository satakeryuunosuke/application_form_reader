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
  }
};
