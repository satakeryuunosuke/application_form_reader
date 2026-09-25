import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { ScannerEngine } from '../scanner.js';
import { Validator } from '../utils/validator.js';
import { TemplateCalibrator } from '../components/calibrator.js';
import { ProjectPage } from './project.js';
import { FolderConnector } from '../sync/folder-connector.js';
import { SyncManager } from '../sync/sync-manager.js';

export const ScanPage = {
  container: null,
  project: null,
  pendingQueue: [],
  currentIndex: 0,
  staffList: [],
  selectedStaff: '',
  classList: [],
  zoomLevel: 1.0,

  resetQueue() {
    if (this._currentKeyHandler) {
      document.removeEventListener('keydown', this._currentKeyHandler);
      this._currentKeyHandler = null;
    }
    if (SyncManager.isBatchMode()) {
      SyncManager.endBatchMode({ flush: true, notify: false });
    }
    this.pendingQueue = [];
    this.currentIndex = 0;
    this.zoomLevel = 1.0;
  },

  async render(container, project) {
    this.container = container;

    // 別のプロジェクトに切り替わった場合は、前プロジェクトのスキャンキュー・進捗状態を完全にリセット
    if (!this.project || this.project.id !== project.id) {
      this.resetQueue();
    }
    this.project = project;

    // 前回のスキャン承認が全件完了している場合は、キューを初期化して新規アップロード画面を表示
    if (this.pendingQueue.length > 0 && this.currentIndex >= this.pendingQueue.length) {
      this.resetQueue();
    }

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
    if (SyncManager.isBatchMode()) {
      SyncManager.endBatchMode({ flush: true, notify: true });
    }

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
          <h2 class="card-title">📷 スキャン帳票読取（PDF / 画像）</h2>
          <span class="badge badge-info">PDF・JPEG・PNG複数一括対応</span>
        </div>

        <div style="margin-bottom: var(--spacing-lg);">
          <p style="color: var(--gray-600); line-height: 1.6; font-size: 0.94rem;">
            受講確認票をスキャンしたPDFファイルまたは画像ファイル（JPEG / PNG）をアップロードしてください。<br>
            バーコードから生徒を自動照合し、チェックボックスのマーク判定を行って承認キューに追加します。
          </p>
        </div>

        <div id="pdf-dropzone" class="dropzone" style="margin-bottom: var(--spacing-lg);">
          <div class="dropzone-icon">📑</div>
          <div class="dropzone-text">スキャンPDF・画像をドラッグ＆ドロップ</div>
          <div class="dropzone-subtext">またはここをクリックしてファイルを選択 (.pdf, .jpg, .png / 複数可)</div>
          <input type="file" id="pdf-file-input" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" multiple style="display: none;">
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
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.processFiles(e.dataTransfer.files);
      }
    };

    fileInput.onchange = () => {
      if (fileInput.files && fileInput.files.length > 0) {
        this.processFiles(fileInput.files);
      }
    };
  },

  /**
   * PDF・画像ファイル群の解析処理実行
   */
  async processFiles(fileList) {
    if (this.project.status === '完了') {
      UI.showToast('完了したプロジェクトにはスキャン登録できません。「進行中に戻す」を行ってください。', 'warning');
      return;
    }

    const files = Array.from(fileList).filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.pdf') || /\.(jpe?g|png|webp)$/i.test(name) || f.type === 'application/pdf' || f.type.startsWith('image/');
    });

    if (files.length === 0) {
      UI.showToast('PDFまたは画像ファイル（.pdf, .jpg, .png）を選択してください', 'error');
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
      const settings = await DB.getSettings();
      const codeType = settings.codeType || 'code39';
      const template = this.project.scanTemplate;
      const scanResults = await ScannerEngine.processFiles(files, template, (p) => {
        const pct = p.total > 0 ? Math.min(100, Math.round((p.current / p.total) * 100)) : 0;
        statusText.textContent = p.status;
        percentText.textContent = `${pct}%`;
        progressBar.style.width = `${pct}%`;
      }, { codeType });

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
      // 一連のスキャン承認フロー開始: 共有フォルダへの即時アップロードを抑止しバッチ蓄積モードにする
      SyncManager.startBatchMode();

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
      // 承認完了: バッチモードを終了し、バックグラウンドでの一括アップロードを開始
      const wasBatch = SyncManager.isBatchMode();
      if (wasBatch) {
        SyncManager.endBatchMode({ flush: true, notify: false });
      }

      const isConnected = FolderConnector.isConnected();
      const approvedCount = this.pendingQueue.filter(p => p.approved).length;

      this.container.innerHTML = `
        <div class="card" style="max-width: 640px; margin: 0 auto; text-align: center; padding: var(--spacing-2xl);">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
          <h2 class="card-title font-bold" style="font-size: 1.4rem; margin-bottom: 8px;">すべての確認票の承認が完了しました！</h2>
          <p style="color: var(--gray-600); margin-bottom: var(--spacing-lg);">
            スキャンしたデータはローカルIndexedDBに高速・安全に保存されました。
          </p>

          <!-- 共有フォルダ一括バックグラウンドアップロード進捗カード -->
          <div id="scan-sync-card" style="margin-bottom: var(--spacing-xl); padding: 14px 18px; border-radius: var(--radius-md); background: var(--gray-50); border: 1px solid var(--gray-200); text-align: left;">
            ${isConnected ? `
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.9rem; color: var(--gray-800);">
                  <span id="scan-sync-spinner" class="spinner-sm"></span>
                  <span id="scan-sync-label">共有フォルダへバックグラウンド一括アップロード中...</span>
                </div>
                <span id="scan-sync-count" class="badge badge-purple font-mono font-bold" style="font-size: 0.82rem;">0 / ${approvedCount}</span>
              </div>
              <div style="height: 6px; background: var(--gray-200); border-radius: 999px; overflow: hidden; margin-bottom: 6px;">
                <div id="scan-sync-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--primary-500), var(--secondary)); transition: width 0.2s;"></div>
              </div>
              <div id="scan-sync-hint" style="font-size: 0.78rem; color: var(--gray-500);">
                ※ アップロードはバックグラウンドで安全に実行されます。完了を待たずに別画面へ移動して問題ありません。
              </div>
            ` : `
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; color: var(--gray-700);">
                <span>⚪</span>
                <span>共有フォルダ未接続のため、ローカルDBに安全に保存されました。（次回接続時に自動アップロードされます）</span>
              </div>
            `}
          </div>

          <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <button id="btn-re-upload" class="btn btn-secondary">
              ➕ 別のPDFをスキャン
            </button>
            <button id="btn-go-review" class="btn btn-secondary" style="border-color: var(--primary-400); color: var(--primary-700);">
              🔍 スキャン照合・履歴確認
            </button>
            <button id="btn-go-list" class="btn btn-primary">
              📊 提出状況一覧を見る
            </button>
          </div>
        </div>
      `;

      // バックグラウンド進捗の監視とカード更新
      if (isConnected) {
        const syncSpinner = this.container.querySelector('#scan-sync-spinner');
        const syncLabel = this.container.querySelector('#scan-sync-label');
        const syncCount = this.container.querySelector('#scan-sync-count');
        const syncBar = this.container.querySelector('#scan-sync-progress-bar');
        const syncHint = this.container.querySelector('#scan-sync-hint');

        // すでにフラッシュが完了していた場合やキューが空だった場合の初期チェック
        if (!SyncManager.isFlushing()) {
          if (syncSpinner) { syncSpinner.className = ''; syncSpinner.textContent = '✅'; }
          if (syncLabel) syncLabel.innerHTML = '<span style="color: var(--success-700); font-weight: bold;">共有フォルダへの一括アップロードが完了しました</span>';
          if (syncBar) syncBar.style.width = '100%';
          if (syncCount) syncCount.textContent = `${approvedCount} / ${approvedCount}`;
          if (syncHint) syncHint.textContent = `全 ${approvedCount} 件のデータが共有フォルダに同期されました。`;
        }

        const progressHandler = (p) => {
          if (!this.container || !this.container.contains(syncBar)) {
            SyncManager.removeProgressListener(progressHandler);
            return;
          }
          if (p.type === 'progress' || p.type === 'complete') {
            const total = p.total || approvedCount || 1;
            const current = p.flushed || 0;
            const pct = Math.min(100, Math.round((current / total) * 100));
            if (syncBar) syncBar.style.width = `${pct}%`;
            if (syncCount) syncCount.textContent = `${current} / ${total}`;

            if (p.type === 'complete') {
              if (syncSpinner) {
                syncSpinner.className = '';
                syncSpinner.textContent = '✅';
              }
              if (syncLabel) syncLabel.innerHTML = `<span style="color: var(--success-700); font-weight: bold;">共有フォルダへの一括アップロードが完了しました</span>`;
              if (syncHint) syncHint.textContent = `全 ${current} 件のデータが共有フォルダに同期されました。`;
              SyncManager.removeProgressListener(progressHandler);
            }
          } else if (p.type === 'error') {
            if (syncSpinner) {
              syncSpinner.className = '';
              syncSpinner.textContent = '⚠️';
            }
            if (syncLabel) syncLabel.innerHTML = `<span style="color: var(--danger-solid); font-weight: bold;">一部のアップロードに失敗しました</span>`;
            if (syncHint) syncHint.textContent = '未送信データはローカルに保持されています。次回通信時に自動再送されます。';
            SyncManager.removeProgressListener(progressHandler);
          }
        };

        SyncManager.addProgressListener(progressHandler);
      }

      this.container.querySelector('#btn-re-upload').onclick = () => {
        this.resetQueue();
        this.renderUploadView();
      };
      this.container.querySelector('#btn-go-review').onclick = () => {
        this.resetQueue();
        const revTabBtn = document.querySelector('.tab-btn[data-tab="review"]');
        if (revTabBtn) {
          revTabBtn.click();
        } else if (this.project?.id) {
          window.location.hash = `#project/${this.project.id}/review`;
        }
      };
      this.container.querySelector('#btn-go-list').onclick = () => {
        this.resetQueue();
        const listTabBtn = document.querySelector('.tab-btn[data-tab="list"]');
        if (listTabBtn) {
          listTabBtn.click();
        } else if (this.project?.id) {
          window.location.hash = `#project/${this.project.id}/list`;
        }
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
    const isSelectionMode = (this.project.projectType === 'selection');

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
            <img id="scanned-image-preview" src="${currentItem.overlayDataUrl || currentItem.imageDataUrl}" style="transform: scale(${this.zoomLevel}); cursor: pointer;" alt="スキャン確認票" title="クリックして全画面拡大">
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
                  <div class="info-label">所属</div>
                  <div id="disp-student-class" class="info-value" style="display: flex; gap: 4px; align-items: center;">
                    ${student ? `<span class="badge badge-info" style="font-size: 0.88rem; padding: 3px 8px;">${student.className}</span> <span class="badge badge-purple" style="font-size: 0.88rem; padding: 3px 8px;">${student.course || '4科'}</span>` : '<span class="text-muted">-</span>'}
                  </div>
                </div>
              </div>

              <!-- 既存登録がある場合の詳細サマリーボックス -->
              <div id="disp-existing-info-box" style="${isAlreadyApproved ? 'display: block;' : 'display: none;'} margin-top: 8px;">
                ${this.renderExistingInfoSnippet(student, existingSub)}
              </div>
            </div>

            <!-- 受講変更 / 講座選択セクション -->
            <div class="approval-section" style="margin-bottom: 0;">
              ${isSelectionMode ? `
                <div class="approval-section-title" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span>🎯 志望校別 申込講座判定</span>
                  <span id="scan-modal-sel-badge" class="badge badge-purple font-bold" style="font-size: 0.85rem; padding: 4px 10px; background: #8b5cf6; color: #fff;">
                    選択中: <span id="scan-sel-count" class="text-mono" style="font-size: 1rem;">${Object.values(currentItem.checkResult?.customChecks || {}).filter(c => c.isChecked).length}</span> 講座
                  </span>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <button type="button" id="btn-scan-select-all" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 3px 8px; border: 1px solid var(--gray-300);">全選択</button>
                    <button type="button" id="btn-scan-select-none" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 3px 8px; border: 1px solid var(--gray-300);">全解除</button>
                    <button type="button" id="btn-scan-sort-selected" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 3px 8px; border: 1px solid #c4b5fd; color: #6d28d9; background: rgba(139, 92, 246, 0.08);" title="選択した講座をリスト上部に再整列">🔝 選択中を上へ</button>
                  </div>
                  <div id="scan-quick-method-filters" style="display: flex; gap: 4px; flex-wrap: wrap;"></div>
                </div>
                <div id="scan-zero-selected-note" style="margin-bottom: 8px; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.78rem; background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; display: ${Object.values(currentItem.checkResult?.customChecks || {}).filter(c => c.isChecked).length === 0 ? 'block' : 'none'};">
                  ⚠️ 現在0講座選択です（未受講・不参加として登録されます）
                </div>
              ` : `
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
                      <div class="font-bold" style="font-size: 0.88rem;">変更なし（所属クラス・科目で受講）</div>
                      <div style="font-size: 0.75rem; color: var(--gray-500); line-height: 1.3;">所属クラス・科目のまま受講</div>
                    </div>
                  </label>

                  <label class="radio-card ${currentItem.detectedHasChange ? 'selected' : ''}" id="card-opt-has-change">
                    <input type="radio" name="enrollment-choice" value="has-change" ${currentItem.detectedHasChange ? 'checked' : ''}>
                    <div style="flex: 1; min-width: 0;">
                      <div class="font-bold" style="font-size: 0.88rem;">変更あり（クラス変更 / 他教室受講 / 非受講 等）</div>
                      <div style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 140px;">
                          <select id="sel-change-class" class="form-control font-bold" style="padding: 5px 8px; font-size: 0.84rem; width: 100%;" ${!currentItem.detectedHasChange ? 'disabled' : ''}>
                            <option value="">-- 変更先クラス / 選択肢を選択 --</option>
                            ${student ? `<option value="${student.className}">${student.className} クラス（クラス変更なし）</option>` : ''}
                            ${this.classList.filter(c => !student || c !== student.className).map(c => `<option value="${c}">${c} クラスへ変更</option>`).join('')}
                            ${DB.getProjectChangeOptions(this.project).map(opt => {
                              let icon = '📝';
                              let style = '';
                              if (opt === '非受講') {
                                icon = '🚫';
                                style = 'color: var(--danger-solid); font-weight: bold;';
                              } else if (opt === '他教室で受講') {
                                icon = '🏫';
                                style = 'color: #2563eb; font-weight: bold;';
                              }
                              return `<option value="${opt}" style="${style}">${icon} ${opt}${opt === '非受講' ? '（受講しない）' : ''}</option>`;
                            }).join('')}
                          </select>
                        </div>
                        <div style="width: 95px;" id="wrap-change-course">
                          <select id="sel-change-course" class="form-control font-bold" style="padding: 5px 8px; font-size: 0.84rem; width: 100%;" ${!currentItem.detectedHasChange ? 'disabled' : ''}>
                            <option value="4科" ${student && student.course === '2科' ? '' : 'selected'}>4科</option>
                            <option value="2科" ${student && student.course === '2科' ? 'selected' : ''}>2科</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </label>
                </div>
              `}

              ${(this.project.scanTemplate?.customBoxes || []).length > 0 ? `
                <div class="custom-checks-review-box" style="margin-top: ${isSelectionMode ? '0' : '10px'}; background: rgba(139, 92, 246, 0.06); border: 1px solid #c4b5fd; border-radius: var(--radius-md); padding: 10px 12px;">
                  <div style="font-size: 0.82rem; font-weight: bold; color: #6d28d9; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <span>🎯 ${isSelectionMode ? '希望講座一覧（クリックで選択・解除）' : '志望校別対策講座・追加チェック項目'}</span>
                    <span style="font-size: 0.72rem; color: var(--gray-500); font-weight: normal;">クリックで手動変更可能</span>
                  </div>
                  <div id="scan-custom-boxes-container" style="display: flex; flex-direction: column; gap: 6px; ${isSelectionMode ? 'max-height: 240px; overflow-y: auto;' : ''}">
                    ${(() => {
                      let boxes = [...(this.project.scanTemplate.customBoxes || [])];
                      if (isSelectionMode) {
                        boxes.sort((a, b) => {
                          const isA = !!(currentItem.checkResult?.customChecks?.[a.id]?.isChecked);
                          const isB = !!(currentItem.checkResult?.customChecks?.[b.id]?.isChecked);
                          if (isA !== isB) return isB ? 1 : -1;
                          return 0;
                        });
                      }
                      return boxes.map(box => {
                        const det = currentItem.checkResult?.customChecks?.[box.id];
                        const isChecked = det ? det.isChecked : false;
                        const pct = det ? Math.round(det.darkRatio * 100) : 0;
                        return `
                          <label class="custom-box-check-row" data-id="${box.id}" style="display: flex; align-items: center; justify-content: space-between; background: ${isChecked ? '#f5f3ff' : '#fff'}; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid ${isChecked ? '#c4b5fd' : 'var(--gray-200)'}; cursor: pointer; user-select: none;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                              <input type="checkbox" class="chk-custom-box-item" data-id="${box.id}" data-label="${box.label}" ${isChecked ? 'checked' : ''}>
                              <span style="font-weight: 700; font-size: 0.84rem; color: ${isChecked ? '#6d28d9' : 'var(--gray-800)'};">${box.label}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                              <span class="badge ${isChecked ? 'badge-purple' : 'badge-gray'}" style="font-size: 0.72rem;">
                                ${isChecked ? '✅ マーク検出' : '⬜ 未選択'}
                              </span>
                              <span class="text-mono" style="font-size: 0.72rem; color: var(--gray-500);">黒画素: ${pct}%</span>
                            </div>
                          </label>
                        `;
                      }).join('');
                    })()}
                  </div>
                </div>
              ` : (isSelectionMode ? `
                <div style="padding: 12px; background: var(--gray-50); border: 1px dashed var(--gray-300); border-radius: var(--radius-md); text-align: center; color: var(--gray-500); font-size: 0.82rem;">
                  このプロジェクトには講座読取枠が登録されていません。「書式設定」から講座枠を追加してください。
                </div>
              ` : '')}

              <div class="form-group" style="margin-top: 8px; margin-bottom: 0;">
                <label class="form-label" style="font-size: 0.76rem; margin-bottom: 3px;">特記事項・メモ（手入力）</label>
                <textarea id="txt-remarks" class="form-control" placeholder="特記事項やメモなど" style="min-height: 44px; height: 44px; font-size: 0.82rem; padding: 6px 10px;"></textarea>
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
    const courseDisp = existingSub.enrollmentCourse || (existingSub.enrollmentClass === '非受講' ? '' : (student.course || '4科'));
    return `
      <div style="background: var(--warning-bg); border: 1px solid var(--warning-border); border-radius: var(--radius-md); padding: 8px 10px; font-size: 0.78rem;">
        <div style="font-weight: 700; color: var(--warning-text); display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
          <span>📋 前回の登録情報 (${existingSub.inputMethod || '登録済'})</span>
          <span style="font-weight: normal; font-size: 0.74rem;">${UI.formatDate(existingSub.approvedAt || existingSub.submittedAt)}</span>
        </div>
        <div style="color: var(--gray-700); line-height: 1.4;">
          受講: <strong>${existingSub.enrollmentClass || (existingSub.hasChange ? '変更あり' : student.className)}${courseDisp && courseDisp !== '非受講' ? ' (' + courseDisp + ')' : ''}</strong>
          ${existingSub.hasChange ? '<span class="badge badge-warning" style="font-size: 0.7rem; padding: 1px 4px; margin-left: 4px;">変更あり</span>' : '<span class="badge badge-success" style="font-size: 0.7rem; padding: 1px 4px; margin-left: 4px;">変更なし</span>'}
          ${existingSub.approvedBy ? ` | 担当: <strong>${existingSub.approvedBy}</strong>` : ''}
          ${existingSub.remarks ? `<div style="color: var(--gray-600); margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">備考: ${existingSub.remarks}</div>` : ''}
        </div>
      </div>
    `;
  },

  bindApprovalEvents(currentItem) {
    const isSelectionMode = (this.project.projectType === 'selection');
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
      calibBtn.onclick = async () => {
        const settings = await DB.getSettings();
        const coursePresets = settings.coursePresets || [];
        const methodPresets = settings.methodPresets || [];
        const isSelectionMode = (this.project?.projectType === 'selection');
        let currentTemplate = JSON.parse(JSON.stringify(this.project.scanTemplate || CheckboxEngine.getDefaultTemplate()));
        if (!currentTemplate.customBoxes) currentTemplate.customBoxes = [];
        if (isSelectionMode) {
          delete currentTemplate.noChangeBox;
          delete currentTemplate.hasChangeBox;
        }

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
                    対象: ${UI.formatProjectTitle(this.project.title)}
                  </div>
                </div>
              </div>
              <div class="modal-header-actions">
                <button class="btn-modal-maximize" id="btn-scan-calib-maximize" title="全画面最大化 / 元に戻す">⛶</button>
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
                    <select id="scan-sel-course" class="form-control" style="font-size: 0.85rem;">
                      <option value="">-- 講座名を選択 --</option>
                      ${coursePresets.map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">受講方法を選択</label>
                    <select id="scan-sel-method" class="form-control" style="font-size: 0.85rem;">
                      <option value="">-- 受講方法を選択 --</option>
                      ${methodPresets.map(m => `<option value="${m}">${m}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <button type="button" id="scan-btn-add-course" class="btn btn-primary btn-sm" style="width: 100%; height: 38px;">
                      ➕ 志望校別講座を追加
                    </button>
                  </div>
                </div>

                <!-- 自由記述追加フォーム -->
                <div style="display: flex; gap: 8px; margin-bottom: 10px; align-items: center;">
                  <input type="text" id="scan-inp-custom-name" class="form-control" placeholder="自由記述で項目名を入力（例: 特別講習A、Zoom振替希望 など）" style="font-size: 0.85rem;">
                  <button type="button" id="scan-btn-add-free" class="btn btn-secondary btn-sm" style="white-space: nowrap; height: 38px;">
                    ➕ 自由項目を追加
                  </button>
                </div>

                <!-- 登録中チェックボックス一覧 -->
                <div id="scan-custom-boxes-container"></div>
              </div>

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
        const calibrator = new TemplateCalibrator(
          mount,
          currentTemplate,
          (t) => {
            currentTemplate = t;
            renderScanCustomBoxes();
          },
          {
            defaultResetTemplate: settings.defaultScanTemplate || CheckboxEngine.getDefaultTemplate(),
            resetLabel: '🔄 共通既定書式に戻す',
            resetToastMsg: '共通既定書式の位置に復元しました',
            allowStandardBoxes: !isSelectionMode,
            allowDeleteStandardBoxes: isSelectionMode
          }
        );

        // チェックボックス一覧描画 & 操作
        let scanSearchFilter = '';
        const renderScanCustomBoxes = () => {
          const container = modal.querySelector('#scan-custom-boxes-container');
          if (!container) return;
          const allBoxes = currentTemplate.customBoxes || [];
          const boxes = scanSearchFilter
            ? allBoxes.filter(b => (b.label || '').toLowerCase().includes(scanSearchFilter.toLowerCase()))
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
                  <button type="button" class="btn btn-secondary btn-sm scan-btn-focus-box" data-id="noChange" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
                    🎯 調整
                  </button>
                </div>
              `;
            }
            if (hasHasChange) {
              standardBoxesHtml += `
                <div style="background: #fff; border: 1px solid #fdba74; border-radius: var(--radius-md); padding: 5px 10px; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                  <span style="font-weight: 700; font-size: 0.85rem; color: #c2410c;">🟧 変更あり</span>
                  <button type="button" class="btn btn-secondary btn-sm scan-btn-focus-box" data-id="hasChange" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
                    🎯 調整
                  </button>
                </div>
              `;
            }
            if (!hasNoChange) {
              restoreButtonsHtml += `
                <button type="button" class="btn btn-secondary btn-sm scan-btn-restore-box" data-type="noChange" style="padding: 3px 8px; font-size: 0.75rem; color: #15803d; border-color: #86efac;" title="「変更なし」読取枠を標準位置で再追加">
                  ➕ 「変更なし」枠を追加
                </button>
              `;
            }
            if (!hasHasChange) {
              restoreButtonsHtml += `
                <button type="button" class="btn btn-secondary btn-sm scan-btn-restore-box" data-type="hasChange" style="padding: 3px 8px; font-size: 0.75rem; color: #c2410c; border-color: #fdba74;" title="「変更あり」読取枠を標準位置で再追加">
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
                  <button type="button" class="custom-box-order-btn scan-btn-move-box" data-id="${box.id}" data-dir="-1" ${isFirst ? 'disabled' : ''} title="上へ移動">▲</button>
                  <button type="button" class="custom-box-order-btn scan-btn-move-box" data-id="${box.id}" data-dir="1" ${isLast ? 'disabled' : ''} title="下へ移動">▼</button>
                  <button type="button" class="btn btn-secondary btn-sm scan-btn-focus-box" data-id="${box.id}" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
                    🎯 調整
                  </button>
                  <button type="button" class="btn-ghost scan-btn-del-box" data-id="${box.id}" style="padding: 0 2px; color: var(--danger-solid); font-size: 14px; line-height: 1; cursor: pointer;" title="削除">
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
                    <button type="button" id="scan-btn-sort-custom" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 2px 8px;" title="講座名を名前順（昇順）に一括並び替え">
                      🔤 名前順に並び替え
                    </button>
                  ` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  ${allBoxes.length > 5 ? `
                    <input type="text" id="scan-custom-filter" class="custom-box-search-input form-control" placeholder="🔍 講座名で絞り込み..." value="${scanSearchFilter}">
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
          const filterInput = container.querySelector('#scan-custom-filter');
          if (filterInput) {
            filterInput.oninput = (e) => {
              scanSearchFilter = e.target.value.trim();
              renderScanCustomBoxes();
              const newInp = container.querySelector('#scan-custom-filter');
              if (newInp) {
                newInp.focus();
                newInp.selectionStart = newInp.selectionEnd = newInp.value.length;
              }
            };
          }

          // 名前順ソートボタン
          const sortBtn = container.querySelector('#scan-btn-sort-custom');
          if (sortBtn) {
            sortBtn.onclick = () => {
              if (!currentTemplate.customBoxes || currentTemplate.customBoxes.length <= 1) return;
              currentTemplate.customBoxes.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja'));
              if (calibrator) {
                calibrator.template = currentTemplate;
                calibrator.updateTabsUI();
                calibrator.drawOverlay();
              }
              renderScanCustomBoxes();
              UI.showToast('講座を名前順に並び替えました', 'success');
            };
          }

          // 並び替えボタン（▲ / ▼）
          container.querySelectorAll('.scan-btn-move-box').forEach(btn => {
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
              renderScanCustomBoxes();
            };
          });

          // 削除ボタンイベント
          container.querySelectorAll('.scan-btn-del-box').forEach(btn => {
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
                renderScanCustomBoxes();
              }
            };
          });

          // 調整フォーカスボタンイベント
          container.querySelectorAll('.scan-btn-focus-box').forEach(btn => {
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
          container.querySelectorAll('.scan-btn-restore-box').forEach(btn => {
            btn.onclick = () => {
              const type = btn.dataset.type;
              if (calibrator) {
                calibrator.addStandardBox(type);
              } else {
                const def = CheckboxEngine.getDefaultTemplate();
                if (type === 'noChange') currentTemplate.noChangeBox = JSON.parse(JSON.stringify(def.noChangeBox));
                else if (type === 'hasChange') currentTemplate.hasChangeBox = JSON.parse(JSON.stringify(def.hasChangeBox));
                renderScanCustomBoxes();
              }
            };
          });
        };

        const addScanCustomBox = (label) => {
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
            size: CheckboxEngine.getCommonBoxSize(currentTemplate)
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
          renderScanCustomBoxes();
          UI.showToast(`「${label}」を追加しました。枠線の位置を調整してください。`, 'success');
        };

        renderScanCustomBoxes();

        // 講座名×受講方法追加
        const addCourseBtn = modal.querySelector('#scan-btn-add-course');
        const selCourse = modal.querySelector('#scan-sel-course');
        const selMethod = modal.querySelector('#scan-sel-method');

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
            addScanCustomBox(label);
            selCourse.value = '';
            selMethod.value = '';
          };
        }

        // 自由項目追加
        const addFreeBtn = modal.querySelector('#scan-btn-add-free');
        const freeInput = modal.querySelector('#scan-inp-custom-name');

        const handleFreeAdd = () => {
          const label = (freeInput?.value || '').trim();
          if (!label) {
            UI.showToast('項目名を入力してください', 'warning');
            return;
          }
          addScanCustomBox(label);
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

        modal.querySelector('#btn-modal-save').onclick = async () => {
          if (!calibrator.isBarcodeDetected()) {
            UI.showToast('バーコードが読み取れていません。バーコードが鮮明に写っている受講票ファイルを選択するか、ファイルをご確認ください。', 'error');
            return;
          }
          const templateToSave = calibrator.getTemplate();
          if (isSelectionMode) {
            delete templateToSave.noChangeBox;
            delete templateToSave.hasChangeBox;
          }
          try {
            await DB.updateProject(this.project.id, { scanTemplate: templateToSave });
            this.project.scanTemplate = templateToSave;

            // 保留中のスキャン結果キュー（pendingQueue）を新しいテンプレートで即座に再評価
            if (this.pendingQueue && this.pendingQueue.length > 0) {
              for (const item of this.pendingQueue) {
                await ScannerEngine.reEvaluateItem(item, templateToSave);
              }
            }

            UI.showToast('受講確認票の書式設定を更新し、判定結果を再計算しました', 'success');
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

    // ラジオ選択制御（受講確認モードのみ）
    const radioNoChange = this.container.querySelector('input[value="no-change"]');
    const radioHasChange = this.container.querySelector('input[value="has-change"]');
    const cardNoChange = this.container.querySelector('#card-opt-no-change');
    const cardHasChange = this.container.querySelector('#card-opt-has-change');
    const changeClassSelect = this.container.querySelector('#sel-change-class');
    const changeCourseSelect = this.container.querySelector('#sel-change-course');

    if (radioNoChange && radioHasChange && cardNoChange && cardHasChange) {
      const updateRadioUI = () => {
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
          if (changeCourseSelect) {
            changeCourseSelect.disabled = (changeClassSelect.value === '非受講');
          }
        };
      }

      radioNoChange.onchange = updateRadioUI;
      radioHasChange.onchange = updateRadioUI;
      cardNoChange.onclick = () => { radioNoChange.checked = true; updateRadioUI(); };
      cardHasChange.onclick = (e) => {
        if (e.target !== changeClassSelect && e.target !== changeCourseSelect) {
          radioHasChange.checked = true;
          updateRadioUI();
        }
      };
    }

    // 志望校別・追加チェックボックスのリアルタイムカウンター・スタイル連動
    const customCheckboxes = this.container.querySelectorAll('.chk-custom-box-item');
    const zeroNote = this.container.querySelector('#scan-zero-selected-note');

    const updateCustomCount = () => {
      let count = 0;
      customCheckboxes.forEach(chk => {
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
            badgeEl.textContent = chk.checked ? '✅ 選択' : '⬜ 未選択';
          }
        }
      });
      const countEl = this.container.querySelector('#scan-sel-count');
      if (countEl) countEl.textContent = count;
      if (zeroNote) {
        zeroNote.style.display = (count === 0) ? 'block' : 'none';
      }
    };
    customCheckboxes.forEach(chk => {
      chk.addEventListener('change', updateCustomCount);
    });

    // 講座選択モード専用: クイック選択ツールバー
    const btnSelectAll = this.container.querySelector('#btn-scan-select-all');
    const btnSelectNone = this.container.querySelector('#btn-scan-select-none');
    const btnSortSelected = this.container.querySelector('#btn-scan-sort-selected');
    const customBoxesContainer = this.container.querySelector('#scan-custom-boxes-container');

    const sortContainerRows = () => {
      if (!customBoxesContainer) return;
      const rows = Array.from(customBoxesContainer.querySelectorAll('.custom-box-check-row'));
      rows.sort((a, b) => {
        const chkA = a.querySelector('.chk-custom-box-item')?.checked ? 1 : 0;
        const chkB = b.querySelector('.chk-custom-box-item')?.checked ? 1 : 0;
        if (chkA !== chkB) return chkB - chkA;
        return 0;
      });
      rows.forEach(r => customBoxesContainer.appendChild(r));
    };

    if (btnSelectAll) {
      btnSelectAll.onclick = () => {
        customCheckboxes.forEach(chk => { chk.checked = true; });
        updateCustomCount();
      };
    }
    if (btnSelectNone) {
      btnSelectNone.onclick = () => {
        customCheckboxes.forEach(chk => { chk.checked = false; });
        updateCustomCount();
      };
    }
    if (btnSortSelected) {
      btnSortSelected.onclick = () => {
        sortContainerRows();
        UI.showToast('選択中の講座を上部に並び替えました', 'info', 1500);
      };
    }

    // 形式別（Zoom / 対面 / 動画等）のクイックトグル生成
    const quickMethodContainer = this.container.querySelector('#scan-quick-method-filters');
    if (quickMethodContainer && customCheckboxes.length > 0) {
      const methods = new Set();
      customCheckboxes.forEach(chk => {
        const label = chk.dataset.label || '';
        const m = label.match(/[（\(](Zoom|対面|動画|テスト|校舎|午前|午後)[）\)]/i);
        if (m) methods.add(m[1]);
      });

      if (methods.size > 0) {
        quickMethodContainer.innerHTML = Array.from(methods).map(m => `
          <button type="button" class="btn btn-ghost btn-sm btn-quick-method" data-method="${m}" style="font-size: 0.75rem; padding: 2px 7px; border: 1px solid var(--purple-300, #c4b5fd); color: #6d28d9; background: rgba(139, 92, 246, 0.05);">
            ${m}のみ
          </button>
        `).join('');

        quickMethodContainer.querySelectorAll('.btn-quick-method').forEach(btn => {
          btn.onclick = () => {
            const mTag = btn.dataset.method;
            customCheckboxes.forEach(chk => {
              const label = chk.dataset.label || '';
              chk.checked = label.includes(mTag);
            });
            updateCustomCount();
          };
        });
      }
    }

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
        classDisp.innerHTML = `<span class="badge badge-info" style="font-size: 0.9rem;">${foundStudent.className}</span> <span class="badge badge-purple" style="font-size: 0.9rem;">${foundStudent.course || '4科'}</span>`;

        if (changeCourseSelect && !currentItem.detectedHasChange) {
          changeCourseSelect.value = foundStudent.course || '4科';
        }

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

    const approveBtn = this.container.querySelector('#btn-approve');
    const skipBtn = this.container.querySelector('#btn-skip');

    let isApproving = false;
    // 承認処理
    const doApprove = async () => {
      if (isApproving) return;

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

      let hasChange = false;
      let enrollmentClass = student.className;
      let enrollmentCourse = student.course || '4科';

      if (!isSelectionMode) {
        hasChange = radioHasChange ? radioHasChange.checked : false;
        if (hasChange) {
          const selClass = changeClassSelect ? changeClassSelect.value : '';
          if (!selClass) {
            UI.showToast('「変更あり」の場合、変更先クラスまたは選択肢を選択してください', 'warning');
            if (changeClassSelect) changeClassSelect.focus();
            return;
          }
          enrollmentClass = selClass;
          if (enrollmentClass === '非受講') {
            enrollmentCourse = '非受講';
          } else {
            enrollmentCourse = changeCourseSelect ? changeCourseSelect.value : (student.course || '4科');
          }
        }
      }

      const remarks = this.container.querySelector('#txt-remarks').value.trim();

      // カスタムチェックボックスの現在の状態（手動トグル含む）を収集
      const customChecks = {};
      this.container.querySelectorAll('.chk-custom-box-item').forEach(chk => {
        const id = chk.dataset.id;
        const label = chk.dataset.label;
        customChecks[id] = {
          id,
          label,
          isChecked: chk.checked
        };
      });

      let selectedCourses = [];
      if (isSelectionMode) {
        selectedCourses = Object.values(customChecks).filter(c => c.isChecked).map(c => c.label);
        const totalSelected = selectedCourses.length;
        hasChange = totalSelected > 0;
        enrollmentClass = totalSelected > 0 ? `${totalSelected}講座申込` : '0講座（未受講）';
        enrollmentCourse = '-';
      }

      isApproving = true;
      if (approveBtn) UI.setButtonLoading(approveBtn, true, '保存中...');

      try {
        // DBの提出レコードを取得
        const submissions = await DB.getProjectStudentsWithSubmissions(this.project.id);
        const target = submissions.find(s => s.studentId === student.id);

        if (!target) {
          UI.showToast('提出レコードが見つかりません', 'error');
          if (approveBtn) UI.setButtonLoading(approveBtn, false);
          isApproving = false;
          return;
        }

        const dataToSave = {
          status: '承認済',
          hasChange,
          enrollmentClass,
          enrollmentCourse,
          inputMethod: 'スキャン',
          approvedBy: this.selectedStaff,
          remarks,
          customChecks,
          selectedCourses,
          scanImageBlob: currentItem.imageDataUrl,
          submittedAt: new Date().toISOString(),
          approvedAt: new Date().toISOString()
        };

        // すでに登録済（承認済）の場合、上書き確認モーダルを表示
        if (target.status === '承認済') {
          if (approveBtn) UI.setButtonLoading(approveBtn, false);
          this.showOverwriteModal({
            student,
            target,
            newData: {
              hasChange,
              enrollmentClass,
              enrollmentCourse,
              selectedCourses,
              remarks,
              staff: this.selectedStaff
            },
            onOverwrite: async () => {
              if (approveBtn) UI.setButtonLoading(approveBtn, true, '上書き中...');
              try {
                await this.saveAndProceed(target.submissionId, student, dataToSave, true);
              } finally {
                isApproving = false;
              }
            },
            onSkip: () => {
              isApproving = false;
              UI.showToast(`${student.name} 様の上書きをスキップしました`, 'info', 1800);
              this.currentIndex++;
              this.renderApprovalView();
            }
          });
          return;
        }

        // 未提出の場合は通常承認保存
        await this.saveAndProceed(target.submissionId, student, dataToSave, false);
      } catch (err) {
        UI.showToast(`保存エラー: ${err.message}`, 'error');
        if (approveBtn) UI.setButtonLoading(approveBtn, false);
        isApproving = false;
      }
    };

    approveBtn.onclick = doApprove;

    // スキップ処理
    skipBtn.onclick = () => {
      UI.showToast(`ページ ${currentItem.pageNum} をスキップしました`, 'info', 1800);
      this.currentIndex++;
      this.renderApprovalView();
    };

    // キーボードショートカット（Enterで承認、Spaceでスキップ）
    const keyHandler = (e) => {
      // モーダル表示中やテキスト入力中はショートカット無効
      if (document.querySelector('.modal-overlay')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          doApprove();
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        doApprove();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        skipBtn.click();
      }
    };

    document.addEventListener('keydown', keyHandler);
    this._currentKeyHandler = keyHandler;
  },

  /**
   * 承認保存を実行して次ページへ進む
   */
  async saveAndProceed(submissionId, student, dataToSave, isOverwrite) {
    if (this._currentKeyHandler) {
      document.removeEventListener('keydown', this._currentKeyHandler);
      this._currentKeyHandler = null;
    }

    await DB.saveSubmission(submissionId, dataToSave);

    const syncNote = SyncManager.isBatchMode()
      ? '（完了後一括同期）'
      : (FolderConnector.isConnected() ? '（共有フォルダ同期済）' : '');

    UI.showToast(
      isOverwrite 
        ? `${student.name} 様の確認票を上書き承認しました${syncNote}`
        : `${student.name} 様の受講内容を承認しました${syncNote}`,
      'success',
      1500
    );

    this.pendingQueue[this.currentIndex].approved = true;
    this.currentIndex++;

    if (typeof ProjectPage.updateHeaderStats === 'function') {
      ProjectPage.updateHeaderStats();
    }

    this.renderApprovalView();
  },

  /**
   * 既存登録済み生徒に対する上書き確認モーダル
   */
  showOverwriteModal({ student, target, newData, onOverwrite, onSkip }) {
    const isSelectionMode = (this.project.projectType === 'selection');
    const prevCourses = target.selectedCourses || (target.customChecks ? Object.values(target.customChecks).filter(c => c.isChecked).map(c => c.label) : []);
    const newCourses = newData.selectedCourses || [];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 540px;">
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
              <span class="badge badge-gray" style="margin-left: 6px;">所属: ${student.className} (${student.course || '4科'})</span>
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
                ${target.enrollmentClass || (target.hasChange ? '変更あり' : student.className)}${target.enrollmentCourse && target.enrollmentCourse !== '非受講' ? ' (' + target.enrollmentCourse + ')' : ''}
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
                ${newData.enrollmentClass}${newData.enrollmentCourse && newData.enrollmentCourse !== '非受講' ? ' (' + newData.enrollmentCourse + ')' : ''}
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
  },

  /**
   * 画面離脱時・破棄時のクリーンアップ
   */
  cleanup() {
    if (this._currentKeyHandler) {
      document.removeEventListener('keydown', this._currentKeyHandler);
      this._currentKeyHandler = null;
    }
    // 承認完了状態のまま離脱した場合、または全件処理済みの場合はキューをクリア
    if (this.pendingQueue.length > 0 && this.currentIndex >= this.pendingQueue.length) {
      this.pendingQueue = [];
      this.currentIndex = 0;
    }
    if (SyncManager.isBatchMode()) {
      SyncManager.endBatchMode({ flush: true, notify: true });
    }
  }
};

