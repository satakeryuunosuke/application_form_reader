/**
 * 提出状況一覧タブ コントローラー
 */

import { DB } from '../db.js';
import { CsvUtil } from '../utils/csv.js';
import { UI } from '../utils/ui.js';
import { ProjectPage } from './project.js';

export const ListPage = {
  container: null,
  project: null,
  allStudentsWithSubmissions: [],
  filteredList: [],
  currentStatusFilter: 'all',
  currentPrevClassFilter: 'all',
  currentPostClassFilter: 'all',
  searchQuery: '',

  async render(container, project) {
    this.container = container;
    this.project = project;

    // プロジェクトヘッダー統計およびタブバッジを同期
    if (typeof ProjectPage.updateHeaderStats === 'function') {
      ProjectPage.updateHeaderStats();
    }

    this.allStudentsWithSubmissions = await DB.getProjectStudentsWithSubmissions(project.id);
    const classes = await DB.getProjectClasses(project.id);
    const stats = await DB.getProjectStats(project.id);

    // 変更前クラス一覧
    const prevClasses = classes;

    // 変更後クラス一覧の構築（プロジェクトクラス ＋ 実際に登録された受講クラスの和集合）
    const postClassSet = new Set(classes);
    for (const item of this.allStudentsWithSubmissions) {
      if (item.enrollmentClass && item.enrollmentClass !== '-' && item.enrollmentClass !== '非受講') {
        postClassSet.add(item.enrollmentClass);
      }
    }
    const postClasses = Array.from(postClassSet).sort();

    this.container.innerHTML = `
      <div class="view-container">
        <!-- サマリーカード（クリックでフィルタ連動） -->
        <div class="summary-cards-grid">
          <div class="summary-card ${this.currentStatusFilter === 'all' ? 'active-filter' : ''}" data-filter="all" style="cursor: pointer;">
            <div>
              <div class="sum-label">全登録生徒</div>
              <div class="sum-count">${stats.total}</div>
            </div>
            <span style="font-size: 1.5rem;">👥</span>
          </div>

          <div class="summary-card ${this.currentStatusFilter === 'no-change' ? 'active-filter' : ''}" data-filter="no-change" style="cursor: pointer;">
            <div>
              <div class="sum-label" style="color: var(--success-text);">変更なし</div>
              <div class="sum-count" style="color: var(--success-solid);">${stats.noChange}</div>
            </div>
            <span style="font-size: 1.5rem;">✅</span>
          </div>

          <div class="summary-card ${this.currentStatusFilter === 'has-change' ? 'active-filter' : ''}" data-filter="has-change" style="cursor: pointer;">
            <div>
              <div class="sum-label" style="color: var(--info-text);">変更あり</div>
              <div class="sum-count" style="color: var(--secondary);">${stats.hasChange}</div>
            </div>
            <span style="font-size: 1.5rem;">🔄</span>
          </div>

          <div class="summary-card ${this.currentStatusFilter === 'not-enrolled' ? 'active-filter' : ''}" data-filter="not-enrolled" style="cursor: pointer;">
            <div>
              <div class="sum-label" style="color: var(--purple-text);">非受講</div>
              <div class="sum-count" style="color: var(--purple-solid);">${stats.notEnrolled}</div>
            </div>
            <span style="font-size: 1.5rem;">🚫</span>
          </div>

          <div class="summary-card ${this.currentStatusFilter === 'unsubmitted' ? 'active-filter' : ''}" data-filter="unsubmitted" style="cursor: pointer;">
            <div>
              <div class="sum-label" style="color: var(--danger-text);">未提出</div>
              <div class="sum-count" style="color: var(--danger-solid);">${stats.unsubmitted}</div>
            </div>
            <span style="font-size: 1.5rem;">⏳</span>
          </div>
        </div>

        <!-- フィルタバー & エクスポート -->
        <div class="list-filter-bar">
          <div class="filter-group-left">
            <div class="search-input-wrap">
              <input type="text" id="inp-search" class="form-control" placeholder="🔍 氏名・カナ・日能研番号で検索..." value="${this.searchQuery}">
            </div>

            <select id="sel-filter-status" class="form-control" style="width: 145px;">
              <option value="all" ${this.currentStatusFilter === 'all' ? 'selected' : ''}>ステータス: すべて</option>
              <option value="submitted" ${this.currentStatusFilter === 'submitted' ? 'selected' : ''}>提出済のみ</option>
              <option value="no-change" ${this.currentStatusFilter === 'no-change' ? 'selected' : ''}>変更なし</option>
              <option value="has-change" ${this.currentStatusFilter === 'has-change' ? 'selected' : ''}>変更あり</option>
              <option value="not-enrolled" ${this.currentStatusFilter === 'not-enrolled' ? 'selected' : ''}>非受講</option>
              <option value="unsubmitted" ${this.currentStatusFilter === 'unsubmitted' ? 'selected' : ''}>未提出のみ</option>
            </select>

            <select id="sel-filter-prev-class" class="form-control" style="width: 145px; ${this.currentPrevClassFilter !== 'all' ? 'border-color: var(--primary-600); font-weight: bold; background: var(--primary-50);' : ''}" title="変更前の所属クラスで絞り込み">
              <option value="all" ${this.currentPrevClassFilter === 'all' ? 'selected' : ''}>変更前: すべて</option>
              ${prevClasses.map(c => `<option value="${c}" ${this.currentPrevClassFilter === c ? 'selected' : ''}>${c} (変更前)</option>`).join('')}
            </select>

            <select id="sel-filter-post-class" class="form-control" style="width: 155px; ${this.currentPostClassFilter !== 'all' ? 'border-color: var(--primary-600); font-weight: bold; background: var(--primary-50);' : ''}" title="変更後の確定受講クラスで絞り込み">
              <option value="all" ${this.currentPostClassFilter === 'all' ? 'selected' : ''}>変更後: すべて</option>
              ${postClasses.map(c => `<option value="${c}" ${this.currentPostClassFilter === c ? 'selected' : ''}>${c} (変更後)</option>`).join('')}
              <option value="非受講" ${this.currentPostClassFilter === '非受講' ? 'selected' : ''}>🚫 非受講</option>
              <option value="unsubmitted" ${this.currentPostClassFilter === 'unsubmitted' ? 'selected' : ''}>⏳ 未定（未提出）</option>
            </select>

            <button id="btn-reset-filters" class="btn btn-ghost btn-sm" title="フィルタをリセット">リセット</button>
          </div>

          <div style="display: flex; gap: 8px;">
            <button id="btn-export-csv" class="btn btn-secondary btn-sm">
              📄 CSV出力
            </button>
            <button id="btn-export-excel" class="btn btn-primary btn-sm">
              📊 Excel出力 (.xlsx)
            </button>
          </div>
        </div>

        <!-- テーブル表示エリア -->
        <div id="table-render-area"></div>
      </div>
    `;

    this.bindEvents();
    this.applyFiltersAndRenderTable();
  },

  bindEvents() {
    const searchInput = this.container.querySelector('#inp-search');
    searchInput.oninput = () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.applyFiltersAndRenderTable();
    };

    const statusSelect = this.container.querySelector('#sel-filter-status');
    statusSelect.onchange = () => {
      this.currentStatusFilter = statusSelect.value;
      this.updateSummaryCardActive();
      this.applyFiltersAndRenderTable();
    };

    const prevClassSelect = this.container.querySelector('#sel-filter-prev-class');
    prevClassSelect.onchange = () => {
      this.currentPrevClassFilter = prevClassSelect.value;
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    const postClassSelect = this.container.querySelector('#sel-filter-post-class');
    postClassSelect.onchange = () => {
      this.currentPostClassFilter = postClassSelect.value;
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    const resetBtn = this.container.querySelector('#btn-reset-filters');
    resetBtn.onclick = () => {
      this.searchQuery = '';
      this.currentStatusFilter = 'all';
      this.currentPrevClassFilter = 'all';
      this.currentPostClassFilter = 'all';
      searchInput.value = '';
      statusSelect.value = 'all';
      prevClassSelect.value = 'all';
      postClassSelect.value = 'all';
      this.updateSummaryCardActive();
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    // サマリーカードクリックでのフィルタ切り替え
    const sumCards = this.container.querySelectorAll('.summary-card');
    sumCards.forEach(card => {
      card.onclick = () => {
        const filter = card.dataset.filter;
        this.currentStatusFilter = filter;
        statusSelect.value = filter;
        this.updateSummaryCardActive();
        this.applyFiltersAndRenderTable();
      };
    });

    // 出力
    this.container.querySelector('#btn-export-csv').onclick = () => {
      const fileName = `${this.project.title}_提出集計_${new Date().toISOString().slice(0, 10)}.csv`;
      CsvUtil.exportSubmissionsCsv(this.filteredList, fileName);
      UI.showToast(`CSVファイルを出力しました (${this.filteredList.length} 件)`, 'success');
    };

    this.container.querySelector('#btn-export-excel').onclick = () => {
      const fileName = `${this.project.title}_提出集計_${new Date().toISOString().slice(0, 10)}.xlsx`;
      CsvUtil.exportSubmissionsExcel(this.filteredList, fileName);
      UI.showToast(`Excelファイルを出力しました (${this.filteredList.length} 件)`, 'success');
    };
  },

  updateClassFilterStyles() {
    const prevClassSelect = this.container?.querySelector('#sel-filter-prev-class');
    if (prevClassSelect) {
      if (this.currentPrevClassFilter !== 'all') {
        prevClassSelect.style.borderColor = 'var(--primary-600)';
        prevClassSelect.style.fontWeight = 'bold';
        prevClassSelect.style.background = 'var(--primary-50)';
      } else {
        prevClassSelect.style.borderColor = '';
        prevClassSelect.style.fontWeight = '';
        prevClassSelect.style.background = '';
      }
    }

    const postClassSelect = this.container?.querySelector('#sel-filter-post-class');
    if (postClassSelect) {
      if (this.currentPostClassFilter !== 'all') {
        postClassSelect.style.borderColor = 'var(--primary-600)';
        postClassSelect.style.fontWeight = 'bold';
        postClassSelect.style.background = 'var(--primary-50)';
      } else {
        postClassSelect.style.borderColor = '';
        postClassSelect.style.fontWeight = '';
        postClassSelect.style.background = '';
      }
    }
  },

  updateSummaryCardActive() {
    const sumCards = this.container.querySelectorAll('.summary-card');
    sumCards.forEach(card => {
      if (card.dataset.filter === this.currentStatusFilter) {
        card.classList.add('active-filter');
      } else {
        card.classList.remove('active-filter');
      }
    });
  },

  applyFiltersAndRenderTable() {
    this.filteredList = this.allStudentsWithSubmissions.filter(item => {
      // 1. ステータスフィルター
      if (this.currentStatusFilter === 'submitted' && item.status === '未提出') return false;
      if (this.currentStatusFilter === 'unsubmitted' && item.status !== '未提出') return false;
      if (this.currentStatusFilter === 'no-change') {
        if (item.status === '未提出' || item.hasChange || item.enrollmentClass === '非受講') return false;
      }
      if (this.currentStatusFilter === 'has-change') {
        if (item.status === '未提出' || !item.hasChange || item.enrollmentClass === '非受講') return false;
      }
      if (this.currentStatusFilter === 'not-enrolled') {
        if (item.status === '未提出' || item.enrollmentClass !== '非受講') return false;
      }

      // 2. 変更前クラスフィルター（所属クラス）
      if (this.currentPrevClassFilter !== 'all' && item.className !== this.currentPrevClassFilter) {
        return false;
      }

      // 3. 変更後クラスフィルター（確定受講クラス）
      if (this.currentPostClassFilter !== 'all') {
        if (this.currentPostClassFilter === 'unsubmitted') {
          // 未提出または受講クラス未定
          if (item.status !== '未提出' && item.enrollmentClass !== '-' && item.enrollmentClass) {
            return false;
          }
        } else if (this.currentPostClassFilter === '非受講') {
          if (item.enrollmentClass !== '非受講') {
            return false;
          }
        } else {
          // 指定されたクラス名（確定受講クラスが一致するもの）
          if (item.status === '未提出' || item.enrollmentClass !== this.currentPostClassFilter) {
            return false;
          }
        }
      }

      // 4. 検索クエリ
      if (this.searchQuery) {
        const q = this.searchQuery;
        const matchId = item.nichinokenId.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchKana = (item.nameKana || '').toLowerCase().includes(q);
        if (!matchId && !matchName && !matchKana) return false;
      }

      return true;
    });

    const tableArea = this.container.querySelector('#table-render-area');
    if (this.filteredList.length === 0) {
      tableArea.innerHTML = `
        <div class="empty-state" style="padding: var(--spacing-xl);">
          <div style="font-size: 2rem; margin-bottom: 6px;">🔍</div>
          <div class="font-bold" style="color: var(--gray-700);">条件に一致する生徒は見つかりませんでした</div>
          <div style="font-size: 0.85rem; color: var(--gray-500); margin-top: 4px;">検索条件やフィルタを変更してください</div>
        </div>
      `;
      return;
    }

    let html = `
      <div style="font-size: 0.85rem; color: var(--gray-600); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span>表示中: <strong class="text-mono font-bold" style="color: var(--gray-900);">${this.filteredList.length}</strong> / ${this.allStudentsWithSubmissions.length} 名</span>
      </div>
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>日能研番号</th>
              <th>氏名</th>
              <th>氏名カナ</th>
              <th>所属クラス <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(変更前)</span></th>
              <th>提出ステータス</th>
              <th>受講クラス (確定) <span style="font-size: 0.75rem; color: var(--gray-500); font-weight: normal;">(変更後)</span></th>
              <th>受付方法</th>
              <th>承認者</th>
              <th>日時</th>
              <th>特記事項</th>
              <th style="text-align: center;">変更履歴</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const row of this.filteredList) {
      let statusBadge = '<span class="badge badge-gray">未提出</span>';
      let enrollmentBadge = '<span class="text-muted">-</span>';

      if (row.status === '承認済') {
        if (row.enrollmentClass === '非受講') {
          statusBadge = '<span class="badge badge-purple">非受講</span>';
          enrollmentBadge = '<strong style="color: var(--purple-solid);">🚫 非受講</strong>';
        } else if (row.hasChange) {
          statusBadge = '<span class="badge badge-warning">変更あり</span>';
          enrollmentBadge = `<span class="badge badge-warning" style="font-size: 0.88rem; font-weight: bold;">${row.enrollmentClass}</span>`;
        } else {
          statusBadge = '<span class="badge badge-success">変更なし</span>';
          enrollmentBadge = `<span class="badge badge-info" style="font-size: 0.88rem;">${row.enrollmentClass}</span>`;
        }
      }

      const historyCount = Array.isArray(row.history) ? row.history.length : (row.status === '承認済' ? 1 : 0);
      const hasScanImg = (row.scanImageBlob) || (row.history && row.history.some(h => h.scanImageBlob));

      html += `
        <tr>
          <td class="text-mono font-bold">${row.nichinokenId}</td>
          <td class="font-bold">${row.name}</td>
          <td class="text-muted" style="font-size: 0.82rem;">${row.nameKana || ''}</td>
          <td><span class="badge badge-gray">${row.className}</span></td>
          <td>${statusBadge}</td>
          <td>${enrollmentBadge}</td>
          <td style="font-size: 0.82rem;">${row.inputMethod ? `<span class="badge badge-gray">${row.inputMethod}</span>` : '-'}</td>
          <td style="font-size: 0.82rem;">${row.approvedBy || '-'}</td>
          <td style="font-size: 0.8rem; color: var(--gray-500); white-space: nowrap;">${UI.formatDate(row.approvedAt || row.submittedAt)}</td>
          <td style="font-size: 0.82rem; color: var(--gray-600); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.remarks || ''}">
            ${row.remarks || '-'}
          </td>
          <td style="text-align: center; white-space: nowrap;">
            <button class="btn btn-secondary btn-sm btn-view-history" data-student-id="${row.studentId}" style="padding: 4px 10px; font-size: 0.78rem;" title="スキャン画像や過去の変更履歴を確認">
              📜 履歴 <span class="badge ${historyCount > 0 ? 'badge-info' : 'badge-gray'}" style="padding: 1px 5px; font-size: 0.72rem; margin-left: 2px;">${historyCount}</span>
              ${hasScanImg ? '<span title="スキャン原本画像あり" style="font-size: 0.85rem; margin-left: 2px;">📷</span>' : ''}
            </button>
          </td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;

    tableArea.innerHTML = html;

    // 履歴ボタンのイベントバインド
    tableArea.querySelectorAll('.btn-view-history').forEach(btn => {
      btn.onclick = () => {
        const studentId = btn.dataset.studentId;
        const studentData = this.allStudentsWithSubmissions.find(s => s.studentId === studentId);
        if (studentData) {
          this.showHistoryModal(studentData);
        }
      };
    });
  },

  /**
   * 変更履歴・スキャン画像ポップアップモーダル
   */
  showHistoryModal(studentData) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';

    // 履歴一覧の構築（降順：新しい順）
    let historyList = Array.isArray(studentData.history) ? [...studentData.history] : [];
    if (historyList.length === 0 && studentData.status === '承認済') {
      historyList.push({
        id: 'hist_fallback',
        timestamp: studentData.approvedAt || studentData.submittedAt || new Date().toISOString(),
        approvedAt: studentData.approvedAt,
        inputMethod: studentData.inputMethod || 'スキャン',
        approvedBy: studentData.approvedBy || '-',
        status: studentData.status,
        hasChange: studentData.hasChange,
        enrollmentClass: studentData.enrollmentClass,
        remarks: studentData.remarks || '',
        scanImageBlob: studentData.scanImageBlob || null
      });
    }

    // 時系列降順ソート
    historyList.sort((a, b) => new Date(b.timestamp || b.approvedAt || 0) - new Date(a.timestamp || a.approvedAt || 0));

    let currentStatusBadge = '<span class="badge badge-gray">未提出</span>';
    if (studentData.status === '承認済') {
      if (studentData.enrollmentClass === '非受講') {
        currentStatusBadge = '<span class="badge badge-purple font-bold">🚫 非受講（確定）</span>';
      } else if (studentData.hasChange) {
        currentStatusBadge = `<span class="badge badge-warning font-bold">🔄 変更あり: ${studentData.enrollmentClass}</span>`;
      } else {
        currentStatusBadge = `<span class="badge badge-success font-bold">✅ 変更なし: ${studentData.enrollmentClass}</span>`;
      }
    }

    modal.innerHTML = `
      <div class="modal-content modal-lg" style="max-width: 780px;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="brand-icon" style="width: 30px; height: 30px; font-size: 15px;">📜</span>
            <div>
              <h3 class="modal-title font-bold">受講確認・変更履歴</h3>
              <div style="font-size: 0.8rem; color: var(--gray-500);">
                対象: ${studentData.name} 様 (${studentData.nichinokenId})
              </div>
            </div>
          </div>
          <button class="btn-ghost btn-sm btn-close-modal">✕</button>
        </div>

        <div class="modal-body" style="max-height: 75vh; overflow-y: auto;">
          <!-- 生徒サマリーヘッダー -->
          <div class="history-summary-header">
            <div class="history-student-profile">
              <div class="history-student-avatar">👤</div>
              <div>
                <div class="history-student-name">
                  ${studentData.name}
                  <span class="text-mono" style="font-size: 0.85rem; font-weight: normal; color: var(--primary-700); margin-left: 4px;">
                    (${studentData.nichinokenId})
                  </span>
                </div>
                <div class="history-student-kana">${studentData.nameKana || 'カナ登録なし'}</div>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 10px;">
              <div>
                <div style="font-size: 0.72rem; color: var(--gray-500); text-align: right;">所属クラス</div>
                <div class="font-bold" style="text-align: right;"><span class="badge badge-gray">${studentData.className}</span></div>
              </div>
              <div style="border-left: 1px solid var(--gray-300); height: 28px;"></div>
              <div>
                <div style="font-size: 0.72rem; color: var(--gray-500);">現在の確定受講ステータス</div>
                <div>${currentStatusBadge}</div>
              </div>
            </div>
          </div>

          <!-- 履歴タイムライン -->
          <div>
            <div style="font-size: 0.92rem; font-weight: 700; color: var(--gray-800); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🕒 変更・承認タイムライン</span>
              <span class="badge badge-info" style="font-size: 0.75rem;">計 ${historyList.length} 件</span>
            </div>

            ${historyList.length === 0 ? `
              <div class="empty-state" style="padding: 32px 16px; background: var(--gray-50); border: 1px dashed var(--gray-300); border-radius: var(--radius-md);">
                <div style="font-size: 2rem; margin-bottom: 6px;">⏳</div>
                <div class="font-bold" style="color: var(--gray-700);">まだ提出・変更履歴はありません</div>
                <div style="font-size: 0.82rem; color: var(--gray-500); margin-top: 4px;">受講確認票のスキャン、または手動登録を行うとここに履歴が記録されます</div>
              </div>
            ` : `
              <div class="history-timeline">
                ${historyList.map((item, idx) => {
                  const isLatest = idx === 0;
                  const methodIconMap = {
                    'スキャン': '📷',
                    '電話': '📞',
                    '口頭': '🗣️',
                    'メール・連絡帳': '✉️',
                    'その他': '📝'
                  };
                  const icon = methodIconMap[item.inputMethod] || '📝';

                  let enrollmentDisp = '<span class="text-muted">-</span>';
                  if (item.enrollmentClass === '非受講') {
                    enrollmentDisp = '<strong style="color: var(--danger-solid);">🚫 非受講（受講しない）</strong>';
                  } else if (item.hasChange) {
                    enrollmentDisp = `<span class="badge badge-warning" style="font-size: 0.88rem; font-weight: bold;">🔄 ${item.enrollmentClass} クラスへ変更</span>`;
                  } else {
                    enrollmentDisp = `<span class="badge badge-success" style="font-size: 0.88rem;">✅ ${item.enrollmentClass || studentData.className}（変更なし）</span>`;
                  }

                  return `
                    <div class="history-item ${isLatest ? 'is-latest' : ''}">
                      <div class="history-dot">${icon}</div>
                      <div class="history-card">
                        <div class="history-card-header">
                          <div class="history-meta-left">
                            <span class="badge ${isLatest ? 'badge-primary' : 'badge-gray'}">${item.inputMethod || '手動'}</span>
                            <span class="history-time">${UI.formatDate(item.timestamp || item.approvedAt)}</span>
                            ${isLatest ? '<span class="badge badge-success" style="font-size: 0.72rem;">最新の確定内容</span>' : ''}
                          </div>
                          <div class="history-staff">
                            担当・承認者: <strong style="color: var(--gray-800);">${item.approvedBy || '-'}</strong>
                          </div>
                        </div>

                        <div class="history-details-grid">
                          <div class="history-field">
                            <div class="history-field-label">受講内容（確定クラス）</div>
                            <div class="history-field-value">${enrollmentDisp}</div>
                          </div>
                          <div class="history-field">
                            <div class="history-field-label">ステータス</div>
                            <div class="history-field-value">
                              <span class="badge ${item.status === '承認済' ? 'badge-success' : 'badge-gray'}">${item.status}</span>
                            </div>
                          </div>
                        </div>

                        ${item.remarks ? `
                          <div class="history-remarks-box">
                            <div style="font-size: 0.72rem; font-weight: bold; color: var(--gray-600); margin-bottom: 2px;">💬 特記事項・メモ:</div>
                            <div>${item.remarks}</div>
                          </div>
                        ` : ''}

                        ${item.scanImageBlob ? `
                          <div class="history-scan-container">
                            <div class="history-scan-label">
                              <span>📷 スキャン確認票（原本プレビュー）</span>
                            </div>
                            <div class="history-scan-thumb-wrap" data-img-src="${item.scanImageBlob}" data-title="${studentData.name} 様 (${UI.formatDate(item.timestamp)}) スキャン確認票">
                              <img src="${item.scanImageBlob}" class="history-scan-thumb" alt="スキャン確認票">
                              <div class="history-scan-overlay">
                                🔍 クリックして拡大表示
                              </div>
                            </div>
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary btn-close-modal">閉じる</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = closeModal);
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    // スキャン画像サムネイルクリックで拡大ライトボックス起動
    modal.querySelectorAll('.history-scan-thumb-wrap').forEach(wrap => {
      wrap.onclick = () => {
        const imgSrc = wrap.dataset.imgSrc;
        const title = wrap.dataset.title;
        if (imgSrc) {
          this.showImageLightbox(imgSrc, title);
        }
      };
    });
  },

  /**
   * 画像拡大ライトボックスモーダル
   */
  showImageLightbox(imgSrc, title) {
    UI.showImageLightbox(imgSrc, title);
  }
};

