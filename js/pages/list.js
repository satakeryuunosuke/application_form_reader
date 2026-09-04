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
  currentPrevCourseFilter: 'all',
  currentPostCourseFilter: 'all',
  currentSortKey: 'id',
  currentSortOrder: 'asc',
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

        <!-- フィルタ & ソート & エクスポート コントロールカード -->
        <div class="list-filter-container">
          <!-- 上段: 検索・ソート・エクスポート -->
          <div class="filter-main-row">
            <div class="filter-left-tools">
              <div class="search-input-wrap">
                <span class="search-icon">🔍</span>
                <input type="text" id="inp-search" class="form-control filter-search-input" placeholder="氏名・カナ・日能研番号で検索..." value="${this.searchQuery}">
                <button type="button" id="btn-search-clear" class="btn-search-clear ${this.searchQuery ? '' : 'hidden'}" title="検索をクリア">✕</button>
              </div>

              <div class="sort-select-wrap ${this.currentSortKey !== 'id' || this.currentSortOrder !== 'asc' ? 'is-active' : ''}" title="一覧の並び順">
                <span class="sort-label-icon">⇅ 並び順:</span>
                <select id="sel-sort-order" class="filter-sort-select">
                  <option value="id-asc" ${this.currentSortKey === 'id' && this.currentSortOrder === 'asc' ? 'selected' : ''}>日能研番号 (昇順)</option>
                  <option value="id-desc" ${this.currentSortKey === 'id' && this.currentSortOrder === 'desc' ? 'selected' : ''}>日能研番号 (降順)</option>
                  <option value="name-asc" ${this.currentSortKey === 'name' && this.currentSortOrder === 'asc' ? 'selected' : ''}>氏名 (五十音順)</option>
                  <option value="name-desc" ${this.currentSortKey === 'name' && this.currentSortOrder === 'desc' ? 'selected' : ''}>氏名 (逆順)</option>
                  <option value="prevClass-asc" ${this.currentSortKey === 'prevClass' && this.currentSortOrder === 'asc' ? 'selected' : ''}>前クラス順</option>
                  <option value="date-desc" ${this.currentSortKey === 'date' && this.currentSortOrder === 'desc' ? 'selected' : ''}>日時 (新しい順)</option>
                  <option value="date-asc" ${this.currentSortKey === 'date' && this.currentSortOrder === 'asc' ? 'selected' : ''}>日時 (古い順)</option>
                </select>
              </div>
            </div>

            <div class="filter-export-actions">
              <button id="btn-export-csv" class="btn btn-secondary btn-sm" title="現在の表示一覧をCSVダウンロード">
                📄 CSV出力
              </button>
              <button id="btn-export-excel" class="btn btn-primary btn-sm" title="現在の表示一覧をExcelダウンロード">
                📊 Excel出力 (.xlsx)
              </button>
            </div>
          </div>

          <!-- 下段: 絞り込みバー -->
          <div class="filter-sub-row">
            <div class="filter-conditions-group">
              <span class="filter-row-label">⚡ 絞り込み:</span>

              <!-- ステータス -->
              <div class="filter-single-select-wrap">
                <select id="sel-filter-status" class="filter-single-select ${this.currentStatusFilter !== 'all' ? 'is-active' : ''}" title="提出ステータスで絞り込み">
                  <option value="all" ${this.currentStatusFilter === 'all' ? 'selected' : ''}>状況: すべて</option>
                  <option value="submitted" ${this.currentStatusFilter === 'submitted' ? 'selected' : ''}>提出済のみ</option>
                  <option value="no-change" ${this.currentStatusFilter === 'no-change' ? 'selected' : ''}>変更なし</option>
                  <option value="has-change" ${this.currentStatusFilter === 'has-change' ? 'selected' : ''}>変更あり</option>
                  <option value="not-enrolled" ${this.currentStatusFilter === 'not-enrolled' ? 'selected' : ''}>非受講</option>
                  <option value="unsubmitted" ${this.currentStatusFilter === 'unsubmitted' ? 'selected' : ''}>未提出のみ</option>
                </select>
              </div>

              <!-- 変更前 所属グループ -->
              <div class="filter-pill-cluster ${this.currentPrevClassFilter !== 'all' || this.currentPrevCourseFilter !== 'all' ? 'is-active' : ''}" title="変更前の所属情報">
                <span class="cluster-tag prev">変更前</span>
                <select id="sel-filter-prev-class" class="cluster-select ${this.currentPrevClassFilter !== 'all' ? 'is-active' : ''}" title="変更前クラス">
                  <option value="all" ${this.currentPrevClassFilter === 'all' ? 'selected' : ''}>クラス: すべて</option>
                  ${prevClasses.map(c => `<option value="${c}" ${this.currentPrevClassFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
                <span class="cluster-divider">/</span>
                <select id="sel-filter-prev-course" class="cluster-select ${this.currentPrevCourseFilter !== 'all' ? 'is-active' : ''}" title="変更前科目">
                  <option value="all" ${this.currentPrevCourseFilter === 'all' ? 'selected' : ''}>科目: すべて</option>
                  <option value="4科" ${this.currentPrevCourseFilter === '4科' ? 'selected' : ''}>4科</option>
                  <option value="2科" ${this.currentPrevCourseFilter === '2科' ? 'selected' : ''}>2科</option>
                </select>
              </div>

              <!-- 確定後 受講グループ -->
              <div class="filter-pill-cluster ${this.currentPostClassFilter !== 'all' || this.currentPostCourseFilter !== 'all' ? 'is-active' : ''}" title="確定後の受講情報">
                <span class="cluster-tag post">確定後</span>
                <select id="sel-filter-post-class" class="cluster-select ${this.currentPostClassFilter !== 'all' ? 'is-active' : ''}" title="確定後クラス">
                  <option value="all" ${this.currentPostClassFilter === 'all' ? 'selected' : ''}>クラス: すべて</option>
                  ${postClasses.map(c => `<option value="${c}" ${this.currentPostClassFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
                  <option value="非受講" ${this.currentPostClassFilter === '非受講' ? 'selected' : ''}>🚫 非受講</option>
                  <option value="unsubmitted" ${this.currentPostClassFilter === 'unsubmitted' ? 'selected' : ''}>⏳ 未定</option>
                </select>
                <span class="cluster-divider">/</span>
                <select id="sel-filter-post-course" class="cluster-select ${this.currentPostCourseFilter !== 'all' ? 'is-active' : ''}" title="確定後科目">
                  <option value="all" ${this.currentPostCourseFilter === 'all' ? 'selected' : ''}>科目: すべて</option>
                  <option value="4科" ${this.currentPostCourseFilter === '4科' ? 'selected' : ''}>4科</option>
                  <option value="2科" ${this.currentPostCourseFilter === '2科' ? 'selected' : ''}>2科</option>
                  <option value="非受講" ${this.currentPostCourseFilter === '非受講' ? 'selected' : ''}>🚫 非受講</option>
                  <option value="unsubmitted" ${this.currentPostCourseFilter === 'unsubmitted' ? 'selected' : ''}>⏳ 未定</option>
                </select>
              </div>
            </div>

            <div class="filter-actions-right">
              <span id="active-filter-badge" class="active-filter-badge hidden"></span>
              <button id="btn-reset-filters" class="btn-filter-reset" title="絞り込みとソートを初期状態にリセット">
                <span>↺</span> リセット
              </button>
            </div>
          </div>
        </div>

        <!-- テーブル表示エリア -->
        <div id="table-render-area"></div>
      </div>
    `;

    this.bindEvents();
    this.updateClassFilterStyles();
    this.applyFiltersAndRenderTable();
  },

  bindEvents() {
    const searchInput = this.container.querySelector('#inp-search');
    const searchClearBtn = this.container.querySelector('#btn-search-clear');

    searchInput.oninput = () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      if (searchClearBtn) {
        if (searchInput.value.length > 0) {
          searchClearBtn.classList.remove('hidden');
        } else {
          searchClearBtn.classList.add('hidden');
        }
      }
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    if (searchClearBtn) {
      searchClearBtn.onclick = () => {
        searchInput.value = '';
        this.searchQuery = '';
        searchClearBtn.classList.add('hidden');
        searchInput.focus();
        this.updateClassFilterStyles();
        this.applyFiltersAndRenderTable();
      };
    }

    const statusSelect = this.container.querySelector('#sel-filter-status');
    statusSelect.onchange = () => {
      this.currentStatusFilter = statusSelect.value;
      this.updateSummaryCardActive();
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    const prevClassSelect = this.container.querySelector('#sel-filter-prev-class');
    prevClassSelect.onchange = () => {
      this.currentPrevClassFilter = prevClassSelect.value;
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    const prevCourseSelect = this.container.querySelector('#sel-filter-prev-course');
    if (prevCourseSelect) {
      prevCourseSelect.onchange = () => {
        this.currentPrevCourseFilter = prevCourseSelect.value;
        this.updateClassFilterStyles();
        this.applyFiltersAndRenderTable();
      };
    }

    const postClassSelect = this.container.querySelector('#sel-filter-post-class');
    postClassSelect.onchange = () => {
      this.currentPostClassFilter = postClassSelect.value;
      this.updateClassFilterStyles();
      this.applyFiltersAndRenderTable();
    };

    const postCourseSelect = this.container.querySelector('#sel-filter-post-course');
    if (postCourseSelect) {
      postCourseSelect.onchange = () => {
        this.currentPostCourseFilter = postCourseSelect.value;
        this.updateClassFilterStyles();
        this.applyFiltersAndRenderTable();
      };
    }

    const sortSelect = this.container.querySelector('#sel-sort-order');
    if (sortSelect) {
      sortSelect.onchange = () => {
        const [key, order] = sortSelect.value.split('-');
        this.currentSortKey = key;
        this.currentSortOrder = order;
        this.updateClassFilterStyles();
        this.applyFiltersAndRenderTable();
      };
    }

    const resetBtn = this.container.querySelector('#btn-reset-filters');
    resetBtn.onclick = () => {
      this.searchQuery = '';
      this.currentStatusFilter = 'all';
      this.currentPrevClassFilter = 'all';
      this.currentPostClassFilter = 'all';
      this.currentPrevCourseFilter = 'all';
      this.currentPostCourseFilter = 'all';
      this.currentSortKey = 'id';
      this.currentSortOrder = 'asc';
      searchInput.value = '';
      if (searchClearBtn) searchClearBtn.classList.add('hidden');
      statusSelect.value = 'all';
      prevClassSelect.value = 'all';
      postClassSelect.value = 'all';
      if (prevCourseSelect) prevCourseSelect.value = 'all';
      if (postCourseSelect) postCourseSelect.value = 'all';
      if (sortSelect) sortSelect.value = 'id-asc';
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
        this.updateClassFilterStyles();
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
    if (!this.container) return;

    // ソートラッパーのアクティブ状態
    const sortWrap = this.container.querySelector('.sort-select-wrap');
    const isCustomSort = this.currentSortKey !== 'id' || this.currentSortOrder !== 'asc';
    if (sortWrap) {
      sortWrap.classList.toggle('is-active', isCustomSort);
    }

    // ステータスセレクトのアクティブ状態
    const statusSelect = this.container.querySelector('#sel-filter-status');
    if (statusSelect) {
      statusSelect.classList.toggle('is-active', this.currentStatusFilter !== 'all');
    }

    // 前クラスタのアクティブ状態
    const prevCluster = this.container.querySelector('.filter-pill-cluster:nth-of-type(1)');
    const prevClassSelect = this.container.querySelector('#sel-filter-prev-class');
    const prevCourseSelect = this.container.querySelector('#sel-filter-prev-course');
    const isPrevActive = this.currentPrevClassFilter !== 'all' || this.currentPrevCourseFilter !== 'all';
    if (prevCluster) prevCluster.classList.toggle('is-active', isPrevActive);
    if (prevClassSelect) prevClassSelect.classList.toggle('is-active', this.currentPrevClassFilter !== 'all');
    if (prevCourseSelect) prevCourseSelect.classList.toggle('is-active', this.currentPrevCourseFilter !== 'all');

    // 後クラスタのアクティブ状態
    const postCluster = this.container.querySelector('.filter-pill-cluster:nth-of-type(2)');
    const postClassSelect = this.container.querySelector('#sel-filter-post-class');
    const postCourseSelect = this.container.querySelector('#sel-filter-post-course');
    const isPostActive = this.currentPostClassFilter !== 'all' || this.currentPostCourseFilter !== 'all';
    if (postCluster) postCluster.classList.toggle('is-active', isPostActive);
    if (postClassSelect) postClassSelect.classList.toggle('is-active', this.currentPostClassFilter !== 'all');
    if (postCourseSelect) postCourseSelect.classList.toggle('is-active', this.currentPostCourseFilter !== 'all');

    // アクティブな絞り込み件数の計算
    let activeFilterCount = 0;
    if (this.searchQuery) activeFilterCount++;
    if (this.currentStatusFilter !== 'all') activeFilterCount++;
    if (this.currentPrevClassFilter !== 'all') activeFilterCount++;
    if (this.currentPrevCourseFilter !== 'all') activeFilterCount++;
    if (this.currentPostClassFilter !== 'all') activeFilterCount++;
    if (this.currentPostCourseFilter !== 'all') activeFilterCount++;

    const badge = this.container.querySelector('#active-filter-badge');
    if (badge) {
      if (activeFilterCount > 0) {
        badge.textContent = `${activeFilterCount}件 絞り込み中`;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    const resetBtn = this.container.querySelector('#btn-reset-filters');
    if (resetBtn) {
      const hasAnyNonDefault = activeFilterCount > 0 || isCustomSort;
      resetBtn.classList.toggle('is-highlighted', hasAnyNonDefault);
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

  getSortHeaderHtml(label, sortKey, colClass, subLabel = '') {
    const isSorted = this.currentSortKey === sortKey;
    const orderClass = isSorted ? (this.currentSortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    const icon = isSorted ? (this.currentSortOrder === 'asc' ? '▲' : '▼') : '↕';
    return `
      <th class="${colClass} sortable-th ${orderClass}" data-sort="${sortKey}" title="${label}で並び替え">
        <span style="display: inline-flex; align-items: center; gap: 2px;">
          ${label}
          <span class="sort-icon">${icon}</span>
        </span>
        ${subLabel ? `<span class="th-sub">${subLabel}</span>` : ''}
      </th>
    `;
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

      // 2-2. 変更前科目フィルター
      if (this.currentPrevCourseFilter !== 'all' && (item.course || '4科') !== this.currentPrevCourseFilter) {
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

      // 3-2. 変更後科目フィルター
      if (this.currentPostCourseFilter !== 'all') {
        if (this.currentPostCourseFilter === 'unsubmitted') {
          if (item.status !== '未提出') return false;
        } else if (this.currentPostCourseFilter === '非受講') {
          if (item.enrollmentClass !== '非受講' && item.enrollmentCourse !== '非受講') return false;
        } else {
          if (item.status === '未提出' || item.enrollmentCourse !== this.currentPostCourseFilter) return false;
        }
      }

      // 4. 検索クエリ
      if (this.searchQuery) {
        const q = this.searchQuery;
        const matchId = item.nichinokenId.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchKana = (item.nameKana || '').toLowerCase().includes(q);
        const matchClass = (item.className || '').toLowerCase().includes(q);
        const matchCourse = (item.course || '').toLowerCase().includes(q);
        if (!matchId && !matchName && !matchKana && !matchClass && !matchCourse) return false;
      }

      return true;
    });

    // 5. ソート処理（デフォルト：日能研番号昇順）
    this.filteredList.sort((a, b) => {
      let cmp = 0;
      switch (this.currentSortKey) {
        case 'id':
          cmp = (a.nichinokenId || '').localeCompare(b.nichinokenId || '', undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'name': {
          const nameA = a.nameKana || a.name || '';
          const nameB = b.nameKana || b.name || '';
          cmp = nameA.localeCompare(nameB, 'ja');
          if (cmp === 0) {
            cmp = (a.name || '').localeCompare(b.name || '', 'ja');
          }
          break;
        }
        case 'prevClass':
          cmp = (a.className || '').localeCompare(b.className || '', undefined, { numeric: true });
          break;
        case 'prevCourse':
          cmp = (a.course || '4科').localeCompare(b.course || '4科', 'ja');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '', 'ja');
          break;
        case 'postClass':
          cmp = (a.enrollmentClass || '').localeCompare(b.enrollmentClass || '', undefined, { numeric: true });
          break;
        case 'postCourse':
          cmp = (a.enrollmentCourse || '').localeCompare(b.enrollmentCourse || '', 'ja');
          break;
        case 'date': {
          const timeA = new Date(a.approvedAt || a.submittedAt || 0).getTime();
          const timeB = new Date(b.approvedAt || b.submittedAt || 0).getTime();
          cmp = timeA - timeB;
          break;
        }
        default:
          cmp = (a.nichinokenId || '').localeCompare(b.nichinokenId || '', undefined, { numeric: true });
      }

      // タイブレーク：日能研番号自然昇順
      if (cmp === 0) {
        cmp = (a.nichinokenId || '').localeCompare(b.nichinokenId || '', undefined, { numeric: true });
      }

      return this.currentSortOrder === 'desc' ? -cmp : cmp;
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
        <table class="table submission-list-table">
          <thead>
            <tr>
              ${this.getSortHeaderHtml('日能研番号', 'id', 'col-id')}
              ${this.getSortHeaderHtml('氏名', 'name', 'col-name')}
              ${this.getSortHeaderHtml('氏名カナ', 'name', 'col-kana')}
              ${this.getSortHeaderHtml('前クラス', 'prevClass', 'col-compact-class', '(所属)')}
              ${this.getSortHeaderHtml('前科目', 'prevCourse', 'col-compact-course', '(所属)')}
              ${this.getSortHeaderHtml('提出状況', 'status', 'col-status')}
              ${this.getSortHeaderHtml('確定クラス', 'postClass', 'col-compact-class', '(後)')}
              ${this.getSortHeaderHtml('確定科目', 'postCourse', 'col-compact-course', '(後)')}
              <th class="col-method">受付方法</th>
              <th class="col-approver">承認者</th>
              ${this.getSortHeaderHtml('日時', 'date', 'col-date')}
              <th class="col-remarks">特記事項</th>
              <th class="col-history" style="text-align: center;">変更履歴</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const row of this.filteredList) {
      let statusBadge = '<span class="badge badge-gray">未提出</span>';
      let enrollmentBadge = '<span class="text-muted">-</span>';
      let enrollmentCourseBadge = '<span class="text-muted">-</span>';

      if (row.status === '承認済') {
        const isCourseChanged = row.enrollmentCourse && row.enrollmentCourse !== (row.course || '4科') && row.enrollmentCourse !== '非受講';
        if (row.enrollmentClass === '非受講' || row.enrollmentCourse === '非受講') {
          statusBadge = '<span class="badge badge-purple">非受講</span>';
          enrollmentBadge = '<strong style="color: var(--purple-solid);">🚫 非受講</strong>';
          enrollmentCourseBadge = '<strong style="color: var(--purple-solid);">-</strong>';
        } else if (row.hasChange) {
          statusBadge = '<span class="badge badge-warning">変更あり</span>';
          enrollmentBadge = `<span class="badge badge-warning" style="font-size: 0.85rem; font-weight: bold; padding: 2px 6px;">${row.enrollmentClass}</span>`;
          enrollmentCourseBadge = `<span class="badge ${isCourseChanged ? 'badge-warning font-bold' : 'badge-purple'}" style="font-size: 0.85rem; padding: 2px 6px;">${row.enrollmentCourse || row.course || '4科'}</span>`;
        } else {
          statusBadge = '<span class="badge badge-success">変更なし</span>';
          enrollmentBadge = `<span class="badge badge-info" style="font-size: 0.85rem; padding: 2px 6px;">${row.enrollmentClass}</span>`;
          enrollmentCourseBadge = `<span class="badge badge-purple" style="font-size: 0.85rem; padding: 2px 6px;">${row.enrollmentCourse || row.course || '4科'}</span>`;
        }
      }

      const historyCount = Array.isArray(row.history) ? row.history.length : (row.status === '承認済' ? 1 : 0);
      const hasScanImg = (row.scanImageBlob) || (row.history && row.history.some(h => h.scanImageBlob));

      html += `
        <tr>
          <td class="col-id text-mono font-bold">${row.nichinokenId}</td>
          <td class="col-name font-bold">${row.name}</td>
          <td class="col-kana">${row.nameKana || ''}</td>
          <td class="col-compact-class"><span class="badge badge-gray" style="padding: 2px 6px;">${row.className}</span></td>
          <td class="col-compact-course"><span class="badge badge-purple" style="padding: 2px 6px;">${row.course || '4科'}</span></td>
          <td class="col-status">${statusBadge}</td>
          <td class="col-compact-class">${enrollmentBadge}</td>
          <td class="col-compact-course">${enrollmentCourseBadge}</td>
          <td class="col-method">${row.inputMethod ? `<span class="badge badge-gray" style="padding: 2px 5px;">${row.inputMethod}</span>` : '-'}</td>
          <td class="col-approver">${row.approvedBy || '-'}</td>
          <td class="col-date">${UI.formatDate(row.approvedAt || row.submittedAt)}</td>
          <td class="col-remarks" title="${row.remarks || ''}">
            ${row.remarks || '-'}
          </td>
          <td class="col-history" style="text-align: center;">
            <button class="btn btn-secondary btn-sm btn-view-history" data-student-id="${row.studentId}" style="padding: 3px 8px; font-size: 0.76rem;" title="スキャン画像や過去の変更履歴を確認">
              📜 履歴 <span class="badge ${historyCount > 0 ? 'badge-info' : 'badge-gray'}" style="padding: 1px 4px; font-size: 0.7rem; margin-left: 2px;">${historyCount}</span>
              ${hasScanImg ? '<span title="スキャン原本画像あり" style="font-size: 0.8rem; margin-left: 1px;">📷</span>' : ''}
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

    // テーブルヘッダークリックでのソート連動
    tableArea.querySelectorAll('th.sortable-th').forEach(th => {
      th.onclick = () => {
        const sortKey = th.dataset.sort;
        if (this.currentSortKey === sortKey) {
          this.currentSortOrder = this.currentSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
          this.currentSortKey = sortKey;
          this.currentSortOrder = sortKey === 'date' ? 'desc' : 'asc';
        }

        const sortSelect = this.container.querySelector('#sel-sort-order');
        if (sortSelect) {
          const val = `${this.currentSortKey}-${this.currentSortOrder}`;
          if (sortSelect.querySelector(`option[value="${val}"]`)) {
            sortSelect.value = val;
          }
        }
        this.updateClassFilterStyles();
        this.applyFiltersAndRenderTable();
      };
    });

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
      if (studentData.enrollmentClass === '非受講' || studentData.enrollmentCourse === '非受講') {
        currentStatusBadge = '<span class="badge badge-purple font-bold">🚫 非受講（確定）</span>';
      } else if (studentData.hasChange) {
        currentStatusBadge = `<span class="badge badge-warning font-bold">🔄 変更あり: ${studentData.enrollmentClass} (${studentData.enrollmentCourse || studentData.course || '4科'})</span>`;
      } else {
        currentStatusBadge = `<span class="badge badge-success font-bold">✅ 変更なし: ${studentData.enrollmentClass} (${studentData.enrollmentCourse || studentData.course || '4科'})</span>`;
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
                <div style="font-size: 0.72rem; color: var(--gray-500); text-align: right;">所属</div>
                <div class="font-bold" style="text-align: right;"><span class="badge badge-gray">${studentData.className}</span> <span class="badge badge-purple">${studentData.course || '4科'}</span></div>
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
                  const itemCourse = item.enrollmentCourse || (item.enrollmentClass === '非受講' ? '非受講' : (studentData.course || '4科'));
                  if (item.enrollmentClass === '非受講' || itemCourse === '非受講') {
                    enrollmentDisp = '<strong style="color: var(--danger-solid);">🚫 非受講（受講しない）</strong>';
                  } else if (item.hasChange) {
                    enrollmentDisp = `<span class="badge badge-warning" style="font-size: 0.88rem; font-weight: bold;">🔄 ${item.enrollmentClass} (${itemCourse})</span>`;
                  } else {
                    enrollmentDisp = `<span class="badge badge-success" style="font-size: 0.88rem;">✅ ${item.enrollmentClass || studentData.className} (${itemCourse})</span>`;
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
                            <div class="history-field-label">受講内容（確定クラス・科目）</div>
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

