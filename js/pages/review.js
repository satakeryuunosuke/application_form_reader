/**
 * スキャン照合・登録履歴確認画面コントローラー
 * 左右矢印で画像を切り替えながら登録履歴を確認し、間違っていたらその場で修正する
 * 右ペインに「変更・承認タイムライン」を表示
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';

export const ReviewPage = {
  container: null,
  project: null,
  allStudents: [],
  reviewItems: [], // スキャン登録済・画像保持レコードのリスト
  currentIndex: 0,
  zoomLevel: 1.0,
  keyHandler: null,

  async render(container, project) {
    this.container = container;

    // 別のプロジェクトに切り替わった場合はインデックスと表示データを初期化
    if (!this.project || this.project.id !== project.id) {
      this.currentIndex = 0;
      this.reviewItems = [];
      this.allStudents = [];
    }
    this.project = project;

    // 前回のキーリスナーを確実に解除
    this.cleanup();

    // 最新データ取得
    this.allStudents = await DB.getProjectStudentsWithSubmissions(project.id);

    // スキャン登録されたレコード（またはスキャン画像が存在する登録データ）を抽出
    this.updateReviewItems();

    if (this.currentIndex >= this.reviewItems.length) {
      this.currentIndex = Math.max(0, this.reviewItems.length - 1);
    }

    // UI描画
    this.renderUI();

    // キーボードショートカットの初期化（renderで1度だけ登録）
    this.initKeyboardNav();
  },

  /**
   * キーボードイベントのクリーンアップ
   */
  cleanup() {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  },

  /**
   * キーボードナビゲーションの初期化（単一リスナー管理）
   */
  initKeyboardNav() {
    this.cleanup();

    this.keyHandler = (e) => {
      // 画面がDOM上に存在しない場合はリスナーを解除して終了
      if (!this.container || !document.body.contains(this.container)) {
        this.cleanup();
        return;
      }

      // キー長押し・リピートによる連続スキップを防止
      if (e.repeat) return;

      // テキスト入力・選択中などは矢印キーでの切り替えを抑止
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (this.currentIndex > 0) {
          this.currentIndex--;
          this.renderUI();
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (this.currentIndex < this.reviewItems.length - 1) {
          this.currentIndex++;
          this.renderUI();
        }
      }
    };

    document.addEventListener('keydown', this.keyHandler);
  },

  /**
   * 対象アイテムを抽出（スキャンで登録されたもの、または画像がある登録データ）
   * なければ承認済全件を対象にする
   */
  updateReviewItems() {
    let candidates = this.allStudents.filter(s => s.status === '承認済' && (s.inputMethod === 'スキャン' || s.scanImageBlob));
    
    if (candidates.length === 0) {
      candidates = this.allStudents.filter(s => s.status === '承認済');
    }

    this.reviewItems = candidates;
  },

  /**
   * UI全体の描画
   */
  async renderUI() {
    const totalCount = this.reviewItems.length;
    const currentItem = totalCount > 0 ? this.reviewItems[this.currentIndex] : null;
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
        <!-- ヘッダーサマリー -->
        <div class="card" style="margin-bottom: var(--spacing-md); padding: 14px 20px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--gray-900);">🔍 スキャン照合・登録履歴確認</h2>
                <span class="badge badge-info" style="font-size: 0.75rem;">原票画像と変更・承認タイムライン</span>
              </div>
              <div style="font-size: 0.82rem; color: var(--gray-600); margin-top: 3px;">
                キーボードの <kbd style="background: var(--gray-200); padding: 2px 6px; border-radius: 4px; font-weight: bold;">←</kbd> <kbd style="background: var(--gray-200); padding: 2px 6px; border-radius: 4px; font-weight: bold;">→</kbd> キーまたは上部ボタンで画像を1件ずつ切り替え、右側のタイムラインで履歴確認・修正ができます。
              </div>
            </div>

            <!-- クイックジャンプセレクター -->
            ${totalCount > 0 ? `
              <div style="display: flex; align-items: center; gap: 8px;">
                <label for="sel-jump-student" style="font-size: 0.82rem; font-weight: 600; color: var(--gray-700); white-space: nowrap;">移動:</label>
                <select id="sel-jump-student" class="form-control" style="font-size: 0.82rem; padding: 4px 8px; max-width: 260px;">
                  ${this.reviewItems.map((item, idx) => `
                    <option value="${idx}" ${idx === this.currentIndex ? 'selected' : ''}>
                      ${idx + 1}. ${item.name} (${item.nichinokenId || '番号なし'}) - ${item.className || ''}
                    </option>
                  `).join('')}
                </select>
              </div>
            ` : ''}
          </div>
        </div>

        ${totalCount === 0 ? `
          <div class="card" style="text-align: center; padding: 48px 20px; color: var(--gray-500);">
            <div style="font-size: 2.5rem; margin-bottom: 12px;">📄</div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--gray-800); margin-bottom: 6px;">
              確認対象の登録データがありません
            </h3>
            <p style="font-size: 0.88rem;">スキャン読み取りまたは手動入力で登録された受講確認票データが存在しません。</p>
          </div>
        ` : `
          <!-- ナビゲーションバー (前へ / 次へ) -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--spacing-sm); background: var(--bg-surface); padding: 8px 16px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
            <button id="btn-rev-prev" class="btn btn-secondary btn-sm" ${this.currentIndex === 0 ? 'disabled' : ''} style="display: flex; align-items: center; gap: 6px;">
              <span>◀ 前のデータ (←)</span>
            </button>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--gray-800); text-align: center;">
              <span class="text-mono" style="color: var(--primary-600); font-size: 1.15rem;">${this.currentIndex + 1}</span> / ${totalCount} 件
              ${currentItem ? `
                <span style="margin-left: 12px; color: var(--gray-800); font-weight: 700;">
                  ${currentItem.name}
                  <span class="badge badge-info text-mono" style="font-size: 0.82rem; margin-left: 6px;">${currentItem.nichinokenId}</span>
                </span>
              ` : ''}
            </div>
            <button id="btn-rev-next" class="btn btn-secondary btn-sm" ${this.currentIndex >= totalCount - 1 ? 'disabled' : ''} style="display: flex; align-items: center; gap: 6px;">
              <span>次のデータ (→) ▶</span>
            </button>
          </div>

          <!-- 2ペイン 照合レイアウト -->
          <div class="review-split-container" style="display: grid; grid-template-columns: minmax(380px, 1.15fr) minmax(360px, 1.1fr); gap: 16px; align-items: start;">
            <!-- 左ペイン: スキャン原票画像 -->
            <div class="card" style="padding: 12px; display: flex; flex-direction: column; min-height: 620px;">
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

              <div id="review-image-viewport" style="flex: 1; min-height: 540px; max-height: 75vh; overflow: auto; background: #1e293b; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; position: relative;">
                ${currentItem && currentItem.scanImageBlob ? `
                  <img id="review-scan-img" src="${currentItem.scanImageBlob}" alt="受講確認票スキャン画像" style="max-width: 100%; max-height: 100%; object-fit: contain; transform: scale(${this.zoomLevel}); transform-origin: top center; transition: transform 0.15s ease-out; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                ` : `
                  <div style="padding: 30px; text-align: center; color: #cbd5e1; max-width: 420px;">
                    <div style="font-size: 2.5rem; margin-bottom: 10px;">📄</div>
                    <div style="font-weight: 700; font-size: 1rem; margin-bottom: 6px;">スキャン画像がこのPCにありません</div>
                    <div style="font-size: 0.82rem; color: #94a3b8; line-height: 1.5;">
                      スキャン画像はデータ軽量化のため、スキャンを実行したPCのIndexedDBに保存されています。<br>
                      登録されたテキストデータおよび履歴は右ペインのタイムラインでご確認いただけます。
                    </div>
                  </div>
                `}
              </div>
            </div>

            <!-- 右ペイン: 変更・承認タイムライン ＆ 修正フォーム -->
            <div class="card" style="padding: 16px; max-height: 80vh; overflow-y: auto;">
              ${currentItem ? this.renderRightPaneHtml(currentItem, classOptions) : ''}
            </div>
          </div>
        `}
      </div>
    `;

    this.bindEvents(currentItem);
  },

  /**
   * 右ペインのHTML（生徒情報、変更・承認タイムライン、最新内容の編集フォーム）
   */
  renderRightPaneHtml(item, classOptions) {
    const isSelectionMode = (this.project.projectType === 'selection');
    const hasChange = item.hasChange;

    // 履歴一覧の構築（新しい順：降順）
    let historyList = Array.isArray(item.history) ? [...item.history] : [];
    if (historyList.length === 0 && item.status === '承認済') {
      historyList.push({
        id: 'hist_init_' + (item.submissionId || item.studentId),
        timestamp: item.approvedAt || item.submittedAt || new Date().toISOString(),
        approvedAt: item.approvedAt,
        inputMethod: item.inputMethod || 'スキャン',
        approvedBy: item.approvedBy || '',
        status: item.status,
        hasChange: item.hasChange,
        enrollmentClass: item.enrollmentClass || item.className,
        enrollmentCourse: item.enrollmentCourse || item.course || '4科',
        remarks: item.remarks || '',
        customChecks: item.customChecks || {},
        scanImageBlob: item.scanImageBlob || null
      });
    }

    // 時系列降順ソート
    historyList.sort((a, b) => new Date(b.timestamp || b.approvedAt || 0) - new Date(a.timestamp || a.approvedAt || 0));

    const methodIconMap = {
      'スキャン': '📷',
      '電話': '📞',
      '口頭': '🗣️',
      'メール・連絡帳': '✉️',
      'その他': '📝'
    };

    return `
      <div>
        <!-- 生徒ヘッダー -->
        <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: var(--spacing-sm);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <div style="font-size: 1.18rem; font-weight: 800; color: var(--gray-900);">
              ${item.name}
            </div>
            <span class="badge badge-info text-mono font-bold" style="font-size: 0.92rem;">${item.nichinokenId}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; font-size: 0.82rem; color: var(--gray-600); flex-wrap: wrap;">
            <span>所属クラス: <strong class="badge badge-purple" style="font-size: 0.8rem;">${item.className}</strong></span>
            <span>コース: <strong>${item.course || '4科'}</strong></span>
            ${item.nameKana ? `<span>カナ: ${item.nameKana}</span>` : ''}
          </div>
        </div>

        <!-- タイムラインセクションタイトル -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 14px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1.5px solid var(--gray-200);">
          <div style="font-size: 0.95rem; font-weight: 800; color: var(--gray-800); display: flex; align-items: center; gap: 6px;">
            <span>🕒 変更・承認タイムライン</span>
            <span class="badge badge-info" style="font-size: 0.75rem;">計 ${historyList.length} 件</span>
          </div>
          <span style="font-size: 0.78rem; color: var(--gray-500);">最新の内容をその場で修正・保存可能</span>
        </div>

        <!-- 変更・承認タイムライン本体 -->
        <div class="history-timeline" style="margin-top: 8px;">
          ${historyList.map((hist, idx) => {
            const isLatest = (idx === 0);
            const icon = methodIconMap[hist.inputMethod] || '📝';

            if (isLatest) {
              // 最新エントリ: 修正フォームを内包した確定カード
              return `
                <div class="history-item is-latest">
                  <div class="history-dot">${icon}</div>
                  <div class="history-card" style="border: 1.5px solid var(--primary-400); box-shadow: var(--shadow-sm);">
                    <div class="history-card-header">
                      <div class="history-meta-left">
                        <span class="badge badge-primary font-bold">${hist.inputMethod || item.inputMethod || 'スキャン'}</span>
                        <span class="history-time" style="font-weight: 600;">${UI.formatDate(hist.timestamp || hist.approvedAt || item.approvedAt || item.submittedAt)}</span>
                        <span class="badge badge-success" style="font-size: 0.72rem; font-weight: bold;">最新の確定内容</span>
                      </div>
                      <div class="history-staff">
                        担当: <strong style="color: var(--gray-800);">${hist.approvedBy || item.approvedBy || '-'}</strong>
                      </div>
                    </div>

                    <!-- 登録内容 ＆ 修正フォーム -->
                    <div style="margin-top: 10px; display: grid; gap: 10px;">
                      <div style="font-size: 0.8rem; font-weight: 700; color: var(--primary-700); display: flex; align-items: center; gap: 4px;">
                        <span>✏️ 内容の確認・修正（画像と相違があれば変更して保存）:</span>
                      </div>

                      ${isSelectionMode ? `
                        <!-- 選択式講座プロジェクト用UI -->
                        <div style="background: rgba(139, 92, 246, 0.06); border: 1px solid #c4b5fd; border-radius: var(--radius-md); padding: 10px 12px;">
                          <div style="font-size: 0.82rem; font-weight: bold; color: #6d28d9; margin-bottom: 8px;">
                            🎯 申込希望講座の確認・修正
                          </div>
                          <div style="display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; padding-right: 4px;">
                            ${(() => {
                              let boxes = (this.project.scanTemplate?.customBoxes || []).length > 0
                                ? [...this.project.scanTemplate.customBoxes]
                                : Object.values(item.customChecks || []);
                              if (isSelectionMode) {
                                boxes.sort((a, b) => {
                                  const isA = !!(item.customChecks?.[a.id]?.isChecked);
                                  const isB = !!(item.customChecks?.[b.id]?.isChecked);
                                  if (isA !== isB) return isB ? 1 : -1;
                                  return 0;
                                });
                              }
                              return boxes.map(box => {
                                const cur = item.customChecks?.[box.id];
                                const isChk = cur ? cur.isChecked : false;
                                return `
                                  <label style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.85rem; cursor: pointer; padding: 4px 8px; border-radius: 4px; background: ${isChk ? '#f5f3ff' : 'transparent'}; border: 1px solid ${isChk ? '#c4b5fd' : 'transparent'}; transition: background 0.15s ease;" onmouseover="this.style.background='rgba(139,92,246,0.12)'" onmouseout="this.style.background='${isChk ? '#f5f3ff' : 'transparent'}'">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                      <input type="checkbox" class="chk-rev-custom-box-item" data-id="${box.id}" data-label="${box.label}" ${isChk ? 'checked' : ''} style="width: 16px; height: 16px;">
                                      <span style="font-weight: ${isChk ? 'bold' : 'normal'}; color: ${isChk ? '#6d28d9' : 'var(--gray-800)'};">${box.label}</span>
                                    </div>
                                    ${isChk ? '<span class="badge badge-purple" style="font-size: 0.68rem; padding: 2px 6px;">✅ 選択中</span>' : '<span class="badge badge-gray" style="font-size: 0.68rem; padding: 2px 6px;">⬜ 未選択</span>'}
                                  </label>
                                `;
                              }).join('');
                            })()}
                          </div>
                        </div>
                      ` : `
                        <!-- 通常受講確認票用UI -->
                        <div class="form-group" style="margin-bottom: 0;">
                          <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: var(--gray-700);">受講選択判定</label>
                          <div style="display: flex; gap: 16px;">
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; font-weight: ${!hasChange ? 'bold' : 'normal'};">
                              <input type="radio" name="edit-has-change" value="0" ${!hasChange ? 'checked' : ''}> 変更なし
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; font-weight: ${hasChange ? 'bold' : 'normal'};">
                              <input type="radio" name="edit-has-change" value="1" ${hasChange ? 'checked' : ''}> 変更あり
                            </label>
                          </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                          <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: var(--gray-700);">受講クラス・受講形態</label>
                            <select id="sel-edit-class" class="form-control" style="font-size: 0.85rem; padding: 5px 8px;">
                              <option value="${item.className}">所属: ${item.className}</option>
                              ${classOptions.filter(c => c !== item.className).map(c => `
                                <option value="${c}" ${item.enrollmentClass === c ? 'selected' : ''}>${c}</option>
                              `).join('')}
                              ${DB.getProjectChangeOptions(this.project).map(opt => {
                                let icon = opt === '非受講' ? '🚫' : (opt === '他教室で受講' ? '🏫' : '📝');
                                return `<option value="${opt}" ${item.enrollmentClass === opt ? 'selected' : ''}>${icon} ${opt}</option>`;
                              }).join('')}
                            </select>
                          </div>
                          <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: var(--gray-700);">受講科目</label>
                            <select id="sel-edit-course" class="form-control" style="font-size: 0.85rem; padding: 5px 8px;">
                              <option value="4科" ${item.enrollmentCourse === '4科' ? 'selected' : ''}>4科</option>
                              <option value="2科" ${item.enrollmentCourse === '2科' ? 'selected' : ''}>2科</option>
                              <option value="非受講" ${item.enrollmentCourse === '非受講' ? 'selected' : ''}>非受講</option>
                            </select>
                          </div>
                        </div>

                        <!-- 志望校別・追加チェック項目がある場合 -->
                        ${((this.project.scanTemplate?.customBoxes || []).length > 0 || Object.keys(item.customChecks || {}).length > 0) ? `
                          <div style="background: rgba(139, 92, 246, 0.05); border: 1px solid #c4b5fd; border-radius: var(--radius-sm); padding: 8px 10px;">
                            <div style="font-size: 0.78rem; font-weight: bold; color: #6d28d9; margin-bottom: 4px;">追加チェック項目:</div>
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                              ${((this.project.scanTemplate?.customBoxes || []).length > 0
                                  ? this.project.scanTemplate.customBoxes
                                  : Object.values(item.customChecks || {})
                                ).map(box => {
                                  const cur = item.customChecks?.[box.id];
                                  const isChk = cur ? cur.isChecked : false;
                                  return `
                                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem; cursor: pointer;">
                                      <input type="checkbox" class="chk-rev-custom-box-item" data-id="${box.id}" data-label="${box.label}" ${isChk ? 'checked' : ''}>
                                      <span style="font-weight: ${isChk ? 'bold' : 'normal'};">${box.label}</span>
                                    </label>
                                  `;
                                }).join('')}
                            </div>
                          </div>
                        ` : ''}
                      `}

                      <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: var(--gray-700);">備考・メモ</label>
                        <input type="text" id="inp-edit-remarks" class="form-control" placeholder="修正理由や特記事項など" value="${item.remarks || ''}" style="font-size: 0.85rem;">
                      </div>

                      <div style="margin-top: 4px;">
                        <button id="btn-save-edit" class="btn btn-primary" style="width: 100%; padding: 9px; font-size: 0.92rem; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;">
                          <span>💾 修正内容を保存</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            } else {
              // 過去の履歴カード
              let enrollmentDisp = '<span class="text-muted">-</span>';
              const histCourse = hist.enrollmentCourse || (hist.enrollmentClass === '非受講' ? '非受講' : (item.course || '4科'));
              if (hist.enrollmentClass === '非受講' || histCourse === '非受講') {
                enrollmentDisp = '<strong style="color: var(--danger-solid);">🚫 非受講</strong>';
              } else if (hist.hasChange) {
                enrollmentDisp = `<span class="badge badge-warning font-bold">🔄 ${hist.enrollmentClass} (${histCourse})</span>`;
              } else {
                enrollmentDisp = `<span class="badge badge-success font-bold">✅ ${hist.enrollmentClass || item.className} (${histCourse})</span>`;
              }

              return `
                <div class="history-item">
                  <div class="history-dot" style="border-color: var(--gray-400); color: var(--gray-600);">${icon}</div>
                  <div class="history-card" style="background: var(--gray-50); border-color: var(--gray-200);">
                    <div class="history-card-header">
                      <div class="history-meta-left">
                        <span class="badge badge-gray">${hist.inputMethod || '登録'}</span>
                        <span class="history-time" style="font-size: 0.78rem; color: var(--gray-500);">${UI.formatDate(hist.timestamp || hist.approvedAt)}</span>
                      </div>
                      <div class="history-staff" style="font-size: 0.78rem; color: var(--gray-600);">
                        担当: <strong>${hist.approvedBy || '-'}</strong>
                      </div>
                    </div>

                    <div class="history-details-grid" style="grid-template-columns: 1fr; gap: 6px;">
                      <div class="history-field">
                        <div class="history-field-label" style="font-size: 0.72rem;">受講内容</div>
                        <div class="history-field-value" style="font-size: 0.85rem;">${enrollmentDisp}</div>
                      </div>
                    </div>

                    ${hist.customChecks && Object.values(hist.customChecks).some(c => c.isChecked) ? `
                      <div style="margin-top: 6px; padding: 4px 8px; background: rgba(139, 92, 246, 0.05); border: 1px solid #ddd6fe; border-radius: var(--radius-sm); font-size: 0.75rem;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: #6d28d9; margin-bottom: 2px;">志望校別講座・追加チェック:</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                          ${Object.values(hist.customChecks).filter(c => c.isChecked).map(c => `
                            <span class="badge badge-purple" style="font-size: 0.72rem;">✅ ${c.label}</span>
                          `).join('')}
                        </div>
                      </div>
                    ` : ''}

                    ${hist.remarks ? `
                      <div class="history-remarks-box" style="margin-top: 6px; padding: 4px 8px; font-size: 0.78rem;">
                        <span style="font-weight: bold; color: var(--gray-600);">特記事項:</span> ${hist.remarks}
                      </div>
                    ` : ''}
                  </div>
                </div>
              `;
            }
          }).join('')}
        </div>
      </div>
    `;
  },

  /**
   * イベントハンドラ設定（画面内ボタン等のバインド）
   */
  bindEvents(currentItem) {
    // クイックジャンプセレクター
    const jumpSelect = this.container.querySelector('#sel-jump-student');
    if (jumpSelect) {
      jumpSelect.onchange = () => {
        const targetIdx = parseInt(jumpSelect.value, 10);
        if (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < this.reviewItems.length) {
          this.currentIndex = targetIdx;
          this.renderUI();
        }
      };
    }

    // 前へ / 次へ ボタン
    const prevBtn = this.container.querySelector('#btn-rev-prev');
    const nextBtn = this.container.querySelector('#btn-rev-next');
    if (prevBtn) {
      prevBtn.onclick = () => {
        if (this.currentIndex > 0) {
          this.currentIndex--;
          this.renderUI();
        }
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.currentIndex < this.reviewItems.length - 1) {
          this.currentIndex++;
          this.renderUI();
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

    // 修正内容の保存
    const saveBtn = this.container.querySelector('#btn-save-edit');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const isSelectionMode = (this.project.projectType === 'selection');
        const hasChangeRadio = this.container.querySelector('input[name="edit-has-change"]:checked');
        let hasChange = hasChangeRadio?.value === '1';
        let enrollmentClass = this.container.querySelector('#sel-edit-class')?.value || currentItem.className;
        let enrollmentCourse = this.container.querySelector('#sel-edit-course')?.value || currentItem.course || '4科';
        const remarks = this.container.querySelector('#inp-edit-remarks')?.value.trim() || '';

        // カスタムチェックボックスの修正状態を収集
        const customChecks = {};
        this.container.querySelectorAll('.chk-rev-custom-box-item').forEach(chk => {
          const id = chk.dataset.id;
          const label = chk.dataset.label;
          customChecks[id] = {
            id,
            label,
            isChecked: chk.checked
          };
        });

        if (isSelectionMode) {
          const totalSelected = Object.values(customChecks).filter(c => c.isChecked).length;
          hasChange = totalSelected > 0;
          enrollmentClass = totalSelected > 0 ? `${totalSelected}講座申込` : '0講座（未受講）';
          enrollmentCourse = '-';
        }

        UI.setButtonLoading(saveBtn, true, '保存中...');
        try {
          await DB.saveSubmission(currentItem.submissionId, {
            status: '承認済',
            hasChange,
            enrollmentClass,
            enrollmentCourse: enrollmentClass === '非受講' ? '非受講' : enrollmentCourse,
            remarks,
            customChecks,
            reviewedAt: new Date().toISOString(),
            reviewedBy: currentItem.approvedBy || '',
            reviewNote: remarks
          });

          UI.showToast(`${currentItem.name} 様の登録内容を修正・保存しました`, 'success');
          
          // 最新データを再取得して表示を更新（タイムラインも最新化）
          this.allStudents = await DB.getProjectStudentsWithSubmissions(this.project.id);
          this.updateReviewItems();
          this.renderUI();
        } catch (err) {
          UI.showToast(`修正保存エラー: ${err.message}`, 'error');
          UI.setButtonLoading(saveBtn, false);
        }
      };
    }
  }
};
