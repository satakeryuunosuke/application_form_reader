/**
 * 手動登録・変更タブ コントローラー（口頭・電話受付対応）
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { ProjectPage } from './project.js';

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
    this.project = project;

    const settings = await DB.getSettings();
    this.staffList = settings.staffNames || ['担当者'];
    this.selectedStaff = this.selectedStaff || '';
    this.classList = await DB.getProjectClasses(project.id);
    this.studentsList = await DB.getProjectStudentsWithSubmissions(project.id);
    this.selectedStudent = null;

    const isCompleted = this.project.status === '完了';
    const now = new Date();
    const nowIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    this.container.innerHTML = `
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
                内容を変更したい場合は、上部ヘッダーの「<strong>🔄 進行中に戻す</strong>」ボタンを押してください。
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
          <label class="form-label">生徒を検索・選択 <span class="required">*</span></label>
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
                所属クラス: <span id="man-disp-class" class="badge badge-gray"></span> | 
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

        <!-- 4. 受講変更内容 -->
        <div class="form-group">
          <label class="form-label">受講内容 <span class="required">*</span></label>
          <div class="radio-card-group">
            <label class="radio-card selected" id="man-card-no-change" style="${isCompleted ? 'cursor: not-allowed;' : ''}">
              <input type="radio" name="man-enroll-choice" value="no-change" checked ${isCompleted ? 'disabled' : ''}>
              <div>
                <div class="font-bold">変更なし（所属クラスで受講）</div>
              </div>
            </label>

            <label class="radio-card" id="man-card-has-change" style="${isCompleted ? 'cursor: not-allowed;' : ''}">
              <input type="radio" name="man-enroll-choice" value="has-change" ${isCompleted ? 'disabled' : ''}>
              <div style="flex: 1;">
                <div class="font-bold">変更あり（クラス変更 / 非受講）</div>
                <div style="margin-top: 6px;">
                  <select id="man-sel-change-class" class="form-control font-bold" style="padding: 6px 10px;" disabled>
                    <option value="">-- 変更先クラス / 非受講を選択 --</option>
                    ${this.classList.map(c => `<option value="${c}">${c} クラスへ変更</option>`).join('')}
                    <option value="非受講" style="color: var(--danger-solid); font-weight: bold;">🚫 非受講（受講しない）</option>
                  </select>
                </div>
              </div>
            </label>
          </div>
        </div>

        <!-- 5. 特記事項 -->
        <div class="form-group">
          <label class="form-label">特記事項・理由（任意）</label>
          <textarea id="man-txt-remarks" class="form-control" placeholder="例: 紙紛失のため口頭連絡。夏期前半は他校舎受講を希望など" ${isCompleted ? 'disabled' : ''}></textarea>
        </div>

        <div style="margin-top: var(--spacing-xl); text-align: right;">
          <button id="btn-save-manual" class="btn ${isCompleted ? 'btn-secondary' : 'btn-primary'} btn-lg" style="min-width: 160px;" ${isCompleted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
            ${isCompleted ? '🔒 完了のため保存不可' : '💾 登録を保存する'}
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  bindEvents() {
    if (this.project.status === '完了') {
      return; // 完了時はイベントバインド不要
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

    clearSelectedBtn.onclick = () => {
      this.selectedStudent = null;
      selectedStudentCard.classList.add('hidden');
      searchInput.value = '';
    };

    // ラジオ選択制御
    const radioNoChange = this.container.querySelector('input[value="no-change"]');
    const radioHasChange = this.container.querySelector('input[value="has-change"]');
    const cardNoChange = this.container.querySelector('#man-card-no-change');
    const cardHasChange = this.container.querySelector('#man-card-has-change');
    const changeClassSelect = this.container.querySelector('#man-sel-change-class');

    const updateRadio = () => {
      if (radioNoChange.checked) {
        cardNoChange.classList.add('selected');
        cardHasChange.classList.remove('selected');
        changeClassSelect.disabled = true;
      } else {
        cardNoChange.classList.remove('selected');
        cardHasChange.classList.add('selected');
        changeClassSelect.disabled = false;
        changeClassSelect.focus();
      }
    };

    radioNoChange.onchange = updateRadio;
    radioHasChange.onchange = updateRadio;
    cardNoChange.onclick = () => { radioNoChange.checked = true; updateRadio(); };
    cardHasChange.onclick = (e) => {
      if (e.target !== changeClassSelect) {
        radioHasChange.checked = true;
        updateRadio();
      }
    };

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

      const hasChange = radioHasChange.checked;
      let enrollmentClass = this.selectedStudent.className;

      if (hasChange) {
        const sel = changeClassSelect.value;
        if (!sel) {
          UI.showToast('変更先クラスまたは非受講を選択してください', 'warning');
          changeClassSelect.focus();
          return;
        }
        enrollmentClass = sel;
      }

      try {
        await DB.saveSubmission(this.selectedStudent.submissionId, {
          status: '承認済',
          hasChange,
          enrollmentClass,
          inputMethod: method,
          approvedBy: staff,
          remarks,
          submittedAt: datetime ? new Date(datetime).toISOString() : new Date().toISOString(),
          approvedAt: new Date().toISOString()
        });

        UI.showToast(`${this.selectedStudent.name} 様の受講内容を手動登録しました`, 'success');

        if (typeof ProjectPage.updateHeaderStats === 'function') {
          ProjectPage.updateHeaderStats();
        }

        // 再レンダリング
        await this.render(this.container, this.project);
      } catch (err) {
        UI.showToast(`保存エラー: ${err.message}`, 'error');
      }
    };
  },

  selectStudent(stu, dispName, dispId, dispClass, dispStatus, card, resultsBox, searchInput) {
    this.selectedStudent = stu;
    dispName.textContent = stu.name;
    dispId.textContent = stu.nichinokenId;
    dispClass.textContent = stu.className;
    dispStatus.textContent = stu.status;
    card.classList.remove('hidden');
    resultsBox.style.display = 'none';
    searchInput.value = `${stu.name} (${stu.nichinokenId})`;

    // 既存の入力があれば初期反映
    const radioNoChange = this.container.querySelector('input[value="no-change"]');
    const radioHasChange = this.container.querySelector('input[value="has-change"]');
    const changeClassSelect = this.container.querySelector('#man-sel-change-class');
    const cardNoChange = this.container.querySelector('#man-card-no-change');
    const cardHasChange = this.container.querySelector('#man-card-has-change');
    const remarksInput = this.container.querySelector('#man-txt-remarks');

    remarksInput.value = stu.remarks || '';

    if (stu.status === '承認済' && (stu.hasChange || stu.enrollmentClass === '非受講')) {
      radioHasChange.checked = true;
      cardNoChange.classList.remove('selected');
      cardHasChange.classList.add('selected');
      changeClassSelect.disabled = false;
      changeClassSelect.value = stu.enrollmentClass || '';
    } else {
      radioNoChange.checked = true;
      cardNoChange.classList.add('selected');
      cardHasChange.classList.remove('selected');
      changeClassSelect.disabled = true;
    }
  }
};
