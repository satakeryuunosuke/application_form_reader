/**
 * アプリケーション エントリーポイント & ルーター
 */

import { DB } from './db.js';
import { HomePage } from './pages/home.js';
import { ProjectPage } from './pages/project.js';
import { SettingsPage } from './pages/settings.js';

class App {
  constructor() {
    this.mainContainer = document.getElementById('app-content');
    this.navLinks = document.querySelectorAll('.nav-link');
  }

  async init() {
    try {
      await DB.init();
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
