/**
 * ホーム画面コントローラー（プロジェクト一覧 & 新規作成ウィザード）
 */

import { DB } from '../db.js';
import { CsvUtil } from '../utils/csv.js';
import { UI } from '../utils/ui.js';
import { ScannerEngine } from '../scanner.js';
import { CheckboxEngine } from '../checkbox.js';
import { TemplateCalibrator } from '../components/calibrator.js';
import { APP_VERSION, SYSTEM_INFO } from '../version.js';

export const HomePage = {
  container: null,
  currentFilter: 'all', // 'all' | 'active' | 'completed'

  async render(container) {
    this.container = container;
    const currentYear = new Date().getFullYear();
    const projects = await DB.getProjects();
    const expiredProjects = await DB.getExpiredProjects(3);

    const activeProjects = projects.filter(p => p.status !== '完了');
    const completedProjects = projects.filter(p => p.status === '完了');

    let html = `
      <div class="view-container">
        <div class="home-hero">
          <div class="home-hero-text">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <h1>受講確認票 プロジェクト管理</h1>
              <span class="badge badge-info" style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; padding: 3px 8px;" title="システムバージョン">${APP_VERSION}</span>
            </div>
            <p>生徒の受講確認票・申込書のスキャン集計および提出管理を行います（完全ローカル動作・外部通信なし）</p>
          </div>
          <button id="btn-new-project" class="btn btn-primary btn-lg">
            <span>➕</span> 新規プロジェクト作成
          </button>
        </div>
    `;

    // 3年超過プロジェクトの警告バナー
    if (expiredProjects.length > 0) {
      html += `
        <div class="card" style="border-left: 4px solid var(--warning-solid); background: var(--warning-bg); margin-bottom: var(--spacing-lg);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div class="font-bold" style="color: var(--warning-text); font-size: 1rem;">⚠️ 保管期間（3年）を超過したプロジェクトがあります</div>
              <div style="color: var(--warning-text); font-size: 0.85rem; margin-top: 4px;">
                ${expiredProjects.map(p => `「${p.title}」`).join('、')} は作成から3年以上経過しています。設定画面からアーカイブ・整理を行えます。
              </div>
            </div>
            <button id="btn-go-settings-archive" class="btn btn-secondary btn-sm">設定で確認</button>
          </div>
        </div>
      `;
    }

    if (projects.length === 0) {
      html += `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h3 class="font-bold" style="font-size: 1.25rem; color: var(--gray-800); margin-bottom: 8px;">プロジェクトがまだありません</h3>
          <p style="margin-bottom: var(--spacing-lg);">右上の「新規プロジェクト作成」ボタンから、講習の受講確認票集計を開始しましょう。</p>
          <button id="btn-empty-new-project" class="btn btn-primary">
            <span>➕</span> 最初のプロジェクトを作成
          </button>
        </div>
      `;
    } else {
      // フィルターバー
      html += `
        <div class="home-filter-bar">
          <div class="home-filter-tabs">
            <button class="home-filter-tab ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">
              すべて <span class="badge badge-gray" style="font-size: 0.75rem; padding: 1px 6px;">${projects.length}</span>
            </button>
            <button class="home-filter-tab ${this.currentFilter === 'active' ? 'active' : ''}" data-filter="active">
              🚀 進行中 <span class="badge badge-info" style="font-size: 0.75rem; padding: 1px 6px;">${activeProjects.length}</span>
            </button>
            <button class="home-filter-tab ${this.currentFilter === 'completed' ? 'active' : ''}" data-filter="completed">
              ✅ 完了・終了 <span class="badge badge-gray" style="font-size: 0.75rem; padding: 1px 6px;">${completedProjects.length}</span>
            </button>
          </div>
        </div>
      `;

      // 1. 進行中プロジェクトセクション（上部にまとめて表示）
      if (this.currentFilter === 'all' || this.currentFilter === 'active') {
        html += `
          <section class="home-section">
            <div class="home-section-header">
              <div class="home-section-title">
                <span>🚀 進行中のプロジェクト</span>
                <span class="badge badge-success" style="font-size: 0.85rem;">${activeProjects.length} 件</span>
              </div>
            </div>
        `;

        if (activeProjects.length === 0) {
          html += `
            <div style="background: var(--gray-50); border: 1px dashed var(--gray-300); border-radius: var(--radius-md); padding: var(--spacing-lg); text-align: center; color: var(--gray-500); margin-top: var(--spacing-sm);">
              現在進行中のプロジェクトはありません。「新規プロジェクト作成」から開始できます。
            </div>
          `;
        } else {
          html += `<div class="project-grid">`;
          for (const p of activeProjects) {
            html += await this.renderProjectCardHtml(p);
          }
          html += `</div>`;
        }
        html += `</section>`;
      }

      // 2. 完了・終了したプロジェクトセクション（下部にまとめて表示）
      if (this.currentFilter === 'all' || this.currentFilter === 'completed') {
        if (completedProjects.length > 0 || this.currentFilter === 'completed') {
          html += `
            <section class="home-section">
              <div class="home-section-header">
                <div class="home-section-title">
                  <span>✅ 完了・終了したプロジェクト</span>
                  <span class="badge badge-gray" style="font-size: 0.85rem;">${completedProjects.length} 件</span>
                </div>
              </div>
          `;

          if (completedProjects.length === 0) {
            html += `
              <div style="background: var(--gray-50); border: 1px dashed var(--gray-300); border-radius: var(--radius-md); padding: var(--spacing-lg); text-align: center; color: var(--gray-500); margin-top: var(--spacing-sm);">
                完了・終了したプロジェクトはまだありません。
              </div>
            `;
          } else {
            html += `<div class="project-grid">`;
            for (const p of completedProjects) {
              html += await this.renderProjectCardHtml(p);
            }
            html += `</div>`;
          }
          html += `</section>`;
        }
      }
    }

    // システム情報・バージョンフッター
    html += `
      <footer class="home-system-footer">
        <div class="home-system-footer-left">
          <span class="font-bold" style="color: var(--gray-800);">受講確認票 処理システム</span>
          <span class="badge badge-info" style="font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700;">${APP_VERSION}</span>
          <span style="color: var(--gray-400);">•</span>
          <span style="color: var(--success-text); font-weight: 600;">🔒 完全ローカル動作（外部通信ゼロ）</span>
          <span style="color: var(--gray-400);">•</span>
          <span>データ保持: 3年間</span>
        </div>
        <div class="home-system-footer-right">
          <button id="btn-show-version-info" class="btn btn-ghost btn-sm" style="font-size: 0.8rem; color: var(--primary-600); padding: 2px 8px;">
            <span>ℹ️</span> システム情報・バージョン詳細
          </button>
        </div>
      </footer>
    `;

    html += `</div>`;
    this.container.innerHTML = html;

    this.bindEvents(currentYear);
  },

  /**
   * プロジェクトカードのHTMLを生成
   */
  async renderProjectCardHtml(p) {
    const stats = await DB.getProjectStats(p.id);
    const percent = stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0;
    const isExpired = (new Date() - new Date(p.createdAt)) / (1000 * 60 * 60 * 24 * 365.25) >= 3;
    const isCompleted = p.status === '完了';

    return `
      <div class="project-card ${isCompleted ? 'is-completed' : ''}" data-project-id="${p.id}">
        <div>
          <div class="project-card-top">
            <div class="project-meta-badges">
              <span class="badge badge-info">${p.year}年度</span>
              <span class="badge badge-purple">${p.grade}年生</span>
              <span class="badge badge-success">${p.sessionName}講習</span>
              ${isCompleted
                ? '<span class="badge badge-gray" style="font-weight: 700;">🏁 完了</span>'
                : '<span class="badge badge-success" style="font-weight: 700; background: #e8f5e9; color: #2e7d32;">🟢 進行中</span>'
              }
              ${isExpired ? '<span class="badge badge-warning">3年経過</span>' : ''}
            </div>
            <div>
              ${isCompleted
                ? `<button class="project-status-toggle-btn btn-to-active" data-id="${p.id}" data-action="reopen" title="進行中に戻す">🔄 進行中に戻す</button>`
                : `<button class="project-status-toggle-btn btn-to-complete" data-id="${p.id}" data-action="complete" title="完了にする">🏁 完了にする</button>`
              }
            </div>
          </div>
          <h3 class="project-title">${p.title}</h3>
          <div style="font-size: 0.8rem; color: var(--gray-500); margin-top: 4px;">
            作成日: ${UI.formatDate(p.createdAt)}
            ${p.completedAt ? ` | 完了日: ${UI.formatDate(p.completedAt)}` : ''}
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
            <span class="font-medium text-muted">提出進捗</span>
            <span class="font-bold" style="color: var(--primary-600);">${stats.submitted} / ${stats.total}名 (${percent}%)</span>
          </div>
          <div style="height: 6px; background: var(--gray-200); border-radius: 999px; overflow: hidden; margin-bottom: 12px;">
            <div style="width: ${percent}%; height: 100%; background: ${isCompleted ? 'var(--gray-500)' : 'linear-gradient(90deg, var(--primary-500), var(--secondary))'};"></div>
          </div>

          <div class="project-stats">
            <div class="stat-item">
              <div class="stat-num" style="color: var(--success-solid);">${stats.noChange}</div>
              <div class="stat-label">変更なし</div>
            </div>
            <div class="stat-item">
              <div class="stat-num" style="color: var(--secondary);">${stats.hasChange}</div>
              <div class="stat-label">変更あり</div>
            </div>
            <div class="stat-item">
              <div class="stat-num" style="color: var(--danger-solid);">${stats.unsubmitted}</div>
              <div class="stat-label">未提出</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  bindEvents(currentYear) {
    const newBtns = this.container.querySelectorAll('#btn-new-project, #btn-empty-new-project');
    newBtns.forEach(btn => btn?.addEventListener('click', () => this.openNewProjectWizard(currentYear)));

    const archiveBtn = this.container.querySelector('#btn-go-settings-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', () => {
        window.location.hash = '#settings';
      });
    }

    // フィルタータブ切り替え
    const filterTabs = this.container.querySelectorAll('.home-filter-tab');
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentFilter = tab.dataset.filter;
        this.render(this.container);
      });
    });

    // ステータス変更トグルボタン
    const statusBtns = this.container.querySelectorAll('.project-status-toggle-btn');
    statusBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // カードクリックのページ遷移を防止
        const projectId = btn.dataset.id;
        const action = btn.dataset.action;
        const newStatus = action === 'complete' ? '完了' : '進行中';

        if (action === 'complete') {
          const ok = await UI.confirm(
            'プロジェクトの完了',
            'このプロジェクトを「完了」にしますか？（後からいつでも「進行中」に戻せます）',
            '完了にする',
            'primary'
          );
          if (!ok) return;
        }

        try {
          await DB.updateProjectStatus(projectId, newStatus);
          UI.showToast(newStatus === '完了' ? 'プロジェクトを完了にしました' : 'プロジェクトを進行中に戻しました', 'success');
          await this.render(this.container);
        } catch (err) {
          UI.showToast(`ステータス変更エラー: ${err.message}`, 'error');
        }
      });
    });

    // カードクリックでプロジェクト画面へ遷移
    const cards = this.container.querySelectorAll('.project-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const projectId = card.dataset.projectId;
        if (projectId) {
          window.location.hash = `#project/${projectId}`;
        }
      });
    });

    // システム情報・バージョン詳細モーダル
    const versionBtn = this.container.querySelector('#btn-show-version-info');
    if (versionBtn) {
      versionBtn.addEventListener('click', () => this.openSystemInfoModal());
    }
  },

  /**
   * システム情報・バージョン詳細モーダル
   */
  openSystemInfoModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 620px;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.25rem;">📑</span>
            <h3 class="modal-title">システム情報・バージョン詳細</h3>
          </div>
          <button class="modal-close" id="btn-close-system-info">✕</button>
        </div>
        <div class="modal-body" style="padding: var(--spacing-lg);">
          <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--spacing-md); border-bottom: 1px solid var(--gray-200); margin-bottom: var(--spacing-md);">
            <div>
              <div style="font-size: 1.2rem; font-weight: 800; color: var(--gray-900);">${SYSTEM_INFO.name}</div>
              <div style="color: var(--gray-500); font-size: 0.85rem; margin-top: 2px;">ビルド日付: ${SYSTEM_INFO.buildDate}</div>
            </div>
            <span class="badge badge-info" style="font-family: var(--font-mono); font-size: 1rem; font-weight: 700; padding: 4px 12px;">${SYSTEM_INFO.version}</span>
          </div>

          <div style="display: grid; gap: 12px; margin-bottom: var(--spacing-lg);">
            <div style="display: flex; justify-content: space-between; font-size: 0.88rem; padding: 8px 12px; background: var(--gray-50); border-radius: var(--radius-sm);">
              <span style="color: var(--gray-600); font-weight: 600;">🔒 セキュリティ・通信方針</span>
              <span style="color: var(--success-text); font-weight: 700;">完全ローカル動作（外部通信ゼロ）</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.88rem; padding: 8px 12px; background: var(--gray-50); border-radius: var(--radius-sm);">
              <span style="color: var(--gray-600); font-weight: 600;">💾 データ保存先</span>
              <span style="color: var(--gray-800);">${SYSTEM_INFO.storageType}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.88rem; padding: 8px 12px; background: var(--gray-50); border-radius: var(--radius-sm);">
              <span style="color: var(--gray-600); font-weight: 600;">⏱️ 保管期間ポリシー</span>
              <span style="color: var(--gray-800);">${SYSTEM_INFO.retentionPeriod}</span>
            </div>
          </div>

          <div style="margin-bottom: var(--spacing-lg);">
            <div style="font-weight: 700; font-size: 0.92rem; color: var(--gray-800); margin-bottom: 8px;">✨ 主要機能・仕様</div>
            <ul style="padding-left: 20px; font-size: 0.85rem; color: var(--gray-600); line-height: 1.7;">
              ${SYSTEM_INFO.features.map(f => `<li>${f}</li>`).join('')}
            </ul>
          </div>

          <div>
            <div style="font-weight: 700; font-size: 0.92rem; color: var(--gray-800); margin-bottom: 8px;">📚 組み込みライブラリ（完全オフライン配置）</div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 0.82rem;">
              <span class="badge badge-gray">Dexie.js (IndexedDBラッパー)</span>
              <span class="badge badge-gray">SheetJS xlsx (Excel/CSV)</span>
              <span class="badge badge-gray">PDF.js (スキャンPDF描画)</span>
              <span class="badge badge-gray">ZXing (CODE 39 バーコード読取)</span>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end;">
          <button id="btn-ok-system-info" class="btn btn-primary">閉じる</button>
        </div>
      </div>
    `;

    const close = () => {
      modal.remove();
    };

    modal.querySelector('#btn-close-system-info').onclick = close;
    modal.querySelector('#btn-ok-system-info').onclick = close;
    modal.onclick = (e) => {
      if (e.target === modal) close();
    };

    document.body.appendChild(modal);
  },

  /**
   * 新規プロジェクト作成ウィザードモーダル
   */
  async openNewProjectWizard(currentYear) {
    let wizardStep = 1;
    let selectedYear = currentYear;
    let selectedGrade = '6';
    let selectedSession = '夏期';
    let parsedStudents = [];

    const settings = await DB.getSettings();
    const defaultTemplate = settings.defaultScanTemplate || CheckboxEngine.getDefaultTemplate();
    let customTemplate = JSON.parse(JSON.stringify(defaultTemplate));

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';

    const renderStep = () => {
      let bodyContent = '';

      if (wizardStep === 1) {
        const yearOffsets = [-4, -3, -2, -1, 0, 1, 2, 3];
        const yearOptionsHtml = yearOffsets.map(offset => {
          const y = currentYear + offset;
          const label = `${y} 年度${offset === 0 ? '（今年度）' : ''}`;
          return `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${label}</option>`;
        }).join('');

        bodyContent = `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">実施年度 <span class="required">*</span></label>
              <select id="wiz-year" class="form-control font-bold">
                ${yearOptionsHtml}
              </select>
              <small class="text-muted">※ 現在の年度（${currentYear}年度）が初期選択されています（変更可能）</small>
            </div>
            <div class="form-group">
              <label class="form-label">学年 <span class="required">*</span></label>
              <select id="wiz-grade" class="form-control font-bold">
                <option value="6" ${selectedGrade === '6' ? 'selected' : ''}>6 年生</option>
                <option value="5" ${selectedGrade === '5' ? 'selected' : ''}>5 年生</option>
                <option value="4" ${selectedGrade === '4' ? 'selected' : ''}>4 年生</option>
                <option value="3" ${selectedGrade === '3' ? 'selected' : ''}>3 年生</option>
                <option value="2" ${selectedGrade === '2' ? 'selected' : ''}>2 年生</option>
                <option value="1" ${selectedGrade === '1' ? 'selected' : ''}>1 年生</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">講習名 <span class="required">*</span></label>
              <select id="wiz-session" class="form-control font-bold">
                <option value="夏期" ${selectedSession === '夏期' ? 'selected' : ''}>夏期講習</option>
                <option value="春期" ${selectedSession === '春期' ? 'selected' : ''}>春期講習</option>
                <option value="冬期" ${selectedSession === '冬期' ? 'selected' : ''}>冬期講習</option>
              </select>
            </div>
          </div>
        `;
      } else if (wizardStep === 2) {
        bodyContent = `
          <div style="margin-bottom: var(--spacing-md); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <p style="font-size: 0.92rem; color: var(--gray-700);">生徒リストのCSVファイルを読み込んでください。</p>
              <p style="font-size: 0.8rem; color: var(--gray-500);">（先頭4列: 日能研番号, 氏名, 氏名カナ, クラス。右側に空列があっても自動許容されます）</p>
            </div>
            <button type="button" id="btn-dl-template" class="btn btn-secondary btn-sm">
              📥 テンプレートCSV取得
            </button>
          </div>

          <div id="csv-dropzone" class="dropzone">
            <div class="dropzone-icon">📄</div>
            <div class="dropzone-text">CSVファイルをドラッグ＆ドロップ</div>
            <div class="dropzone-subtext">またはここをクリックしてファイルを選択</div>
            <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display: none;">
          </div>

          <div id="csv-preview-container" style="margin-top: var(--spacing-md); max-height: 200px; overflow-y: auto; ${parsedStudents.length === 0 ? 'display:none;' : ''}">
            <div class="font-bold" style="font-size: 0.88rem; margin-bottom: 6px; color: var(--success-text);">
              ✅ ${parsedStudents.length} 名の生徒データを読み込みました
            </div>
            <table class="table" style="font-size: 0.82rem;">
              <thead>
                <tr>
                  <th>日能研番号</th>
                  <th>氏名</th>
                  <th>氏名カナ</th>
                  <th>クラス</th>
                  <th>科目</th>
                </tr>
              </thead>
              <tbody>
                ${parsedStudents.slice(0, 5).map(s => `
                  <tr>
                    <td class="text-mono font-bold">${s.nichinokenId}</td>
                    <td>${s.name}</td>
                    <td class="text-muted">${s.nameKana}</td>
                    <td><span class="badge badge-info">${s.className}</span></td>
                    <td><span class="badge badge-purple">${s.course || '4科'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            ${parsedStudents.length > 5 ? `<div style="text-align: center; font-size: 0.78rem; color: var(--gray-500); padding: 4px;">他 ${parsedStudents.length - 5} 名...</div>` : ''}
          </div>
        `;
      } else if (wizardStep === 3) {
        bodyContent = `
          <div class="template-setup-container">
            <div style="display: flex; align-items: center; justify-content: space-between; background: var(--primary-50); border: 1px solid var(--primary-200); border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: 12px;">
              <div>
                <span class="badge badge-info">${selectedYear}年度</span>
                <span class="badge badge-purple">${selectedGrade}年生</span>
                <span class="badge badge-success">${selectedSession}講習</span>
                <span style="font-size: 0.95rem; font-weight: 800; color: var(--primary-900); margin-left: 6px;">
                  受講確認票の書式・スキャン読取位置設定
                </span>
              </div>
              <div style="font-size: 0.85rem; color: var(--primary-700);">
                登録生徒: <span class="text-mono font-bold">${parsedStudents.length}</span> 名
              </div>
            </div>

            <div id="wizard-calib-container"></div>
          </div>
        `;
      }

      modal.innerHTML = `
        <div class="modal-content ${wizardStep === 3 ? 'modal-2xl' : ''}">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="brand-icon" style="width: 28px; height: 28px; font-size: 14px;">➕</span>
              <h3 class="modal-title font-bold">新規プロジェクト作成 (Step ${wizardStep} / 3: ${wizardStep === 1 ? '基本情報' : wizardStep === 2 ? '生徒リスト' : '受講票書式設定'})</h3>
            </div>
            <div class="modal-header-actions">
              ${wizardStep === 3 ? `
                <button class="btn-modal-maximize" id="btn-wiz-maximize" title="全画面最大化 / 元に戻す">⛶</button>
              ` : ''}
              <button class="btn-ghost btn-sm btn-close-modal" title="閉じる">✕</button>
            </div>
          </div>
          <div class="modal-body" style="${wizardStep === 3 ? 'padding: 10px var(--spacing-lg); max-height: 86vh;' : ''}">
            ${bodyContent}
          </div>
          <div class="modal-footer">
            ${wizardStep > 1 ? '<button id="btn-wiz-prev" class="btn btn-secondary">戻る</button>' : ''}
            <button id="btn-wiz-cancel" class="btn btn-secondary">キャンセル</button>
            <button id="btn-wiz-next" class="btn btn-primary">${wizardStep === 3 ? 'この書式設定でプロジェクト作成' : '次へ進む'}</button>
          </div>
        </div>
      `;

      // モーダル内イベントバインド
      modal.querySelector('.btn-close-modal').onclick = () => modal.remove();
      modal.querySelector('#btn-wiz-cancel').onclick = () => modal.remove();

      // 最大化トグル
      const maxBtn = modal.querySelector('#btn-wiz-maximize');
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

      // Step 3 のキャリブレーター初期化
      let calibratorInstance = null;
      if (wizardStep === 3) {
        const mount = modal.querySelector('#wizard-calib-container');
        if (mount) {
          calibratorInstance = new TemplateCalibrator(
            mount,
            customTemplate,
            (t) => {
              customTemplate = t;
            },
            {
              defaultResetTemplate: defaultTemplate,
              resetLabel: '🔄 共通既定書式に戻す',
              resetToastMsg: '共通既定書式の位置に復元しました'
            }
          );
        }
      }

      const prevBtn = modal.querySelector('#btn-wiz-prev');
      if (prevBtn) {
        prevBtn.onclick = () => {
          if (calibratorInstance) {
            customTemplate = calibratorInstance.getTemplate();
          }
          wizardStep--;
          renderStep();
        };
      }

      const nextBtn = modal.querySelector('#btn-wiz-next');
      nextBtn.onclick = async () => {
        if (wizardStep === 1) {
          const yearEl = modal.querySelector('#wiz-year');
          const gradeEl = modal.querySelector('#wiz-grade');
          const sessionEl = modal.querySelector('#wiz-session');
          if (yearEl) selectedYear = parseInt(yearEl.value, 10);
          if (gradeEl) selectedGrade = gradeEl.value;
          if (sessionEl) selectedSession = sessionEl.value;

          wizardStep = 2;
          renderStep();
        } else if (wizardStep === 2) {
          if (parsedStudents.length === 0) {
            UI.showToast('生徒CSVファイルを読み込んでください', 'warning');
            return;
          }
          wizardStep = 3;
          renderStep();
        } else if (wizardStep === 3) {
          if (calibratorInstance) {
            // バーコードが読み取れているかチェック
            if (!calibratorInstance.isBarcodeDetected()) {
              UI.showToast('バーコードが読み取れていません。バーコードが鮮明に写っている受講票ファイルを選択するか、ファイルをご確認ください。', 'error');
              return;
            }
            customTemplate = calibratorInstance.getTemplate();
          }
          // 作成実行
          try {
            const project = await DB.createProject({
              year: selectedYear,
              grade: selectedGrade,
              sessionName: selectedSession,
              students: parsedStudents,
              scanTemplate: customTemplate
            });

            UI.showToast(`「${project.title}」を作成しました`, 'success');
            modal.remove();
            window.location.hash = `#project/${project.id}`;
          } catch (err) {
            UI.showToast(`プロジェクト作成に失敗しました: ${err.message}`, 'error');
          }
        }
      };

      // Step 2 のイベント
      if (wizardStep === 2) {
        const dlBtn = modal.querySelector('#btn-dl-template');
        if (dlBtn) dlBtn.onclick = () => CsvUtil.downloadTemplateCsv();

        const dropzone = modal.querySelector('#csv-dropzone');
        const fileInput = modal.querySelector('#csv-file-input');

        dropzone.onclick = () => fileInput.click();

        dropzone.ondragover = (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        };
        dropzone.ondragleave = () => dropzone.classList.remove('dragover');
        dropzone.ondrop = (e) => {
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

        const handleCsvFile = (file) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const text = e.target.result;
            const res = CsvUtil.parseStudentsCsv(text);
            if (res.students.length === 0) {
              UI.showToast('有効な生徒データが見つかりませんでした', 'error');
              return;
            }
            parsedStudents = res.students;
            UI.showToast(`${res.students.length} 名の生徒データを読み込みました`, 'success');
            renderStep();
          };
          reader.readAsText(file, 'UTF-8');
        };
      }
    };

    document.body.appendChild(modal);
    renderStep();
  }
};
