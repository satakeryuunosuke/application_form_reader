import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { ScannerEngine } from '../scanner.js';
import { Validator } from '../utils/validator.js';
import { TemplateCalibrator } from '../components/calibrator.js';
import { ProjectPage } from './project.js';

export const ScanPage = {
  container: null,
  project: null,
  pendingQueue: [],
  currentIndex: 0,
  staffList: [],
  selectedStaff: '',
  classList: [],
  zoomLevel: 1.0,

  async render(container, project) {
    this.container = container;
    this.project = project;

    const settings = await DB.getSettings();
    this.staffList = settings.staffNames || ['担当者'];
    this.selectedStaff = this.selectedStaff || '';
    this.classList = await DB.getProjectClasses(project.id);

    if (this.pendingQueue.length === 0) {
      this.renderUploadView();
    } else {
      this.renderApprovalView();
    }
  },

  /**
   * PDFアップロード・読取開始ビュー
   */
  renderUploadView() {
    const isCompleted = this.project.status === '完了';

    if (isCompleted) {
      this.container.innerHTML = `
        <div class="card" style="max-width: 720px; margin: 0 auto; text-align: center; padding: 48px 24px;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🔒</div>
          <h2 class="card-title" style="margin-bottom: 8px; font-size: 1.35rem; color: var(--gray-900);">スキャン読取はロックされています</h2>
          <p style="color: var(--gray-600); max-width: 520px; margin: 0 auto 24px auto; font-size: 0.95rem; line-height: 1.6;">
            このプロジェクトは「<strong>完了</strong>」に設定されているため、受講確認票のスキャン読み取りおよびデータ登録はできません。<br>
            追加のスキャンや再読み取りを行う場合は、右上の「<strong>🔄 進行中に戻す</strong>」ボタンをクリックしてプロジェクトを進行中に戻してください。
          </p>
          <div style="display: inline-flex; gap: 12px;">
            <button id="btn-scan-unlock-reopen" class="btn btn-primary">
              🔄 進行中に戻してスキャンする
            </button>
            <a href="#home" class="btn btn-secondary">プロジェクト一覧へ</a>
          </div>
        </div>
      `;

      const unlockBtn = this.container.querySelector('#btn-scan-unlock-reopen');
      if (unlockBtn) {
        unlockBtn.onclick = async () => {
          try {
            await DB.updateProjectStatus(this.project.id, '進行中');
            this.project.status = '進行中';
            UI.showToast('プロジェクトを進行中に戻しました', 'success');
            if (typeof ProjectPage.render === 'function') {
              await ProjectPage.render(this.container.closest('.view-container') ? this.container.closest('.view-container').parentNode : this.container, this.project.id, 'scan');
            } else {
              this.render(this.container, this.project);
            }
          } catch (err) {
            UI.showToast(`ステータス変更エラー: ${err.message}`, 'error');
          }
        };
      }
      return;
    }

    this.container.innerHTML = `
      <div class="card" style="max-width: 800px; margin: 0 auto;">
        <div class="card-header">
          <h2 class="card-title">📷 スキャンPDF読取</h2>
          <span class="badge badge-info">複数ページ連続スキャン対応</span>
        </div>

        <div style="margin-bottom: var(--spacing-lg);">
          <p style="color: var(--gray-600); line-height: 1.6; font-size: 0.94rem;">
            受講確認票をスキャンしたPDFファイルをアップロードしてください。<br>
            バーコードから生徒を自動照合し、チェックボックスの塗りつぶしを判定して承認キューに追加します。
          </p>
        </div>

        <div id="pdf-dropzone" class="dropzone" style="margin-bottom: var(--spacing-lg);">
          <div class="dropzone-icon">📑</div>
          <div class="dropzone-text">スキャンPDFをドラッグ＆ドロップ</div>
          <div class="dropzone-subtext">またはここをクリックしてファイルを選択 (.pdf)</div>
          <input type="file" id="pdf-file-input" accept=".pdf,application/pdf" style="display: none;">
        </div>

        <div id="scan-progress-box" class="hidden" style="margin-top: var(--spacing-lg);">
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem; margin-bottom: 6px;">
            <span id="scan-progress-status" class="font-medium text-muted">解析中...</span>
            <span id="scan-progress-percent" class="font-bold" style="color: var(--primary-600);">0%</span>
          </div>
          <div style="height: 8px; background: var(--gray-200); border-radius: 999px; overflow: hidden;">
            <div id="scan-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--primary-500), var(--secondary)); transition: width 0.2s;"></div>
          </div>
        </div>
      </div>
    `;

    const dropzone = this.container.querySelector('#pdf-dropzone');
    const fileInput = this.container.querySelector('#pdf-file-input');

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
        this.processPdfFile(e.dataTransfer.files[0]);
      }
    };

    fileInput.onchange = () => {
      if (fileInput.files.length > 0) {
        this.processPdfFile(fileInput.files[0]);
      }
    };
  },

  /**
   * PDF処理実行
   */
  async processPdfFile(file) {
    if (this.project.status === '完了') {
      UI.showToast('完了したプロジェクトにはスキャン登録できません。「進行中に戻す」を行ってください。', 'warning');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      UI.showToast('PDFファイルを選択してください', 'error');
      return;
    }

    const progressBox = this.container.querySelector('#scan-progress-box');
    const statusText = this.container.querySelector('#scan-progress-status');
    const percentText = this.container.querySelector('#scan-progress-percent');
    const progressBar = this.container.querySelector('#scan-progress-bar');
    const dropzone = this.container.querySelector('#pdf-dropzone');

    dropzone.style.pointerEvents = 'none';
    dropzone.style.opacity = '0.5';
    progressBox.classList.remove('hidden');

    try {
      const template = this.project.scanTemplate;
      const scanResults = await ScannerEngine.processPdf(file, template, (p) => {
        const pct = Math.round((p.current / p.total) * 100);
        statusText.textContent = p.status;
        percentText.textContent = `${pct}%`;
        progressBar.style.width = `${pct}%`;
      });

      // 各スキャン結果に対してDBの生徒情報を照合
      this.pendingQueue = [];
      const submissions = await DB.getProjectStudentsWithSubmissions(this.project.id);
      const subMap = new Map(submissions.map(s => [s.studentId, s]));

      for (const res of scanResults) {
        let student = null;
        let existingSubmission = null;
        if (res.rawNichinokenId) {
          student = await DB.findStudentByNichinokenId(this.project.id, res.rawNichinokenId);
          if (student) {
            existingSubmission = subMap.get(student.id) || null;
          }
        }

        this.pendingQueue.push({
          ...res,
          matchedStudent: student,
          existingSubmission: existingSubmission,
          // 初期判定値
          detectedHasChange: res.checkResult?.hasChange || false,
          approved: false
        });
      }

      this.currentIndex = 0;
      UI.showToast(`${scanResults.length} ページの受講確認票を読み込みました`, 'success');
      this.renderApprovalView();
    } catch (err) {
      console.error(err);
      UI.showToast(`スキャン読取エラー: ${err.message}`, 'error');
      dropzone.style.pointerEvents = 'auto';
      dropzone.style.opacity = '1';
      progressBox.classList.add('hidden');
    }
  },

  /**
   * 左右2ペインの承認ビュー
   */
  async renderApprovalView() {
    if (this.pendingQueue.length === 0 || this.currentIndex >= this.pendingQueue.length) {
      // 承認完了
      this.container.innerHTML = `
        <div class="card" style="max-width: 600px; margin: 0 auto; text-align: center; padding: var(--spacing-2xl);">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
          <h2 class="card-title font-bold" style="font-size: 1.4rem; margin-bottom: 8px;">すべての確認票の承認が完了しました！</h2>
          <p style="color: var(--gray-600); margin-bottom: var(--spacing-xl);">
            スキャンしたデータはIndexedDBに正常に保存・更新されました。
          </p>
          <div style="display: flex; justify-content: center; gap: 12px;">
            <button id="btn-re-upload" class="btn btn-secondary">
              ➕ 別のPDFをスキャン
            </button>
            <button id="btn-go-list" class="btn btn-primary">
              📊 提出状況一覧を見る
            </button>
          </div>
        </div>
      `;

      this.container.querySelector('#btn-re-upload').onclick = () => {
        this.pendingQueue = [];
        this.renderUploadView();
      };
      this.container.querySelector('#btn-go-list').onclick = () => {
        const listTabBtn = document.querySelector('.tab-btn[data-tab="list"]');
        if (listTabBtn) listTabBtn.click();
      };
      return;
    }

    const currentItem = this.pendingQueue[this.currentIndex];
    const student = currentItem.matchedStudent;

    // 最新の登録状況を取得して判定
    let existingSub = currentItem.existingSubmission;
    if (student) {
      const submissions = await DB.getProjectStudentsWithSubmissions(this.project.id);
      existingSub = submissions.find(s => s.studentId === student.id) || null;
      currentItem.existingSubmission = existingSub;
    }
    const isAlreadyApproved = existingSub && existingSub.status === '承認済';

    this.container.innerHTML = `
      <div class="scan-split-container">
        <!-- 左ペイン: スキャン画像実寸ビューア -->
        <div class="scan-viewer-pane">
          <div class="viewer-toolbar">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge badge-purple">ページ ${currentItem.pageNum} / ${this.pendingQueue.length}</span>
              ${currentItem.barcodeFound ? '<span class="badge badge-success">バーコード検知済</span>' : '<span class="badge badge-danger">バーコード未検知</span>'}
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button id="btn-scan-calib" class="btn btn-ghost btn-sm" style="color:#fff; border: 1px solid rgba(255,255,255,0.25);" title="このプロジェクトの書式・読取位置を調整">
                📐 書式調整
              </button>
              <button id="btn-zoom-out" class="btn btn-ghost btn-sm" style="color:#fff;" title="縮小">🔍-</button>
              <span id="zoom-val" style="font-size: 0.8rem; font-family: var(--font-mono);">${Math.round(this.zoomLevel * 100)}%</span>
              <button id="btn-zoom-in" class="btn btn-ghost btn-sm" style="color:#fff;" title="拡大">🔍+</button>
              <button id="btn-zoom-reset" class="btn btn-ghost btn-sm" style="color:#fff;" title="リセット">100%</button>
              <button id="btn-fullscreen-img" class="btn btn-ghost btn-sm" style="color:#fff; border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.1);" title="スキャン確認票を全画面拡大表示">
                ⛶ 全画面拡大
              </button>
            </div>
          </div>
          <div class="viewer-canvas-wrap" id="image-viewer-wrap" title="ホイールでズーム / クリックで全画面拡大">
            <img id="scanned-image-preview" src="${currentItem.imageDataUrl}" style="transform: scale(${this.zoomLevel}); cursor: pointer;" alt="スキャン確認票" title="クリックして全画面拡大">
          </div>
        </div>

        <!-- 右ペイン: 読取結果・承認コントロール -->
        <div class="scan-approval-pane">
          <!-- 上部スクロールエリア -->
          <div class="approval-scroll-area">
            <!-- 作業者選択 -->
            <div class="form-group" style="margin-bottom: 10px;">
              <label class="form-label" style="font-size: 0.82rem; margin-bottom: 4px;">作業者（承認者） <span class="required">*</span></label>
              <select id="sel-staff" class="form-control font-bold" style="background: var(--gray-50); padding: 7px 10px; font-size: 0.9rem; ${!this.selectedStaff ? 'border-color: var(--warning-solid);' : ''}">
                <option value="" ${!this.selectedStaff ? 'selected' : ''}>-- 選択してください --</option>
                ${this.staffList.map(s => `<option value="${s}" ${s === this.selectedStaff ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>

            <!-- 生徒情報照合セクション -->
            <div class="approval-section">
              <div class="approval-section-title">
                <span>👤 生徒情報</span>
                <span id="student-match-badge">
                  ${student 
                    ? (isAlreadyApproved 
                        ? '<span class="badge badge-warning" style="font-weight: bold;">⚠️ 既に登録済（上書き対象）</span>' 
                        : '<span class="badge badge-success">DB照合一致</span>') 
                    : '<span class="badge badge-danger">未登録の番号</span>'}
                </span>
              </div>

              <div class="form-group" style="margin-bottom: 6px;">
                <label class="form-label" style="font-size: 0.76rem; margin-bottom: 3px;">日能研番号（誤読時は手動修正）</label>
                <div style="display: flex; gap: 6px;">
                  <input type="text" id="inp-nichinoken-id" class="form-control text-mono font-bold" value="${currentItem.validatedId || ''}" placeholder="例: TDN60013" style="padding: 6px 10px; font-size: 0.92rem;">
                  <button id="btn-re-search" class="btn btn-secondary btn-sm" title="生徒再検索" style="padding: 6px 10px; font-size: 0.8rem; white-space: nowrap;">再検索</button>
                </div>
                <div id="id-error-msg" class="text-muted" style="font-size: 0.72rem; color: var(--danger-solid); margin-top: 2px; min-height: 14px;">
                  ${!currentItem.isIdValid && currentItem.idValidationReason ? currentItem.idValidationReason : ''}
                </div>
              </div>

              <div class="student-info-grid">
                <div class="info-box">
                  <div class="info-label">氏名</div>
                  <div id="disp-student-name" class="info-value">${student ? student.name : '<span class="text-muted">（未登録）</span>'}</div>
                  <div id="disp-student-kana" style="font-size: 0.72rem; color: var(--gray-500);">${student ? student.nameKana : ''}</div>
                </div>
                <div class="info-box">
                  <div class="info-label">所属クラス</div>
                  <div id="disp-student-class" class="info-value">
                    ${student ? `<span class="badge badge-info" style="font-size: 0.88rem; padding: 3px 8px;">${student.className}</span>` : '<span class="text-muted">-</span>'}
                  </div>
                </div>
              </div>

              <!-- 既存登録がある場合の詳細サマリーボックス -->
              <div id="disp-existing-info-box" style="${isAlreadyApproved ? 'display: block;' : 'display: none;'} margin-top: 8px;">
                ${this.renderExistingInfoSnippet(student, existingSub)}
              </div>
            </div>

            <!-- 受講変更セクション -->
            <div class="approval-section" style="margin-bottom: 0;">
              <div class="approval-section-title">
                <span>📝 受講内容判定</span>
                <span class="badge ${currentItem.detectedHasChange ? 'badge-warning' : 'badge-success'}">
                  自動判定: ${currentItem.detectedHasChange ? '変更あり' : '変更なし'}
                </span>
              </div>

              <div class="radio-card-group">
                <label class="radio-card ${!currentItem.detectedHasChange ? 'selected' : ''}" id="card-opt-no-change">
                  <input type="radio" name="enrollment-choice" value="no-change" ${!currentItem.detectedHasChange ? 'checked' : ''}>
                  <div>
                    <div class="font-bold" style="font-size: 0.88rem;">変更なし（所属クラスで受講）</div>
                    <div style="font-size: 0.75rem; color: var(--gray-500); line-height: 1.3;">所属クラスの期間・科目でそのまま受講</div>
                  </div>
                </label>

                <label class="radio-card ${currentItem.detectedHasChange ? 'selected' : ''}" id="card-opt-has-change">
                  <input type="radio" name="enrollment-choice" value="has-change" ${currentItem.detectedHasChange ? 'checked' : ''}>
                  <div style="flex: 1; min-width: 0;">
                    <div class="font-bold" style="font-size: 0.88rem;">変更あり（クラス変更 / 非受講）</div>
                    <div style="margin-top: 4px;">
                      <select id="sel-change-class" class="form-control font-bold" style="padding: 5px 8px; font-size: 0.84rem; width: 100%;" ${!currentItem.detectedHasChange ? 'disabled' : ''}>
                        <option value="">-- 変更先クラス / 非受講を選択 --</option>
                        ${this.classList.map(c => `<option value="${c}">${c} クラスへ変更</option>`).join('')}
                        <option value="非受講" style="color: var(--danger-solid); font-weight: bold;">🚫 非受講（受講しない）</option>
                      </select>
                    </div>
                  </div>
                </label>
              </div>

              <div class="form-group" style="margin-top: 8px; margin-bottom: 0;">
                <label class="form-label" style="font-size: 0.76rem; margin-bottom: 3px;">変更内容・特記事項（手入力メモ）</label>
                <textarea id="txt-remarks" class="form-control" placeholder="理由や希望校舎など" style="min-height: 44px; height: 44px; font-size: 0.82rem; padding: 6px 10px;"></textarea>
              </div>
            </div>
          </div>

          <!-- 下部固定: 承認操作アクション -->
          <div class="approval-actions">
            <div class="approval-actions-buttons">
              <button id="btn-skip" class="btn btn-secondary btn-action-skip">
                ⏭️ スキップ <span class="shortcut-key">(Space)</span>
              </button>
              <button id="btn-approve" class="btn btn-primary btn-action-approve">
                ✅ 承認して次へ <span class="shortcut-key">(Enter)</span>
              </button>
            </div>
            <div class="approval-remaining-count">
              残り <span class="font-bold text-mono remaining-number">${this.pendingQueue.length - this.currentIndex}</span> 枚
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindApprovalEvents(currentItem);
  },

  /**
   * 既存登録情報のスニペットHTML生成
   */
  renderExistingInfoSnippet(student, existingSub) {
    if (!student || !existingSub || existingSub.status !== '承認済') return '';
    return `
      <div style="background: var(--warning-bg); border: 1px solid var(--warning-border); border-radius: var(--radius-md); padding: 8px 10px; font-size: 0.78rem;">
        <div style="font-weight: 700; color: var(--warning-text); display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
          <span>📋 前回の登録情報 (${existingSub.inputMethod || '登録済'})</span>
          <span style="font-weight: normal; font-size: 0.74rem;">${UI.formatDate(existingSub.approvedAt || existingSub.submittedAt)}</span>
        </div>
        <div style="color: var(--gray-700); line-height: 1.4;">
          受講: <strong>${existingSub.enrollmentClass || (existingSub.hasChange ? '変更あり' : student.className)}</strong>
          ${existingSub.hasChange ? '<span class="badge badge-warning" style="font-size: 0.7rem; padding: 1px 4px; margin-left: 4px;">変更あり</span>' : '<span class="badge badge-success" style="font-size: 0.7rem; padding: 1px 4px; margin-left: 4px;">変更なし</span>'}
          ${existingSub.approvedBy ? ` | 担当: <strong>${existingSub.approvedBy}</strong>` : ''}
          ${existingSub.remarks ? `<div style="color: var(--gray-600); margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">備考: ${existingSub.remarks}</div>` : ''}
        </div>
      </div>
    `;
  },

  bindApprovalEvents(currentItem) {
    const img = this.container.querySelector('#scanned-image-preview');
    const zoomVal = this.container.querySelector('#zoom-val');
    const viewerWrap = this.container.querySelector('#image-viewer-wrap');

    // ズーム制御
    const updateZoom = (z) => {
      this.zoomLevel = Math.max(0.4, Math.min(3.5, z));
      img.style.transform = `scale(${this.zoomLevel})`;
      zoomVal.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    };

    this.container.querySelector('#btn-zoom-in').onclick = () => updateZoom(this.zoomLevel + 0.2);
    this.container.querySelector('#btn-zoom-out').onclick = () => updateZoom(this.zoomLevel - 0.2);
    this.container.querySelector('#btn-zoom-reset').onclick = () => updateZoom(1.0);

    // 左ペイン内でのホイールズーム
    if (viewerWrap) {
      viewerWrap.onwheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        updateZoom(this.zoomLevel + delta);
      };
    }

    // 全画面ライトボックス拡大表示
    const openLightbox = () => {
      const student = currentItem.matchedStudent;
      const title = student 
        ? `${student.name} 様 (${student.nichinokenId}) スキャン確認票`
        : `受講確認票 (ページ ${currentItem.pageNum})`;
      UI.showImageLightbox(currentItem.imageDataUrl, title);
    };

    const fullscreenBtn = this.container.querySelector('#btn-fullscreen-img');
    if (fullscreenBtn) fullscreenBtn.onclick = openLightbox;
    if (img) img.onclick = openLightbox;

    // 書式調整モーダル起動
    const calibBtn = this.container.querySelector('#btn-scan-calib');
    if (calibBtn) {
      calibBtn.onclick = () => {
        let currentTemplate = this.project.scanTemplate || null;
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
                    対象: ${this.project.title}
                  </div>
                </div>
              </div>
              <div class="modal-header-actions">
                <button class="btn-modal-maximize" id="btn-scan-calib-maximize" title="全画面最大化 / 元に戻す">⛶</button>
                <button class="btn-ghost btn-sm btn-close-modal" title="閉じる">✕</button>
              </div>
            </div>
            <div class="modal-body" style="padding: 10px var(--spacing-lg); max-height: 86vh;">
              <div id="scan-calib-container"></div>
            </div>
            <div class="modal-footer">
              <button id="btn-modal-cancel" class="btn btn-secondary">キャンセル</button>
              <button id="btn-modal-save" class="btn btn-primary">💾 この設定を保存して再判定</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        // 最大化トグル
        const maxBtn = modal.querySelector('#btn-scan-calib-maximize');
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

        const mount = modal.querySelector('#scan-calib-container');
        const calibrator = new TemplateCalibrator(mount, currentTemplate, (t) => {
          currentTemplate = t;
        });

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
            await DB.updateProject(this.project.id, { scanTemplate: templateToSave });
            this.project.scanTemplate = templateToSave;
            UI.showToast('受講確認票の書式設定を更新しました', 'success');
            closeModal();
            // 現在のプレビューを再描画
            this.renderApprovalView();
          } catch (err) {
            UI.showToast(`保存エラー: ${err.message}`, 'error');
          }
        };
      };
    }

    // 作業者選択
    const staffSelect = this.container.querySelector('#sel-staff');
    staffSelect.onchange = () => {
      this.selectedStaff = staffSelect.value;
      if (this.selectedStaff) {
        staffSelect.style.borderColor = '';
      }
    };

    // ラジオ選択制御
    const radioNoChange = this.container.querySelector('input[value="no-change"]');
    const radioHasChange = this.container.querySelector('input[value="has-change"]');
    const cardNoChange = this.container.querySelector('#card-opt-no-change');
    const cardHasChange = this.container.querySelector('#card-opt-has-change');
    const changeClassSelect = this.container.querySelector('#sel-change-class');

    const updateRadioUI = () => {
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

    radioNoChange.onchange = updateRadioUI;
    radioHasChange.onchange = updateRadioUI;
    cardNoChange.onclick = () => { radioNoChange.checked = true; updateRadioUI(); };
    cardHasChange.onclick = (e) => {
      if (e.target !== changeClassSelect) {
        radioHasChange.checked = true;
        updateRadioUI();
      }
    };

    // 日能研番号の手動再検索
    const nichinokenIdInput = this.container.querySelector('#inp-nichinoken-id');
    const reSearchBtn = this.container.querySelector('#btn-re-search');
    const nameDisp = this.container.querySelector('#disp-student-name');
    const kanaDisp = this.container.querySelector('#disp-student-kana');
    const classDisp = this.container.querySelector('#disp-student-class');
    const idErrorMsg = this.container.querySelector('#id-error-msg');
    const matchBadge = this.container.querySelector('#student-match-badge');
    const existingInfoBox = this.container.querySelector('#disp-existing-info-box');

    const reSearch = async () => {
      const idVal = nichinokenIdInput.value.trim().toUpperCase();
      nichinokenIdInput.value = idVal;
      const validRes = Validator.validateNichinokenId(idVal);
      idErrorMsg.textContent = validRes.isValid ? '' : (validRes.reason || '');

      const foundStudent = await DB.findStudentByNichinokenId(this.project.id, idVal);
      currentItem.matchedStudent = foundStudent;
      currentItem.validatedId = idVal;

      if (foundStudent) {
        const submissions = await DB.getProjectStudentsWithSubmissions(this.project.id);
        const existingSub = submissions.find(s => s.studentId === foundStudent.id) || null;
        currentItem.existingSubmission = existingSub;

        nameDisp.textContent = foundStudent.name;
        kanaDisp.textContent = foundStudent.nameKana;
        classDisp.innerHTML = `<span class="badge badge-info" style="font-size: 0.9rem;">${foundStudent.className}</span>`;

        if (existingSub && existingSub.status === '承認済') {
          matchBadge.innerHTML = '<span class="badge badge-warning" style="font-weight: bold;">⚠️ 既に登録済（上書き対象）</span>';
          existingInfoBox.innerHTML = this.renderExistingInfoSnippet(foundStudent, existingSub);
          existingInfoBox.style.display = 'block';
        } else {
          matchBadge.innerHTML = '<span class="badge badge-success">DB照合一致</span>';
          existingInfoBox.style.display = 'none';
        }
      } else {
        currentItem.existingSubmission = null;
        nameDisp.innerHTML = '<span class="text-muted">（未登録）</span>';
        kanaDisp.textContent = '';
        classDisp.innerHTML = '<span class="text-muted">-</span>';
        matchBadge.innerHTML = '<span class="badge badge-danger">未登録の番号</span>';
        existingInfoBox.style.display = 'none';
      }
    };

    reSearchBtn.onclick = reSearch;
    nichinokenIdInput.onblur = reSearch;
    nichinokenIdInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        reSearch();
      }
    };

    // 承認処理
    const doApprove = async () => {
      if (this.project.status === '完了') {
        UI.showToast('完了プロジェクトのため承認保存できません。「進行中に戻す」を行ってください。', 'warning');
        return;
      }

      if (!this.selectedStaff) {
        UI.showToast('作業者（承認者）を選択してください', 'warning');
        staffSelect.focus();
        staffSelect.style.borderColor = 'var(--danger-solid)';
        return;
      }

      const student = currentItem.matchedStudent;
      if (!student) {
        UI.showToast('生徒が照合されていないため承認できません。日能研番号を確認してください。', 'error');
        return;
      }

      const hasChange = radioHasChange.checked;
      let enrollmentClass = student.className;

      if (hasChange) {
        const selClass = changeClassSelect.value;
        if (!selClass) {
          UI.showToast('「変更あり」の場合、変更先クラスまたは非受講を選択してください', 'warning');
          changeClassSelect.focus();
          return;
        }
        enrollmentClass = selClass;
      }

      const remarks = this.container.querySelector('#txt-remarks').value.trim();

      // DBの提出レコードを取得
      const submissions = await DB.getProjectStudentsWithSubmissions(this.project.id);
      const target = submissions.find(s => s.studentId === student.id);

      if (!target) {
        UI.showToast('提出レコードが見つかりません', 'error');
        return;
      }

      const dataToSave = {
        status: '承認済',
        hasChange,
        enrollmentClass,
        inputMethod: 'スキャン',
        approvedBy: this.selectedStaff,
        remarks,
        scanImageBlob: currentItem.imageDataUrl,
        submittedAt: new Date().toISOString(),
        approvedAt: new Date().toISOString()
      };

      // すでに登録済（承認済）の場合、上書き確認モーダルを表示
      if (target.status === '承認済') {
        this.showOverwriteModal({
          student,
          target,
          newData: {
            hasChange,
            enrollmentClass,
            remarks,
            staff: this.selectedStaff
          },
          onOverwrite: async () => {
            await this.saveAndProceed(target.submissionId, student, dataToSave, true);
          },
          onSkip: () => {
            UI.showToast(`${student.name} 様の上書きをスキップしました`, 'info', 1800);
            this.currentIndex++;
            this.renderApprovalView();
          }
        });
        return;
      }

      // 未提出の場合は通常承認保存
      await this.saveAndProceed(target.submissionId, student, dataToSave, false);
    };

    // スキップ処理
    const doSkip = () => {
      this.currentIndex++;
      this.renderApprovalView();
    };

    this.container.querySelector('#btn-approve').onclick = doApprove;
    this.container.querySelector('#btn-skip').onclick = doSkip;

    // キーボードショートカット
    const keyHandler = (e) => {
      // モーダル表示中や入力欄フォーカス時はスキップ
      if (document.querySelector('.modal-overlay')) {
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        doApprove();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        doSkip();
      }
    };

    document.addEventListener('keydown', keyHandler, { once: true });
  },

  /**
   * 提出結果の保存と次ページ遷移
   */
  async saveAndProceed(submissionId, student, dataToSave, isOverwrite = false) {
    try {
      await DB.saveSubmission(submissionId, dataToSave);
      const msg = isOverwrite 
        ? `${student.name} 様 (${student.nichinokenId}) を上書き登録しました`
        : `${student.name} 様 (${student.nichinokenId}) を承認しました`;
      UI.showToast(msg, 'success', 2000);

      // プロジェクトヘッダーの統計およびバッジを即時更新
      if (typeof ProjectPage.updateHeaderStats === 'function') {
        ProjectPage.updateHeaderStats();
      }

      this.currentIndex++;
      this.renderApprovalView();
    } catch (err) {
      console.error(err);
      UI.showToast(`保存エラー: ${err.message}`, 'error');
    }
  },

  /**
   * すでに登録されている生徒の上書き確認モーダル（ポップアップ）
   */
  showOverwriteModal({ student, target, newData, onOverwrite, onSkip }) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 530px;">
        <div class="modal-header" style="background: var(--warning-bg); border-bottom: 1px solid var(--warning-border); padding: 14px 18px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.5rem;">⚠️</span>
            <div>
              <h3 class="modal-title font-bold" style="color: var(--warning-text); font-size: 1.05rem; margin-bottom: 2px;">
                すでに登録されている生徒です
              </h3>
              <div style="font-size: 0.78rem; color: var(--gray-600);">
                この生徒の受講確認票はすでに承認・登録されています。
              </div>
            </div>
          </div>
          <button class="btn-ghost btn-sm btn-close-modal" title="閉じる（画面にとどまる）" style="font-size: 1.1rem; line-height: 1;">✕</button>
        </div>

        <div class="modal-body" style="padding: 16px 20px;">
          <!-- 対象生徒概要 -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--gray-200); margin-bottom: 14px;">
            <div>
              <span class="font-bold" style="font-size: 1.1rem; color: var(--gray-900);">${student.name}</span>
              <span class="text-muted" style="font-size: 0.8rem; margin-left: 6px;">(${student.nameKana || ''})</span>
            </div>
            <div>
              <span class="text-mono font-bold" style="color: var(--primary-600); font-size: 0.95rem;">${student.nichinokenId}</span>
              <span class="badge badge-gray" style="margin-left: 6px;">所属: ${student.className}</span>
            </div>
          </div>

          <!-- 比較カード（前回の登録内容 VS 今回スキャン） -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
            <!-- 登録済みデータ -->
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 10px 12px;">
              <div style="font-size: 0.75rem; font-weight: 700; color: var(--gray-500); margin-bottom: 6px; display: flex; justify-content: space-between;">
                <span>📋 現在の登録内容</span>
                <span class="badge badge-gray" style="font-size: 0.68rem; padding: 1px 5px;">${target.inputMethod || '登録済'}</span>
              </div>
              <div style="font-size: 0.88rem; font-weight: 700; margin-bottom: 4px; color: var(--gray-800);">
                ${target.enrollmentClass || (target.hasChange ? '変更あり' : student.className)}
                <span class="badge ${target.hasChange ? 'badge-warning' : 'badge-success'}" style="font-size: 0.68rem; padding: 1px 4px; margin-left: 2px;">
                  ${target.hasChange ? '変更あり' : '変更なし'}
                </span>
              </div>
              <div style="font-size: 0.75rem; color: var(--gray-600); line-height: 1.45;">
                <div>担当: <strong>${target.approvedBy || '-'}</strong></div>
                <div>日時: ${UI.formatDate(target.approvedAt || target.submittedAt)}</div>
                ${target.remarks ? `<div style="margin-top: 3px; color: var(--gray-500); font-style: italic; word-break: break-all;">"${target.remarks}"</div>` : ''}
              </div>
            </div>

            <!-- 今回スキャンデータ -->
            <div style="background: var(--primary-50); border: 1px solid var(--primary-300); border-radius: var(--radius-md); padding: 10px 12px;">
              <div style="font-size: 0.75rem; font-weight: 700; color: var(--primary-700); margin-bottom: 6px; display: flex; justify-content: space-between;">
                <span>📷 今回のスキャン</span>
                <span class="badge badge-info" style="font-size: 0.68rem; padding: 1px 5px;">スキャン</span>
              </div>
              <div style="font-size: 0.88rem; font-weight: 700; margin-bottom: 4px; color: var(--primary-900);">
                ${newData.enrollmentClass}
                <span class="badge ${newData.hasChange ? 'badge-warning' : 'badge-success'}" style="font-size: 0.68rem; padding: 1px 4px; margin-left: 2px;">
                  ${newData.hasChange ? '変更あり' : '変更なし'}
                </span>
              </div>
              <div style="font-size: 0.75rem; color: var(--primary-800); line-height: 1.45;">
                <div>担当: <strong>${newData.staff}</strong></div>
                <div>日時: いま上書き</div>
                ${newData.remarks ? `<div style="margin-top: 3px; color: var(--primary-700); font-style: italic; word-break: break-all;">"${newData.remarks}"</div>` : ''}
              </div>
            </div>
          </div>

          <div style="background: var(--gray-100); padding: 8px 12px; border-radius: var(--radius-md); font-size: 0.82rem; color: var(--gray-700); line-height: 1.45;">
            💡 <strong>上書きして登録しますか？</strong><br>
            「スキップ」を選択すると、既存の登録内容を保持したまま次の確認票へ進みます。
          </div>
        </div>

        <div class="modal-footer" style="background: var(--gray-50); display: flex; justify-content: space-between; gap: 10px; padding: 12px 18px;">
          <button id="btn-modal-skip" class="btn btn-secondary" style="flex: 1; padding: 9px 14px;">
            ⏭️ スキップして次へ
          </button>
          <button id="btn-modal-overwrite" class="btn btn-primary" style="flex: 1; padding: 9px 14px;">
            💾 上書きして登録
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cleanup = () => {
      modal.remove();
      document.removeEventListener('keydown', modalKeyHandler);
    };

    const modalKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup();
        onOverwrite();
      }
    };
    document.addEventListener('keydown', modalKeyHandler);

    modal.querySelector('.btn-close-modal').onclick = cleanup;
    modal.onclick = (e) => {
      if (e.target === modal) cleanup();
    };

    modal.querySelector('#btn-modal-skip').onclick = () => {
      cleanup();
      onSkip();
    };

    modal.querySelector('#btn-modal-overwrite').onclick = () => {
      cleanup();
      onOverwrite();
    };
  }
};

