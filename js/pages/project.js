/**
 * プロジェクト画面コントローラー（ヘッダー・タブ管理）
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { CheckboxEngine } from '../checkbox.js';
import { ScanPage } from './scan.js';
import { ListPage } from './list.js';
import { ManualPage } from './manual.js';
import { TemplateCalibrator } from '../components/calibrator.js';

export const ProjectPage = {
  container: null,
  currentProject: null,
  currentTab: 'scan',

  async render(container, projectId, tab = 'scan') {
    this.container = container;
    this.currentTab = tab || 'scan';

    const project = await DB.getProject(projectId);
    if (!project) {
      UI.showToast('プロジェクトが見つかりません', 'error');
      window.location.hash = '#home';
      return;
    }
    this.currentProject = project;

    const stats = await DB.getProjectStats(projectId);
    const isCompleted = project.status === '完了';

    this.container.innerHTML = `
      <div class="view-container">
        <div class="project-header-bar">
          <div class="project-header-title">
            <button id="btn-back-home" class="back-btn" title="ホームに戻る">←</button>
            <div>
              <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 4px;">
                <span class="badge badge-info">${project.year}年度</span>
                <span class="badge badge-purple">${project.grade}年生</span>
                <span class="badge badge-success">${project.sessionName}講習</span>
                <span id="header-status-badge" class="badge ${isCompleted ? 'badge-gray' : 'badge-success'}" style="${isCompleted ? 'font-weight: 700;' : 'font-weight: 700; background: #e8f5e9; color: #2e7d32;'}">
                  ${isCompleted ? '🏁 完了' : '🟢 進行中'}
                </span>
                <h1 style="font-size: 1.45rem; font-weight: 800; color: var(--gray-900); display: inline; margin-left: 4px;">${project.title}</h1>
              </div>
              <div style="font-size: 0.82rem; color: var(--gray-500);">
                登録生徒数: <span id="header-stat-total" class="font-bold text-mono">${stats.total}</span> 名 | 
                提出済: <span id="header-stat-submitted" class="font-bold text-mono" style="color: var(--primary-600);">${stats.submitted}</span> 名 | 
                未提出: <span id="header-stat-unsubmitted" class="font-bold text-mono" style="color: var(--danger-solid);">${stats.unsubmitted}</span> 名
                ${project.completedAt ? ` | 完了日時: <span class="text-mono font-bold">${UI.formatDate(project.completedAt)}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button id="btn-toggle-project-status" class="btn ${isCompleted ? 'btn-primary' : 'btn-secondary'} btn-sm" title="${isCompleted ? 'このプロジェクトを進行中に戻す' : 'このプロジェクトを完了にする'}">
              ${isCompleted ? '🔄 進行中に戻す' : '🏁 完了にする'}
            </button>
            <button id="btn-edit-template" class="btn btn-secondary btn-sm" title="${isCompleted ? '完了プロジェクトのため書式調整は不可' : 'このプロジェクトの受講確認票書式・読取位置を微調整'}" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
              📐 書式・読取位置調整
            </button>
            <button id="btn-delete-project" class="btn btn-ghost btn-sm" style="color: var(--danger-solid);" title="プロジェクト削除">
              🗑️ 削除
            </button>
          </div>
        </div>

        ${isCompleted ? `
          <div class="card" style="border-left: 4px solid var(--gray-400); background: var(--gray-100); padding: 10px 16px; margin-bottom: var(--spacing-md); display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 0.88rem; color: var(--gray-700); display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.15rem;">🔒</span>
              <span><strong>このプロジェクトは「完了」に設定されているため、データの変更・新規スキャンはロックされています。</strong> 内容を変更・追加する場合は、右上の「<strong>🔄 進行中に戻す</strong>」ボタンを押してください。</span>
            </div>
          </div>
        ` : ''}

        <div class="tab-nav">
          <button class="tab-btn ${this.currentTab === 'scan' ? 'active' : ''}" data-tab="scan">
            📷 読み取り・承認
          </button>
          <button class="tab-btn ${this.currentTab === 'list' ? 'active' : ''}" data-tab="list">
            📊 提出状況一覧
            <span id="tab-badge-list" class="tab-badge">${stats.submitted}/${stats.total}</span>
          </button>
          <button class="tab-btn ${this.currentTab === 'manual' ? 'active' : ''}" data-tab="manual">
            ✏️ 手動登録・変更
          </button>
        </div>

        <div id="project-tab-content"></div>
      </div>
    `;

    this.bindEvents(projectId);
    this.renderActiveTab();
  },

  /**
   * ヘッダーの統計数値およびタブバッジを最新データで更新
   */
  async updateHeaderStats() {
    if (!this.currentProject || !this.container) return;
    try {
      const stats = await DB.getProjectStats(this.currentProject.id);
      const totalEl = this.container.querySelector('#header-stat-total');
      const submittedEl = this.container.querySelector('#header-stat-submitted');
      const unsubmittedEl = this.container.querySelector('#header-stat-unsubmitted');
      const badgeEl = this.container.querySelector('#tab-badge-list');

      if (totalEl) totalEl.textContent = stats.total;
      if (submittedEl) submittedEl.textContent = stats.submitted;
      if (unsubmittedEl) unsubmittedEl.textContent = stats.unsubmitted;
      if (badgeEl) badgeEl.textContent = `${stats.submitted}/${stats.total}`;
    } catch (e) {
      console.error('Failed to update header stats:', e);
    }
  },

  bindEvents(projectId) {
    const backBtn = this.container.querySelector('#btn-back-home');
    backBtn.onclick = () => { window.location.hash = '#home'; };

    // ステータス切り替え（完了／進行中）
    const toggleStatusBtn = this.container.querySelector('#btn-toggle-project-status');
    if (toggleStatusBtn) {
      toggleStatusBtn.onclick = async () => {
        const isCompleted = this.currentProject.status === '完了';
        const newStatus = isCompleted ? '進行中' : '完了';

        if (!isCompleted) {
          const ok = await UI.confirm(
            'プロジェクトの完了',
            `「${this.currentProject.title}」を「完了」にしますか？\n（完了状態になると誤変更防止のためデータ登録・スキャンがロックされます。後からいつでも「進行中」に戻せます）`,
            '完了にする',
            'primary'
          );
          if (!ok) return;
        }

        try {
          await DB.updateProjectStatus(projectId, newStatus);
          UI.showToast(newStatus === '完了' ? 'プロジェクトを完了にしました（編集ロック）' : 'プロジェクトを進行中に戻しました（編集可能）', 'success');
          await this.render(this.container, projectId, this.currentTab);
        } catch (err) {
          UI.showToast(`ステータス変更エラー: ${err.message}`, 'error');
        }
      };
    }

    // 書式調整モーダル
    const editTemplateBtn = this.container.querySelector('#btn-edit-template');
    if (editTemplateBtn) {
      editTemplateBtn.onclick = () => {
        if (this.currentProject.status === '完了') {
          UI.showToast('完了したプロジェクトの書式設定は変更できません。「進行中に戻す」を行ってください。', 'warning');
          return;
        }
        this.openTemplateCalibrationModal(projectId);
      };
    }

    const deleteBtn = this.container.querySelector('#btn-delete-project');
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

    const tabBtns = this.container.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.onclick = async () => {
        const tab = btn.dataset.tab;
        this.currentTab = tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await this.updateHeaderStats();
        this.renderActiveTab();
      };
    });
  },

  async renderActiveTab() {
    const content = this.container.querySelector('#project-tab-content');
    if (!content) return;

    this.updateHeaderStats();

    content.innerHTML = '';
    if (this.currentTab === 'scan') {
      await ScanPage.render(content, this.currentProject);
    } else if (this.currentTab === 'list') {
      await ListPage.render(content, this.currentProject);
    } else if (this.currentTab === 'manual') {
      await ManualPage.render(content, this.currentProject);
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
    let currentTemplate = project.scanTemplate || defaultTemplate;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content modal-xl">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="brand-icon" style="width: 28px; height: 28px; font-size: 14px;">📐</span>
            <div>
              <h3 class="modal-title font-bold">受講確認票 書式・読取位置調整</h3>
              <div style="font-size: 0.8rem; color: var(--gray-500); font-weight: normal;">
                対象: ${project.title}
              </div>
            </div>
          </div>
          <button class="btn-ghost btn-sm btn-close-modal">✕</button>
        </div>
        <div class="modal-body" style="padding: 12px var(--spacing-lg); max-height: 78vh;">
          <div id="project-calib-container"></div>
        </div>
        <div class="modal-footer">
          <button id="btn-modal-cancel" class="btn btn-secondary">キャンセル</button>
          <button id="btn-modal-save" class="btn btn-primary">💾 この設定を保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const mount = modal.querySelector('#project-calib-container');
    const calibrator = new TemplateCalibrator(
      mount,
      currentTemplate,
      (t) => {
        currentTemplate = t;
      },
      {
        defaultResetTemplate: defaultTemplate,
        resetLabel: '🔄 共通既定書式に戻す',
        resetToastMsg: '共通既定書式の位置に復元しました'
      }
    );

    const closeModal = () => modal.remove();
    modal.querySelector('.btn-close-modal').onclick = closeModal;
    modal.querySelector('#btn-modal-cancel').onclick = closeModal;

    modal.querySelector('#btn-modal-save').onclick = async () => {
      const templateToSave = calibrator.getTemplate();
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
      }
    };
  }
};
