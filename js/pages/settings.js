/**
 * 設定画面コントローラー（職員マスタ・共通既定書式設定・JSONバックアップ・3年アーカイブ管理）
 */

import { DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { CsvUtil } from '../utils/csv.js';
import { CheckboxEngine } from '../checkbox.js';
import { TemplateCalibrator } from '../components/calibrator.js';

export const SettingsPage = {
  container: null,
  calibrator: null,
  currentDefaultTemplate: null,

  async render(container) {
    this.container = container;
    const settings = await DB.getSettings();
    const expiredProjects = await DB.getExpiredProjects(3);

    const staffList = settings.staffNames || [];
    const systemDefaultTemplate = CheckboxEngine.getDefaultTemplate();
    this.currentDefaultTemplate = settings.defaultScanTemplate
      ? JSON.parse(JSON.stringify(settings.defaultScanTemplate))
      : JSON.parse(JSON.stringify(systemDefaultTemplate));

    this.container.innerHTML = `
      <div class="view-container" style="max-width: 980px; margin: 0 auto;">
        <div style="margin-bottom: var(--spacing-xl);">
          <h1 style="font-size: 1.85rem; font-weight: 800; color: var(--gray-900);">⚙️ システム設定</h1>
          <p style="color: var(--gray-500); margin-top: 4px;">職員マスタ、交換票（受講確認票）の共通既定書式、バックアップおよびデータ整理を行います</p>
        </div>

        <!-- 1. 職員マスタ管理 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <h2 class="card-title">👥 職員マスタ設定</h2>
            <span class="badge badge-gray">${staffList.length} 名登録</span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            確認票の承認作業者・手動受付者としてプルダウンに表示される職員名を設定します。
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

        <!-- 2. 交換票（受講確認票）の共通既定書式設定 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h2 class="card-title">📐 交換票（受講確認票）の共通既定書式設定</h2>
            </div>
            <span class="badge badge-info">新規プロジェクト適用</span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            新しく作成するプロジェクトの初期書式として適用される、受講確認票（交換票）の共通既定書式（バーコードからのチェックボックス相対位置・サイズ・判定閾値）を設定します。<br>
            ※ サンプル帳票やお手元のPDF/画像を読み込んで位置を合わせ、右下の「<strong>💾 共通既定書式を保存</strong>」を押してください。
          </p>

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

        <!-- 3. 3年超過プロジェクトの管理 -->
        <div class="card" style="margin-bottom: var(--spacing-lg);">
          <div class="card-header">
            <h2 class="card-title">🗄️ データ保持管理（3年超過アーカイブ）</h2>
            <span class="badge ${expiredProjects.length > 0 ? 'badge-warning' : 'badge-success'}">
              ${expiredProjects.length} 件
            </span>
          </div>
          <p style="color: var(--gray-600); font-size: 0.88rem; margin-bottom: var(--spacing-md);">
            作成から3年以上経過したプロジェクトを検出し、整理・削除できます。
          </p>

          ${expiredProjects.length === 0 ? `
            <div style="font-size: 0.88rem; color: var(--gray-500); padding: 8px 0;">
              現在、3年以上経過したプロジェクトはありません。
            </div>
          ` : `
            <div class="table-container" style="margin-bottom: var(--spacing-md);">
              <table class="table" style="font-size: 0.85rem;">
                <thead>
                  <tr>
                    <th>プロジェクト名</th>
                    <th>作成日時</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${expiredProjects.map(p => `
                    <tr>
                      <td class="font-bold">${p.title}</td>
                      <td class="text-mono">${UI.formatDate(p.createdAt)}</td>
                      <td>
                        <button class="btn btn-danger btn-sm btn-delete-expired" data-id="${p.id}" data-title="${p.title}">
                          🗑️ 削除
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- 4. バックアップ & 復元 -->
        <div class="card">
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
        },
        {
          defaultResetTemplate: systemDefaultTemplate,
          resetLabel: '🔄 システム標準初期値に戻す',
          resetToastMsg: 'システム標準初期値に復元しました（「共通既定書式を保存」で確定してください）'
        }
      );
    }

    this.bindEvents(settings, staffList, systemDefaultTemplate);
  },

  bindEvents(settings, staffList, systemDefaultTemplate) {
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
      UI.showToast(`「${name}」を追加しました`, 'success');
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
        await DB.saveSettings({ ...settings, staffNames: staffList });
        UI.showToast(`「${delName}」を削除しました`, 'info');
        this.render(this.container);
      };
    });

    // 共通既定書式の保存
    const saveDefaultTemplateBtn = this.container.querySelector('#btn-save-default-template');
    if (saveDefaultTemplateBtn) {
      saveDefaultTemplateBtn.onclick = async () => {
        try {
          const templateToSave = this.calibrator ? this.calibrator.getTemplate() : this.currentDefaultTemplate;
          const updatedSettings = {
            ...settings,
            staffNames: staffList,
            defaultScanTemplate: templateToSave,
            checkThreshold: templateToSave.threshold !== undefined ? templateToSave.threshold : 0.25
          };
          await DB.saveSettings(updatedSettings);
          UI.showToast('交換票（受講確認票）の共通既定書式を保存しました', 'success');
        } catch (err) {
          UI.showToast(`保存エラー: ${err.message}`, 'error');
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
          UI.showToast('システム標準（初期値）に復元しました。「共通既定書式を保存」で確定してください。', 'info');
        }
      };
    }

    // 3年超過プロジェクト削除
    this.container.querySelectorAll('.btn-delete-expired').forEach(btn => {
      btn.onclick = async () => {
        const pid = btn.dataset.id;
        const ptitle = btn.dataset.title;
        const ok = await UI.confirm(
          '古いプロジェクトの削除',
          `「${ptitle}」を完全に削除しますか？`,
          '削除する',
          'danger'
        );
        if (ok) {
          await DB.deleteProject(pid);
          UI.showToast('プロジェクトを削除しました', 'info');
          this.render(this.container);
        }
      };
    });

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
  }
};
