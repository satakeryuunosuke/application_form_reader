/**
 * アプリケーション エントリーポイント & ルーター
 */

import { DB } from './db.js';
import { HomePage } from './pages/home.js';
import { ProjectPage } from './pages/project.js';
import { SettingsPage } from './pages/settings.js';
import { FolderConnector } from './sync/folder-connector.js';

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
    } else {
      indicator.textContent = '⚪ ローカル';
      indicator.className = 'badge badge-gray';
      indicator.title = '共有フォルダ未接続（クリックで設定へ）';
    }
    indicator.onclick = (e) => {
      e.preventDefault();
      window.location.hash = '#settings';
    };
  }

  async init() {
    try {
      await DB.init();
      this.updateSyncIndicator();
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
      const tab = parts[2] || 'scan';
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

// DOM読み込み完了時に起動
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
