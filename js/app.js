/**
 * アプリケーション エントリーポイント & ルーター
 */

import { DB } from './db.js';
import { APP_VERSION } from './version.js';
import { HomePage } from './pages/home.js';
import { ProjectPage } from './pages/project.js';
import { SettingsPage } from './pages/settings.js';
import { FolderConnector } from './sync/folder-connector.js';
import { SyncManager } from './sync/sync-manager.js';
import { UI } from './utils/ui.js';

class App {
  constructor() {
    this.mainContainer = document.getElementById('app-content');
    this.navLinks = document.querySelectorAll('.nav-link');
  }

  updateSyncIndicator() {
    const indicator = document.getElementById('header-sync-indicator');
    if (!indicator) return;
    if (FolderConnector.isConnected()) {
      indicator.textContent = `🟢 共有中: ${FolderConnector.getFolderName()}`;
      indicator.className = 'badge badge-success';
      indicator.title = `共有フォルダ「${FolderConnector.getFolderName()}」に接続中（クリックで設定へ）`;
      indicator.onclick = (e) => {
        e.preventDefault();
        window.location.hash = '#settings';
      };
    } else if (FolderConnector.isPermissionPending()) {
      indicator.textContent = `🟡 共有再開: ${FolderConnector.getFolderName()}`;
      indicator.className = 'badge badge-warning';
      indicator.title = `共有フォルダ「${FolderConnector.getFolderName()}」へのアクセス許可が一時停止しています。クリックしてアクセスを再開してください。`;
      indicator.onclick = async (e) => {
        e.preventDefault();
        indicator.textContent = '⏳ 再開中...';
        const permitted = await FolderConnector.ensurePermission(true);
        if (permitted) {
          UI.showToast(`共有フォルダ「${FolderConnector.getFolderName()}」へのアクセスを再開しました`, 'success');
          try {
            await SyncManager.readSharedSettings();
          } catch (syncErr) {
            console.warn('再開時共有設定同期スキップ:', syncErr);
          }
          this.updateSyncIndicator();
          await this.handleRoute();
        } else {
          UI.showToast('共有フォルダへのアクセス権限が許可されませんでした。設定画面から再接続してください。', 'warning');
          window.location.hash = '#settings';
        }
      };
    } else {
      indicator.textContent = '⚪ ローカル';
      indicator.className = 'badge badge-gray';
      indicator.title = '共有フォルダ未接続（クリックで設定へ）';
      indicator.onclick = (e) => {
        e.preventDefault();
        window.location.hash = '#settings';
      };
    }
  }

  async init() {
    try {
      const verEl = document.getElementById('header-app-version');
      if (verEl) verEl.textContent = APP_VERSION;

      await DB.init();
      this.updateSyncIndicator();

      // バックグラウンド一括アップロードの進捗をヘッダーに連動表示
      SyncManager.addProgressListener((p) => {
        const indicator = document.getElementById('header-sync-indicator');
        if (!indicator) return;
        if (p.type === 'start' || p.type === 'progress') {
          indicator.textContent = `📤 送信中: ${p.flushed || 0}/${p.total}`;
          indicator.className = 'badge badge-purple';
          indicator.title = `共有フォルダへスキャンデータをバックグラウンド送信中 (${p.flushed || 0} / ${p.total} 件)`;
        } else if (p.type === 'complete' || p.type === 'error') {
          this.updateSyncIndicator();
        }
      });

      window.addEventListener('hashchange', () => this.handleRoute());
      this.handleRoute();
    } catch (err) {
      console.error('App initialization error:', err);
      if (this.mainContainer) {
        this.mainContainer.innerHTML = `
          <div class="card" style="margin-top: 40px; text-align: center; color: var(--danger-solid);">
            <h2>初期化エラー</h2>
            <p>${err.message}</p>
          </div>
        `;
      }
    }
  }

  async handleRoute() {
    this.updateSyncIndicator();
    const hash = window.location.hash || '#home';
    const parts = hash.replace(/^#/, '').split('/');
    const route = parts[0] || 'home';

    // ナビゲーションのactive更新
    this.navLinks.forEach(link => {
      const linkHash = link.getAttribute('href')?.replace(/^#/, '');
      if (linkHash === route) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    if (route === 'home' || route === '') {
      await HomePage.render(this.mainContainer);
    } else if (route === 'project') {
      const projectId = parts[1];
      const tab = parts[2] || 'list';
      if (!projectId) {
        window.location.hash = '#home';
        return;
      }
      await ProjectPage.render(this.mainContainer, projectId, tab);
    } else if (route === 'settings') {
      await SettingsPage.render(this.mainContainer);
    } else {
      window.location.hash = '#home';
    }
  }
}

// アプリケーション起動
const bootstrap = () => {
  const app = new App();
  app.init();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
