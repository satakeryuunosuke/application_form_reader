/**
 * プロジェクト画面コントローラー（ヘッダー・タブ管理）
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { CsvUtil } from '../utils/csv.js';
import { Validator } from '../utils/validator.js';
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
            <button id="btn-manage-students" class="btn btn-secondary btn-sm" title="${isCompleted ? '完了プロジェクトのため生徒管理は不可' : '生徒の追加・削除（個別追加 / CSV追加取込 / 登録解除）'}" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
              👥 生徒管理
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

    // 生徒管理モーダル
    const manageStudentsBtn = this.container.querySelector('#btn-manage-students');
    if (manageStudentsBtn) {
      manageStudentsBtn.onclick = () => {
        if (this.currentProject.status === '完了') {
          UI.showToast('完了したプロジェクトの生徒データは変更できません。「進行中に戻す」を行ってください。', 'warning');
          return;
        }
        this.openStudentManagementModal(projectId);
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
      <div class="modal-content modal-2xl">
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
          <div class="modal-header-actions">
            <button class="btn-modal-maximize" id="btn-proj-calib-maximize" title="全画面最大化 / 元に戻す">⛶</button>
            <button class="btn-ghost btn-sm btn-close-modal" title="閉じる">✕</button>
          </div>
        </div>
        <div class="modal-body" style="padding: 10px var(--spacing-lg); max-height: 86vh;">
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
      if (!calibrator.isBarcodeDetected()) {
        UI.showToast('バーコードが読み取れていません。バーコードが鮮明に写っている受講票ファイルを選択するか、ファイルをご確認ください。', 'error');
        return;
      }
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
  },

  /**
   * 生徒管理モーダル（生徒の追加・削除 / 緊急・メンテナンス用）
   */
  async openStudentManagementModal(projectId) {
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
          (s.className && s.className.toLowerCase().includes(q))
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
                  対象: ${project.title} | 現在の登録生徒数: <span class="text-mono font-bold" id="modal-student-count">${students.length}</span> 名
                </div>
              </div>
            </div>
            <button class="btn-ghost btn-sm btn-close-modal">✕</button>
          </div>

          <!-- モーダル内タブ切り替え -->
          <div style="display: flex; border-bottom: 1px solid var(--gray-200); padding: 0 var(--spacing-lg); background: var(--gray-50);">
            <button id="modal-tab-list" class="btn btn-ghost" style="border-radius: 0; padding: 10px 16px; font-weight: 700; ${activeModalTab === 'list' ? 'border-bottom: 3px solid var(--primary-600); color: var(--primary-600);' : 'color: var(--gray-600);'}">
              📋 登録生徒一覧・削除 (${students.length}名)
            </button>
            <button id="modal-tab-add" class="btn btn-ghost" style="border-radius: 0; padding: 10px 16px; font-weight: 700; ${activeModalTab === 'add' ? 'border-bottom: 3px solid var(--primary-600); color: var(--primary-600);' : 'color: var(--gray-600);'}">
              ➕ 生徒の追加（手動 / CSV）
            </button>
          </div>

          <div class="modal-body" style="flex: 1; overflow-y: auto; padding: var(--spacing-lg);">
            ${activeModalTab === 'list' ? `
              <!-- 1. 生徒一覧 & 削除エリア -->
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-md); gap: 12px; flex-wrap: wrap;">
                <div style="display: flex; gap: 8px; flex: 1; max-width: 500px;">
                  <input type="text" id="modal-inp-search" class="form-control" placeholder="🔍 日能研番号・氏名・カナで絞り込み..." value="${studentSearchQuery}">
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
                      <th style="width: 120px;">提出状況</th>
                      <th style="width: 80px; text-align: center;">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredStudents.length === 0 ? `
                      <tr>
                        <td colspan="6" style="text-align: center; color: var(--gray-500); padding: 30px;">
                          該当する生徒が見つかりません
                        </td>
                      </tr>
                    ` : filteredStudents.map(s => {
                      const isSubmitted = s.status === '承認済';
                      const badgeClass = isSubmitted ? 'badge-success' : 'badge-danger';
                      return `
                        <tr>
                          <td class="text-mono font-bold">${s.nichinokenId}</td>
                          <td class="font-bold">${s.name}</td>
                          <td class="text-muted" style="font-size: 0.8rem;">${s.nameKana || '-'}</td>
                          <td><span class="badge badge-info">${s.className}</span></td>
                          <td>
                            <span class="badge ${badgeClass}">${s.status}</span>
                            ${s.hasChange ? '<span class="badge badge-purple" style="font-size: 0.7rem; margin-left: 2px;">変更有</span>' : ''}
                          </td>
                          <td style="text-align: center;">
                            <button class="btn btn-ghost btn-sm btn-delete-student" data-id="${s.studentId}" data-name="${s.name}" data-nid="${s.nichinokenId}" data-status="${s.status}" data-image="${s.scanImageBlob ? '1' : '0'}" style="color: var(--danger-solid); padding: 2px 8px;" title="生徒を削除">
                              🗑️ 削除
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

                    <div class="form-group" style="margin-bottom: var(--spacing-md);">
                      <label class="form-label" style="font-size: 0.85rem;">所属クラス <span class="required">*</span></label>
                      <input type="text" id="add-inp-class" class="form-control font-bold" placeholder="例: W1, M1, A1 など" list="exist-classes-list" required>
                      <datalist id="exist-classes-list">
                        ${classes.map(c => `<option value="${c}">`).join('')}
                      </datalist>
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

        // 削除ボタン
        modal.querySelectorAll('.btn-delete-student').forEach(btn => {
          btn.onclick = async () => {
            const stuId = btn.dataset.id;
            const stuName = btn.dataset.name;
            const stuNid = btn.dataset.nid;
            const stuStatus = btn.dataset.status;
            const hasImage = btn.dataset.image === '1';

            let confirmTitle = '生徒の削除';
            let confirmMsg = `「${stuName}（${stuNid}）」をプロジェクトから削除しますか？`;

            if (stuStatus === '承認済' || hasImage) {
              confirmTitle = '⚠️ 提出済みデータの削除確認';
              confirmMsg = `「${stuName}（${stuNid}）」にはすでに【提出・スキャン済みデータ（画像や受付履歴）】が存在します。\n\n削除を実行すると、この生徒の提出データ・履歴もすべて完全に破棄されます。\n本当に削除してよろしいですか？`;
            }

            const ok = await UI.confirm(confirmTitle, confirmMsg, '削除する', 'danger');
            if (!ok) return;

            try {
              await DB.deleteStudentFromProject(projectId, stuId);
              UI.showToast(`生徒「${stuName}」を削除しました`, 'info');
              await this.updateHeaderStats();
              this.renderActiveTab();
              await renderModalContent();
            } catch (err) {
              UI.showToast(`削除エラー: ${err.message}`, 'error');
            }
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

            try {
              await DB.addStudentToProject(projectId, { nichinokenId, name, nameKana, className });
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
            if (resultDiv) {
              resultDiv.style.display = 'block';
              resultDiv.style.background = res.addedCount > 0 ? 'var(--success-bg)' : 'var(--warning-bg)';
              resultDiv.style.color = res.addedCount > 0 ? 'var(--success-text)' : 'var(--warning-text)';
              resultDiv.style.border = `1px solid ${res.addedCount > 0 ? 'var(--success-solid)' : 'var(--warning-solid)'}`;
              resultDiv.innerHTML = `
                <div class="font-bold">処理完了: ${res.addedCount} 名追加、${res.skippedCount} 件スキップ</div>
                ${res.skippedCount > 0 ? `<div style="font-size: 0.78rem; margin-top: 4px;">スキップ理由: 既に登録済み番号またはフォーマット不備</div>` : ''}
              `;
            }
            UI.showToast(`CSVから ${res.addedCount} 名の生徒を追加しました`, 'success');
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

