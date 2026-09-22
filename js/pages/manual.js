/**
 * 手動登録・変更タブ コントローラー（口頭・電話受付対応）
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { ProjectPage } from './project.js';
import { FolderConnector } from '../sync/folder-connector.js';

export const ManualPage = {
  container: null,
  project: null,
  studentsList: [],
  selectedStudent: null,
  staffList: [],
  selectedStaff: '',
  classList: [],

  async render(container, project) {
    this.container = container;

    // 別のプロジェクトに切り替わった場合は選択生徒を初期化
    if (!this.project || this.project.id !== project.id) {
      this.selectedStudent = null;
      this.studentsList = [];
    }
    this.project = project;

    const settings = await DB.getSettings();
    this.staffList = settings.staffNames || ['担当者'];
    this.selectedStaff = this.selectedStaff || '';
    this.classList = await DB.getProjectClasses(project.id);
    this.studentsList = await DB.getProjectStudentsWithSubmissions(project.id);
    this.selectedStudent = null;

    const isCompleted = this.project.status === '完了';
    const isSelectionMode = (this.project.projectType === 'selection');
    const now = new Date();
    const nowIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    this.container.innerHTML = `
      <div class="subpage-nav-bar" style="max-width: 680px; margin: 0 auto var(--spacing-md) auto;">
        <div class="subpage-nav-left">
          <button id="btn-manual-back-list" class="btn btn-secondary btn-sm" style="font-weight: 700;">
            ← 提出状況一覧に戻る
          </button>
        </div>
        <div style="font-size: 0.82rem; color: var(--gray-600);">
          ${UI.formatProjectTitle(this.project.title)}
        </div>
      </div>

      <div class="card" style="max-width: 680px; margin: 0 auto; ${isCompleted ? 'opacity: 0.95;' : ''}">
        <div class="card-header">
          <h2 class="card-title">✏️ 受講変更・手動登録</h2>
          <span class="badge ${isCompleted ? 'badge-gray' : 'badge-info'}">${isCompleted ? '🔒 閲覧専用' : '口頭・電話連絡対応'}</span>
        </div>

        ${isCompleted ? `
          <div class="card" style="border-left: 4px solid var(--gray-400); background: var(--gray-100); padding: 12px 16px; margin-bottom: var(--spacing-lg);">
            <div style="font-size: 0.9rem; color: var(--gray-700); display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.2rem;">🔒</span>
              <div>
                <strong>このプロジェクトは「完了」しているため、手動登録・変更はロックされています。</strong><br>
                内容を変更したい場合は、管理ダッシュボードから「<strong>🔄 進行中に戻す</strong>」を行ってください。
              </div>
            </div>
          </div>
        ` : `
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-lg);">
            紙を紛失された場合や、電話・口頭での変更連絡、提出後の再変更を手動で登録・更新します。
          </p>
        `}

        <!-- 1. 作業者選択 -->
        <div class="form-group">
          <label class="form-label">受付担当者 <span class="required">*</span></label>
          <select id="man-sel-staff" class="form-control font-bold" style="max-width: 280px; background: var(--gray-50); ${!this.selectedStaff && !isCompleted ? 'border-color: var(--warning-solid);' : ''}" ${isCompleted ? 'disabled' : ''}>
            <option value="" ${!this.selectedStaff ? 'selected' : ''}>-- 選択してください --</option>
            ${this.staffList.map(s => `<option value="${s}" ${s === this.selectedStaff ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>

        <!-- 2. 生徒検索 -->
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; flex-wrap: wrap; gap: 4px;">
            <label class="form-label" style="margin-bottom: 0;">生徒を検索・選択 <span class="required">*</span></label>
            ${!isCompleted ? `
              <button type="button" id="btn-manual-add-new-student" class="btn btn-ghost btn-sm" style="color: var(--primary-600); font-size: 0.8rem; padding: 2px 6px;">
                ➕ 名簿にない新規生徒を追加
              </button>
            ` : ''}
          </div>
          <input type="text" id="man-inp-search-student" class="form-control" placeholder="日能研番号または氏名・カナを入力..." ${isCompleted ? 'disabled' : ''}>
          <div id="man-student-search-results" style="margin-top: 4px; max-height: 180px; overflow-y: auto; border: 1px solid var(--gray-200); border-radius: var(--radius-md); display: none; background: #fff;"></div>
        </div>

        <!-- 選択中生徒情報表示カード -->
        <div id="man-selected-student-card" class="card hidden" style="background: var(--primary-50); border-color: var(--primary-300); margin-bottom: var(--spacing-lg); padding: 12px 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 0.8rem; color: var(--primary-700);">対象生徒</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: var(--gray-900);">
                <span id="man-disp-name"></span>
                <span id="man-disp-id" class="text-mono" style="font-size: 0.95rem; margin-left: 6px; color: var(--primary-700);"></span>
              </div>
              <div style="font-size: 0.82rem; color: var(--gray-600); margin-top: 2px;">
                所属: <span id="man-disp-class" class="badge badge-gray"></span> <span id="man-disp-course" class="badge badge-purple"></span> | 
                現在のステータス: <span id="man-disp-status" class="badge badge-info"></span>
              </div>
            </div>
            ${isCompleted ? '' : '<button id="btn-clear-selected-student" class="btn btn-ghost btn-sm" style="color: var(--gray-600);">✕ 解除</button>'}
          </div>
        </div>

        <!-- 3. 受付情報 -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">受付手段 <span class="required">*</span></label>
            <select id="man-sel-method" class="form-control" ${isCompleted ? 'disabled' : ''}>
              <option value="口頭">🗣️ 口頭（直接）</option>
              <option value="電話">📞 電話</option>
              <option value="メール・連絡帳">✉️ メール・連絡帳</option>
              <option value="その他">📝 その他</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">受付日時 <span class="required">*</span></label>
            <input type="datetime-local" id="man-inp-datetime" class="form-control" value="${nowIso}" ${isCompleted ? 'disabled' : ''}>
          </div>
        </div>

        <!-- 4. 受講変更内容 / 講座選択 -->
        ${isSelectionMode ? `
          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
              <label class="form-label font-bold" style="margin-bottom: 0;">🎯 申込希望講座の選択 <span class="required">*</span></label>
              <span class="badge badge-purple font-bold" style="font-size: 0.85rem; padding: 4px 10px; background: #8b5cf6; color: #fff;">
                選択中: <span id="man-sel-count" class="text-mono" style="font-size: 1rem;">0</span> 講座
              </span>
            </div>

            <!-- クイック選択ツールバー -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <button type="button" id="btn-man-select-all" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 3px 8px; border: 1px solid var(--gray-300);" ${isCompleted ? 'disabled' : ''}>全選択</button>
                <button type="button" id="btn-man-select-none" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 3px 8px; border: 1px solid var(--gray-300);" ${isCompleted ? 'disabled' : ''}>全解除</button>
              </div>
              <div id="man-quick-method-filters" style="display: flex; gap: 4px; flex-wrap: wrap;"></div>
            </div>

            <div id="man-zero-selected-note" style="margin-bottom: 8px; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.78rem; background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3;">
              ⚠️ 現在0講座選択です（未受講・不参加として登録されます）
            </div>

            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 12px;">
              ${(this.project.scanTemplate?.customBoxes || []).length > 0 ? `
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto;">
                  ${(this.project.scanTemplate.customBoxes).map(box => {
                    const m = (box.label || '').match(/[（\(](Zoom|対面|動画|テスト|校舎|午前|午後)[）\)]/i);
                    const tag = m ? m[1] : '';
                    return `
                      <label class="custom-box-check-row" style="display: flex; align-items: center; justify-content: space-between; background: #fff; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200); cursor: pointer; user-select: none;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                          <input type="checkbox" class="chk-man-custom-box-item" data-id="${box.id}" data-label="${box.label}" ${isCompleted ? 'disabled' : ''}>
                          <span style="font-weight: 700; font-size: 0.88rem; color: var(--gray-800);">${box.label}</span>
                          ${tag ? `<span class="badge ${tag === 'Zoom' ? 'badge-info' : (tag === '動画' ? 'badge-purple' : 'badge-gray')}" style="font-size: 0.7rem; padding: 1px 5px;">${tag}</span>` : ''}
                        </div>
                        <span class="badge badge-gray" style="font-size: 0.75rem;">⬜ なし</span>
                      </label>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div style="color: var(--gray-500); font-size: 0.82rem; text-align: center; padding: 10px;">
                  読取講座枠が設定されていません。「書式設定」から講座枠を登録してください。
                </div>
              `}
            </div>
          </div>
        ` : `
          <div class="form-group">
            <label class="form-label">受講内容 <span class="required">*</span></label>
            <div class="radio-card-group">
              <label class="radio-card selected" id="man-card-no-change" style="${isCompleted ? 'cursor: not-allowed;' : ''}">
                <input type="radio" name="man-enroll-choice" value="no-change" checked ${isCompleted ? 'disabled' : ''}>
                <div>
                  <div class="font-bold">変更なし（所属クラス・科目で受講）</div>
                  <div style="font-size: 0.76rem; color: var(--gray-500); margin-top: 2px;">所属クラス・科目のまま受講</div>
                </div>
              </label>

              <label class="radio-card" id="man-card-has-change" style="${isCompleted ? 'cursor: not-allowed;' : ''}">
                <input type="radio" name="man-enroll-choice" value="has-change" ${isCompleted ? 'disabled' : ''}>
                <div style="flex: 1;">
                  <div class="font-bold">変更あり（クラス・科目変更 / 非受講）</div>
                  <div style="margin-top: 8px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 170px;">
                      <label style="font-size: 0.78rem; font-weight: 700; color: var(--gray-600); display: block; margin-bottom: 2px;">変更先クラス</label>
                      <select id="man-sel-change-class" class="form-control font-bold" style="padding: 6px 10px;" disabled>
                        <option value="">-- 変更先クラス / 非受講を選択 --</option>
                        ${this.classList.map(c => `<option value="${c}">${c} クラスへ変更</option>`).join('')}
                        <option value="非受講" style="color: var(--danger-solid); font-weight: bold;">🚫 非受講（受講しない）</option>
                      </select>
                    </div>
                    <div style="width: 125px;" id="man-wrap-change-course">
                      <label style="font-size: 0.78rem; font-weight: 700; color: var(--gray-600); display: block; margin-bottom: 2px;">変更先科目</label>
                      <select id="man-sel-change-course" class="form-control font-bold" style="padding: 6px 10px;" disabled>
                        <option value="4科">4科</option>
                        <option value="2科">2科</option>
                      </select>
                    </div>
                  </div>
                </div>
              </label>
            </div>
          </div>
        `}

        <!-- 5. 特記事項 -->
        <div class="form-group">
          <label class="form-label">特記事項・理由（任意）</label>
          <textarea id="man-txt-remarks" class="form-control" placeholder="例: 紙紛失のため口頭連絡。12/28はZoom受講希望など" ${isCompleted ? 'disabled' : ''}></textarea>
        </div>

        <div style="margin-top: var(--spacing-xl); display: flex; justify-content: flex-end; align-items: center; gap: 12px;">
          <button id="btn-save-manual" class="btn ${isCompleted ? 'btn-secondary' : 'btn-primary'} btn-lg" style="min-width: 160px;" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
            ${isCompleted ? '🔒 完了のため保存不可' : '💾 登録を保存する'}
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  bindEvents() {
    const backBtn = this.container.querySelector('#btn-manual-back-list');
    if (backBtn) {
      backBtn.onclick = () => {
        window.location.hash = `#project/${this.project.id}/list`;
      };
    }

    const addStudentBtn = this.container.querySelector('#btn-manual-add-new-student');
    if (addStudentBtn) {
      addStudentBtn.onclick = async () => {
        if (typeof ProjectPage.openStudentManagementModal === 'function') {
          await ProjectPage.openStudentManagementModal(this.project.id);
          // モーダル操作後に生徒リストを再取得
          this.studentsList = await DB.getProjectStudentsWithSubmissions(this.project.id);
        }
      };
    }

    if (this.project.status === '完了') {
      return; // 完了時は入力用イベントバインド不要
    }

    const staffSelect = this.container.querySelector('#man-sel-staff');
    if (staffSelect) {
      staffSelect.onchange = () => {
        this.selectedStaff = staffSelect.value;
        if (this.selectedStaff) {
          staffSelect.style.borderColor = '';
        }
      };
    }

    const searchInput = this.container.querySelector('#man-inp-search-student');
    const resultsBox = this.container.querySelector('#man-student-search-results');
    const selectedStudentCard = this.container.querySelector('#man-selected-student-card');
    const clearSelectedBtn = this.container.querySelector('#btn-clear-selected-student');

    const dispName = this.container.querySelector('#man-disp-name');
    const dispId = this.container.querySelector('#man-disp-id');
    const dispClass = this.container.querySelector('#man-disp-class');
    const dispStatus = this.container.querySelector('#man-disp-status');

    // ひらがなをカタカナに変換するヘルパー
    const toKatakana = (str) => {
      return (str || '').replace(/[\u3041-\u3096]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) + 0x60)
      );
    };

    // 生徒インクリメンタル検索
    searchInput.oninput = () => {
      const rawQ = searchInput.value.trim().toLowerCase();
      if (!rawQ) {
        resultsBox.style.display = 'none';
        return;
      }

      const q = rawQ.replace(/[\s　]+/g, '');
      const qKana = toKatakana(q);

      const matches = this.studentsList.filter(s => {
        const id = (s.nichinokenId || '').toLowerCase();
        const name = (s.name || '').toLowerCase().replace(/[\s　]+/g, '');
        const kana = toKatakana((s.nameKana || '').toLowerCase().replace(/[\s　]+/g, ''));

        return id.includes(q) ||
          name.includes(q) ||
          kana.includes(qKana) ||
          (s.name || '').toLowerCase().includes(rawQ);
      });

      if (matches.length === 0) {
        resultsBox.innerHTML = '<div style="padding: 8px 12px; font-size: 0.85rem; color: var(--gray-500);">該当する生徒はいません</div>';
        resultsBox.style.display = 'block';
        return;
      }

      resultsBox.innerHTML = matches.map(s => `
        <div class="student-search-item" data-id="${s.studentId}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--gray-100); font-size: 0.88rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="font-bold">${s.name}</span>
            <span class="text-muted" style="font-size: 0.78rem; margin-left: 4px;">(${s.nameKana || ''})</span>
            <span class="text-mono" style="font-size: 0.82rem; margin-left: 6px; color: var(--primary-600);">${s.nichinokenId}</span>
          </div>
          <div>
            <span class="badge badge-gray">${s.className}</span>
            <span class="badge ${s.status === '承認済' ? 'badge-success' : 'badge-gray'}">${s.status}</span>
          </div>
        </div>
      `).join('');

      resultsBox.style.display = 'block';

      // 候補クリック
      resultsBox.querySelectorAll('.student-search-item').forEach(item => {
        item.onclick = () => {
          const sid = item.dataset.id;
          const stu = this.studentsList.find(s => s.studentId === sid);
          if (stu) {
            this.selectStudent(stu, dispName, dispId, dispClass, dispStatus, selectedStudentCard, resultsBox, searchInput);
          }
        };
      });
    };

    // 日能研番号または生徒名のEnter即時確定
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const rawQ = searchInput.value.trim().toLowerCase();
        if (!rawQ) return;
        const q = rawQ.replace(/[\s　]+/g, '');
        const qKana = toKatakana(q);

        // 完全一致があれば最優先
        const exactMatch = this.studentsList.find(s => 
          (s.nichinokenId || '').toLowerCase() === q ||
          (s.name || '').replace(/[\s　]+/g, '') === q
        );
        if (exactMatch) {
          this.selectStudent(exactMatch, dispName, dispId, dispClass, dispStatus, selectedStudentCard, resultsBox, searchInput);
          return;
        }

        // 候補が1件のみなら確定
        const matches = this.studentsList.filter(s => {
          const id = (s.nichinokenId || '').toLowerCase();
          const name = (s.name || '').toLowerCase().replace(/[\s　]+/g, '');
          const kana = toKatakana((s.nameKana || '').toLowerCase().replace(/[\s　]+/g, ''));
          return id.includes(q) || name.includes(q) || kana.includes(qKana);
        });
        if (matches.length === 1) {
          this.selectStudent(matches[0], dispName, dispId, dispClass, dispStatus, selectedStudentCard, resultsBox, searchInput);
        }
      }
    };

    clearSelectedBtn.onclick = () => {
      this.selectedStudent = null;
      selectedStudentCard.classList.add('hidden');
      searchInput.value = '';
      searchInput.focus();
    };

    // ラジオ選択制御（受講確認モードのみ）
    const radioNoChange = this.container.querySelector('input[value="no-change"]');
    const radioHasChange = this.container.querySelector('input[value="has-change"]');
    const cardNoChange = this.container.querySelector('#man-card-no-change');
    const cardHasChange = this.container.querySelector('#man-card-has-change');
    const changeClassSelect = this.container.querySelector('#man-sel-change-class');
    const changeCourseSelect = this.container.querySelector('#man-sel-change-course');

    if (radioNoChange && radioHasChange && cardNoChange && cardHasChange) {
      const updateRadio = () => {
        if (radioNoChange.checked) {
          cardNoChange.classList.add('selected');
          cardHasChange.classList.remove('selected');
          if (changeClassSelect) changeClassSelect.disabled = true;
          if (changeCourseSelect) changeCourseSelect.disabled = true;
        } else {
          cardNoChange.classList.remove('selected');
          cardHasChange.classList.add('selected');
          if (changeClassSelect) {
            changeClassSelect.disabled = false;
            changeClassSelect.focus();
          }
          if (changeCourseSelect && changeClassSelect) {
            changeCourseSelect.disabled = (changeClassSelect.value === '非受講');
          }
        }
      };

      if (changeClassSelect) {
        changeClassSelect.onchange = () => {
          if (changeClassSelect.value === '非受講') {
            if (changeCourseSelect) changeCourseSelect.disabled = true;
          } else if (radioHasChange.checked) {
            if (changeCourseSelect) changeCourseSelect.disabled = false;
          }
        };
      }

      radioNoChange.onchange = updateRadio;
      radioHasChange.onchange = updateRadio;
      cardNoChange.onclick = () => { radioNoChange.checked = true; updateRadio(); };
      cardHasChange.onclick = (e) => {
        if (e.target !== changeClassSelect && e.target !== changeCourseSelect) {
          radioHasChange.checked = true;
          updateRadio();
        }
      };
    }

    // 志望校別・講座チェックボックスのリアルタイムカウンター・連動
    const manCustomChecks = this.container.querySelectorAll('.chk-man-custom-box-item');
    const manZeroNote = this.container.querySelector('#man-zero-selected-note');

    const updateManCount = () => {
      let count = 0;
      manCustomChecks.forEach(chk => {
        if (chk.checked) count++;
        const row = chk.closest('.custom-box-check-row');
        if (row) {
          row.style.background = chk.checked ? '#f5f3ff' : '#fff';
          row.style.borderColor = chk.checked ? '#c4b5fd' : 'var(--gray-200)';
          const textEl = row.querySelector('span[style*="font-weight: 700"]');
          if (textEl) textEl.style.color = chk.checked ? '#6d28d9' : 'var(--gray-800)';
          const badgeEl = row.querySelector('.badge');
          if (badgeEl) {
            badgeEl.className = `badge ${chk.checked ? 'badge-purple font-bold' : 'badge-gray'}`;
            badgeEl.textContent = chk.checked ? '✅ 選択' : '⬜ なし';
          }
        }
      });
      const countEl = this.container.querySelector('#man-sel-count');
      if (countEl) countEl.textContent = count;
      if (manZeroNote) {
        manZeroNote.style.display = (count === 0) ? 'block' : 'none';
      }
    };
    manCustomChecks.forEach(chk => chk.addEventListener('change', updateManCount));

    // 講座選択モード用: クイック選択ツールバー
    const btnManSelectAll = this.container.querySelector('#btn-man-select-all');
    const btnManSelectNone = this.container.querySelector('#btn-man-select-none');
    if (btnManSelectAll) {
      btnManSelectAll.onclick = () => {
        manCustomChecks.forEach(chk => { chk.checked = true; });
        updateManCount();
      };
    }
    if (btnManSelectNone) {
      btnManSelectNone.onclick = () => {
        manCustomChecks.forEach(chk => { chk.checked = false; });
        updateManCount();
      };
    }

    const quickMethodContainer = this.container.querySelector('#man-quick-method-filters');
    if (quickMethodContainer && manCustomChecks.length > 0) {
      const methods = new Set();
      manCustomChecks.forEach(chk => {
        const label = chk.dataset.label || '';
        const m = label.match(/[（\(](Zoom|対面|動画|テスト|校舎|午前|午後)[）\)]/i);
        if (m) methods.add(m[1]);
      });

      if (methods.size > 0) {
        quickMethodContainer.innerHTML = Array.from(methods).map(m => `
          <button type="button" class="btn btn-ghost btn-sm btn-quick-man-method" data-method="${m}" style="font-size: 0.75rem; padding: 2px 7px; border: 1px solid var(--purple-300, #c4b5fd); color: #6d28d9; background: rgba(139, 92, 246, 0.05);">
            ${m}のみ
          </button>
        `).join('');

        quickMethodContainer.querySelectorAll('.btn-quick-man-method').forEach(btn => {
          btn.onclick = () => {
            const mTag = btn.dataset.method;
            manCustomChecks.forEach(chk => {
              const label = chk.dataset.label || '';
              chk.checked = label.includes(mTag);
            });
            updateManCount();
          };
        });
      }
    }

    // 保存ボタン
    this.container.querySelector('#btn-save-manual').onclick = async () => {
      if (this.project.status === '完了') {
        UI.showToast('完了したプロジェクトには手動登録できません。「進行中に戻す」を行ってください。', 'warning');
        return;
      }

      const staff = staffSelect.value;
      if (!staff) {
        UI.showToast('受付担当者を選択してください', 'warning');
        staffSelect.focus();
        staffSelect.style.borderColor = 'var(--danger-solid)';
        return;
      }

      if (!this.selectedStudent) {
        UI.showToast('対象の生徒を選択してください', 'warning');
        searchInput.focus();
        return;
      }

      const method = this.container.querySelector('#man-sel-method').value;
      const datetime = this.container.querySelector('#man-inp-datetime').value;
      const remarks = this.container.querySelector('#man-txt-remarks').value.trim();

      const isSelectionMode = (this.project.projectType === 'selection');
      let hasChange = false;
      let enrollmentClass = this.selectedStudent.className;
      let enrollmentCourse = this.selectedStudent.course || '4科';
      const customChecks = {};
      let selectedCourses = [];

      if (isSelectionMode) {
        manCustomChecks.forEach(chk => {
          const id = chk.dataset.id;
          const label = chk.dataset.label;
          customChecks[id] = { id, label, isChecked: chk.checked };
        });
        selectedCourses = Object.values(customChecks).filter(c => c.isChecked).map(c => c.label);
        const totalSelected = selectedCourses.length;
        hasChange = totalSelected > 0;
        enrollmentClass = totalSelected > 0 ? `${totalSelected}講座申込` : '0講座（未受講）';
        enrollmentCourse = '-';
      } else {
        hasChange = radioHasChange ? radioHasChange.checked : false;
        if (hasChange) {
          const sel = changeClassSelect ? changeClassSelect.value : '';
          if (!sel) {
            UI.showToast('変更先クラスまたは非受講を選択してください', 'warning');
            if (changeClassSelect) changeClassSelect.focus();
            return;
          }
          enrollmentClass = sel;
          if (enrollmentClass === '非受講') {
            enrollmentCourse = '非受講';
          } else {
            enrollmentCourse = changeCourseSelect ? changeCourseSelect.value : (this.selectedStudent.course || '4科');
          }
        }
      }

      const saveBtn = this.container.querySelector('#btn-save-manual');
      if (saveBtn) UI.setButtonLoading(saveBtn, true, '登録中...');

      try {
        const payload = {
          status: '承認済',
          hasChange,
          enrollmentClass,
          enrollmentCourse,
          inputMethod: method,
          approvedBy: staff,
          remarks,
          submittedAt: datetime ? new Date(datetime).toISOString() : new Date().toISOString(),
          approvedAt: new Date().toISOString()
        };
        if (isSelectionMode) {
          payload.customChecks = customChecks;
          payload.selectedCourses = selectedCourses;
        }

        await DB.saveSubmission(this.selectedStudent.submissionId, payload);

        const syncNote = FolderConnector.isConnected() ? '（共有フォルダ同期済）' : '';
        UI.showToast(`${this.selectedStudent.name} 様の受講内容を手動登録しました${syncNote}`, 'success');

        if (typeof ProjectPage.updateHeaderStats === 'function') {
          ProjectPage.updateHeaderStats();
        }

        // 保存完了後、提出状況一覧画面へ戻る
        window.location.hash = `#project/${this.project.id}/list`;
      } catch (err) {
        UI.showToast(`保存エラー: ${err.message}`, 'error');
        if (saveBtn) UI.setButtonLoading(saveBtn, false);
      }
    };
  },

  updateChangeClassOptions(stu) {
    const select = this.container.querySelector('#man-sel-change-class');
    if (!select) return;
    const currentStuClass = stu ? stu.className : '';
    let html = `<option value="">-- 変更先クラス / 非受講を選択 --</option>`;
    if (currentStuClass) {
      html += `<option value="${currentStuClass}">${currentStuClass} クラス（クラス変更なし）</option>`;
    }
    this.classList.forEach(c => {
      if (c !== currentStuClass) {
        html += `<option value="${c}">${c} クラスへ変更</option>`;
      }
    });
    html += `<option value="非受講" style="color: var(--danger-solid); font-weight: bold;">🚫 非受講（受講しない）</option>`;
    select.innerHTML = html;
  },

  selectStudent(stu, dispName, dispId, dispClass, dispStatus, card, resultsBox, searchInput) {
    this.selectedStudent = stu;
    dispName.textContent = stu.name;
    dispId.textContent = stu.nichinokenId;
    dispClass.textContent = stu.className;
    const dispCourse = this.container.querySelector('#man-disp-course');
    if (dispCourse) {
      dispCourse.textContent = stu.course || '4科';
    }
    dispStatus.textContent = stu.status;
    card.classList.remove('hidden');
    resultsBox.style.display = 'none';
    searchInput.value = `${stu.name} (${stu.nichinokenId})`;

    this.updateChangeClassOptions(stu);

    // 既存の入力があれば初期反映
    const radioNoChange = this.container.querySelector('input[value="no-change"]');
    const radioHasChange = this.container.querySelector('input[value="has-change"]');
    const changeClassSelect = this.container.querySelector('#man-sel-change-class');
    const changeCourseSelect = this.container.querySelector('#man-sel-change-course');
    const cardNoChange = this.container.querySelector('#man-card-no-change');
    const cardHasChange = this.container.querySelector('#man-card-has-change');
    const remarksInput = this.container.querySelector('#man-txt-remarks');

    remarksInput.value = stu.remarks || '';

    const isSelectionMode = (this.project.projectType === 'selection');
    if (isSelectionMode) {
      const savedChecks = stu.customChecks || {};
      const manCustomChecks = this.container.querySelectorAll('.chk-man-custom-box-item');
      let count = 0;
      manCustomChecks.forEach(chk => {
        const id = chk.dataset.id;
        const isChecked = !!(savedChecks[id] && savedChecks[id].isChecked);
        chk.checked = isChecked;
        if (isChecked) count++;

        const row = chk.closest('.custom-box-check-row');
        if (row) {
          row.style.background = isChecked ? '#f5f3ff' : '#fff';
          row.style.borderColor = isChecked ? '#c4b5fd' : 'var(--gray-200)';
          const textEl = row.querySelector('span[style*="font-weight: 700"]');
          if (textEl) textEl.style.color = isChecked ? '#6d28d9' : 'var(--gray-800)';
          const badgeEl = row.querySelector('.badge');
          if (badgeEl) {
            badgeEl.className = `badge ${isChecked ? 'badge-purple font-bold' : 'badge-gray'}`;
            badgeEl.textContent = isChecked ? '✅ 選択' : '⬜ なし';
          }
        }
      });
      const countEl = this.container.querySelector('#man-sel-count');
      if (countEl) countEl.textContent = count;
      const manZeroNote = this.container.querySelector('#man-zero-selected-note');
      if (manZeroNote) {
        manZeroNote.style.display = (count === 0) ? 'block' : 'none';
      }
    } else {
      if (stu.status === '承認済' && (stu.hasChange || stu.enrollmentClass === '非受講')) {
        if (radioHasChange) radioHasChange.checked = true;
        if (cardNoChange) cardNoChange.classList.remove('selected');
        if (cardHasChange) cardHasChange.classList.add('selected');
        if (changeClassSelect) {
          changeClassSelect.disabled = false;
          changeClassSelect.value = stu.enrollmentClass || '';
        }
        if (changeCourseSelect) {
          changeCourseSelect.value = (stu.enrollmentCourse && stu.enrollmentCourse !== '-' && stu.enrollmentCourse !== '非受講')
            ? stu.enrollmentCourse 
            : (stu.course || '4科');
          changeCourseSelect.disabled = (stu.enrollmentClass === '非受講');
        }
      } else {
        if (radioNoChange) radioNoChange.checked = true;
        if (cardNoChange) cardNoChange.classList.add('selected');
        if (cardHasChange) cardHasChange.classList.remove('selected');
        if (changeClassSelect) changeClassSelect.disabled = true;
        if (changeCourseSelect) {
          changeCourseSelect.value = stu.course || '4科';
          changeCourseSelect.disabled = true;
        }
      }
    }
  }
};
