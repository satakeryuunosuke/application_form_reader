/**
 * 設定画面コントローラー（職員マスタ・共通既定書式設定・共有フォルダ連携・JSONバックアップ・3年アーカイブ管理）
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { CsvUtil } from '../utils/csv.js';
import { CheckboxEngine } from '../checkbox.js';
import { TemplateCalibrator } from '../components/calibrator.js';
import { APP_VERSION, SYSTEM_INFO } from '../version.js';
import { FolderConnector } from '../sync/folder-connector.js';
import { SyncManager } from '../sync/sync-manager.js';
import { PendingQueue } from '../sync/pending-queue.js';

export const SettingsPage = {
  container: null,
  calibrator: null,
  currentDefaultTemplate: null,

  async render(container) {
    this.container = container;

    // 共有フォルダ接続中なら最新の共有設定を読み込み
    if (FolderConnector.isConnected()) {
      await SyncManager.readSharedSettings();
    }

    const settings = await DB.getSettings();
    const clientId = await SyncManager.getClientId();
    const isSupported = FolderConnector.isSupported();
    const isConnected = FolderConnector.isConnected();
    const isPending = FolderConnector.isPermissionPending();
    const folderName = FolderConnector.getFolderName();
    const pendingCount = await PendingQueue.getPendingCount();

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;
    const twoYearsAgo = currentYear - 2;

    let archivedProjects = [];
    if (isConnected) {
      try {
        archivedProjects = await DB.getArchivedProjects();
      } catch (e) {
        console.warn('アーカイブ取得エラー:', e);
      }
    }

    const staffList = settings.staffNames || [];
    const coursePresets = settings.coursePresets || [];
    const methodPresets = settings.methodPresets || [];
    const currentCodeType = settings.codeType || 'code39';
    const systemDefaultTemplate = CheckboxEngine.getDefaultTemplate();
    this.currentDefaultTemplate = settings.defaultScanTemplate
      ? JSON.parse(JSON.stringify(settings.defaultScanTemplate))
      : JSON.parse(JSON.stringify(systemDefaultTemplate));

    this.container.innerHTML = `
      <div class="view-container" style="max-width: 980px; margin: 0 auto;">
        <div style="margin-bottom: var(--spacing-xl);">
          <h1 style="font-size: 1.85rem; font-weight: 800; color: var(--gray-900);">⚙️ システム設定</h1>
          <p style="color: var(--gray-500); margin-top: 4px;">共有フォルダ連携、職員マスタ、交換票（受講確認票）の共通既定書式、バックアップおよびデータ整理を行います</p>
        </div>

        <!-- 0. 共有フォルダ連携（複数PC共有） -->
        <div class="card" style="margin-bottom: var(--spacing-lg); border-left: 4px solid var(--primary-600);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title">📁 共有フォルダ連携（サーバーレス複数PC共有）</h2>
              <span class="badge ${isConnected ? 'badge-success' : (isPending ? 'badge-warning' : 'badge-gray')}">
                ${isConnected ? '🟢 接続中' : (isPending ? '🟡 要再認可 (一時停止中)' : '⚪ 未接続 (ローカル専用)')}
              </span>
            </div>
            ${isConnected ? `<button id="btn-sync-settings-now" class="btn btn-secondary btn-sm" title="共有フォルダから最新の職員名・共通書式を再取得">🔄 共有設定を同期</button>` : ''}
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            社内LANのファイルサーバーや共有フォルダを指定することで、外部サーバーを介さずに複数台のPC間で受講確認状況の閲覧・手動登録・職員名・共通書式を共有できます（File System Access API）。
          </p>

          ${isPending ? `
            <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: var(--spacing-md); font-size: 0.85rem; color: #b45309;">
              ⚠️ <strong>共有フォルダへのアクセス許可が一時停止しています</strong><br>
              ブラウザのセキュリティ仕様により、ブラウザの再起動・リロード後はファイルアクセスの再認可が必要です。「アクセスを再開」をクリックしてください。
            </div>
          ` : ''}

          ${!isSupported ? `
            <div class="card" style="background: var(--warning-bg); border: 1px solid var(--warning-border); padding: 12px 16px; margin-bottom: var(--spacing-md);">
              <div style="color: var(--warning-text); font-size: 0.88rem;">
                ⚠️ <strong>ご利用中のブラウザは共有フォルダ接続に対応していません。</strong><br>
                複数PC共有機能をご利用になるには、PC版 Google Chrome または Microsoft Edge をご利用ください。
              </div>
            </div>
          ` : `
            <div style="display: grid; gap: 14px; margin-bottom: var(--spacing-md);">
              <!-- 接続状態とボタン -->
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: var(--gray-50); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
                <div>
                  <div style="font-size: 0.78rem; color: var(--gray-500);">接続先フォルダ</div>
                  <div style="font-size: 0.95rem; font-weight: 700; color: var(--gray-800); word-break: break-all;">
                    ${isConnected
                      ? `📂 ${folderName}`
                      : (isPending
                          ? `📂 ${folderName} <span class="badge badge-warning" style="font-size: 0.72rem; margin-left: 6px;">権限停止中</span>`
                          : '未接続（ローカル IndexedDB のみで動作中）')}
                  </div>
                </div>
                <div style="display: flex; gap: 8px;">
                  ${isConnected ? `
                    <button id="btn-disconnect-folder" class="btn btn-secondary btn-sm">🔌 接続解除</button>
                  ` : (isPending ? `
                    <button id="btn-resume-folder-settings" class="btn btn-primary btn-sm">🔑 アクセスを再開</button>
                    <button id="btn-connect-folder" class="btn btn-secondary btn-sm">📁 別のフォルダを選択</button>
                    <button id="btn-disconnect-folder" class="btn btn-ghost btn-sm text-muted">解除</button>
                  ` : `
                    <button id="btn-connect-folder" class="btn btn-primary btn-sm">📁 共有フォルダを接続</button>
                  `)}
                </div>
              </div>

              <!-- 端末識別子 (clientId) と 未送信キュー -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">
                <!-- 端末識別子 -->
                <div style="background: var(--bg-surface); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
                  <div style="font-size: 0.78rem; color: var(--gray-500); margin-bottom: 4px;">このPCの識別名 (端末ID)</div>
                  <div style="display: flex; gap: 6px;">
                    <input type="text" id="inp-client-id" class="form-control text-mono font-bold" value="${clientId}" style="font-size: 0.88rem; padding: 4px 8px;">
                    <button id="btn-save-client-id" class="btn btn-secondary btn-sm" style="white-space: nowrap;">変更</button>
                  </div>
                  <div style="font-size: 0.72rem; color: var(--gray-400); margin-top: 3px;">イベントログの差分記録元として記録されます</div>
                </div>

                <!-- 未送信キュー -->
                <div style="background: var(--bg-surface); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--gray-200); display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="font-size: 0.78rem; color: var(--gray-500); margin-bottom: 4px;">未送信イベント（オフライン保留）</div>
                    <div style="font-size: 0.95rem; font-weight: 700; color: ${pendingCount > 0 ? 'var(--warning-text)' : 'var(--success-text)'};">
                      ${pendingCount > 0 ? `⚠️ ${pendingCount} 件 保留中` : '✅ 保留なし (すべて同期済)'}
                    </div>
                  </div>
                  <div style="margin-top: 6px;">
                    <button id="btn-flush-queue" class="btn btn-secondary btn-sm" style="width: 100%;" ${pendingCount === 0 || !isConnected ? 'disabled' : ''}>
                      📤 保留データを今すぐ送信
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `}
        </div>

        <!-- 1. 職員マスタ管理 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title">👥 職員マスタ設定</h2>
              <span class="badge ${isConnected ? 'badge-info' : 'badge-gray'}" style="font-size: 0.75rem;">
                ${isConnected ? '全PC共有' : 'ローカル'}
              </span>
            </div>
            <span class="badge badge-gray">${staffList.length} 名登録</span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            確認票の承認作業者・手動受付者としてプルダウンに表示される職員名を設定します。
            ${isConnected ? '共有フォルダ接続中は自動的に全PC間で共有・同期されます。' : ''}
          </p>

          <div style="display: flex; gap: 8px; margin-bottom: var(--spacing-md);">
            <input type="text" id="inp-new-staff" class="form-control" placeholder="新しい職員名を入力（例: 山田 太郎）" style="max-width: 320px;">
            <button id="btn-add-staff" class="btn btn-primary">➕ 追加</button>
          </div>

          <div id="staff-tags-list" style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${staffList.map((name, index) => `
              <div class="badge badge-info" style="font-size: 0.92rem; padding: 6px 12px; display: inline-flex; align-items: center; gap: 8px;">
                <span>${name}</span>
                <button class="btn-ghost btn-del-staff" data-index="${index}" style="padding: 0; color: var(--danger-solid); font-size: 14px; line-height: 1; cursor: pointer;" title="削除">✕</button>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 2. 志望校別対策講座マスタ設定 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title">📚 志望校別対策講座マスタ設定</h2>
              <span class="badge ${isConnected ? 'badge-info' : 'badge-gray'}" style="font-size: 0.75rem;">
                ${isConnected ? '全PC共有' : 'ローカル'}
              </span>
            </div>
            <span class="badge badge-purple">講座名 ${coursePresets.length}件 / 受講方法 ${methodPresets.length}件</span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            志望校別対策講座用の「講座名」および「受講方法（校舎・形式）」の選択肢マスタを設定します。<br>
            ここで登録した項目は、プロジェクト作成時や共通書式設定のチェックボックス追加プルダウンで選択できるようになります。
            ${isConnected ? '（共有フォルダ接続中は全PC間で共有・同期されます）' : ''}
          </p>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
            <!-- 講座名マスタ -->
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 14px;">
              <div style="font-weight: 700; font-size: 0.92rem; color: var(--gray-800); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span>🏫 講座名マスタ</span>
                  <span class="badge badge-gray" style="font-size: 0.75rem;">${coursePresets.length} 件</span>
                </div>
                ${coursePresets.length > 1 ? `
                  <button type="button" id="btn-sort-course-presets" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 2px 8px;" title="講座名を名前順（昇順）に並び替え">
                    🔤 名前順に並び替え
                  </button>
                ` : ''}
              </div>
              <div style="display: flex; gap: 6px; margin-bottom: 10px;">
                <input type="text" id="inp-new-course" class="form-control" placeholder="新しい講座名（例: 東海Ⅱ）" style="font-size: 0.85rem;">
                <button id="btn-add-course-preset" class="btn btn-primary btn-sm" style="white-space: nowrap;">➕ 追加</button>
              </div>
              <div id="course-tags-list" style="display: flex; flex-wrap: wrap; gap: 6px; min-height: 36px;">
                ${coursePresets.map((name, index) => `
                  <div class="badge badge-purple" style="font-size: 0.84rem; padding: 4px 8px; display: inline-flex; align-items: center; gap: 6px;">
                    <div style="display: inline-flex; gap: 2px;">
                      <button type="button" class="btn-ghost btn-move-course" data-index="${index}" data-dir="-1" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''} style="padding:0; font-size:10px; cursor:pointer;" title="前へ">◀</button>
                      <button type="button" class="btn-ghost btn-move-course" data-index="${index}" data-dir="1" ${index === coursePresets.length - 1 ? 'disabled style="opacity:0.3;"' : ''} style="padding:0; font-size:10px; cursor:pointer;" title="次へ">▶</button>
                    </div>
                    <span>${name}</span>
                    <button class="btn-ghost btn-del-course" data-index="${index}" style="padding: 0; color: #dc2626; font-size: 13px; line-height: 1; cursor: pointer;" title="削除">✕</button>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- 受講方法マスタ -->
            <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 14px;">
              <div style="font-weight: 700; font-size: 0.92rem; color: var(--gray-800); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <span>💻 受講方法マスタ</span>
                <span class="badge badge-gray" style="font-size: 0.75rem;">${methodPresets.length} 件</span>
              </div>
              <div style="display: flex; gap: 6px; margin-bottom: 10px;">
                <input type="text" id="inp-new-method" class="form-control" placeholder="新しい受講方法（例: 名駅校）" style="font-size: 0.85rem;">
                <button id="btn-add-method-preset" class="btn btn-primary btn-sm" style="white-space: nowrap;">➕ 追加</button>
              </div>
              <div id="method-tags-list" style="display: flex; flex-wrap: wrap; gap: 6px; min-height: 36px;">
                ${methodPresets.map((name, index) => `
                  <div class="badge badge-info" style="font-size: 0.84rem; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px;">
                    <span>${name}</span>
                    <button class="btn-ghost btn-del-method" data-index="${index}" style="padding: 0; color: #dc2626; font-size: 13px; line-height: 1; cursor: pointer;" title="削除">✕</button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- 3. 交換票（受講確認票）の共通既定書式設定 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title">📐 交換票（受講確認票）の共通既定書式設定</h2>
              <span class="badge ${isConnected ? 'badge-info' : 'badge-gray'}" style="font-size: 0.75rem;">
                ${isConnected ? '全PC共有' : 'ローカル'}
              </span>
            </div>
            <span class="badge badge-info">新規プロジェクト適用</span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            新しく作成するプロジェクトの初期書式として適用される、受講確認票（交換票）の共通既定書式（コード規格、チェックボックス相対位置・サイズ・判定閾値）を設定します。<br>
            ※ サンプル帳票やお手元のPDF/画像を読み込んで位置を合わせ、右下の「<strong>💾 共通既定書式を保存</strong>」を押してください。
            ${isConnected ? '（共有フォルダ接続中は全PCに共有されます）' : ''}
          </p>

          <!-- 読取コード規格切替パネル -->
          <div style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: var(--spacing-md);">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
              <div style="font-weight: 700; font-size: 0.95rem; color: var(--gray-800); display: flex; align-items: center; gap: 6px;">
                <span>🏷️ 帳票の読取コード規格</span>
                <span class="badge badge-info" style="font-size: 0.75rem;">全PC共有</span>
              </div>
              <span style="font-size: 0.78rem; color: var(--gray-500);">※ Wordの差し込み印刷でQRコードをお使いの場合は「QRコード」を選択してください</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px;">
              <label id="label-code-type-qr" style="display: flex; align-items: flex-start; gap: 10px; background: white; border: 2px solid ${currentCodeType === 'qr' ? 'var(--primary-600)' : 'var(--gray-200)'}; border-radius: var(--radius-md); padding: 12px 14px; cursor: pointer; transition: all 0.2s ease;">
                <input type="radio" name="setting-code-type" value="qr" ${currentCodeType === 'qr' ? 'checked' : ''} style="margin-top: 3px;">
                <div>
                  <div style="font-weight: 700; font-size: 0.88rem; color: var(--gray-900);">🏁 QRコード <span class="badge badge-success" style="font-size: 0.72rem; padding: 2px 6px;">推奨・最速</span></div>
                  <div style="font-size: 0.78rem; color: var(--gray-600); margin-top: 3px;">省スペース・傾きや汚れに強く、読取処理が最も高速です。Word差込印刷（MERGEBARCODE）に対応。</div>
                </div>
              </label>

              <label id="label-code-type-code39" style="display: flex; align-items: flex-start; gap: 10px; background: white; border: 2px solid ${currentCodeType === 'code39' ? 'var(--primary-600)' : 'var(--gray-200)'}; border-radius: var(--radius-md); padding: 12px 14px; cursor: pointer; transition: all 0.2s ease;">
                <input type="radio" name="setting-code-type" value="code39" ${currentCodeType === 'code39' ? 'checked' : ''} style="margin-top: 3px;">
                <div>
                  <div style="font-weight: 700; font-size: 0.88rem; color: var(--gray-900);">📊 バーコード (CODE 39)</div>
                  <div style="font-size: 0.78rem; color: var(--gray-600); margin-top: 3px;">従来の横長バーコード形式です。過去に印刷済みの帳票を読み取る場合に選択してください。</div>
                </div>
              </label>

              <label id="label-code-type-auto" style="display: flex; align-items: flex-start; gap: 10px; background: white; border: 2px solid ${currentCodeType === 'auto' ? 'var(--primary-600)' : 'var(--gray-200)'}; border-radius: var(--radius-md); padding: 12px 14px; cursor: pointer; transition: all 0.2s ease;">
                <input type="radio" name="setting-code-type" value="auto" ${currentCodeType === 'auto' ? 'checked' : ''} style="margin-top: 3px;">
                <div>
                  <div style="font-weight: 700; font-size: 0.88rem; color: var(--gray-900);">🔀 自動判別 (両対応)</div>
                  <div style="font-size: 0.78rem; color: var(--gray-600); margin-top: 3px;">QRコードを優先探索し、未検出時はCODE 39も探索します。新旧帳票が混在する場合に便利です。</div>
                </div>
              </label>
            </div>
          </div>

          <!-- 志望校別対策講座・追加チェックボックス管理パネル -->
          <div class="custom-boxes-config-panel" style="background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 14px; margin-bottom: var(--spacing-md);">
            <div style="font-weight: bold; font-size: 0.95rem; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
              <span>🎯 読取チェックボックス項目管理（標準・志望校別講座）</span>
              <span class="badge badge-purple" style="font-size: 0.75rem;">共通初期枠</span>
            </div>
            <p style="color: var(--gray-600); font-size: 0.82rem; margin-bottom: 12px;">
              共通既定書式として読み取るチェックボックス（標準の変更なし・変更あり、志望校別対策講座、自由項目）を調整・削除・追加できます。
            </p>

            <!-- 志望校別講座（講座名 × 受講方法）選択追加フォーム -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px; align-items: end;">
              <div>
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">講座名を選択</label>
                <select id="sel-course-preset" class="form-control" style="font-size: 0.85rem;">
                  <option value="">-- 講座名を選択 --</option>
                  ${coursePresets.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">受講方法を選択</label>
                <select id="sel-method-preset" class="form-control" style="font-size: 0.85rem;">
                  <option value="">-- 受講方法を選択 --</option>
                  ${methodPresets.map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>
              </div>
              <div>
                <button type="button" id="btn-add-course-checkbox" class="btn btn-primary btn-sm" style="width: 100%; height: 38px;">
                  ➕ 志望校別講座を追加
                </button>
              </div>
            </div>

            <!-- 自由記述追加フォーム -->
            <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center;">
              <input type="text" id="inp-custom-box-name" class="form-control" placeholder="自由記述で項目名を入力（例: 特別講習A、Zoom振替希望 など）" style="font-size: 0.85rem;">
              <button type="button" id="btn-add-custom-free-checkbox" class="btn btn-secondary btn-sm" style="white-space: nowrap; height: 38px;">
                ➕ 自由項目を追加
              </button>
            </div>

            <!-- 登録中カスタムボックス一覧 -->
            <div id="custom-boxes-list-container"></div>
          </div>

          <div id="settings-calib-mount" style="margin-bottom: var(--spacing-md);"></div>

          <div style="display: flex; align-items: center; justify-content: space-between; padding-top: var(--spacing-md); border-top: 1px solid var(--gray-200); flex-wrap: wrap; gap: 12px;">
            <button id="btn-reset-system-template" class="btn btn-ghost btn-sm" style="color: var(--gray-600);">
              🔄 システム標準（初期値）に戻す
            </button>
            <button id="btn-save-default-template" class="btn btn-primary">
              💾 共通既定書式を保存
            </button>
          </div>
        </div>

        <!-- 3. 共有フォルダの完了（アーカイブ）プロジェクト整理・一括削除 -->
        <div class="card" style="margin-bottom: var(--spacing-lg); border-left: 4px solid var(--primary-600);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title">🗄️ 共有フォルダの完了（アーカイブ）プロジェクト整理・一括削除</h2>
              <span class="badge ${archivedProjects.length > 0 ? 'badge-info' : 'badge-gray'}">
                ${archivedProjects.length} 件
              </span>
            </div>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            共有フォルダの退避フォルダ（<code>archive/</code>）に保管されている完了プロジェクトを年度ごとに一括選択し、共有フォルダから完全に消去できます。
          </p>

          ${!isConnected ? `
            <div style="background: var(--gray-50); border: 1px dashed var(--gray-300); border-radius: var(--radius-md); padding: var(--spacing-md); text-align: center; color: var(--gray-500); font-size: 0.85rem;">
              共有フォルダが接続されていません。上部の「共有フォルダ連携」から接続してください。
            </div>
          ` : (archivedProjects.length === 0 ? `
            <div style="font-size: 0.88rem; color: var(--gray-500); padding: 8px 0;">
              現在、共有フォルダに完了（アーカイブ）されたプロジェクトはありません。
            </div>
          ` : `
            <!-- 一括選択補助バー -->
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; background: var(--gray-50); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span class="font-bold" style="font-size: 0.82rem; color: var(--gray-700);">まとめて選択:</span>
                <button type="button" id="btn-select-last-year" class="btn btn-secondary btn-sm" style="font-size: 0.78rem; padding: 3px 10px;">
                  📅 昨年度 (${lastYear}年度)
                </button>
                <button type="button" id="btn-select-older-years" class="btn btn-secondary btn-sm" style="font-size: 0.78rem; padding: 3px 10px;">
                  📅 一昨年度以前 (${twoYearsAgo}年度以前)
                </button>
                <button type="button" id="btn-toggle-all-archived" class="btn btn-ghost btn-sm" style="font-size: 0.78rem; padding: 3px 8px; color: var(--primary-600);">
                  全選択 / 解除
                </button>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span id="label-archived-selected-count" style="font-size: 0.84rem; font-weight: 700; color: var(--primary-700);">0 件選択中</span>
                <button type="button" id="btn-delete-selected-archived" class="btn btn-danger btn-sm" disabled style="font-size: 0.82rem;">
                  🗑️ 選択したプロジェクトを完全削除
                </button>
              </div>
            </div>

            <div class="table-container" style="max-height: 380px; overflow-y: auto; margin-bottom: var(--spacing-sm);">
              <table class="table" style="font-size: 0.85rem;">
                <thead>
                  <tr>
                    <th style="width: 44px; text-align: center;">
                      <input type="checkbox" id="chk-header-select-all" title="すべて選択/解除">
                    </th>
                    <th>年度 / 学年 / 受講期</th>
                    <th>プロジェクト名</th>
                    <th>生徒数</th>
                    <th>完了日</th>
                  </tr>
                </thead>
                <tbody id="archived-projects-tbody">
                  ${archivedProjects.map(p => `
                    <tr data-id="${p.id}" data-year="${p.meta.year}">
                      <td style="text-align: center;">
                        <input type="checkbox" class="chk-archived-item" data-id="${p.id}" data-title="${UI.formatProjectTitle(p.meta.title)}" data-year="${p.meta.year}" data-info="${p.meta.year}年度 ${p.meta.grade}年 ${UI.formatSession(p.meta.sessionName)}">
                      </td>
                      <td>
                        <span class="badge badge-info">${p.meta.year}年度</span>
                        <span class="badge badge-purple">${p.meta.grade}年</span>
                        <span class="badge badge-success">${UI.formatSession(p.meta.sessionName)}</span>
                      </td>
                      <td class="font-bold" style="color: var(--gray-800);">${UI.formatProjectTitle(p.meta.title)}</td>
                      <td class="text-mono">${p.studentCount > 0 ? `${p.studentCount} 名` : '-'}</td>
                      <td class="text-mono" style="font-size: 0.8rem; color: var(--gray-600);">
                        ${p.meta.completedAt ? UI.formatDate(p.meta.completedAt) : (p.meta.archivedAt ? UI.formatDate(p.meta.archivedAt) : '-')}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `)}
        </div>

        <!-- 4. バックアップ & 復元 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <h2 class="card-title">💾 データのバックアップと復元</h2>
            <span class="badge badge-info">完全ローカル安全出力</span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            IndexedDB に保存されている全プロジェクト・生徒・提出データ・共通設定を1つのJSONファイルとして書き出し／復元できます。<br>
            ブラウザのキャッシュ消去対策や別PCへのデータ移行にご活用ください。
          </p>

          <div style="display: flex; flex-wrap: wrap; gap: 12px;">
            <button id="btn-export-backup" class="btn btn-primary">
              📥 全データJSONバックアップ出力
            </button>
            <button id="btn-trigger-import" class="btn btn-secondary">
              📤 JSONバックアップから復元
            </button>
            <input type="file" id="inp-import-file" accept=".json,application/json" style="display: none;">
          </div>
        </div>

        <!-- 5. システム情報 & バージョン -->
        <div class="card" style="background: var(--gray-50); border: 1px solid var(--gray-200);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title" style="font-size: 1.05rem;">ℹ️ システム情報</h2>
            </div>
            <span class="badge badge-info" style="font-family: var(--font-mono); font-weight: 700;">${APP_VERSION}</span>
          </div>
          <div style="font-size: 0.88rem; color: var(--gray-700); display: grid; gap: 8px;">
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">システム名称:</span>
              <span class="font-bold">${SYSTEM_INFO.name}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">バージョン / ビルド:</span>
              <span class="text-mono">${APP_VERSION} (${SYSTEM_INFO.buildDate})</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">セキュリティ・通信方針:</span>
              <span style="color: var(--success-text); font-weight: 600;">完全ローカル動作 (外部サーバー通信ゼロ)</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">複数PC共有方式:</span>
              <span style="font-weight: 600;">File System Access API (LAN共有フォルダ差分ログ同期)</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">データ保存先:</span>
              <span>${SYSTEM_INFO.storageType}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">データ保管期限:</span>
              <span>${SYSTEM_INFO.retentionPeriod}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // キャリブレーターの初期化マウント
    const calibMount = this.container.querySelector('#settings-calib-mount');
    if (calibMount) {
      this.calibrator = new TemplateCalibrator(
        calibMount,
        this.currentDefaultTemplate,
        (updatedTemplate) => {
          this.currentDefaultTemplate = updatedTemplate;
          this.renderCustomBoxesList();
        },
        {
          defaultResetTemplate: systemDefaultTemplate,
          codeType: currentCodeType,
          resetLabel: '🔄 システム標準初期値に戻す',
          resetToastMsg: 'システム標準初期値に復元しました（「共通既定書式を保存」で確定してください）',
          allowDeleteStandardBoxes: false
        }
      );
    }

    this.renderCustomBoxesList();
    this.bindEvents(settings, staffList, coursePresets, methodPresets, systemDefaultTemplate);
  },

  bindEvents(settings, staffList, coursePresets, methodPresets, systemDefaultTemplate) {
    // 共有フォルダ接続
    const connectFolderBtn = this.container.querySelector('#btn-connect-folder');
    if (connectFolderBtn) {
      connectFolderBtn.onclick = async () => {
        UI.setButtonLoading(connectFolderBtn, true, '接続中...');
        try {
          await FolderConnector.connect();
          UI.showToast(`共有フォルダ「${FolderConnector.getFolderName()}」に接続しました`, 'success');
          // 接続直後に共有設定を同期
          await SyncManager.readSharedSettings();
          await this.render(this.container);
        } catch (err) {
          UI.showToast(err.message, 'warning');
          UI.setButtonLoading(connectFolderBtn, false);
        }
      };
    }

    // 共有フォルダアクセス再開
    const resumeFolderBtn = this.container.querySelector('#btn-resume-folder-settings');
    if (resumeFolderBtn) {
      resumeFolderBtn.onclick = async () => {
        UI.setButtonLoading(resumeFolderBtn, true, '再開中...');
        try {
          const permitted = await FolderConnector.ensurePermission(true);
          if (permitted) {
            UI.showToast(`共有フォルダ「${FolderConnector.getFolderName()}」へのアクセスを再開しました`, 'success');
            await SyncManager.readSharedSettings();
            await this.render(this.container);
          } else {
            UI.showToast('共有フォルダへのアクセス権限が許可されませんでした。', 'warning');
            UI.setButtonLoading(resumeFolderBtn, false);
          }
        } catch (err) {
          UI.showToast(`再開エラー: ${err.message}`, 'error');
          UI.setButtonLoading(resumeFolderBtn, false);
        }
      };
    }

    // 共有フォルダ切断
    const disconnectFolderBtn = this.container.querySelector('#btn-disconnect-folder');
    if (disconnectFolderBtn) {
      disconnectFolderBtn.onclick = async () => {
        const ok = await UI.confirm(
          '共有フォルダの接続解除',
          '共有フォルダの接続を解除しますか？\n（解除後はローカル専用モードで動作し、いつでも再接続できます）',
          '接続を解除',
          'warning'
        );
        if (ok) {
          await FolderConnector.disconnect();
          UI.showToast('共有フォルダの接続を解除しました', 'info');
          await this.render(this.container);
        }
      };
    }

    // 共有設定の手動同期
    const syncSettingsBtn = this.container.querySelector('#btn-sync-settings-now');
    if (syncSettingsBtn) {
      syncSettingsBtn.onclick = async () => {
        UI.setButtonLoading(syncSettingsBtn, true, '同期中...');
        UI.showLoading({
          title: '共有設定を同期中...',
          message: 'ファイルサーバーの settings.json から職員名・共通既定書式を取得・反映しています。',
          icon: '⚙️'
        });
        try {
          const res = await SyncManager.readSharedSettings();
          if (res) {
            UI.showToast('共有フォルダから職員名・共通書式を最新化しました', 'success');
          } else {
            UI.showToast('共有設定が見つからないか、最新の状態です', 'info');
          }
          await this.render(this.container);
        } catch (err) {
          UI.showToast(`設定同期エラー: ${err.message}`, 'error');
          UI.setButtonLoading(syncSettingsBtn, false);
        } finally {
          UI.hideLoading();
        }
      };
    }

    // 端末ID (clientId) の変更
    const saveClientIdBtn = this.container.querySelector('#btn-save-client-id');
    const clientIdInput = this.container.querySelector('#inp-client-id');
    if (saveClientIdBtn && clientIdInput) {
      saveClientIdBtn.onclick = async () => {
        const val = clientIdInput.value.trim();
        if (!val) {
          UI.showToast('端末IDを入力してください', 'warning');
          return;
        }
        await SyncManager.setClientId(val);
        UI.showToast(`端末識別子を「${val}」に変更しました`, 'success');
      };
    }

    // 未送信キューのフラッシュ
    const flushQueueBtn = this.container.querySelector('#btn-flush-queue');
    if (flushQueueBtn) {
      flushQueueBtn.onclick = async () => {
        flushQueueBtn.disabled = true;
        flushQueueBtn.textContent = '送信中...';
        try {
          const res = await PendingQueue.flush(async (pId, ev) => {
            return await SyncManager.writeEventDirectly(pId, ev);
          });
          UI.showToast(`未送信イベントを送信しました（成功: ${res.flushed}件, 失敗: ${res.failed}件）`, res.failed > 0 ? 'warning' : 'success');
          await this.render(this.container);
        } catch (err) {
          UI.showToast(`キュー送信エラー: ${err.message}`, 'error');
          flushQueueBtn.disabled = false;
        }
      };
    }

    // 職員追加
    const staffInput = this.container.querySelector('#inp-new-staff');
    const addStaffBtn = this.container.querySelector('#btn-add-staff');

    const handleAddStaff = async () => {
      const name = staffInput.value.trim();
      if (!name) return;
      if (staffList.includes(name)) {
        UI.showToast('すでに登録されている名前です', 'warning');
        return;
      }
      staffList.push(name);
      await DB.saveSettings({ ...settings, staffNames: staffList });
      UI.showToast(`「${name}」を追加しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'success');
      this.render(this.container);
    };

    addStaffBtn.onclick = handleAddStaff;
    staffInput.onkeydown = (e) => {
      if (e.key === 'Enter') handleAddStaff();
    };

    // 職員削除
    this.container.querySelectorAll('.btn-del-staff').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const delName = staffList[idx];
        staffList.splice(idx, 1);
        await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
        UI.showToast(`「${delName}」を削除しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'info');
        this.render(this.container);
      };
    });

    // 講座名マスタ追加
    const courseInput = this.container.querySelector('#inp-new-course');
    const addCoursePresetBtn = this.container.querySelector('#btn-add-course-preset');

    const handleAddCoursePreset = async () => {
      const name = courseInput?.value.trim();
      if (!name) return;
      if (coursePresets.includes(name)) {
        UI.showToast('すでに登録されている講座名です', 'warning');
        return;
      }
      coursePresets.push(name);
      await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
      UI.showToast(`講座名「${name}」を追加しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'success');
      this.render(this.container);
    };

    if (addCoursePresetBtn) addCoursePresetBtn.onclick = handleAddCoursePreset;
    if (courseInput) {
      courseInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleAddCoursePreset();
      };
    }

    // 講座名マスタ削除
    this.container.querySelectorAll('.btn-del-course').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const delName = coursePresets[idx];
        coursePresets.splice(idx, 1);
        await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
        UI.showToast(`講座名「${delName}」を削除しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'info');
        this.render(this.container);
      };
    });

    // 講座名マスタ順序変更（◀ / ▶）
    this.container.querySelectorAll('.btn-move-course').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const dir = parseInt(btn.dataset.dir, 10);
        const targetIdx = idx + dir;
        if (targetIdx < 0 || targetIdx >= coursePresets.length) return;
        const [item] = coursePresets.splice(idx, 1);
        coursePresets.splice(targetIdx, 0, item);
        await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
        this.render(this.container);
      };
    });

    // 講座名マスタ名前順ソート
    const sortCoursesBtn = this.container.querySelector('#btn-sort-course-presets');
    if (sortCoursesBtn) {
      sortCoursesBtn.onclick = async () => {
        coursePresets.sort((a, b) => a.localeCompare(b, 'ja'));
        await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
        UI.showToast('講座名マスタを名前順に並び替えました', 'success');
        this.render(this.container);
      };
    }

    // 受講方法マスタ追加
    const methodInput = this.container.querySelector('#inp-new-method');
    const addMethodPresetBtn = this.container.querySelector('#btn-add-method-preset');

    const handleAddMethodPreset = async () => {
      const name = methodInput?.value.trim();
      if (!name) return;
      if (methodPresets.includes(name)) {
        UI.showToast('すでに登録されている受講方法です', 'warning');
        return;
      }
      methodPresets.push(name);
      await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
      UI.showToast(`受講方法「${name}」を追加しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'success');
      this.render(this.container);
    };

    if (addMethodPresetBtn) addMethodPresetBtn.onclick = handleAddMethodPreset;
    if (methodInput) {
      methodInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleAddMethodPreset();
      };
    }

    // 受講方法マスタ削除
    this.container.querySelectorAll('.btn-del-method').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const delName = methodPresets[idx];
        methodPresets.splice(idx, 1);
        await DB.saveSettings({ ...settings, staffNames: staffList, coursePresets, methodPresets });
        UI.showToast(`受講方法「${delName}」を削除しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'info');
        this.render(this.container);
      };
    });

    // 読取コード規格（QRコード / CODE 39 / 自動判別）の切り替え
    const codeTypeRadios = this.container.querySelectorAll('input[name="setting-code-type"]');
    codeTypeRadios.forEach(radio => {
      radio.addEventListener('change', async (e) => {
        const val = e.target.value;
        const s = await DB.getSettings();
        s.codeType = val;
        await DB.saveSettings(s);

        // ラベルのアクティブ枠線表示を更新
        codeTypeRadios.forEach(r => {
          const parentLabel = r.closest('label');
          if (parentLabel) {
            parentLabel.style.borderColor = r.checked ? 'var(--primary-600)' : 'var(--gray-200)';
          }
        });

        // キャリブレーターに動的通知
        if (this.calibrator) {
          await this.calibrator.updateCodeType(val);
        }

        const labelText = val === 'qr' ? 'QRコード' : (val === 'code39' ? 'バーコード (CODE 39)' : '自動判別 (両対応)');
        UI.showToast(`読取コード規格を「${labelText}」に変更しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'success');
      });
    });

    // 共通既定書式の保存
    const saveDefaultTemplateBtn = this.container.querySelector('#btn-save-default-template');
    if (saveDefaultTemplateBtn) {
      saveDefaultTemplateBtn.onclick = async () => {
        const selRadio = this.container.querySelector('input[name="setting-code-type"]:checked');
        const selectedCodeType = selRadio ? selRadio.value : (settings.codeType || 'code39');

        if (this.calibrator && !this.calibrator.isBarcodeDetected()) {
          const codeName = selectedCodeType === 'qr' ? 'QRコード' : 'コード';
          UI.showToast(`${codeName}が読み取れていません。鮮明に写っている受講票ファイルを選択するか、ファイルをご確認ください。`, 'error');
          return;
        }
        UI.setButtonLoading(saveDefaultTemplateBtn, true, '保存中...');
        try {
          const templateToSave = this.calibrator ? this.calibrator.getTemplate() : this.currentDefaultTemplate;
          const updatedSettings = {
            ...settings,
            staffNames: staffList,
            coursePresets,
            methodPresets,
            codeType: selectedCodeType,
            defaultScanTemplate: templateToSave,
            checkThreshold: templateToSave.threshold !== undefined ? templateToSave.threshold : 0.25
          };
          await DB.saveSettings(updatedSettings);
          UI.showToast(`交換票（受講確認票）の共通既定書式を保存しました${FolderConnector.isConnected() ? '（共有フォルダ同期済）' : ''}`, 'success');
        } catch (err) {
          UI.showToast(`保存エラー: ${err.message}`, 'error');
        } finally {
          UI.setButtonLoading(saveDefaultTemplateBtn, false);
        }
      };
    }

    // システム標準へのリセット
    const resetSystemTemplateBtn = this.container.querySelector('#btn-reset-system-template');
    if (resetSystemTemplateBtn) {
      resetSystemTemplateBtn.onclick = async () => {
        const ok = await UI.confirm(
          '共通既定書式のリセット',
          '交換票の書式設定をシステム標準（初期値）に戻しますか？\n（リセット後、「共通既定書式を保存」を押して確定してください）',
          '初期値に戻す',
          'warning'
        );
        if (!ok) return;

        if (this.calibrator) {
          this.calibrator.setTemplate(systemDefaultTemplate);
          this.currentDefaultTemplate = JSON.parse(JSON.stringify(systemDefaultTemplate));
          this.renderCustomBoxesList();
          UI.showToast('システム標準（初期値）に復元しました。「共通既定書式を保存」で確定してください。', 'info');
        }
      };
    }

    // 共有フォルダの完了（アーカイブ）プロジェクト整理・一括削除
    const itemCheckboxes = this.container.querySelectorAll('.chk-archived-item');
    const headerSelectAll = this.container.querySelector('#chk-header-select-all');
    const selectLastYearBtn = this.container.querySelector('#btn-select-last-year');
    const selectOlderYearsBtn = this.container.querySelector('#btn-select-older-years');
    const toggleAllBtn = this.container.querySelector('#btn-toggle-all-archived');
    const deleteSelectedBtn = this.container.querySelector('#btn-delete-selected-archived');
    const selectedCountLabel = this.container.querySelector('#label-archived-selected-count');

    const updateSelectionState = () => {
      const checkedItems = Array.from(itemCheckboxes).filter(chk => chk.checked);
      const count = checkedItems.length;
      if (selectedCountLabel) {
        selectedCountLabel.textContent = `${count} 件選択中`;
      }
      if (deleteSelectedBtn) {
        deleteSelectedBtn.disabled = count === 0;
      }
      if (headerSelectAll) {
        headerSelectAll.checked = itemCheckboxes.length > 0 && count === itemCheckboxes.length;
        headerSelectAll.indeterminate = count > 0 && count < itemCheckboxes.length;
      }
    };

    itemCheckboxes.forEach(chk => {
      chk.addEventListener('change', updateSelectionState);
    });

    if (headerSelectAll) {
      headerSelectAll.addEventListener('change', () => {
        const isChecked = headerSelectAll.checked;
        itemCheckboxes.forEach(chk => { chk.checked = isChecked; });
        updateSelectionState();
      });
    }

    if (toggleAllBtn) {
      toggleAllBtn.onclick = () => {
        const anyUnchecked = Array.from(itemCheckboxes).some(chk => !chk.checked);
        itemCheckboxes.forEach(chk => { chk.checked = anyUnchecked; });
        updateSelectionState();
      };
    }

    if (selectLastYearBtn) {
      selectLastYearBtn.onclick = () => {
        const currentYear = new Date().getFullYear();
        const lastYear = currentYear - 1;
        itemCheckboxes.forEach(chk => {
          const y = parseInt(chk.dataset.year, 10);
          chk.checked = (y === lastYear);
        });
        updateSelectionState();
      };
    }

    if (selectOlderYearsBtn) {
      selectOlderYearsBtn.onclick = () => {
        const currentYear = new Date().getFullYear();
        const twoYearsAgo = currentYear - 2;
        itemCheckboxes.forEach(chk => {
          const y = parseInt(chk.dataset.year, 10);
          chk.checked = (y <= twoYearsAgo);
        });
        updateSelectionState();
      };
    }

    if (deleteSelectedBtn) {
      deleteSelectedBtn.onclick = async () => {
        const checkedItems = Array.from(itemCheckboxes).filter(chk => chk.checked);
        if (checkedItems.length === 0) return;

        const selectedList = checkedItems.map(chk => ({
          id: chk.dataset.id,
          title: chk.dataset.title,
          info: chk.dataset.info
        }));

        // プロジェクト名一覧の確認モーダル
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1100';
        modal.innerHTML = `
          <div class="modal-content" style="max-width: 600px; width: 95%;">
            <div class="modal-header">
              <h3 style="margin: 0; color: var(--danger-solid); font-size: 1.15rem;">
                ⚠️ 共有フォルダからの完全削除の確認
              </h3>
              <button class="modal-close" id="btn-close-delete-confirm-modal">✕</button>
            </div>
            <div class="modal-body" style="padding: 16px 20px;">
              <div style="background: #ffebee; border-left: 4px solid var(--danger-solid); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 14px; color: #b71c1c; font-size: 0.88rem; font-weight: 600;">
                以下の <strong>${selectedList.length} 件</strong> のプロジェクトを共有フォルダ（<code>archive/</code>）から完全に消去します。<br>
                この操作を実行するとデータは二度と復元できません。
              </div>

              <div class="font-bold" style="font-size: 0.86rem; margin-bottom: 6px; color: var(--gray-700);">
                削除対象のプロジェクト一覧:
              </div>
              <div style="max-height: 220px; overflow-y: auto; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); background: var(--gray-50); padding: 8px 12px; margin-bottom: 14px;">
                <ul style="margin: 0; padding-left: 18px; font-size: 0.84rem; color: var(--gray-800); line-height: 1.7;">
                  ${selectedList.map(item => `
                    <li>
                      <span class="font-bold">${item.title}</span>
                      <span style="color: var(--gray-500); font-size: 0.78rem; margin-left: 6px;">(${item.info})</span>
                    </li>
                  `).join('')}
                </ul>
              </div>

              <p style="font-size: 0.85rem; color: var(--gray-600); margin: 0;">
                本当にこれらのプロジェクトを共有フォルダから完全削除してもよろしいですか？
              </p>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 10px;">
              <button class="btn btn-secondary" id="btn-cancel-delete-confirm">キャンセル</button>
              <button class="btn btn-danger" id="btn-execute-delete-confirm">
                🗑️ 完全削除を実行する（元に戻せません）
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(modal);

        const closeConfirm = () => {
          if (document.body.contains(modal)) {
            document.body.removeChild(modal);
          }
        };

        modal.querySelector('#btn-close-delete-confirm-modal').onclick = closeConfirm;
        modal.querySelector('#btn-cancel-delete-confirm').onclick = closeConfirm;

        modal.querySelector('#btn-execute-delete-confirm').onclick = async () => {
          closeConfirm();
          UI.showLoading({
            title: 'プロジェクトを完全削除中...',
            message: '共有フォルダ（archive/）から選択されたプロジェクトを消去しています。',
            icon: '🗑️'
          });

          try {
            const projectIds = selectedList.map(item => item.id);
            const res = await DB.deleteArchivedProjects(projectIds);
            if (res.failedCount > 0) {
              UI.showToast(`${res.successCount} 件を削除しました（${res.failedCount} 件失敗）`, 'warning', 6000);
            } else {
              UI.showToast(`${res.successCount} 件のプロジェクトを共有フォルダから完全削除しました`, 'success', 5000);
            }
            await this.render(this.container);
          } catch (delErr) {
            console.error('一括削除例外:', delErr);
            UI.showToast(`削除エラー: ${delErr.message}`, 'error', 6000);
          } finally {
            UI.hideLoading();
          }
        };
      };
    }

    // JSONバックアップ出力
    this.container.querySelector('#btn-export-backup').onclick = async () => {
      try {
        const backup = await DB.exportFullBackup();
        const jsonStr = JSON.stringify(backup, null, 2);
        const fileName = `受講確認票_バックアップ_${new Date().toISOString().slice(0, 10)}.json`;
        CsvUtil.downloadFile(jsonStr, fileName, 'application/json;charset=utf-8;');
        UI.showToast('バックアップファイルをダウンロードしました', 'success');
      } catch (err) {
        UI.showToast(`バックアップ出力エラー: ${err.message}`, 'error');
      }
    };

    // JSONバックアップ復元
    const triggerImportBtn = this.container.querySelector('#btn-trigger-import');
    const importFileInput = this.container.querySelector('#inp-import-file');

    triggerImportBtn.onclick = () => importFileInput.click();

    importFileInput.onchange = async () => {
      if (importFileInput.files.length === 0) return;
      const file = importFileInput.files[0];

      const ok = await UI.confirm(
        'バックアップからの復元',
        'バックアップファイルを読み込むと、現在の全データが上書きされます。続行しますか？',
        '復元を実行する',
        'danger'
      );
      if (!ok) {
        importFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const json = JSON.parse(e.target.result);
          await DB.importFullBackup(json);
          UI.showToast('バックアップから正常に復元しました', 'success');
          this.render(this.container);
        } catch (err) {
          UI.showToast(`復元エラー: ${err.message}`, 'error');
        }
      };
      reader.readAsText(file, 'UTF-8');
    };

    // --- 志望校別対策講座・追加チェックボックス管理のイベント ---
    const addCourseBtn = this.container.querySelector('#btn-add-course-checkbox');
    const selCourse = this.container.querySelector('#sel-course-preset');
    const selMethod = this.container.querySelector('#sel-method-preset');

    const handleAddPreset = () => {
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
      this.addNewCustomBox(label);
      selCourse.value = '';
      selMethod.value = '';
    };

    if (addCourseBtn) {
      addCourseBtn.onclick = handleAddPreset;
    }

    // 自由記述追加
    const addFreeBtn = this.container.querySelector('#btn-add-custom-free-checkbox');
    const freeInput = this.container.querySelector('#inp-custom-box-name');

    const handleAddFree = () => {
      const label = (freeInput?.value || '').trim();
      if (!label) {
        UI.showToast('チェックボックスの項目名を入力してください', 'warning');
        return;
      }
      this.addNewCustomBox(label);
      freeInput.value = '';
    };

    if (addFreeBtn) {
      addFreeBtn.onclick = handleAddFree;
    }
    if (freeInput) {
      freeInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleAddFree();
      };
    }
  },

  /**
   * 新しいカスタムチェックボックスをテンプレートに追加
   */
  addNewCustomBox(label) {
    const cur = this.calibrator ? this.calibrator.getTemplate() : this.currentDefaultTemplate;
    if (!cur.customBoxes) cur.customBoxes = [];

    if (cur.customBoxes.some(b => b.label === label)) {
      UI.showToast(`「${label}」は既に追加されています`, 'warning');
      return;
    }

    const id = 'cbox_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const count = cur.customBoxes.length;
    const newBox = {
      id,
      label,
      dx: -0.058,
      dy: Math.round((0.360 + count * 0.050) * 1000) / 1000,
      size: 0.032
    };

    cur.customBoxes.push(newBox);
    this.currentDefaultTemplate = cur;

    if (this.calibrator) {
      this.calibrator.activeTab = id;
      this.calibrator.setTemplate(cur);
      this.calibrator.updateTabsUI();
      this.calibrator.syncSlidersFromTemplate();
      this.calibrator.drawOverlay();
      this.calibrator.focusTargetArea();
    }

    this.renderCustomBoxesList();
    UI.showToast(`「${label}」を追加しました。プレビューで枠線の位置を合わせて「共通既定書式を保存」を押してください。`, 'success', 4500);
  },

  /**
   * 登録中カスタムチェックボックスの一覧を描画
   */
  settingsSearchFilter: '',
  renderCustomBoxesList() {
    const listContainer = this.container.querySelector('#custom-boxes-list-container');
    if (!listContainer) return;

    const currentTemplate = this.calibrator ? this.calibrator.getTemplate() : this.currentDefaultTemplate;
    const allCustomBoxes = currentTemplate.customBoxes || [];
    const customBoxes = this.settingsSearchFilter
      ? allCustomBoxes.filter(b => (b.label || '').toLowerCase().includes(this.settingsSearchFilter.toLowerCase()))
      : allCustomBoxes;
    const hasNoChange = !!currentTemplate.noChangeBox;
    const hasHasChange = !!currentTemplate.hasChangeBox;
    const totalBoxes = (hasNoChange ? 1 : 0) + (hasHasChange ? 1 : 0) + allCustomBoxes.length;

    let standardBoxesHtml = '';
    if (hasNoChange) {
      standardBoxesHtml += `
        <div style="background: #fff; border: 1px solid #86efac; border-radius: var(--radius-md); padding: 5px 10px; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
          <span style="font-weight: 700; font-size: 0.85rem; color: #15803d;">🟩 変更なし</span>
          <button type="button" class="btn btn-secondary btn-sm btn-focus-box" data-id="noChange" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
            🎯 調整
          </button>
        </div>
      `;
    }
    if (hasHasChange) {
      standardBoxesHtml += `
        <div style="background: #fff; border: 1px solid #fdba74; border-radius: var(--radius-md); padding: 5px 10px; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
          <span style="font-weight: 700; font-size: 0.85rem; color: #c2410c;">🟧 変更あり</span>
          <button type="button" class="btn btn-secondary btn-sm btn-focus-box" data-id="hasChange" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
            🎯 調整
          </button>
        </div>
      `;
    }

    const customBoxesHtml = customBoxes.map(box => {
      const originalIndex = allCustomBoxes.findIndex(b => b.id === box.id);
      const isFirst = originalIndex <= 0;
      const isLast = originalIndex >= allCustomBoxes.length - 1;
      return `
        <div class="custom-box-item-card ${this.calibrator && this.calibrator.activeTab === box.id ? 'is-active' : ''}">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-weight: 700; font-size: 0.84rem; color: #6d28d9;">🟪 ${box.label}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 3px;">
            <button type="button" class="custom-box-order-btn btn-settings-move-box" data-id="${box.id}" data-dir="-1" ${isFirst ? 'disabled' : ''} title="上へ移動">▲</button>
            <button type="button" class="custom-box-order-btn btn-settings-move-box" data-id="${box.id}" data-dir="1" ${isLast ? 'disabled' : ''} title="下へ移動">▼</button>
            <button type="button" class="btn btn-secondary btn-sm btn-focus-box" data-id="${box.id}" style="padding: 1px 6px; font-size: 0.72rem;" title="このチェックボックスの位置調整に切り替える">
              🎯 調整
            </button>
            <button type="button" class="btn-ghost btn-del-box" data-id="${box.id}" style="padding: 0 2px; color: var(--danger-solid); font-size: 14px; line-height: 1; cursor: pointer;" title="削除">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');

    let restoreButtonsHtml = '';
    if (!hasNoChange) {
      restoreButtonsHtml += `
        <button type="button" class="btn btn-secondary btn-sm btn-restore-box" data-type="noChange" style="padding: 3px 8px; font-size: 0.75rem; color: #15803d; border-color: #86efac;" title="「変更なし」読取枠を標準位置で再追加">
          ➕ 「変更なし」枠を追加
        </button>
      `;
    }
    if (!hasHasChange) {
      restoreButtonsHtml += `
        <button type="button" class="btn btn-secondary btn-sm btn-restore-box" data-type="hasChange" style="padding: 3px 8px; font-size: 0.75rem; color: #c2410c; border-color: #fdba74;" title="「変更あり」読取枠を標準位置で再追加">
          ➕ 「変更あり」枠を追加
        </button>
      `;
    }

    if (totalBoxes === 0) {
      listContainer.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--gray-500); padding: 8px 12px; background: #fff; border-radius: var(--radius-sm); border: 1px dashed var(--gray-300); text-align: center; margin-bottom: 8px;">
          現在、読取チェックボックスはありません
        </div>
        ${restoreButtonsHtml ? `<div style="display: flex; gap: 8px; align-items: center;">${restoreButtonsHtml}</div>` : ''}
      `;
    } else {
      listContainer.innerHTML = `
        <div class="custom-box-manager-toolbar">
          <div style="font-size: 0.82rem; font-weight: bold; color: var(--gray-700); display: flex; align-items: center; gap: 8px;">
            <span>登録中の読取チェックボックス (全 ${totalBoxes} 個):</span>
            ${allCustomBoxes.length > 1 ? `
              <button type="button" id="btn-settings-sort-custom" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 2px 8px;" title="講座名を名前順（昇順）に一括並び替え">
                🔤 名前順に並び替え
              </button>
            ` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            ${allCustomBoxes.length > 5 ? `
              <input type="text" id="inp-settings-custom-filter" class="custom-box-search-input form-control" placeholder="🔍 講座名で絞り込み..." value="${this.settingsSearchFilter}">
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
    const filterInput = listContainer.querySelector('#inp-settings-custom-filter');
    if (filterInput) {
      filterInput.oninput = (e) => {
        this.settingsSearchFilter = e.target.value.trim();
        this.renderCustomBoxesList();
        const newInp = listContainer.querySelector('#inp-settings-custom-filter');
        if (newInp) {
          newInp.focus();
          newInp.selectionStart = newInp.selectionEnd = newInp.value.length;
        }
      };
    }

    // 名前順ソートボタン
    const sortBtn = listContainer.querySelector('#btn-settings-sort-custom');
    if (sortBtn) {
      sortBtn.onclick = () => {
        const cur = this.calibrator ? this.calibrator.getTemplate() : this.currentDefaultTemplate;
        if (!cur.customBoxes || cur.customBoxes.length <= 1) return;
        cur.customBoxes.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja'));
        this.currentDefaultTemplate = cur;
        if (this.calibrator) {
          this.calibrator.setTemplate(cur);
          this.calibrator.updateTabsUI();
          this.calibrator.drawOverlay();
        }
        this.renderCustomBoxesList();
        UI.showToast('講座を名前順に並び替えました', 'success');
      };
    }

    // 並び替えボタン（▲ / ▼）
    listContainer.querySelectorAll('.btn-settings-move-box').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const dir = parseInt(btn.dataset.dir, 10);
        const cur = this.calibrator ? this.calibrator.getTemplate() : this.currentDefaultTemplate;
        if (!cur.customBoxes || cur.customBoxes.length <= 1) return;
        const idx = cur.customBoxes.findIndex(b => b.id === id);
        if (idx < 0) return;
        const targetIdx = idx + dir;
        if (targetIdx < 0 || targetIdx >= cur.customBoxes.length) return;

        const [item] = cur.customBoxes.splice(idx, 1);
        cur.customBoxes.splice(targetIdx, 0, item);
        this.currentDefaultTemplate = cur;
        if (this.calibrator) {
          this.calibrator.setTemplate(cur);
          this.calibrator.activeTab = item.id;
          this.calibrator.updateTabsUI();
          this.calibrator.drawOverlay();
        }
        this.renderCustomBoxesList();
      };
    });

    // 削除ボタン
    listContainer.querySelectorAll('.btn-del-box').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (id === 'noChange' || id === 'hasChange') {
          return;
        }
        if (this.calibrator) {
          this.calibrator.deleteBox(id);
          this.currentDefaultTemplate = this.calibrator.getTemplate();
        } else {
          const cur = this.currentDefaultTemplate;
          if (id === 'noChange') delete cur.noChangeBox;
          else if (id === 'hasChange') delete cur.hasChangeBox;
          else cur.customBoxes = (cur.customBoxes || []).filter(b => b.id !== id);
          this.renderCustomBoxesList();
        }
      };
    });

    // 調整フォーカスボタン
    listContainer.querySelectorAll('.btn-focus-box').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (this.calibrator) {
          this.calibrator.activeTab = id;
          this.calibrator.updateTabsUI();
          this.calibrator.syncSlidersFromTemplate();
          this.calibrator.drawOverlay();
          this.calibrator.focusTargetArea();
        }
      };
    });

    // 復元・再追加ボタン
    listContainer.querySelectorAll('.btn-restore-box').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.type;
        if (this.calibrator) {
          this.calibrator.addStandardBox(type);
          this.currentDefaultTemplate = this.calibrator.getTemplate();
        } else {
          const def = CheckboxEngine.getDefaultTemplate();
          if (type === 'noChange') this.currentDefaultTemplate.noChangeBox = JSON.parse(JSON.stringify(def.noChangeBox));
          else if (type === 'hasChange') this.currentDefaultTemplate.hasChangeBox = JSON.parse(JSON.stringify(def.hasChangeBox));
          this.renderCustomBoxesList();
        }
      };
    });
  }
};
