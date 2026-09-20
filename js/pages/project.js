/**
 * プロジェクト画面コントローラー（ヘッダー・タブ管理）
 */

import { DB, db } from '../db.js';
import { UI } from '../utils/ui.js';
import { CsvUtil } from '../utils/csv.js';
import { Validator } from '../utils/validator.js';
import { CheckboxEngine } from '../checkbox.js';
import { ScanPage } from './scan.js';
import { ListPage } from './list.js';
import { ManualPage } from './manual.js';
import { ReviewPage } from './review.js';
import { TemplateCalibrator } from '../components/calibrator.js';
import { FolderConnector } from '../sync/folder-connector.js';
import { SyncManager } from '../sync/sync-manager.js';

export const ProjectPage = {
  container: null,
  currentProject: null,
  currentTab: 'list',

  async render(container, projectId, tab = 'list') {
    // 同一プロジェクト内のタブ切り替え時はヘッダーを再描画せずタブの中身のみ差し替え（高速化・ちらつき防止）
    const isSameProject = this.currentProject && this.currentProject.id === projectId && this.container === container && this.container.querySelector('#project-tab-content');
    if (isSameProject) {
      this.currentTab = tab || 'list';
      const dashBtn = this.container.querySelector('#btn-go-dashboard');
      if (dashBtn) {
        dashBtn.className = this.currentTab === 'dashboard' ? 'btn btn-primary btn-md' : 'btn btn-secondary btn-md';
      }
      await this.renderActiveTab();
      // 同一プロジェクト内のタブ遷移でもバックグラウンド同期をスロットル付きで実行
      this._startBackgroundSync(projectId);
      return;
    }

    this.container = container;
    this.currentTab = tab || 'list';

    // ローカルIndexedDBから即座にプロジェクト情報を取得して描画
    const project = await DB.getProject(projectId);
    if (!project) {
      UI.showToast('プロジェクトが見つかりません', 'error');
      window.location.hash = '#home';
      return;
    }
    this.currentProject = project;

    const stats = await DB.getProjectStats(projectId);
    const isCompleted = project.status === '完了';
    const isFolderConnected = FolderConnector.isConnected();
    const lastSync = SyncManager.getLastSyncTime(projectId);
    const lastSyncTimeStr = lastSync ? lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const isSelectionMode = project.projectType === 'selection';

    this.container.innerHTML = `
      <div class="view-container">
        <!-- プロジェクト表層ヘッダー（シンプル化） -->
        <div class="project-header-bar">
          <div class="project-header-title">
            <button id="btn-back-home" class="back-btn" title="プロジェクト一覧（ホーム）に戻る">←</button>
            <div>
              <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 4px;">
                <span class="badge badge-info">${project.year}年度</span>
                <span class="badge badge-purple">${project.grade}年生</span>
                <span class="badge badge-success">${UI.formatSession(project.sessionName)}</span>
                ${isSelectionMode ? '<span class="badge" style="background: #ede7f6; color: #512da8; border: 1px solid #d1c4e9; font-weight: 700;">🎯 講座選択モード</span>' : ''}
                <span id="header-status-badge" class="badge ${isCompleted ? 'badge-gray' : 'badge-success'}" style="${isCompleted ? 'font-weight: 700;' : 'font-weight: 700; background: #e8f5e9; color: #2e7d32;'}">
                  ${isCompleted ? '🏁 完了' : '🟢 進行中'}
                </span>
                <span class="badge ${isFolderConnected ? 'badge-success' : (FolderConnector.isPermissionPending() ? 'badge-warning' : 'badge-gray')}" style="font-size: 0.75rem;">
                  ${isFolderConnected ? '🟢 共有同期中' : (FolderConnector.isPermissionPending() ? '🟡 共有再開待ち' : '⚪ ローカル')}
                </span>
                <h1 style="font-size: 1.4rem; font-weight: 800; color: var(--gray-900); display: inline; margin-left: 4px;">${UI.formatProjectTitle(project.title)}</h1>
              </div>
              <div style="font-size: 0.82rem; color: var(--gray-500);">
                登録生徒数: <span id="header-stat-total" class="font-bold text-mono">${stats.total}</span> 名 | 
                提出済: <span id="header-stat-submitted" class="font-bold text-mono" style="color: var(--primary-600);">${stats.submitted}</span> 名 | 
                未提出: <span id="header-stat-unsubmitted" class="font-bold text-mono" style="color: var(--danger-solid);">${stats.unsubmitted}</span> 名
                ${isSelectionMode ? ` | 申込講座計: <span id="header-stat-courses" class="font-bold text-mono" style="color: #673ab7;">${stats.totalSelectedCourses || 0}</span> 講座` : ''}
                ${project.completedAt ? ` | 完了日時: <span class="text-mono font-bold">${UI.formatDate(project.completedAt)}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- ヘッダー右側: 主要ボタン群 -->
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button id="btn-header-sync" class="btn btn-secondary btn-md" style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;" title="${isFolderConnected ? '共有フォルダから最新の受講変更・提出データや生徒名簿を取り込んで更新' : '共有フォルダに接続して最新データに更新'}">
              <span id="header-sync-pulse" class="sync-pulse-dot" style="display: ${isFolderConnected ? 'inline-block' : 'none'};"></span>
              <span class="sync-btn-icon">🔄</span>
              <span class="sync-btn-text">更新${lastSyncTimeStr ? ` <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(${lastSyncTimeStr})</span>` : ''}</span>
            </button>
            <button id="btn-go-manual" class="btn btn-primary btn-md" style="font-weight: 700; box-shadow: var(--shadow-sm);" title="電話や口頭での受講変更、手動でのデータ登録・追加画面を開く">
              ✏️ 手動登録・変更
            </button>
            <button id="btn-go-dashboard" class="btn ${this.currentTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'} btn-md" style="font-weight: 600;" title="スキャン読取・照合・生徒管理・書式調整などの詳細機能をまとめたダッシュボードを開く">
              🛠️ 管理ダッシュボード
            </button>
          </div>
        </div>

        ${isCompleted ? `
          <div class="card" style="border-left: 4px solid var(--gray-400); background: var(--gray-100); padding: 10px 16px; margin-bottom: var(--spacing-md); display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 0.88rem; color: var(--gray-700); display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.15rem;">🔒</span>
              <span><strong>このプロジェクトは「完了」に設定されています（データ変更ロック中）。</strong> 登録情報の閲覧は可能です。編集やスキャンを行う場合は「<strong>🛠️ 管理ダッシュボード</strong>」から「進行中に戻す」を行ってください。</span>
            </div>
          </div>
        ` : ''}

        <!-- メインコンテンツ表示エリア -->
        <div id="project-tab-content"></div>
      </div>
    `;

    this.bindEvents(projectId);
    await this.renderActiveTab();

    // 共有フォルダ接続中なら最新状態を非同期バックグラウンド同期（画面遷移のブロッキングを完全解消）
    if (FolderConnector.isConnected()) {
      this._startBackgroundSync(projectId);
    }
  },

  /**
   * 画面遷移をブロックしない非同期バックグラウンド同期処理
   */
  async _startBackgroundSync(projectId) {
    if (!FolderConnector.isConnected()) return;
    if (this._isSyncing || SyncManager.isSyncing(projectId)) return;

    const syncBtn = this.container ? this.container.querySelector('#btn-header-sync') : null;
    const dot = this.container ? this.container.querySelector('#header-sync-pulse') : null;
    const icon = syncBtn ? syncBtn.querySelector('.sync-btn-icon') : null;

    if (dot) {
      dot.classList.add('pulse');
      dot.style.display = 'inline-block';
    }
    if (icon) icon.classList.add('spin-icon');

    try {
      const res = await SyncManager.syncFromSharedFolder(projectId);
      if (res && !res.skippedThrottle) {
        await this.updateHeaderStats();
        if (this.currentTab === 'list' && typeof ListPage.notifyBackgroundSyncComplete === 'function') {
          ListPage.notifyBackgroundSyncComplete(res);
        }
      }
    } catch (syncErr) {
      console.warn('バックグラウンド共有同期スキップ/失敗:', syncErr);
    } finally {
      if (dot) dot.classList.remove('pulse');
      if (icon) icon.classList.remove('spin-icon');
      this.updateHeaderStats();
    }
  },

  /**
   * ヘッダーの統計数値および更新ボタン表示を最新データで更新
   */
  async updateHeaderStats() {
    if (!this.currentProject || !this.container) return;
    try {
      const stats = await DB.getProjectStats(this.currentProject.id);
      const totalEl = this.container.querySelector('#header-stat-total');
      const submittedEl = this.container.querySelector('#header-stat-submitted');
      const unsubmittedEl = this.container.querySelector('#header-stat-unsubmitted');
      const coursesEl = this.container.querySelector('#header-stat-courses');

      if (totalEl) totalEl.textContent = stats.total;
      if (submittedEl) submittedEl.textContent = stats.submitted;
      if (unsubmittedEl) unsubmittedEl.textContent = stats.unsubmitted;
      if (coursesEl) coursesEl.textContent = stats.totalSelectedCourses || 0;

      // 更新ボタンの最終更新時刻も最新化
      const syncBtn = this.container.querySelector('#btn-header-sync');
      if (syncBtn && !syncBtn.disabled) {
        const lastSync = SyncManager.getLastSyncTime(this.currentProject.id);
        const lastSyncTimeStr = lastSync ? lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const textEl = syncBtn.querySelector('.sync-btn-text');
        if (textEl) {
          textEl.innerHTML = `更新${lastSyncTimeStr ? ` <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(${lastSyncTimeStr})</span>` : ''}`;
        } else {
          syncBtn.innerHTML = `🔄 更新${lastSyncTimeStr ? ` <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(${lastSyncTimeStr})</span>` : ''}`;
        }
      }
    } catch (e) {
      console.error('Failed to update header stats:', e);
    }
  },

  _isSyncing: false,

  /**
   * 共有フォルダとの手動同期・データ更新を実行（キャッシュを無効化して最新データを強制取得）
   */
  async handleSync(projectId) {
    if (this._isSyncing) {
      console.warn('同期処理が既に実行中です');
      return;
    }

    const syncBtn = this.container ? this.container.querySelector('#btn-header-sync') : null;
    const dashSyncBtn = this.container ? this.container.querySelector('#btn-dash-sync') : null;

    // クリック直後に即座にボタンを無効化して多重実行を完全遮断
    if (syncBtn) UI.setButtonLoading(syncBtn, true, '更新中...');
    if (dashSyncBtn) UI.setButtonLoading(dashSyncBtn, true, '更新中...');
    this._isSyncing = true;

    try {
      if (!FolderConnector.isSupported()) {
        UI.showToast('お使いのブラウザは共有フォルダ機能に対応していません。Google Chrome または Microsoft Edge をご利用ください。', 'warning');
        return;
      }

      if (!FolderConnector.isConnected()) {
        if (FolderConnector.hasSavedFolder()) {
          const reauth = await UI.confirm(
            '共有フォルダのアクセス再開',
            `共有フォルダ「${FolderConnector.getFolderName()}」へのアクセス権限が一時停止しています。\nアクセスを再開して最新データを取り込みますか？`,
            'アクセスを許可して更新',
            'primary'
          );
          if (!reauth) return;

          const permitted = await FolderConnector.ensurePermission(true);
          if (!permitted) {
            UI.showToast('共有フォルダへの読み書き権限が許可されませんでした。', 'warning');
            return;
          }
        } else {
          const connectNow = await UI.confirm(
            '共有フォルダの接続',
            '現在共有フォルダに未接続です。最新データを取り込むために共有フォルダ（社内LANまたはローカルフォルダ）を選択して接続しますか？',
            'フォルダを選択して接続',
            'primary'
          );
          if (!connectNow) return;

          try {
            await FolderConnector.connect();
            UI.showToast(`共有フォルダ「${FolderConnector.getFolderName()}」に接続しました`, 'success');
            await SyncManager.readSharedSettings({ force: true });
          } catch (connErr) {
            if (connErr.name !== 'AbortError') {
              UI.showToast(`接続エラー: ${connErr.message}`, 'warning');
            }
            return;
          }
        }
      } else {
        // 接続済みでも権限を再確認
        const hasPerm = await FolderConnector.ensurePermission(true);
        if (!hasPerm) {
          UI.showToast('共有フォルダへのアクセス権限が確認できませんでした。設定画面から再接続してください。', 'warning');
          return;
        }
      }

      UI.showLoading({
        title: '最新データと同期中...',
        message: 'ファイルサーバー（共有フォルダ）の最新データを取得・反映しています。画面を閉じずにお待ちください。',
        icon: '🔄'
      });

      try {
        await SyncManager.flushPendingQueueInBackground();
        // 手動更新時はキャッシュを破棄して強制同期
        SyncManager.invalidateSyncCache(projectId);
        const res = await SyncManager.syncFromSharedFolder(projectId, { force: true });
        const parts = [];
        if (res.studentsAdded > 0) parts.push(`生徒追加: ${res.studentsAdded}名`);
        if (res.studentsUpdated > 0) parts.push(`生徒更新: ${res.studentsUpdated}名`);
        if (res.newEventsCount > 0) parts.push(`新規イベント: ${res.newEventsCount}件`);
        const detail = parts.length > 0 ? `（${parts.join(', ')}）` : '（最新の状態です）';
        UI.showToast(`最新データに更新しました${detail}`, 'success');

        // 画面全体を再描画して最新データを反映
        await this.render(this.container, projectId, this.currentTab);
      } finally {
        UI.hideLoading();
      }
    } catch (err) {
      console.error('更新エラー:', err);
      let userMsg = err.message;
      if (err.name === 'NotAllowedError' || (err.message && (err.message.includes('not allowed') || err.message.includes('Permission')))) {
        userMsg = '共有フォルダへのアクセス権限が拒否されたか、無効になっています。画面上部の共有インジケーターから再認可を行ってください。';
      }
      UI.showToast(`更新エラー: ${userMsg}`, 'error');
    } finally {
      this._isSyncing = false;
      const lastSync = SyncManager.getLastSyncTime(projectId);
      const lastSyncTimeStr = lastSync ? lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      if (syncBtn) {
        UI.setButtonLoading(syncBtn, false);
        const textEl = syncBtn.querySelector('.sync-btn-text');
        if (textEl) {
          textEl.innerHTML = `更新${lastSyncTimeStr ? ` <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(${lastSyncTimeStr})</span>` : ''}`;
        } else {
          syncBtn.innerHTML = `🔄 更新${lastSyncTimeStr ? ` <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(${lastSyncTimeStr})</span>` : ''}`;
        }
      }
      if (dashSyncBtn) {
        UI.setButtonLoading(dashSyncBtn, false);
        dashSyncBtn.innerHTML = '🔄 最新データに更新';
      }
    }
  },

  /**
   * 共有フォルダへプロジェクト情報（meta.json）と生徒名簿（students.json）を強制再書き出し
   * （他PCで取り込めない場合や、空ファイル破損時の復旧・修復用）
   */
  async handleForceExport(projectId) {
    if (!FolderConnector.isSupported()) {
      UI.showToast('お使いのブラウザは共有フォルダ機能に対応していません。Google Chrome または Microsoft Edge をご利用ください。', 'warning');
      return;
    }

    if (!FolderConnector.isConnected()) {
      if (FolderConnector.hasSavedFolder()) {
        const reauth = await UI.confirm(
          '共有フォルダのアクセス再開',
          `共有フォルダ「${FolderConnector.getFolderName()}」へのアクセス権限が一時停止しています。\nアクセスを再開して再書き出しを実行しますか？`,
          'アクセスを許可して実行',
          'primary'
        );
        if (!reauth) return;

        const permitted = await FolderConnector.ensurePermission(true);
        if (!permitted) {
          UI.showToast('共有フォルダへの書き込み権限が許可されませんでした。設定画面でフォルダを再選択してください。', 'warning');
          return;
        }
      } else {
        const connectNow = await UI.confirm(
          '共有フォルダの接続',
          '現在共有フォルダに未接続です。再書き出しを行うために共有フォルダを選択して接続しますか？',
          'フォルダを選択して接続',
          'primary'
        );
        if (!connectNow) return;

        try {
          await FolderConnector.connect();
          UI.showToast(`共有フォルダ「${FolderConnector.getFolderName()}」に接続しました`, 'success');
        } catch (connErr) {
          if (connErr.name !== 'AbortError') {
            UI.showToast(`接続エラー: ${connErr.message}`, 'warning');
          }
          return;
        }
      }
    }

    const confirmed = await UI.confirm(
      '共有フォルダへ再書き出し（修復・同期）',
      'このPCに保存されているプロジェクト情報（meta.json）および全生徒名簿（students.json）を共有フォルダへ再書き出しします。\n\n他のPCがプロジェクトを取り込めない場合や、共有フォルダのデータ破損時の修復に使用できます。実行しますか？',
      '再書き出しを実行',
      'primary'
    );
    if (!confirmed) return;

    // モーダル確定直後（ユーザーアクティベーション有効時）で確実に書き込み権限を検証・昇格
    const hasPerm = await FolderConnector.ensurePermission(true);
    if (!hasPerm) {
      UI.showToast('共有フォルダへの書き込み権限が許可されませんでした。再書き出しを中止します。', 'warning');
      return;
    }

    const exportBtn = this.container.querySelector('#btn-dash-force-export');
    if (exportBtn) UI.setButtonLoading(exportBtn, true, '書き出し中...');

    UI.showLoading({
      title: '共有フォルダへ書き出し中...',
      message: 'プロジェクト情報および生徒名簿をアトミック書き込み・検証しています。画面を閉じずにお待ちください。',
      icon: '📤'
    });

    try {
      const project = await DB.getProject(projectId);
      if (!project) throw new Error('プロジェクトが見つかりません');

      const students = await db.students.where('projectId').equals(projectId).toArray();
      if (!students || students.length === 0) {
        throw new Error('ローカルに生徒データが存在しません');
      }

      await SyncManager.writeProjectMeta(project);
      await SyncManager.writeStudentList(projectId, students);

      UI.showToast(`共有フォルダへ再書き出し完了（生徒 ${students.length} 名・検証済）`, 'success', 4000);
      await this.render(this.container, projectId, this.currentTab);
    } catch (err) {
      console.error('再書き出しエラー:', err);
      let userMsg = err.message;
      if (err.name === 'NotAllowedError' || (err.message && (err.message.includes('not allowed') || err.message.includes('Permission')))) {
        userMsg = '共有フォルダへのアクセス権限が拒否されたか、無効になっています。画面上部の共有インジケーターから再認可を行うか、設定画面でフォルダを再接続してください。';
      }
      UI.showToast(`再書き出しエラー: ${userMsg}`, 'error', 6000);
      if (exportBtn) {
        UI.setButtonLoading(exportBtn, false);
        exportBtn.innerHTML = '📤 共有フォルダへ再書き出し';
      }
    } finally {
      UI.hideLoading();
    }
  },

  bindEvents(projectId) {
    const backBtn = this.container.querySelector('#btn-back-home');
    if (backBtn) {
      backBtn.onclick = () => { window.location.hash = '#home'; };
    }

    const syncBtn = this.container.querySelector('#btn-header-sync');
    if (syncBtn) {
      syncBtn.onclick = () => {
        this.handleSync(projectId);
      };
    }

    const manualBtn = this.container.querySelector('#btn-go-manual');
    if (manualBtn) {
      manualBtn.onclick = () => {
        window.location.hash = `#project/${projectId}/manual`;
      };
    }

    const dashboardBtn = this.container.querySelector('#btn-go-dashboard');
    if (dashboardBtn) {
      dashboardBtn.onclick = () => {
        if (this.currentTab === 'dashboard') {
          window.location.hash = `#project/${projectId}/list`;
        } else {
          window.location.hash = `#project/${projectId}/dashboard`;
        }
      };
    }
  },

  async renderActiveTab() {
    const content = this.container.querySelector('#project-tab-content');
    if (!content) return;

    // スキャン画面離脱時の安全クリーンアップ（未完了バッチの自動バックグラウンドフラッシュ）
    if (typeof ScanPage.cleanup === 'function') {
      ScanPage.cleanup();
    }

    this.updateHeaderStats();
    content.innerHTML = '';

    if (this.currentTab === 'list') {
      // 表層デフォルト: 提出状況一覧を直接表示
      await ListPage.render(content, this.currentProject);
    } else if (this.currentTab === 'manual') {
      // 手動登録・変更画面
      await ManualPage.render(content, this.currentProject);
    } else if (this.currentTab === 'dashboard') {
      // 管理ダッシュボード
      await this.renderDashboard(content, this.currentProject);
    } else if (this.currentTab === 'scan') {
      // スキャン画面（上部に戻るナビゲーションバーを付加）
      content.innerHTML = `
        <div class="subpage-nav-bar">
          <div class="subpage-nav-left">
            <button id="btn-scan-back-dash" class="btn btn-secondary btn-sm" style="font-weight: 700;">
              ← 管理ダッシュボードに戻る
            </button>
            <button id="btn-scan-back-list" class="btn btn-ghost btn-sm" style="color: var(--gray-600);">
              提出状況一覧へ
            </button>
          </div>
          <div style="font-size: 0.85rem; color: var(--gray-600);">
            📷 受講確認票 読み取り・承認（スキャン処理）
          </div>
        </div>
        <div id="scan-page-inner"></div>
      `;
      content.querySelector('#btn-scan-back-dash').onclick = () => {
        window.location.hash = `#project/${this.currentProject.id}/dashboard`;
      };
      content.querySelector('#btn-scan-back-list').onclick = () => {
        window.location.hash = `#project/${this.currentProject.id}/list`;
      };
      await ScanPage.render(content.querySelector('#scan-page-inner'), this.currentProject);
    } else if (this.currentTab === 'review') {
      // スキャン照合画面（上部に戻るナビゲーションバーを付加）
      content.innerHTML = `
        <div class="subpage-nav-bar">
          <div class="subpage-nav-left">
            <button id="btn-rev-back-dash" class="btn btn-secondary btn-sm" style="font-weight: 700;">
              ← 管理ダッシュボードに戻る
            </button>
            <button id="btn-rev-back-list" class="btn btn-ghost btn-sm" style="color: var(--gray-600);">
              提出状況一覧へ
            </button>
          </div>
          <div style="font-size: 0.85rem; color: var(--gray-600);">
            🔍 スキャン照合・原本確認
          </div>
        </div>
        <div id="review-page-inner"></div>
      `;
      content.querySelector('#btn-rev-back-dash').onclick = () => {
        window.location.hash = `#project/${this.currentProject.id}/dashboard`;
      };
      content.querySelector('#btn-rev-back-list').onclick = () => {
        window.location.hash = `#project/${this.currentProject.id}/list`;
      };
      await ReviewPage.render(content.querySelector('#review-page-inner'), this.currentProject);
    } else {
      // 未知のタブなら一覧へ
      await ListPage.render(content, this.currentProject);
    }
  },

  /**
   * より複雑な機能を格納した管理ダッシュボードの描画
   */
  async renderDashboard(content, project) {
    const projectId = project.id;
    const stats = await DB.getProjectStats(projectId);
    const reviewStats = await DB.getReviewStats(projectId);
    const isCompleted = project.status === '完了';
    const isFolderConnected = FolderConnector.isConnected();
    const isSelectionMode = project.projectType === 'selection';
    const courseDist = stats.courseCountDistribution || {};
    const methodDist = stats.methodDistribution || {};
    const courseBoxes = (project.scanTemplate?.customBoxes || project.template?.customBoxes || []);

    content.innerHTML = `
      <div class="dashboard-container">
        <!-- 上部ナビゲーションバナー -->
        <div class="dashboard-nav-banner">
          <div class="dashboard-nav-banner-left">
            <button id="btn-dash-back-list" class="btn btn-secondary btn-sm" style="font-weight: 700;">
              ← 提出状況一覧（通常画面）に戻る
            </button>
            <span style="font-size: 0.92rem; color: var(--primary-800); font-weight: 700;">
              🛠️ 管理ダッシュボード
            </span>
          </div>
          <div style="font-size: 0.82rem; color: var(--gray-600);">
            高度なスキャン処理・照合・生徒名簿・各種設定機能
          </div>
        </div>

        <!-- 共有フォルダ格納情報バナー / プロジェクト識別情報 -->
        <div class="dashboard-folder-info-card">
          <div class="folder-info-header">
            <div class="folder-info-title-group">
              <span class="folder-info-icon">📁</span>
              <div>
                <div class="folder-info-title">
                  <span>共有フォルダ格納情報（プロジェクトフォルダ名）</span>
                </div>
                <div class="folder-info-sub">
                  共有フォルダ内やWindowsエクスプローラー上で、このプロジェクトが保存されているフォルダ名です
                </div>
              </div>
            </div>
            <div class="folder-info-status-badges">
              <span class="badge ${isFolderConnected ? 'badge-success' : (FolderConnector.isPermissionPending() ? 'badge-warning' : 'badge-gray')}">
                ${isFolderConnected ? `🟢 共有フォルダ: ${FolderConnector.getFolderName() || FolderConnector.folderName || '接続中'}` : (FolderConnector.isPermissionPending() ? '🟡 要再認可' : '⚪ 共有フォルダ未接続')}
              </span>
              <span class="badge ${isCompleted ? 'badge-gray' : 'badge-success'}">
                ${isCompleted ? '🏁 完了 (archive/)' : '🟢 進行中'}
              </span>
            </div>
          </div>
          <div class="folder-info-body">
            <div class="folder-info-row">
              <span class="folder-info-label">格納名 (ID):</span>
              <div class="folder-name-box">
                <code class="folder-name-code text-mono" id="dash-project-folder-name" title="クリックして全選択">${projectId}</code>
                <button type="button" id="btn-copy-folder-name" class="btn btn-secondary btn-xs btn-copy-folder" title="フォルダ名「${projectId}」をクリップボードにコピー">
                  📋 コピー
                </button>
              </div>
            </div>
            <div class="folder-info-path-hint">
              ${isFolderConnected ? `
                <span style="color: var(--gray-500);">エクスプローラー上の場所:</span>
                <code class="text-mono">${FolderConnector.getFolderName() || FolderConnector.folderName || '共有フォルダ'}\\${isCompleted ? 'archive\\' : ''}${projectId}\\</code>
              ` : `
                <span style="color: var(--gray-500);">※ 共有フォルダに接続すると、ルート直下に <code class="text-mono">${projectId}\\</code> として作成・同期されます</span>
              `}
            </div>
          </div>
        </div>

        ${isSelectionMode ? `
          <!-- 講座選択モード専用: 講座別申込サマリー -->
          <div class="dashboard-section">
            <div class="dashboard-section-header">
              <span style="font-size: 1.25rem;">🎯</span>
              <h3 class="dashboard-section-title">志望校別 講座別申込人数サマリー</h3>
              <span class="badge" style="background: #ede7f6; color: #512da8; font-weight: 700; margin-left: 8px;">
                延べ申込: ${stats.totalSelectedCourses || 0} 講座 (平均 ${(stats.avgCourses || 0).toFixed(1)} 講座/人)
              </span>
            </div>
            
            <div style="background: #fff; border: 1px solid var(--gray-200); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 20px; box-shadow: var(--shadow-sm);">
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
                ${courseBoxes.length > 0 ? courseBoxes.map(b => {
                  const count = courseDist[b.label] || 0;
                  const pct = stats.submitted > 0 ? Math.round((count / stats.submitted) * 100) : 0;
                  const isZoom = b.label.includes('Zoom');
                  const isVideo = b.label.includes('動画');
                  const badgeColor = isZoom ? '#0284c7' : (isVideo ? '#ea580c' : '#7c3aed');
                  const badgeBg = isZoom ? '#e0f2fe' : (isVideo ? '#ffedd5' : '#ede9fe');
                  const badgeText = isZoom ? 'Zoom' : (isVideo ? '動画' : '対面');
                  return `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md);">
                      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                        <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; font-weight: 700; font-size: 0.72rem; padding: 2px 6px;">${badgeText}</span>
                        <span style="font-weight: 600; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${b.label}">${b.label}</span>
                      </div>
                      <div style="text-align: right; min-width: 65px;">
                        <span class="text-mono font-bold" style="font-size: 1.1rem; color: var(--primary-700);">${count}</span>
                        <span style="font-size: 0.75rem; color: var(--gray-500);">名 (${pct}%)</span>
                      </div>
                    </div>
                  `;
                }).join('') : '<p class="text-muted" style="padding: 8px;">講座枠が設定されていません</p>'}
              </div>

              <div style="display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--gray-200); font-size: 0.82rem; color: var(--gray-600);">
                <span>受講形式内訳:</span>
                <span>💻 Zoom: <strong class="text-mono font-bold" style="color: #0284c7;">${methodDist['Zoom'] || 0}</strong> 件</span>
                <span>🎬 動画: <strong class="text-mono font-bold" style="color: #ea580c;">${methodDist['動画'] || 0}</strong> 件</span>
                <span>🏫 校舎: <strong class="text-mono font-bold" style="color: #7c3aed;">${methodDist['校舎'] || 0}</strong> 件</span>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- セクション1: 受講確認票 スキャン・照合業務 -->
        <div class="dashboard-section">
          <div class="dashboard-section-header">
            <span style="font-size: 1.25rem;">📷</span>
            <h3 class="dashboard-section-title">${isSelectionMode ? '志望校別申込書 スキャン・照合業務' : '受講確認票 スキャン・照合業務'}</h3>
          </div>
          <div class="dashboard-grid">
            <!-- スキャン読み取り・承認 -->
            <div class="dashboard-card card-featured">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">📷</div>
                  <div>
                    <h4 class="dashboard-card-title">読み取り・承認（スキャン処理）</h4>
                    <span class="badge ${isCompleted ? 'badge-gray' : 'badge-primary'}">${isCompleted ? '🔒 ロック中' : 'バーコード一括読取'}</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  ${isSelectionMode 
                    ? 'スキャナーや画像ファイル（PDF/JPEG）から志望校別対策講座申込書のバーコードと希望講座チェックを一括読み取りし、申込状況を承認します。' 
                    : 'スキャナーや画像ファイル（PDF/JPEG）から受講確認票のバーコード・チェックボックスを一括読み取りし、提出状況を反映・承認します。'}
                </p>
              </div>
              <div>
                <button id="btn-dash-open-scan" class="btn btn-primary btn-block" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                  📷 スキャン画面を開く
                </button>
              </div>
            </div>

            <!-- スキャン照合・確認 -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">🔍</div>
                  <div>
                    <h4 class="dashboard-card-title">スキャン照合・確認</h4>
                    <span class="badge ${reviewStats.unreviewed > 0 ? 'badge-warning' : 'badge-success'}">
                      ${reviewStats.unreviewed > 0 ? `未確認 ${reviewStats.unreviewed}件` : '全件確認済'}
                    </span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  ${isSelectionMode 
                    ? '読み取った申込書の原本画像と講座認識結果を並べて照合し、希望講座のチェック漏れや差異がないか確認・修正します。' 
                    : '読み取った受講確認票の原本画像と自動認識結果を並べて照合し、チェックの誤りや未確認の差異がないか確認・修正します。'}
                </p>
              </div>
              <div>
                <button id="btn-dash-open-review" class="btn btn-secondary btn-block">
                  🔍 照合画面を開く
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- セクション2: 生徒名簿・データ管理 -->
        <div class="dashboard-section">
          <div class="dashboard-section-header">
            <span style="font-size: 1.25rem;">👥</span>
            <h3 class="dashboard-section-title">生徒名簿・データ管理</h3>
          </div>
          <div class="dashboard-grid">
            <!-- 生徒管理 -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">👥</div>
                  <div>
                    <h4 class="dashboard-card-title">生徒名簿の管理・追加</h4>
                    <span class="badge badge-info">登録生徒: ${stats.total}名</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  受講対象の生徒を個別に新規登録、またはCSV/Excelファイルから一括取り込みします。登録済み生徒情報の修正もここから行えます。
                </p>
              </div>
              <div>
                <button id="btn-dash-manage-students" class="btn btn-secondary btn-block" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                  👥 生徒管理を開く
                </button>
              </div>
            </div>

            <!-- 提出データ出力（Excel / CSV） -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">📊</div>
                  <div>
                    <h4 class="dashboard-card-title">${isSelectionMode ? '講座申込データ出力' : '提出状況データ出力'}</h4>
                    <span class="badge badge-primary">Excel / CSV</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  ${isSelectionMode 
                    ? '全生徒の申込講座一覧および講座別クロス集計マトリクス（生徒×講座）を、Excel (.xlsx) または CSV 形式でダウンロードして集計や校舎管理に利用します。' 
                    : '登録された全生徒の提出状況・受講変更・確定内容の一覧データを、Excel (.xlsx) または CSV 形式でダウンロードして集計や保管に利用します。'}
                </p>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button id="btn-dash-export-excel" class="btn btn-primary" style="flex: 1; min-width: 140px;" title="全生徒の提出状況一覧をExcelダウンロード">
                  📊 Excel出力 (.xlsx)
                </button>
                <button id="btn-dash-export-csv" class="btn btn-secondary" style="flex: 1; min-width: 120px;" title="全生徒の提出状況一覧をCSVダウンロード">
                  📄 CSV出力
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- セクション3: 設定・メンテナンス -->
        <div class="dashboard-section">
          <div class="dashboard-section-header">
            <span style="font-size: 1.25rem;">⚙️</span>
            <h3 class="dashboard-section-title">プロジェクト設定・メンテナンス</h3>
          </div>
          <div class="dashboard-grid">
            <!-- 書式調整 -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">📐</div>
                  <div>
                    <h4 class="dashboard-card-title">書式・読取位置調整</h4>
                    <span class="badge badge-gray">キャリブレーション</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  受講確認票の印刷ズレがある場合に、バーコードや各チェックボックスの読み取り枠位置を画面上でプレビューしながら微調整します。
                </p>
              </div>
              <div>
                <button id="btn-dash-edit-template" class="btn btn-secondary btn-block" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                  📐 書式調整を開く
                </button>
              </div>
            </div>

            <!-- 共有同期 -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">🔄</div>
                  <div>
                    <h4 class="dashboard-card-title">共有フォルダ最新同期</h4>
                    <span class="badge ${isFolderConnected ? 'badge-success' : (FolderConnector.isPermissionPending() ? 'badge-warning' : 'badge-gray')}">
                      ${isFolderConnected ? '🟢 接続中' : (FolderConnector.isPermissionPending() ? '🟡 要再認可' : '⚪ 未接続')}
                    </span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  共有フォルダから、他のPCが追加した生徒や提出・変更イベントの最新差分を手動で取り込んでデータを最新化します。
                  <span style="display: block; margin-top: 8px; font-size: 0.8rem; color: var(--gray-600); background: var(--gray-100); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px dashed var(--gray-300);">対象フォルダ: <code class="text-mono font-bold" style="color: var(--primary-700);">${projectId}</code></span>
                </p>
              </div>
              <div>
                <button id="btn-dash-sync" class="btn btn-secondary btn-block">
                  🔄 最新データに同期
                </button>
              </div>
            </div>

            <!-- 共有フォルダへ再書き出し（障害復旧・再配置） -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">📤</div>
                  <div>
                    <h4 class="dashboard-card-title">共有フォルダへ再書き出し</h4>
                    <span class="badge badge-gray">修復・再配置</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  このPCのローカルデータを正として、共有フォルダのプロジェクト情報（meta.json）および生徒名簿（students.json）を強制的に再出力・検証します。他PCで取り込めない場合の修復に使用します。
                  <span style="display: block; margin-top: 8px; font-size: 0.8rem; color: var(--gray-600); background: var(--gray-100); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px dashed var(--gray-300);">出力先フォルダ: <code class="text-mono font-bold" style="color: var(--primary-700);">${projectId}</code></span>
                </p>
              </div>
              <div>
                <button id="btn-dash-force-export" class="btn btn-secondary btn-block">
                  📤 共有フォルダへ再書き出し
                </button>
              </div>
            </div>

            <!-- 完了（アーカイブ） -->
            <div class="dashboard-card">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon">🏁</div>
                  <div>
                    <h4 class="dashboard-card-title">プロジェクトを完了（アーカイブ）にする</h4>
                    <span class="badge badge-success">🟢 進行中</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  講習業務が終了した際に「完了（アーカイブ）」に設定します。<br>
                  共有フォルダの退避フォルダ（archive/）へ移動され、全端末のホーム画面および手元データから取り下げられます。<br>
                  <span style="font-size: 0.8rem; color: var(--primary-600);">※ 後からホーム画面の「完了済みのプロジェクト」ボタンより、いつでも進行中に戻せます。</span>
                </p>
              </div>
              <div>
                <button id="btn-dash-archive" class="btn btn-secondary btn-block">
                  🏁 完了（アーカイブ）にする
                </button>
              </div>
            </div>

            <!-- 削除 -->
            <div class="dashboard-card" style="border-color: #ffcdd2;">
              <div>
                <div class="dashboard-card-header">
                  <div class="dashboard-card-icon" style="background: #ffebee;">🗑️</div>
                  <div>
                    <h4 class="dashboard-card-title" style="color: var(--danger-solid);">プロジェクトの削除</h4>
                    <span class="badge badge-danger">危険操作</span>
                  </div>
                </div>
                <p class="dashboard-card-desc">
                  この端末から、登録されている生徒名簿・受講提出データを削除します。※共有フォルダ上のファイルは削除されません。
                </p>
              </div>
              <div>
                <button id="btn-dash-delete" class="btn btn-ghost btn-block" style="color: var(--danger-solid); border: 1px solid var(--danger-solid);">
                  🗑️ この端末から削除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // ダッシュボード内のイベントバインド
    content.querySelector('#btn-dash-back-list').onclick = () => {
      window.location.hash = `#project/${projectId}/list`;
    };

    const copyFolderBtn = content.querySelector('#btn-copy-folder-name');
    if (copyFolderBtn) {
      copyFolderBtn.onclick = async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(projectId);
          } else {
            const tempInput = document.createElement('input');
            tempInput.value = projectId;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
          }
          const originalText = copyFolderBtn.innerHTML;
          copyFolderBtn.innerHTML = '✓ コピー完了';
          copyFolderBtn.classList.add('btn-success');
          copyFolderBtn.classList.remove('btn-secondary');
          UI.showToast(`共有フォルダ格納名「${projectId}」をコピーしました`, 'success', 3000);
          setTimeout(() => {
            if (copyFolderBtn) {
              copyFolderBtn.innerHTML = originalText;
              copyFolderBtn.classList.remove('btn-success');
              copyFolderBtn.classList.add('btn-secondary');
            }
          }, 2000);
        } catch (err) {
          console.error('クリップボードコピー失敗:', err);
          UI.showToast(`コピーに失敗しました: ${err.message}`, 'warning');
        }
      };
    }

    const scanBtn = content.querySelector('#btn-dash-open-scan');
    if (scanBtn) {
      scanBtn.onclick = () => {
        window.location.hash = `#project/${projectId}/scan`;
      };
    }

    const reviewBtn = content.querySelector('#btn-dash-open-review');
    if (reviewBtn) {
      reviewBtn.onclick = () => {
        window.location.hash = `#project/${projectId}/review`;
      };
    }

    const manageStudentsBtn = content.querySelector('#btn-dash-manage-students');
    if (manageStudentsBtn) {
      manageStudentsBtn.onclick = () => {
        this.openStudentManagementModal(projectId);
      };
    }

    const exportExcelBtn = content.querySelector('#btn-dash-export-excel');
    if (exportExcelBtn) {
      exportExcelBtn.onclick = async () => {
        try {
          UI.setButtonLoading(exportExcelBtn, true, '出力中...');
          const items = await DB.getProjectStudentsWithSubmissions(projectId);
          const cleanTitle = UI.formatProjectTitle(project.title);
          const fileName = `${cleanTitle}_${isSelectionMode ? '講座申込集計' : '提出集計'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
          if (isSelectionMode) {
            CsvUtil.exportSelectionSubmissionsExcel(items, project.scanTemplate?.customBoxes || project.template?.customBoxes, fileName);
          } else {
            CsvUtil.exportSubmissionsExcel(items, fileName);
          }
          UI.showToast(`Excelファイルを出力しました (${items.length} 件)`, 'success');
        } catch (e) {
          UI.showToast(`Excel出力エラー: ${e.message}`, 'error');
        } finally {
          UI.setButtonLoading(exportExcelBtn, false);
        }
      };
    }

    const exportCsvBtn = content.querySelector('#btn-dash-export-csv');
    if (exportCsvBtn) {
      exportCsvBtn.onclick = async () => {
        try {
          UI.setButtonLoading(exportCsvBtn, true, '出力中...');
          const items = await DB.getProjectStudentsWithSubmissions(projectId);
          const cleanTitle = UI.formatProjectTitle(project.title);
          const fileName = `${cleanTitle}_${isSelectionMode ? '講座申込集計' : '提出集計'}_${new Date().toISOString().slice(0, 10)}.csv`;
          if (isSelectionMode) {
            CsvUtil.exportSelectionSubmissionsCsv(items, fileName);
          } else {
            CsvUtil.exportSubmissionsCsv(items, fileName);
          }
          UI.showToast(`CSVファイルを出力しました (${items.length} 件)`, 'success');
        } catch (e) {
          UI.showToast(`CSV出力エラー: ${e.message}`, 'error');
        } finally {
          UI.setButtonLoading(exportCsvBtn, false);
        }
      };
    }

    const editTemplateBtn = content.querySelector('#btn-dash-edit-template');
    if (editTemplateBtn) {
      editTemplateBtn.onclick = () => {
        this.openTemplateCalibrationModal(projectId);
      };
    }

    const syncBtn = content.querySelector('#btn-dash-sync');
    if (syncBtn) {
      syncBtn.onclick = () => {
        this.handleSync(projectId);
      };
    }

    const forceExportBtn = content.querySelector('#btn-dash-force-export');
    if (forceExportBtn) {
      forceExportBtn.onclick = () => {
        this.handleForceExport(projectId);
      };
    }

    const archiveBtn = content.querySelector('#btn-dash-archive');
    if (archiveBtn) {
      archiveBtn.onclick = async () => {
        if (!FolderConnector.isConnected()) {
          UI.showToast('完了（アーカイブ）を実行するには共有フォルダの接続が必要です。画面上部または設定画面から共有フォルダを接続してください。', 'warning', 6000);
          return;
        }

        const ok = await UI.confirm(
          'プロジェクトの完了（アーカイブ）',
          `「${this.currentProject.title}」を「完了（アーカイブ）」にしますか？\n\n【処理内容】\n・共有フォルダ内の退避フォルダ（archive/）へプロジェクトが退避されます。\n・全端末のホーム画面および端末内データから自動的に取り下げられます。\n\n※ 必要なときは、いつでもホーム画面の「完了済みのプロジェクト」ボタンから「進行中」に戻すことができます。`,
          '完了（アーカイブ）にする',
          'primary'
        );
        if (!ok) return;

        UI.setButtonLoading(archiveBtn, true, '退避処理中...');
        try {
          await UI.withLoading(async () => {
            await DB.archiveProject(projectId);
          }, {
            title: '完了（アーカイブ）処理中...',
            message: '共有フォルダの退避フォルダ（archive/）へプロジェクトを移動し、手元データを整理しています。画面を閉じずにお待ちください。',
            icon: '📦'
          });
          UI.showToast(`「${this.currentProject.title}」を完了（アーカイブ）へ退避しました`, 'success', 5000);
          window.location.hash = '#home';
        } catch (err) {
          console.error('アーカイブエラー:', err);
          UI.showToast(`アーカイブ処理エラー: ${err.message}`, 'error', 6000);
          UI.setButtonLoading(archiveBtn, false);
        }
      };
    }

    const deleteBtn = content.querySelector('#btn-dash-delete');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        const ok = await UI.confirm(
          'プロジェクトの削除',
          `「${this.currentProject.title}」と、登録されている生徒・提出データをすべて削除しますか？（この操作は元に戻せません）`,
          '削除する',
          'danger'
        );
        if (ok) {
          await DB.deleteProject(projectId);
          UI.showToast('プロジェクトを削除しました', 'info');
          window.location.hash = '#home';
        }
      };
    }
  },

  /**
   * 受講確認票の書式・読取位置調整モーダル
   */
  async openTemplateCalibrationModal(projectId) {
    const project = await DB.getProject(projectId);
    if (!project) return;

    const settings = await DB.getSettings();
    const defaultTemplate = settings.defaultScanTemplate || CheckboxEngine.getDefaultTemplate();
    const isSelectionMode = (project.projectType === 'selection');
    let currentTemplate = JSON.parse(JSON.stringify(project.scanTemplate || defaultTemplate));
    if (!currentTemplate.customBoxes) currentTemplate.customBoxes = [];
    if (isSelectionMode) {
      delete currentTemplate.noChangeBox;
      delete currentTemplate.hasChangeBox;
    }
    const coursePresets = settings.coursePresets || [];
    const methodPresets = settings.methodPresets || [];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content modal-2xl">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="brand-icon" style="width: 28px; height: 28px; font-size: 14px;">📐</span>
            <div>
              <h3 class="modal-title font-bold">受講確認票 書式・読取位置調整</h3>
              <div style="font-size: 0.8rem; color: var(--gray-500); font-weight: normal;">
                対象: ${UI.formatProjectTitle(project.title)}
              </div>
            </div>
          </div>
          <div class="modal-header-actions">
            <button class="btn-modal-maximize" id="btn-proj-calib-maximize" title="全画面最大化 / 元に戻す">⛶</button>
            <button class="btn-ghost btn-sm btn-close-modal" title="閉じる">✕</button>
          </div>
        </div>
        <div class="modal-body" style="padding: 10px var(--spacing-lg); max-height: 86vh;">
          <!-- 読取チェックボックス項目管理パネル -->
          <div class="custom-boxes-config-panel" style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 14px; margin-bottom: var(--spacing-md);">
            <div style="font-weight: bold; font-size: 0.92rem; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
              <span>🎯 ${isSelectionMode ? '読取チェックボックス項目管理（志望校別講座）' : '読取チェックボックス項目管理（標準・志望校別講座）'}</span>
              <span class="badge badge-purple" style="font-size: 0.75rem;">プロジェクト個別設定</span>
            </div>
            <p style="color: var(--gray-600); font-size: 0.82rem; margin-bottom: 10px;">
              ${isSelectionMode
                ? 'このプロジェクトで読み取るチェックボックス（志望校別対策講座、自由項目）を調整・削除・追加できます。'
                : 'このプロジェクトで読み取るチェックボックス（標準の変更なし・変更あり、志望校別対策講座、自由項目）を調整・削除・追加できます。'}
            </p>

            <!-- 志望校別講座（講座名 × 受講方法）選択追加フォーム -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px; align-items: end;">
              <div>
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">講座名を選択</label>
                <select id="proj-sel-course" class="form-control" style="font-size: 0.85rem;">
                  <option value="">-- 講座名を選択 --</option>
                  ${coursePresets.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">受講方法を選択</label>
                <select id="proj-sel-method" class="form-control" style="font-size: 0.85rem;">
                  <option value="">-- 受講方法を選択 --</option>
                  ${methodPresets.map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>
              </div>
              <div>
                <button type="button" id="proj-btn-add-course" class="btn btn-primary btn-sm" style="width: 100%; height: 38px;">
                  ➕ 志望校別講座を追加
                </button>
              </div>
            </div>

            <!-- 自由記述追加フォーム -->
            <div style="display: flex; gap: 8px; margin-bottom: 10px; align-items: center;">
              <input type="text" id="proj-inp-custom-name" class="form-control" placeholder="自由記述で項目名を入力（例: 特別講習A、Zoom振替希望 など）" style="font-size: 0.85rem;">
              <button type="button" id="proj-btn-add-free" class="btn btn-secondary btn-sm" style="white-space: nowrap; height: 38px;">
                ➕ 自由項目を追加
              </button>
            </div>

            <!-- 登録中チェックボックス一覧 -->
            <div id="proj-custom-boxes-container"></div>
          </div>

          <div id="project-calib-container"></div>
        </div>
        <div class="modal-footer">
          <button id="btn-modal-cancel" class="btn btn-secondary">キャンセル</button>
          <button id="btn-modal-save" class="btn btn-primary">💾 この設定を保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 最大化トグル
    const maxBtn = modal.querySelector('#btn-proj-calib-maximize');
    if (maxBtn) {
      maxBtn.onclick = () => {
        const content = modal.querySelector('.modal-content');
        if (content.classList.contains('modal-fullscreen')) {
          content.classList.remove('modal-fullscreen');
          maxBtn.textContent = '⛶';
          maxBtn.title = '全画面最大化';
        } else {
          content.classList.add('modal-fullscreen');
          maxBtn.textContent = '🗗';
          maxBtn.title = '元に戻す';
        }
      };
    }

    const mount = modal.querySelector('#project-calib-container');
    const calibrator = new TemplateCalibrator(
      mount,
      currentTemplate,
      (t) => {
        currentTemplate = t;
        renderProjCustomBoxes();
      },
      {
        defaultResetTemplate: defaultTemplate,
        resetLabel: '🔄 共通既定書式に戻す',
        resetToastMsg: '共通既定書式の位置に復元しました',
        allowStandardBoxes: !isSelectionMode,
        allowDeleteStandardBoxes: isSelectionMode
      }
    );

    // チェックボックス一覧描画 & 操作
    let projSearchFilter = '';
    const renderProjCustomBoxes = () => {
      const container = modal.querySelector('#proj-custom-boxes-container');
      if (!container) return;
      const allBoxes = currentTemplate.customBoxes || [];
      const boxes = projSearchFilter
        ? allBoxes.filter(b => (b.label || '').toLowerCase().includes(projSearchFilter.toLowerCase()))
        : allBoxes;

      let standardBoxesHtml = '';
      let restoreButtonsHtml = '';

      if (!isSelectionMode) {
        const hasNoChange = !!currentTemplate.noChangeBox;
        const hasHasChange = !!currentTemplate.hasChangeBox;
        if (hasNoChange) {
          standardBoxesHtml += `
            <div style="background: #fff; border: 1px solid #86efac; border-radius: var(--radius-md); padding: 5px 10px; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
              <span style="font-weight: 700; font-size: 0.85rem; color: #15803d;">🟩 変更なし</span>
              <button type="button" class="btn btn-secondary btn-sm proj-btn-focus-box" data-id="noChange" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
                🎯 調整
              </button>
            </div>
          `;
        }
        if (hasHasChange) {
          standardBoxesHtml += `
            <div style="background: #fff; border: 1px solid #fdba74; border-radius: var(--radius-md); padding: 5px 10px; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
              <span style="font-weight: 700; font-size: 0.85rem; color: #c2410c;">🟧 変更あり</span>
              <button type="button" class="btn btn-secondary btn-sm proj-btn-focus-box" data-id="hasChange" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
                🎯 調整
              </button>
            </div>
          `;
        }
        if (!hasNoChange) {
          restoreButtonsHtml += `
            <button type="button" class="btn btn-secondary btn-sm proj-btn-restore-box" data-type="noChange" style="padding: 3px 8px; font-size: 0.75rem; color: #15803d; border-color: #86efac;" title="「変更なし」読取枠を標準位置で再追加">
              ➕ 「変更なし」枠を追加
            </button>
          `;
        }
        if (!hasHasChange) {
          restoreButtonsHtml += `
            <button type="button" class="btn btn-secondary btn-sm proj-btn-restore-box" data-type="hasChange" style="padding: 3px 8px; font-size: 0.75rem; color: #c2410c; border-color: #fdba74;" title="「変更あり」読取枠を標準位置で再追加">
              ➕ 「変更あり」枠を追加
            </button>
          `;
        }
      }

      const totalBoxes = (isSelectionMode ? 0 : ((currentTemplate.noChangeBox ? 1 : 0) + (currentTemplate.hasChangeBox ? 1 : 0))) + allBoxes.length;

      const customBoxesHtml = boxes.map(box => {
        const originalIndex = allBoxes.findIndex(b => b.id === box.id);
        const isFirst = originalIndex <= 0;
        const isLast = originalIndex >= allBoxes.length - 1;
        return `
          <div class="custom-box-item-card ${calibrator && calibrator.activeTab === box.id ? 'is-active' : ''}">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-weight: 700; font-size: 0.84rem; color: #6d28d9;">🟪 ${box.label}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 3px;">
              <button type="button" class="custom-box-order-btn proj-btn-move-box" data-id="${box.id}" data-dir="-1" ${isFirst ? 'disabled' : ''} title="上へ移動">▲</button>
              <button type="button" class="custom-box-order-btn proj-btn-move-box" data-id="${box.id}" data-dir="1" ${isLast ? 'disabled' : ''} title="下へ移動">▼</button>
              <button type="button" class="btn btn-secondary btn-sm proj-btn-focus-box" data-id="${box.id}" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
                🎯 調整
              </button>
              <button type="button" class="btn-ghost proj-btn-del-box" data-id="${box.id}" style="padding: 0 2px; color: var(--danger-solid); font-size: 14px; line-height: 1; cursor: pointer;" title="削除">
                ✕
              </button>
            </div>
          </div>
        `;
      }).join('');

      if (totalBoxes === 0) {
        container.innerHTML = `
          <div style="font-size: 0.8rem; color: var(--gray-500); padding: 8px 12px; background: #fff; border-radius: var(--radius-sm); border: 1px dashed var(--gray-300); text-align: center; margin-bottom: 8px;">
            ${isSelectionMode ? '現在、読取チェックボックス（志望校別講座）はありません。上のフォームから講座を追加してください。' : '現在、読取チェックボックスはありません'}
          </div>
          ${restoreButtonsHtml ? `<div style="display: flex; gap: 8px; align-items: center;">${restoreButtonsHtml}</div>` : ''}
        `;
      } else {
        container.innerHTML = `
          <div class="custom-box-manager-toolbar">
            <div style="font-size: 0.82rem; font-weight: bold; color: var(--gray-700); display: flex; align-items: center; gap: 8px;">
              <span>登録中チェックボックス (${totalBoxes} 個):</span>
              ${allBoxes.length > 1 ? `
                <button type="button" id="proj-btn-sort-custom" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 2px 8px;" title="講座名を名前順（昇順）に一括並び替え">
                  🔤 名前順に並び替え
                </button>
              ` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${allBoxes.length > 5 ? `
                <input type="text" id="proj-custom-filter" class="custom-box-search-input form-control" placeholder="🔍 講座名で絞り込み..." value="${projSearchFilter}">
              ` : ''}
              ${restoreButtonsHtml ? `<div style="display: flex; gap: 6px;">${restoreButtonsHtml}</div>` : ''}
            </div>
          </div>
          <div class="custom-box-cards-grid">
            ${standardBoxesHtml}
            ${customBoxesHtml}
          </div>
        `;
      }

      // 検索フィルター入力イベント
      const filterInput = container.querySelector('#proj-custom-filter');
      if (filterInput) {
        filterInput.oninput = (e) => {
          projSearchFilter = e.target.value.trim();
          renderProjCustomBoxes();
          const newInp = container.querySelector('#proj-custom-filter');
          if (newInp) {
            newInp.focus();
            newInp.selectionStart = newInp.selectionEnd = newInp.value.length;
          }
        };
      }

      // 名前順ソートボタン
      const sortBtn = container.querySelector('#proj-btn-sort-custom');
      if (sortBtn) {
        sortBtn.onclick = () => {
          if (!currentTemplate.customBoxes || currentTemplate.customBoxes.length <= 1) return;
          currentTemplate.customBoxes.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja'));
          if (calibrator) {
            calibrator.template = currentTemplate;
            calibrator.updateTabsUI();
            calibrator.drawOverlay();
          }
          renderProjCustomBoxes();
          UI.showToast('講座を名前順に並び替えました', 'success');
        };
      }

      // 並び替えボタン（▲ / ▼）
      container.querySelectorAll('.proj-btn-move-box').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          const dir = parseInt(btn.dataset.dir, 10);
          if (!currentTemplate.customBoxes || currentTemplate.customBoxes.length <= 1) return;
          const idx = currentTemplate.customBoxes.findIndex(b => b.id === id);
          if (idx < 0) return;
          const targetIdx = idx + dir;
          if (targetIdx < 0 || targetIdx >= currentTemplate.customBoxes.length) return;

          const [item] = currentTemplate.customBoxes.splice(idx, 1);
          currentTemplate.customBoxes.splice(targetIdx, 0, item);
          if (calibrator) {
            calibrator.template = currentTemplate;
            calibrator.activeTab = item.id;
            calibrator.updateTabsUI();
            calibrator.drawOverlay();
          }
          renderProjCustomBoxes();
        };
      });

      // 削除ボタンイベント
      container.querySelectorAll('.proj-btn-del-box').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          if (!isSelectionMode && (id === 'noChange' || id === 'hasChange')) {
            return;
          }
          if (calibrator) {
            calibrator.deleteBox(id);
          } else {
            if (id === 'noChange') delete currentTemplate.noChangeBox;
            else if (id === 'hasChange') delete currentTemplate.hasChangeBox;
            else currentTemplate.customBoxes = (currentTemplate.customBoxes || []).filter(b => b.id !== id);
            renderProjCustomBoxes();
          }
        };
      });

      // 調整フォーカスボタンイベント
      container.querySelectorAll('.proj-btn-focus-box').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          if (calibrator) {
            calibrator.activeTab = id;
            calibrator.updateTabsUI();
            calibrator.syncSlidersFromTemplate();
            calibrator.drawOverlay();
            calibrator.focusTargetArea();
          }
        };
      });

      // 復元・再追加ボタンイベント
      container.querySelectorAll('.proj-btn-restore-box').forEach(btn => {
        btn.onclick = () => {
          const type = btn.dataset.type;
          if (calibrator) {
            calibrator.addStandardBox(type);
          } else {
            const def = CheckboxEngine.getDefaultTemplate();
            if (type === 'noChange') currentTemplate.noChangeBox = JSON.parse(JSON.stringify(def.noChangeBox));
            else if (type === 'hasChange') currentTemplate.hasChangeBox = JSON.parse(JSON.stringify(def.hasChangeBox));
            renderProjCustomBoxes();
          }
        };
      });
    };

    const addProjCustomBox = (label) => {
      if (!currentTemplate.customBoxes) currentTemplate.customBoxes = [];
      if (currentTemplate.customBoxes.some(b => b.label === label)) {
        UI.showToast(`「${label}」は既に追加されています`, 'warning');
        return;
      }
      const id = 'cbox_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      const count = currentTemplate.customBoxes.length;
      const newBox = {
        id,
        label,
        dx: -0.058,
        dy: Math.round((0.360 + count * 0.050) * 1000) / 1000,
        size: 0.032
      };
      currentTemplate.customBoxes.push(newBox);
      if (calibrator) {
        calibrator.activeTab = id;
        calibrator.setTemplate(currentTemplate);
        calibrator.updateTabsUI();
        calibrator.syncSlidersFromTemplate();
        calibrator.drawOverlay();
        calibrator.focusTargetArea();
      }
      renderProjCustomBoxes();
      UI.showToast(`「${label}」を追加しました。枠線の位置を調整してください。`, 'success');
    };

    renderProjCustomBoxes();

    // 講座名×受講方法追加
    const addCourseBtn = modal.querySelector('#proj-btn-add-course');
    const selCourse = modal.querySelector('#proj-sel-course');
    const selMethod = modal.querySelector('#proj-sel-method');

    if (addCourseBtn) {
      addCourseBtn.onclick = () => {
        const course = (selCourse?.value || '').trim();
        const method = (selMethod?.value || '').trim();
        if (!course) {
          UI.showToast('講座名を選択してください', 'warning');
          return;
        }
        if (!method) {
          UI.showToast('受講方法を選択してください', 'warning');
          return;
        }
        const label = `${course}（${method}）`;
        addProjCustomBox(label);
        selCourse.value = '';
        selMethod.value = '';
      };
    }

    // 自由項目追加
    const addFreeBtn = modal.querySelector('#proj-btn-add-free');
    const freeInput = modal.querySelector('#proj-inp-custom-name');

    const handleFreeAdd = () => {
      const label = (freeInput?.value || '').trim();
      if (!label) {
        UI.showToast('項目名を入力してください', 'warning');
        return;
      }
      addProjCustomBox(label);
      freeInput.value = '';
    };

    if (addFreeBtn) addFreeBtn.onclick = handleFreeAdd;
    if (freeInput) {
      freeInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleFreeAdd();
      };
    }

    const closeModal = () => modal.remove();
    modal.querySelector('.btn-close-modal').onclick = closeModal;
    modal.querySelector('#btn-modal-cancel').onclick = closeModal;

    const saveTemplateBtn = modal.querySelector('#btn-modal-save');
    saveTemplateBtn.onclick = async () => {
      if (!calibrator.isBarcodeDetected()) {
        UI.showToast('バーコードが読み取れていません。バーコードが鮮明に写っている受講票ファイルを選択するか、ファイルをご確認ください。', 'error');
        return;
      }
      const templateToSave = calibrator.getTemplate();
      if (isSelectionMode) {
        delete templateToSave.noChangeBox;
        delete templateToSave.hasChangeBox;
      }
      UI.setButtonLoading(saveTemplateBtn, true, '保存中...');
      try {
        await DB.updateProject(projectId, { scanTemplate: templateToSave });
        this.currentProject.scanTemplate = templateToSave;
        UI.showToast('受講確認票の書式設定を更新しました', 'success');
        closeModal();
        if (this.currentTab === 'scan') {
          this.renderActiveTab();
        }
      } catch (err) {
        UI.showToast(`保存エラー: ${err.message}`, 'error');
        UI.setButtonLoading(saveTemplateBtn, false);
      }
    };
  },

  /**
   * 生徒管理モーダル（生徒の追加・編集 / 事故防止のため削除は廃止）
   */
  async openStudentManagementModal(projectId) {
    // 共有フォルダ接続中なら最新生徒情報を取得してからモーダルを開く
    if (FolderConnector.isConnected()) {
      try {
        await SyncManager.syncFromSharedFolder(projectId);
      } catch (syncErr) {
        console.warn('生徒管理モーダル表示前の共有同期スキップ:', syncErr);
      }
    }

    const project = await DB.getProject(projectId);
    if (!project) return;

    let activeModalTab = 'list'; // 'list' | 'add'
    let studentSearchQuery = '';
    let selectedClassFilter = 'all';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';

    const renderModalContent = async () => {
      const students = await DB.getProjectStudentsWithSubmissions(projectId);
      const classes = await DB.getProjectClasses(projectId);

      const filteredStudents = students.filter(s => {
        // クラスフィルタ
        if (selectedClassFilter !== 'all' && s.className !== selectedClassFilter) {
          return false;
        }
        // 検索クエリ
        if (!studentSearchQuery) return true;
        const q = studentSearchQuery.toLowerCase();
        return (
          (s.nichinokenId && s.nichinokenId.toLowerCase().includes(q)) ||
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.nameKana && s.nameKana.toLowerCase().includes(q)) ||
          (s.className && s.className.toLowerCase().includes(q)) ||
          (s.course && s.course.toLowerCase().includes(q))
        );
      });

      modal.innerHTML = `
        <div class="modal-content modal-xl" style="max-height: 90vh; display: flex; flex-direction: column;">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="brand-icon" style="width: 28px; height: 28px; font-size: 14px;">👥</span>
              <div>
                <h3 class="modal-title font-bold">生徒管理</h3>
                <div style="font-size: 0.8rem; color: var(--gray-500); font-weight: normal;">
                  対象: ${UI.formatProjectTitle(project.title)} | 現在の登録生徒数: <span class="text-mono font-bold" id="modal-student-count">${students.length}</span> 名
                </div>
              </div>
            </div>
            <button class="btn-ghost btn-sm btn-close-modal">✕</button>
          </div>

          <!-- モーダル内タブ切り替え -->
          <div style="display: flex; border-bottom: 1px solid var(--gray-200); padding: 0 var(--spacing-lg); background: var(--gray-50);">
            <button id="modal-tab-list" class="btn btn-ghost" style="border-radius: 0; padding: 10px 16px; font-weight: 700; ${activeModalTab === 'list' ? 'border-bottom: 3px solid var(--primary-600); color: var(--primary-600);' : 'color: var(--gray-600);'}">
              📋 登録生徒一覧・編集 (${students.length}名)
            </button>
            <button id="modal-tab-add" class="btn btn-ghost" style="border-radius: 0; padding: 10px 16px; font-weight: 700; ${activeModalTab === 'add' ? 'border-bottom: 3px solid var(--primary-600); color: var(--primary-600);' : 'color: var(--gray-600);'}">
              ➕ 生徒の追加（手動 / CSV）
            </button>
          </div>

          <div class="modal-body" style="flex: 1; overflow-y: auto; padding: var(--spacing-lg);">
            ${activeModalTab === 'list' ? `
              <!-- 1. 生徒一覧 & 編集エリア -->
              <div style="background: #f8fafc; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 12px; font-size: 0.82rem; color: var(--gray-600); display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1rem;">ℹ️</span>
                <span>事故防止のため生徒の削除機能は廃止されました。退会等で受講しない生徒は、受講確認票の確認時に「<strong>非受講</strong>」を選択してください。</span>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-md); gap: 12px; flex-wrap: wrap;">
                <div style="display: flex; gap: 8px; flex: 1; max-width: 500px;">
                  <input type="text" id="modal-inp-search" class="form-control" placeholder="🔍 日能研番号・氏名・カナ・科目で絞り込み..." value="${studentSearchQuery}">
                  <select id="modal-sel-class-filter" class="form-control" style="width: 140px;">
                    <option value="all" ${selectedClassFilter === 'all' ? 'selected' : ''}>全クラス</option>
                    ${classes.map(c => `<option value="${c}" ${selectedClassFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
                  </select>
                </div>
                <div style="font-size: 0.85rem; color: var(--gray-500);">
                  表示中: <span class="font-bold text-mono" style="color: var(--gray-800);">${filteredStudents.length}</span> / ${students.length} 名
                </div>
              </div>

              <div class="table-container" style="max-height: 52vh; overflow-y: auto; border: 1px solid var(--gray-200); border-radius: var(--radius-md);">
                <table class="table" style="font-size: 0.85rem;">
                  <thead>
                    <tr style="position: sticky; top: 0; background: var(--gray-50); z-index: 1;">
                      <th style="width: 120px;">日能研番号</th>
                      <th>氏名</th>
                      <th>カナ</th>
                      <th style="width: 80px;">クラス</th>
                      <th style="width: 70px;">科目</th>
                      <th style="width: 120px;">提出状況</th>
                      <th style="width: 80px; text-align: center;">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredStudents.length === 0 ? `
                      <tr>
                        <td colspan="7" style="text-align: center; color: var(--gray-500); padding: 30px;">
                          該当する生徒が見つかりません
                        </td>
                      </tr>
                    ` : filteredStudents.map(s => {
                      const isSubmitted = s.status === '承認済';
                      const badgeClass = isSubmitted ? 'badge-success' : 'badge-danger';
                      return `
                        <tr>
                          <td class="text-mono font-bold">${s.nichinokenId}</td>
                          <td class="font-bold">
                            ${s.name}
                            ${(!/[\u4e00-\u9faf]/.test(s.name) && s.name) ? '<span class="badge badge-warning" style="font-size: 0.68rem; margin-left: 4px; padding: 1px 4px;">カナ氏名</span>' : ''}
                          </td>
                          <td class="text-muted" style="font-size: 0.8rem;">${s.nameKana || '-'}</td>
                          <td><span class="badge badge-info">${s.className}</span></td>
                          <td><span class="badge badge-purple">${s.course || '4科'}</span></td>
                          <td>
                            <span class="badge ${badgeClass}">${s.status}</span>
                            ${s.hasChange ? '<span class="badge badge-purple" style="font-size: 0.7rem; margin-left: 2px;">変更有</span>' : ''}
                          </td>
                          <td style="text-align: center; white-space: nowrap;">
                            <button class="btn btn-ghost btn-sm btn-edit-student" data-id="${s.studentId}" data-name="${s.name}" data-kana="${s.nameKana || ''}" data-class="${s.className}" data-course="${s.course || '4科'}" data-nid="${s.nichinokenId}" style="color: var(--primary-700); padding: 2px 8px; font-weight: 600;" title="生徒情報を編集">
                              ✏️ 編集
                            </button>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <!-- 2. 生徒追加エリア -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-lg);">
                <!-- 1名手動追加 -->
                <div class="card" style="border: 1px solid var(--gray-200); background: #fff;">
                  <div class="card-header" style="padding-bottom: 8px;">
                    <h4 class="card-title" style="font-size: 1rem;">✏️ 1名手動追加</h4>
                  </div>
                  <p style="font-size: 0.82rem; color: var(--gray-600); margin-bottom: var(--spacing-md);">
                    途中入塾や追加登録の生徒を1名ずつ手動で登録します。
                  </p>

                  <form id="form-add-single-student">
                    <div class="form-group" style="margin-bottom: 10px;">
                      <label class="form-label" style="font-size: 0.85rem;">日能研番号 <span class="required">*</span></label>
                      <input type="text" id="add-inp-nid" class="form-control text-mono font-bold" placeholder="例: TDN60013" required>
                      <div id="add-nid-warn" style="font-size: 0.78rem; color: var(--danger-solid); margin-top: 2px; display: none;"></div>
                    </div>

                    <div class="form-group" style="margin-bottom: 10px;">
                      <label class="form-label" style="font-size: 0.85rem;">氏名 <span class="required">*</span></label>
                      <input type="text" id="add-inp-name" class="form-control" placeholder="例: 日能研 太郎" required>
                    </div>

                    <div class="form-group" style="margin-bottom: 10px;">
                      <label class="form-label" style="font-size: 0.85rem;">氏名カナ</label>
                      <input type="text" id="add-inp-kana" class="form-control" placeholder="例: ニチノウケン タロウ">
                    </div>

                    <div class="form-row" style="margin-bottom: var(--spacing-md); display: flex; gap: 10px;">
                      <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label class="form-label" style="font-size: 0.85rem;">所属クラス <span class="required">*</span></label>
                        <input type="text" id="add-inp-class" class="form-control font-bold" placeholder="例: W1, M1, A1 など" list="exist-classes-list" required>
                        <datalist id="exist-classes-list">
                          ${classes.map(c => `<option value="${c}">`).join('')}
                        </datalist>
                      </div>

                      <div class="form-group" style="width: 120px; margin-bottom: 0;">
                        <label class="form-label" style="font-size: 0.85rem;">科目 <span class="required">*</span></label>
                        <select id="add-sel-course" class="form-control font-bold" required>
                          <option value="4科" selected>4科</option>
                          <option value="2科">2科</option>
                        </select>
                      </div>
                    </div>

                    <button type="submit" id="btn-submit-add-student" class="btn btn-primary" style="width: 100%;">
                      ➕ 生徒を追加する
                    </button>
                  </form>
                </div>

                <!-- CSV一括追加取込 -->
                <div class="card" style="border: 1px solid var(--gray-200); background: #fff;">
                  <div class="card-header" style="padding-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                      <h4 class="card-title" style="font-size: 1rem;">📄 CSV一括追加取込</h4>
                      <button type="button" id="modal-btn-dl-csv-template" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 2px 6px;">
                        📥 雛型CSV
                      </button>
                    </div>
                  </div>
                  <p style="font-size: 0.82rem; color: var(--gray-600); margin-bottom: var(--spacing-md);">
                    複数生徒のCSVを一括で追加取り込みします。<br>
                    ※ 既に登録されている日能研番号は自動的にスキップされます。
                  </p>

                  <div id="modal-csv-dropzone" class="dropzone" style="padding: 24px 16px; margin-bottom: var(--spacing-md);">
                    <div class="dropzone-icon" style="font-size: 2rem;">📄</div>
                    <div class="dropzone-text" style="font-size: 0.9rem;">CSVファイルをドラッグ＆ドロップ</div>
                    <div class="dropzone-subtext" style="font-size: 0.78rem;">またはクリックしてファイル選択</div>
                    <input type="file" id="modal-csv-file-input" accept=".csv,text/csv" style="display: none;">
                  </div>

                  <div id="modal-csv-result" style="display: none; font-size: 0.85rem; padding: 10px; border-radius: var(--radius-sm);"></div>
                </div>
              </div>
            `}
          </div>

          <div class="modal-footer" style="display: flex; justify-content: flex-end;">
            <button id="btn-modal-close" class="btn btn-primary">閉じる</button>
          </div>
        </div>
      `;

      // モーダルイベント設定
      const closeModal = () => modal.remove();
      modal.querySelector('.btn-close-modal').onclick = closeModal;
      modal.querySelector('#btn-modal-close').onclick = closeModal;

      // タブ切り替え
      const tabListBtn = modal.querySelector('#modal-tab-list');
      const tabAddBtn = modal.querySelector('#modal-tab-add');

      if (tabListBtn) {
        tabListBtn.onclick = async () => {
          activeModalTab = 'list';
          await renderModalContent();
        };
      }
      if (tabAddBtn) {
        tabAddBtn.onclick = async () => {
          activeModalTab = 'add';
          await renderModalContent();
        };
      }

      if (activeModalTab === 'list') {
        // 検索入力
        const searchInput = modal.querySelector('#modal-inp-search');
        if (searchInput) {
          searchInput.oninput = (e) => {
            studentSearchQuery = e.target.value.trim();
            renderModalContent();
          };
          searchInput.focus();
        }

        // クラスフィルタ
        const classSelect = modal.querySelector('#modal-sel-class-filter');
        if (classSelect) {
          classSelect.onchange = (e) => {
            selectedClassFilter = e.target.value;
            renderModalContent();
          };
        }

        // 編集ボタン
        modal.querySelectorAll('.btn-edit-student').forEach(btn => {
          btn.onclick = () => {
            const stuId = btn.dataset.id;
            const stuName = btn.dataset.name;
            const stuKana = btn.dataset.kana;
            const stuClass = btn.dataset.class;
            const stuCourse = btn.dataset.course || '4科';
            const stuNid = btn.dataset.nid;

            const editModal = document.createElement('div');
            editModal.className = 'modal-overlay';
            editModal.style.zIndex = '1100';
            editModal.innerHTML = `
              <div class="modal-content" style="max-width: 440px;">
                <div class="modal-header">
                  <h3 class="modal-title font-bold" style="font-size: 1.1rem;">✏️ 生徒情報の編集</h3>
                  <button class="modal-close" id="edit-modal-close">&times;</button>
                </div>
                <div class="modal-body">
                  <div style="font-size: 0.85rem; color: var(--gray-600); margin-bottom: 12px;">
                    日能研番号: <strong class="text-mono font-bold" style="color: var(--gray-900);">${stuNid}</strong>
                  </div>
                  <div class="form-group" style="margin-bottom: 10px;">
                    <label class="form-label required">氏名（漢字）</label>
                    <input type="text" id="edit-inp-name" class="form-control" value="${stuName}" placeholder="例: 日能研太郎" required>
                  </div>
                  <div class="form-group" style="margin-bottom: 10px;">
                    <label class="form-label">氏名カナ</label>
                    <input type="text" id="edit-inp-kana" class="form-control" value="${stuKana}" placeholder="例: ニチノウケンタロウ">
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                    <div class="form-group">
                      <label class="form-label required">所属クラス</label>
                      <input type="text" id="edit-inp-class" class="form-control text-uppercase" value="${stuClass}" placeholder="例: W1" required>
                    </div>
                    <div class="form-group">
                      <label class="form-label required">所属科目</label>
                      <select id="edit-sel-course" class="form-control">
                        <option value="4科" ${stuCourse === '4科' ? 'selected' : ''}>4科</option>
                        <option value="2科" ${stuCourse === '2科' ? 'selected' : ''}>2科</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div class="modal-footer">
                  <button class="btn btn-secondary" id="edit-modal-cancel">キャンセル</button>
                  <button class="btn btn-primary" id="edit-modal-save">保存する</button>
                </div>
              </div>
            `;
            document.body.appendChild(editModal);

            const closeEdit = () => editModal.remove();
            editModal.querySelector('#edit-modal-close').onclick = closeEdit;
            editModal.querySelector('#edit-modal-cancel').onclick = closeEdit;

            const editSaveBtn = editModal.querySelector('#edit-modal-save');
            editSaveBtn.onclick = async () => {
              const newName = editModal.querySelector('#edit-inp-name').value.trim();
              const newKana = editModal.querySelector('#edit-inp-kana').value.trim();
              const newClass = editModal.querySelector('#edit-inp-class').value.trim();
              const newCourse = editModal.querySelector('#edit-sel-course').value;

              if (!newName || !newClass) {
                UI.showToast('氏名と所属クラスは必須です', 'error');
                return;
              }

              UI.setButtonLoading(editSaveBtn, true, '更新中...');
              try {
                await DB.updateStudent(stuId, {
                  name: newName,
                  nameKana: newKana,
                  className: newClass,
                  course: newCourse
                });
                UI.showToast(`生徒「${newName}」の情報を更新しました`, 'success');
                closeEdit();
                await this.updateHeaderStats();
                this.renderActiveTab();
                await renderModalContent();
              } catch (err) {
                UI.showToast(`更新エラー: ${err.message}`, 'error');
                UI.setButtonLoading(editSaveBtn, false);
              }
            };
          };
        });
      } else if (activeModalTab === 'add') {
        // 1名手動追加フォーム
        const form = modal.querySelector('#form-add-single-student');
        const nidInput = modal.querySelector('#add-inp-nid');
        const nameInput = modal.querySelector('#add-inp-name');
        const kanaInput = modal.querySelector('#add-inp-kana');
        const classInput = modal.querySelector('#add-inp-class');
        const nidWarn = modal.querySelector('#add-nid-warn');

        if (nidInput) {
          nidInput.oninput = () => {
            const val = nidInput.value.trim().toUpperCase();
            if (val.length >= 6) {
              const res = Validator.validateNichinokenId(val);
              if (!res.isValid) {
                nidWarn.textContent = `⚠️ ${res.reason}`;
                nidWarn.style.display = 'block';
              } else {
                nidWarn.style.display = 'none';
              }
            } else {
              nidWarn.style.display = 'none';
            }
          };
        }

        if (form) {
          form.onsubmit = async (e) => {
            e.preventDefault();
            const nichinokenId = nidInput.value.trim().toUpperCase();
            const name = nameInput.value.trim();
            const nameKana = kanaInput.value.trim();
            const className = classInput.value.trim();
            const courseSelect = modal.querySelector('#add-sel-course');
            const course = courseSelect ? courseSelect.value : '4科';

            try {
              await DB.addStudentToProject(projectId, { nichinokenId, name, nameKana, className, course });
              UI.showToast(`生徒「${name}（${nichinokenId}）」を追加しました`, 'success');
              await this.updateHeaderStats();
              this.renderActiveTab();
              // 一覧タブへ切り替えて追加結果を確認
              activeModalTab = 'list';
              await renderModalContent();
            } catch (err) {
              UI.showToast(`追加エラー: ${err.message}`, 'error');
            }
          };
        }

        // CSV雛型ダウンロード
        const dlCsvBtn = modal.querySelector('#modal-btn-dl-csv-template');
        if (dlCsvBtn) {
          dlCsvBtn.onclick = () => CsvUtil.downloadTemplateCsv();
        }

        // CSVドロップゾーン
        const dropzone = modal.querySelector('#modal-csv-dropzone');
        const fileInput = modal.querySelector('#modal-csv-file-input');
        const resultDiv = modal.querySelector('#modal-csv-result');

        const processParsedStudents = async (parsed) => {
          if (parsed.students.length === 0) {
            UI.showToast('CSVに有効な生徒データが見つかりませんでした', 'error');
            return;
          }

          try {
            const res = await DB.addStudentsBulkToProject(projectId, parsed.students);
            const totalProcessed = (res.addedCount || 0) + (res.updatedCount || 0);
            if (resultDiv) {
              resultDiv.style.display = 'block';
              resultDiv.style.background = totalProcessed > 0 ? 'var(--success-bg)' : 'var(--warning-bg)';
              resultDiv.style.color = totalProcessed > 0 ? 'var(--success-text)' : 'var(--warning-text)';
              resultDiv.style.border = `1px solid ${totalProcessed > 0 ? 'var(--success-solid)' : 'var(--warning-solid)'}`;
              resultDiv.innerHTML = `
                <div class="font-bold">処理完了: 新規追加 ${res.addedCount} 名、更新 ${res.updatedCount || 0} 名、スキップ ${res.skippedCount} 件</div>
                ${res.updatedCount > 0 ? `<div style="font-size: 0.78rem; margin-top: 4px; color: var(--success-text);">✓ 既存生徒の氏名・カナ・クラス・科目を最新CSVで上書き更新しました</div>` : ''}
                ${res.skippedCount > 0 ? `<div style="font-size: 0.78rem; margin-top: 4px;">スキップ理由: CSV内重複またはフォーマット不備</div>` : ''}
              `;
            }
            UI.showToast(`CSV処理完了: ${res.addedCount} 名追加、${res.updatedCount || 0} 名更新`, 'success');
            await this.updateHeaderStats();
            this.renderActiveTab();
          } catch (err) {
            UI.showToast(`CSV取込エラー: ${err.message}`, 'error');
          }
        };

        const handleCsvFile = (file) => {
          const reader = new FileReader();
          reader.onload = async (e) => {
            const text = e.target.result;
            const parsed = CsvUtil.parseStudentsCsv(text);
            if (parsed.students.length === 0 && parsed.errors.some(er => er.message && er.message.includes('日能研番号'))) {
              // Shift_JISで再試行
              const r2 = new FileReader();
              r2.onload = async (e2) => {
                const text2 = e2.target.result;
                const parsed2 = CsvUtil.parseStudentsCsv(text2);
                await processParsedStudents(parsed2);
              };
              r2.readAsText(file, 'Shift_JIS');
              return;
            }
            await processParsedStudents(parsed);
          };
          reader.readAsText(file, 'UTF-8');
        };

        if (dropzone && fileInput) {
          dropzone.onclick = () => fileInput.click();
          dropzone.ondragover = (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
          };
          dropzone.ondragleave = () => dropzone.classList.remove('dragover');
          dropzone.ondrop = async (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
              handleCsvFile(e.dataTransfer.files[0]);
            }
          };
          fileInput.onchange = () => {
            if (fileInput.files.length > 0) {
              handleCsvFile(fileInput.files[0]);
            }
          };
        }
      }
    };

    document.body.appendChild(modal);
    await renderModalContent();
  }
};

