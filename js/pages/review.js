/**
 * スキャン照合レビュー画面コントローラー
 * メインPCでスキャン承認した内容と原本スキャン画像を突き合わせて確認・不一致修正を行う
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { FolderConnector } from '../sync/folder-connector.js';

export const ReviewPage = {
  container: null,
  project: null,
  allStudents: [],
  reviewItems: [], // スキャン承認済レコードのリスト
  currentIndex: 0,
  currentFilter: 'unreviewed', // 'all' | 'unreviewed' | 'mismatch' | 'confirmed'
  zoomLevel: 1.0,

  async render(container, project) {
    this.container = container;
    this.project = project;

    // 最新データ取得
    this.allStudents = await DB.getProjectStudentsWithSubmissions(project.id);

    // スキャン承認されたレコード（または画像があるレコード）を対象とする
    this.updateReviewItems();

    if (this.currentIndex >= this.reviewItems.length) {
      this.currentIndex = Math.max(0, this.reviewItems.length - 1);
    }

    this.renderUI();
  },

  /**
   * フィルタ条件に基づいてレビュー対象アイテムを抽出
   */
  updateReviewItems() {
    // 承認済レコードのうち、スキャンされたもの（または画像が存在するもの、あるいは全承認済）
    const scanCandidates = this.allStudents.filter(s => s.status === '承認済' && (s.inputMethod === 'スキャン' || s.scanImageBlob));

    if (this.currentFilter === 'all') {
      this.reviewItems = scanCandidates;
    } else if (this.currentFilter === 'unreviewed') {
      this.reviewItems = scanCandidates.filter(s => !s.reviewStatus || s.reviewStatus === 'unreviewed');
    } else if (this.currentFilter === 'mismatch') {
      this.reviewItems = scanCandidates.filter(s => s.reviewStatus === 'mismatch');
    } else if (this.currentFilter === 'confirmed') {
      this.reviewItems = scanCandidates.filter(s => s.reviewStatus === 'confirmed');
    }
  },

  /**
   * UI全体の描画
   */
  async renderUI() {
    const stats = await DB.getReviewStats(this.project.id);
    const percent = stats.total > 0 ? Math.round(((stats.confirmed + stats.mismatch) / stats.total) * 100) : 0;
    const currentItem = this.reviewItems[this.currentIndex] || null;
    const classes = await DB.getProjectClasses(this.project.id);

    // 変更先クラス候補（プロジェクトクラス ＋ 実際に登録された受講クラス）
    const classSet = new Set(classes);
    for (const item of this.allStudents) {
      if (item.enrollmentClass && item.enrollmentClass !== '-' && item.enrollmentClass !== '非受講') {
        classSet.add(item.enrollmentClass);
      }
    }
    const classOptions = Array.from(classSet).sort();

    this.container.innerHTML = `
      <div class="view-container" style="max-width: 1400px; margin: 0 auto;">
        <!-- ヘッダーサマリー & 進捗バー -->
        <div class="card" style="margin-bottom: var(--spacing-md); padding: 14px 20px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 8px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--gray-900);">🔍 スキャン照合レビュー</h2>
                <span class="badge badge-info" style="font-size: 0.75rem;">スキャン原票と承認データの突合</span>
              </div>
              <div style="font-size: 0.82rem; color: var(--gray-600); margin-top: 3px;">
                スキャン承認済 <span class="font-bold text-mono">${stats.total}</span> 件中 
                確認済: <span class="font-bold text-mono" style="color: var(--success-solid);">${stats.confirmed}</span> 件 | 
                不一致: <span class="font-bold text-mono" style="color: var(--danger-solid);">${stats.mismatch}</span> 件 | 
                未確認: <span class="font-bold text-mono" style="color: var(--warning-text);">${stats.unreviewed}</span> 件
              </div>
            </div>

            <!-- フィルタタブ -->
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-sm ${this.currentFilter === 'unreviewed' ? 'btn-primary' : 'btn-secondary'} btn-filter-rev" data-filter="unreviewed">
                ⏳ 未確認のみ (${stats.unreviewed})
              </button>
              <button class="btn btn-sm ${this.currentFilter === 'mismatch' ? 'btn-danger' : 'btn-secondary'} btn-filter-rev" data-filter="mismatch">
                ⚠️ 不一致 (${stats.mismatch})
              </button>
              <button class="btn btn-sm ${this.currentFilter === 'confirmed' ? 'btn-success' : 'btn-secondary'} btn-filter-rev" data-filter="confirmed">
                ✅ 照合OK (${stats.confirmed})
              </button>
              <button class="btn btn-sm ${this.currentFilter === 'all' ? 'btn-primary' : 'btn-secondary'} btn-filter-rev" data-filter="all">
                すべて (${stats.total})
              </button>
            </div>
          </div>

          <!-- 進捗バー -->
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1; height: 8px; background: var(--gray-200); border-radius: 999px; overflow: hidden;">
              <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, #10B981, #059669); transition: width 0.3s ease;"></div>
            </div>
            <span class="text-mono font-bold" style="font-size: 0.85rem; color: var(--gray-700); min-width: 45px;">${percent}%</span>
          </div>
        </div>

        ${this.reviewItems.length === 0 ? `
          <div class="card" style="text-align: center; padding: 48px 20px; color: var(--gray-500);">
            <div style="font-size: 2.5rem; margin-bottom: 12px;">🎉</div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--gray-800); margin-bottom: 6px;">
              ${this.currentFilter === 'unreviewed' ? 'すべてのスキャンデータが確認済みです！' : '該当するデータはありません'}
            </h3>
            <p style="font-size: 0.88rem;">上部のフィルターボタンから「すべて」や「不一致」を選択して確認できます。</p>
          </div>
        ` : `
          <!-- ナビゲーションバー (前へ / 次へ) -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--spacing-sm); background: var(--bg-surface); padding: 8px 16px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
            <button id="btn-rev-prev" class="btn btn-secondary btn-sm" ${this.currentIndex === 0 ? 'disabled' : ''}>
              ← 前へ (←キー)
            </button>
            <div style="font-size: 0.9rem; font-weight: 700; color: var(--gray-800);">
              <span class="text-mono" style="color: var(--primary-600); font-size: 1.1rem;">${this.currentIndex + 1}</span> / ${this.reviewItems.length} 件
              ${currentItem ? `<span style="margin-left: 12px; color: var(--gray-600); font-weight: 600;">${currentItem.name} (${currentItem.nichinokenId})</span>` : ''}
            </div>
            <button id="btn-rev-next" class="btn btn-secondary btn-sm" ${this.currentIndex >= this.reviewItems.length - 1 ? 'disabled' : ''}>
              次へ (→キー) →
            </button>
          </div>

          <!-- 2ペイン 照合レイアウト -->
          <div class="review-split-container" style="display: grid; grid-template-columns: minmax(360px, 1.2fr) minmax(340px, 1fr); gap: 16px; align-items: start;">
            <!-- 左ペイン: スキャン原票画像 -->
            <div class="card" style="padding: 12px; display: flex; flex-direction: column; min-height: 600px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid var(--gray-200); padding-bottom: 8px;">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--gray-800); display: flex; align-items: center; gap: 6px;">
                  <span>📷 原票スキャン画像</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button id="btn-zoom-in" class="btn btn-ghost btn-sm" title="拡大">➕ 拡大</button>
                  <button id="btn-zoom-out" class="btn btn-ghost btn-sm" title="縮小">➖ 縮小</button>
                  <button id="btn-zoom-reset" class="btn btn-ghost btn-sm" title="等倍に戻す">↺ 等倍</button>
                </div>
              </div>

              <div id="review-image-viewport" style="flex: 1; min-height: 520px; max-height: 72vh; overflow: auto; background: #1e293b; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; position: relative;">
                ${currentItem && currentItem.scanImageBlob ? `
                  <img id="review-scan-img" src="${currentItem.scanImageBlob}" alt="受講確認票スキャン画像" style="max-width: 100%; max-height: 100%; object-fit: contain; transform: scale(${this.zoomLevel}); transform-origin: top center; transition: transform 0.15s ease-out; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                ` : `
                  <div style="padding: 30px; text-align: center; color: #cbd5e1; max-width: 420px;">
                    <div style="font-size: 2.5rem; margin-bottom: 10px;">📄</div>
                    <div style="font-weight: 700; font-size: 1rem; margin-bottom: 6px;">スキャン画像がこのPCにありません</div>
                    <div style="font-size: 0.82rem; color: #94a3b8; line-height: 1.5;">
                      スキャン画像はデータ軽量化のため、スキャンを実行したPC（メインPC）のIndexedDBにのみ保存されています。<br>
                      画像の目視確認・照合はメインPCで行ってください。
                    </div>
                  </div>
                `}
              </div>
            </div>

            <!-- 右ペイン: 承認済データ & 照合判定 & その場で修正 -->
            <div class="card" style="padding: 16px;">
              ${currentItem ? this.renderRightPaneHtml(currentItem, classOptions) : ''}
            </div>
          </div>
        `}
      </div>
    `;

    this.bindEvents(currentItem);
  },

  /**
   * 右ペインのHTML（生徒情報、承認内容、照合アクション、修正フォーム）
   */
  renderRightPaneHtml(item, classOptions) {
    const isConfirmed = item.reviewStatus === 'confirmed';
    const isMismatch = item.reviewStatus === 'mismatch';
    const hasChange = item.hasChange;

    return `
      <div>
        <!-- 生徒ヘッダー -->
        <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: var(--spacing-md);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: var(--gray-900);">
              ${item.name}
            </div>
            <span class="badge badge-info text-mono font-bold" style="font-size: 0.9rem;">${item.nichinokenId}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; font-size: 0.82rem; color: var(--gray-600);">
            <span>所属: <strong class="badge badge-purple" style="font-size: 0.8rem;">${item.className}</strong> (${item.course || '4科'})</span>
            ${item.nameKana ? `<span>カナ: ${item.nameKana}</span>` : ''}
          </div>
        </div>

        <!-- 現在の承認内容カード -->
        <div style="background: #ffffff; border: 2px solid ${isMismatch ? 'var(--danger-solid)' : (isConfirmed ? 'var(--success-solid)' : 'var(--primary-300)')}; border-radius: var(--radius-md); padding: 14px; margin-bottom: var(--spacing-md);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--gray-700);">現在登録されている承認データ:</span>
            <span class="badge ${isMismatch ? 'badge-danger' : (isConfirmed ? 'badge-success' : 'badge-warning')}" style="font-size: 0.78rem; font-weight: 700;">
              ${isMismatch ? '⚠️ 不一致あり' : (isConfirmed ? '✅ 照合OK' : '⏳ 未確認')}
            </span>
          </div>

          <div style="display: grid; gap: 6px; font-size: 0.88rem;">
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">受講判定:</span>
              <span class="badge ${hasChange ? 'badge-warning' : 'badge-success'}" style="font-weight: 700;">
                ${hasChange ? '変更あり' : '変更なし'}
              </span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">受講クラス:</span>
              <span class="font-bold text-mono" style="font-size: 0.95rem; color: ${item.enrollmentClass === '非受講' ? 'var(--purple-solid)' : 'var(--primary-700)'};">
                ${item.enrollmentClass || '-'} ${item.enrollmentCourse && item.enrollmentCourse !== '非受講' ? `(${item.enrollmentCourse})` : ''}
              </span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">登録担当者:</span>
              <span><strong>${item.approvedBy || '-'}</strong> (${item.inputMethod || 'スキャン'})</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">登録日時:</span>
              <span class="text-mono" style="font-size: 0.8rem;">${UI.formatDate(item.approvedAt || item.submittedAt)}</span>
            </div>
            ${item.remarks ? `
              <div style="margin-top: 4px; padding: 6px 10px; background: var(--gray-100); border-radius: var(--radius-sm); font-size: 0.8rem; color: var(--gray-700);">
                備考: ${item.remarks}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 照合アクションボタン群 -->
        <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 14px; margin-bottom: var(--spacing-md);">
          <div style="font-weight: 700; font-size: 0.88rem; color: var(--gray-800); margin-bottom: 8px;">
            📋 照合結果の判定
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 10px;">
            <button id="btn-action-confirm" class="btn btn-success" style="flex: 1; padding: 10px; font-size: 0.95rem;">
              ✅ 照合OK (一致)
            </button>
            <button id="btn-action-mismatch" class="btn btn-danger" style="flex: 1; padding: 10px; font-size: 0.95rem;">
              ⚠️ 不一致あり
            </button>
          </div>

          <!-- 不一致メモ入力 -->
          <div id="mismatch-note-wrap" style="display: ${isMismatch ? 'block' : 'none'};">
            <label class="form-label" style="font-size: 0.78rem; margin-bottom: 2px;">不一致・相違の内容メモ</label>
            <div style="display: flex; gap: 6px;">
              <input type="text" id="inp-mismatch-note" class="form-control" placeholder="例: チェック漏れ、M1へ変更のはず、等" value="${item.reviewNote || ''}" style="font-size: 0.85rem;">
              <button id="btn-save-mismatch-note" class="btn btn-secondary btn-sm" style="white-space: nowrap;">保存</button>
            </div>
          </div>
        </div>

        <!-- その場でデータ修正アコーディオン -->
        <details class="card" style="padding: 12px; background: #ffffff; border: 1px solid var(--gray-300);">
          <summary style="font-weight: 700; font-size: 0.88rem; color: var(--primary-700); cursor: pointer; user-select: none;">
            ✏️ 画像と相違がある場合、その場でデータを修正する
          </summary>
          <div style="margin-top: 12px; display: grid; gap: 10px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-size: 0.78rem;">受講選択</label>
              <div style="display: flex; gap: 12px;">
                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85rem; cursor: pointer;">
                  <input type="radio" name="edit-has-change" value="0" ${!hasChange ? 'checked' : ''}> 変更なし
                </label>
                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85rem; cursor: pointer;">
                  <input type="radio" name="edit-has-change" value="1" ${hasChange ? 'checked' : ''}> 変更あり
                </label>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" style="font-size: 0.78rem;">受講クラス</label>
                <select id="sel-edit-class" class="form-control" style="font-size: 0.85rem; padding: 5px 8px;">
                  <option value="${item.className}">所属: ${item.className}</option>
                  <option value="非受講" ${item.enrollmentClass === '非受講' ? 'selected' : ''}>非受講</option>
                  ${classOptions.filter(c => c !== item.className).map(c => `
                    <option value="${c}" ${item.enrollmentClass === c ? 'selected' : ''}>${c}</option>
                  `).join('')}
                </select>
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" style="font-size: 0.78rem;">受講科目</label>
                <select id="sel-edit-course" class="form-control" style="font-size: 0.85rem; padding: 5px 8px;">
                  <option value="4科" ${item.enrollmentCourse === '4科' ? 'selected' : ''}>4科</option>
                  <option value="2科" ${item.enrollmentCourse === '2科' ? 'selected' : ''}>2科</option>
                  <option value="非受講" ${item.enrollmentCourse === '非受講' ? 'selected' : ''}>非受講</option>
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-size: 0.78rem;">備考・修正理由</label>
              <input type="text" id="inp-edit-remarks" class="form-control" placeholder="照合レビューによる修正、等" value="${item.remarks || ''}" style="font-size: 0.85rem;">
            </div>

            <button id="btn-save-inline-edit" class="btn btn-primary btn-sm" style="width: 100%; margin-top: 4px;">
              💾 承認データを修正して再保存
            </button>
          </div>
        </details>
      </div>
    `;
  },

  /**
   * イベントハンドラ設定
   */
  bindEvents(currentItem) {
    // フィルタータブ切り替え
    this.container.querySelectorAll('.btn-filter-rev').forEach(btn => {
      btn.onclick = () => {
        this.currentFilter = btn.dataset.filter;
        this.currentIndex = 0;
        this.render(this.container, this.project);
      };
    });

    // 前へ / 次へ
    const prevBtn = this.container.querySelector('#btn-rev-prev');
    const nextBtn = this.container.querySelector('#btn-rev-next');
    if (prevBtn) {
      prevBtn.onclick = () => {
        if (this.currentIndex > 0) {
          this.currentIndex--;
          this.render(this.container, this.project);
        }
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.currentIndex < this.reviewItems.length - 1) {
          this.currentIndex++;
          this.render(this.container, this.project);
        }
      };
    }

    // ズームボタン
    const zoomInBtn = this.container.querySelector('#btn-zoom-in');
    const zoomOutBtn = this.container.querySelector('#btn-zoom-out');
    const zoomResetBtn = this.container.querySelector('#btn-zoom-reset');
    const imgEl = this.container.querySelector('#review-scan-img');

    if (zoomInBtn && imgEl) {
      zoomInBtn.onclick = () => {
        this.zoomLevel = Math.min(3.0, this.zoomLevel + 0.25);
        imgEl.style.transform = `scale(${this.zoomLevel})`;
      };
    }
    if (zoomOutBtn && imgEl) {
      zoomOutBtn.onclick = () => {
        this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.25);
        imgEl.style.transform = `scale(${this.zoomLevel})`;
      };
    }
    if (zoomResetBtn && imgEl) {
      zoomResetBtn.onclick = () => {
        this.zoomLevel = 1.0;
        imgEl.style.transform = `scale(${this.zoomLevel})`;
      };
    }

    if (!currentItem) return;

    // 照合OK (confirmed)
    const confirmBtn = this.container.querySelector('#btn-action-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        try {
          await DB.updateReviewStatus(currentItem.submissionId, {
            reviewStatus: 'confirmed',
            reviewedBy: currentItem.approvedBy || '',
            reviewNote: ''
          });
          UI.showToast(`${currentItem.name} 様: 照合OKで確認しました`, 'success', 1500);

          // 自動で次の未確認へ進むか再描画
          this.allStudents = await DB.getProjectStudentsWithSubmissions(this.project.id);
          this.updateReviewItems();
          if (this.currentIndex >= this.reviewItems.length) {
            this.currentIndex = Math.max(0, this.reviewItems.length - 1);
          }
          this.renderUI();
        } catch (err) {
          UI.showToast(`保存エラー: ${err.message}`, 'error');
        }
      };
    }

    // 不一致あり (mismatch)
    const mismatchBtn = this.container.querySelector('#btn-action-mismatch');
    const mismatchWrap = this.container.querySelector('#mismatch-note-wrap');
    if (mismatchBtn) {
      mismatchBtn.onclick = async () => {
        if (mismatchWrap) mismatchWrap.style.display = 'block';
        try {
          await DB.updateReviewStatus(currentItem.submissionId, {
            reviewStatus: 'mismatch',
            reviewedBy: currentItem.approvedBy || '',
            reviewNote: currentItem.reviewNote || ''
          });
          UI.showToast(`${currentItem.name} 様を「不一致あり」に設定しました`, 'warning', 1800);
          this.allStudents = await DB.getProjectStudentsWithSubmissions(this.project.id);
          this.updateReviewItems();
          this.renderUI();
        } catch (err) {
          UI.showToast(`保存エラー: ${err.message}`, 'error');
        }
      };
    }

    // 不一致メモ保存
    const saveNoteBtn = this.container.querySelector('#btn-save-mismatch-note');
    const noteInput = this.container.querySelector('#inp-mismatch-note');
    if (saveNoteBtn && noteInput) {
      saveNoteBtn.onclick = async () => {
        const note = noteInput.value.trim();
        try {
          await DB.updateReviewStatus(currentItem.submissionId, {
            reviewStatus: 'mismatch',
            reviewedBy: currentItem.approvedBy || '',
            reviewNote: note
          });
          UI.showToast('不一致メモを保存しました', 'info');
        } catch (err) {
          UI.showToast(`メモ保存エラー: ${err.message}`, 'error');
        }
      };
    }

    // インライン修正・再保存
    const saveInlineBtn = this.container.querySelector('#btn-save-inline-edit');
    if (saveInlineBtn) {
      saveInlineBtn.onclick = async () => {
        const hasChangeRadio = this.container.querySelector('input[name="edit-has-change"]:checked');
        const hasChange = hasChangeRadio?.value === '1';
        const enrollmentClass = this.container.querySelector('#sel-edit-class').value;
        const enrollmentCourse = this.container.querySelector('#sel-edit-course').value;
        const remarks = this.container.querySelector('#inp-edit-remarks').value.trim();

        try {
          await DB.saveSubmission(currentItem.submissionId, {
            status: '承認済',
            hasChange,
            enrollmentClass,
            enrollmentCourse: enrollmentClass === '非受講' ? '非受講' : enrollmentCourse,
            remarks,
            reviewStatus: 'confirmed', // 修正後は確認済みに設定
            reviewedAt: new Date().toISOString(),
            reviewedBy: currentItem.approvedBy || '',
            reviewNote: 'レビュー時に修正'
          });

          UI.showToast(`${currentItem.name} 様の承認データを修正・保存しました`, 'success');
          this.allStudents = await DB.getProjectStudentsWithSubmissions(this.project.id);
          this.updateReviewItems();
          this.renderUI();
        } catch (err) {
          UI.showToast(`修正保存エラー: ${err.message}`, 'error');
        }
      };
    }

    // キーボードショートカット (左右キーで移動)
    const keyHandler = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (this.currentIndex > 0) {
          this.currentIndex--;
          this.render(this.container, this.project);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (this.currentIndex < this.reviewItems.length - 1) {
          this.currentIndex++;
          this.render(this.container, this.project);
        }
      }
    };

    document.addEventListener('keydown', keyHandler, { once: true });
  }
};
