/**
 * 共有フォルダ同期マネージャー
 * イベントソーシング（差分ログ追記方式）による複数PC間のデータ共有とローカルIndexedDB同期を一元管理
 */

import { db, DB } from '../db.js';
import { UI } from '../utils/ui.js';
import { FolderConnector } from './folder-connector.js';
import { PendingQueue } from './pending-queue.js';

export const SyncManager = {
  lastSyncTimes: new Map(), // projectId -> Date
  _activeSyncPromises: new Map(), // projectId -> Promise
  _lockMap: new Map(), // key -> Promise

  /**
   * 現在同期処理が実行中かどうか
   * @param {string} [projectId]
   * @returns {boolean}
   */
  isSyncing(projectId = null) {
    if (projectId) {
      return this._activeSyncPromises.has(projectId);
    }
    return this._activeSyncPromises.size > 0;
  },

  /**
   * 汎用非同期排他実行ヘルパー (Mutex)
   * 同一キーの非同期処理が走っている場合、直列化して順次実行
   */
  async withLock(key, asyncFn) {
    while (this._lockMap.has(key)) {
      try {
        await this._lockMap.get(key);
      } catch (e) {
        // 先行処理のエラーは無視して自処理へ進む
      }
    }
    const promise = (async () => {
      try {
        return await asyncFn();
      } finally {
        this._lockMap.delete(key);
      }
    })();
    this._lockMap.set(key, promise);
    return await promise;
  },

  /**
   * クライアント識別子（PC端末名・ID）の取得（なければ自動生成して保存）
   */
  async getClientId() {
    try {
      const stored = await db.appState.get('clientId');
      if (stored && stored.value) {
        return stored.value;
      }

      // 未設定時は端末IDを自動生成
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      const timePart = Date.now().toString(36).slice(-4).toUpperCase();
      const newClientId = `PC-${timePart}-${randomPart}`;

      await db.appState.put({
        key: 'clientId',
        value: newClientId,
        createdAt: new Date().toISOString()
      });

      return newClientId;
    } catch (err) {
      console.warn('端末ID取得エラー（フォールバック）:', err);
      return 'PC-LOCAL';
    }
  },

  /**
   * クライアント識別子を変更・保存
   */
  async setClientId(newId) {
    const trimmed = (newId || '').trim();
    if (!trimmed) throw new Error('端末識別子を入力してください');
    await db.appState.put({
      key: 'clientId',
      value: trimmed,
      updatedAt: new Date().toISOString()
    });
    return trimmed;
  },

  /* ================= ファイルシステム 低レベルヘルパー ================= */

  /**
   * サブディレクトリを取得（なければ作成）
   */
  async getOrCreateSubdir(parentHandle, dirName) {
    return await parentHandle.getDirectoryHandle(dirName, { create: true });
  },

  /**
   * サブディレクトリを取得（存在しない場合は null）
   */
  async getSubdir(parentHandle, dirName) {
    try {
      return await parentHandle.getDirectoryHandle(dirName, { create: false });
    } catch (err) {
      return null;
    }
  },

  /**
   * ファイル内容を JSON として読み込み
   */
  async readJsonFile(dirHandle, fileName) {
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  },

  /**
   * 文字列・JSONをファイルにアトミック書き出し（一時ファイル経由＋検証）
   * 途中で通信が切断されても正規ファイルが0バイトになる事故を防ぎます
   */
  async writeJsonFile(dirHandle, fileName, data) {
    if (!dirHandle) {
      throw new Error(`ディレクトリハンドルが無効です: ${fileName}`);
    }

    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    if (!jsonStr || jsonStr.trim().length === 0) {
      throw new Error(`書き込みデータが空です: ${fileName}`);
    }

    // Step 1: 一時ファイル（_tmp_${fileName}）に書き込み
    const tmpName = `_tmp_${fileName}`;
    const tmpHandle = await dirHandle.getFileHandle(tmpName, { create: true });
    const tmpWritable = await tmpHandle.createWritable({ keepExistingData: false });
    try {
      await tmpWritable.write(jsonStr);
    } finally {
      await tmpWritable.close();
    }

    // Step 2: 一時ファイルの内容検証（空でないこと＋JSONパース可能であること）
    const tmpFile = await tmpHandle.getFile();
    const tmpText = await tmpFile.text();
    if (!tmpText || tmpText.trim().length === 0) {
      throw new Error(`一時ファイル書き込み検証失敗: ${tmpName} が空（0バイト）です`);
    }
    try {
      JSON.parse(tmpText);
    } catch (parseErr) {
      throw new Error(`一時ファイルのJSON検証に失敗しました: ${tmpName} (${parseErr.message})`);
    }

    // Step 3: 正規ファイルへ書き込み（keepExistingData: false で確実に上書き）
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    try {
      await writable.write(tmpText);
    } finally {
      await writable.close();
    }

    // Step 4: 正規ファイルの読み戻し検証（空でないこと＋JSON検証）
    const finalFile = await fileHandle.getFile();
    const finalText = await finalFile.text();
    if (!finalText || finalText.trim().length === 0) {
      throw new Error(`正規ファイル書き込み検証失敗: ${fileName} が空（0バイト）です`);
    }
    try {
      JSON.parse(finalText);
    } catch (parseErr) {
      throw new Error(`正規ファイルのJSON検証に失敗しました: ${fileName} (${parseErr.message})`);
    }

    // Step 5: 一時ファイルのクリーンアップ（失敗しても本処理には影響させない）
    try {
      await dirHandle.removeEntry(tmpName);
    } catch (removeErr) {
      // ネットワークドライブ等の遅延ロックで削除失敗しても無視
    }
  },

  /**
   * リトライ付き JSON 書き込み（ネットワーク遅延・一時的IOロック対策）
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} fileName
   * @param {any} data
   * @param {number} maxRetries 最大試行回数 (デフォルト: 3)
   * @param {number} baseDelayMs 基本待機ミリ秒 (デフォルト: 500ms)
   */
  async writeJsonFileWithRetry(dirHandle, fileName, data, maxRetries = 3, baseDelayMs = 500) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.writeJsonFile(dirHandle, fileName, data);
        return true;
      } catch (err) {
        lastError = err;
        console.warn(`[writeJsonFileWithRetry] ${fileName} の書き込み失敗 (試行 ${attempt}/${maxRetries}):`, err);
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1); // 500ms -> 1000ms -> 2000ms
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error(`${fileName} の書き込みが ${maxRetries} 回試行後も失敗しました: ${lastError?.message || lastError}`);
  },

  /* ================= 共有設定 (settings.json) ================= */

  /**
   * 共有設定 (settings.json) を共有フォルダ直下に書き出し
   */
  async writeSharedSettings(settings) {
    if (!FolderConnector.isConnected()) return false;
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return false;

    try {
      const clientId = await this.getClientId();
      const sharedData = {
        staffNames: settings.staffNames || [],
        defaultScanTemplate: settings.defaultScanTemplate || null,
        updatedAt: new Date().toISOString(),
        updatedBy: clientId
      };

      await this.writeJsonFileWithRetry(rootHandle, 'settings.json', sharedData);
      return true;
    } catch (err) {
      console.error('settings.json 書き込みエラー:', err);
      throw err;
    }
  },

  /**
   * 共有フォルダから settings.json を読み込み、ローカルDBにマージ
   * （職員名と共通書式を全PCで同期）
   */
  async readSharedSettings() {
    if (!FolderConnector.isConnected()) return null;
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return null;

    try {
      const sharedSettings = await this.readJsonFile(rootHandle, 'settings.json');
      if (!sharedSettings) return null;

      const localSettings = await DB.getSettings();
      let hasChanges = false;

      // 職員マスタのマージ（共有設定にあるものを尊重）
      if (Array.isArray(sharedSettings.staffNames) && sharedSettings.staffNames.length > 0) {
        // 重複を除去して合体、または共有設定を最新版として採用
        const mergedStaff = Array.from(new Set([...sharedSettings.staffNames]));
        if (JSON.stringify(mergedStaff) !== JSON.stringify(localSettings.staffNames)) {
          localSettings.staffNames = mergedStaff;
          hasChanges = true;
        }
      }

      // 共通既定書式のマージ
      if (sharedSettings.defaultScanTemplate) {
        if (JSON.stringify(sharedSettings.defaultScanTemplate) !== JSON.stringify(localSettings.defaultScanTemplate)) {
          localSettings.defaultScanTemplate = sharedSettings.defaultScanTemplate;
          if (sharedSettings.defaultScanTemplate.checkThreshold !== undefined) {
            localSettings.checkThreshold = sharedSettings.defaultScanTemplate.checkThreshold;
          }
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await DB.saveSettings(localSettings);
      }

      return sharedSettings;
    } catch (err) {
      console.warn('settings.json 読み込み・マージ失敗:', err);
      return null;
    }
  },

  /* ================= プロジェクト管理 (meta.json, students.json) ================= */

  /**
   * プロジェクト基本情報を共有フォルダに書き出し（メインPC新規作成時またはステータス更新時）
   */
  async writeProjectMeta(project) {
    if (!FolderConnector.isConnected()) return false;
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return false;

    try {
      const projDir = await this.getOrCreateSubdir(rootHandle, project.id);
      const meta = {
        id: project.id,
        year: project.year,
        grade: project.grade,
        sessionName: UI.formatSession(project.sessionName),
        title: UI.formatProjectTitle(project.title),
        status: project.status || '進行中',
        scanTemplate: project.scanTemplate || null,
        createdAt: project.createdAt,
        completedAt: project.completedAt || null,
        updatedAt: new Date().toISOString()
      };
      await this.writeJsonFileWithRetry(projDir, 'meta.json', meta);

      // 書き込み後のベリファイ確認
      const verify = await this.readJsonFile(projDir, 'meta.json');
      if (!verify || verify.id !== project.id) {
        throw new Error('meta.json の書き込み検証に失敗しました（データ不一致または読み取り不可）');
      }
      return true;
    } catch (err) {
      console.error(`meta.json 書き込みエラー (${project.id}):`, err);
      throw err;
    }
  },

  /**
   * 生徒マスタリストを共有フォルダに書き出し（メインPC新規作成時または生徒追加・更新時）
   */
  async writeStudentList(projectId, students) {
    if (!FolderConnector.isConnected()) return false;
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return false;

    try {
      const projDir = await this.getOrCreateSubdir(rootHandle, projectId);
      const stuList = (students || []).map(s => ({
        id: s.id,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana || '',
        className: s.className,
        course: s.course || '4科'
      }));
      await this.writeJsonFileWithRetry(projDir, 'students.json', stuList);

      // 書き込み後のベリファイ確認
      const verify = await this.readJsonFile(projDir, 'students.json');
      if (!verify || !Array.isArray(verify)) {
        throw new Error('students.json の書き込み検証に失敗しました（データ破損または読み取り不能）');
      }
      if (stuList.length > 0 && verify.length === 0) {
        throw new Error('students.json の書き込み検証に失敗しました（生徒データが空）');
      }
      return true;
    } catch (err) {
      console.error(`students.json 書き込みエラー (${projectId}):`, err);
      throw err;
    }
  },

  /* ================= イベントログ書き出し (events/evt_*.json) ================= */

  /**
   * イベントログを共有フォルダへ直接書き出し（成功時 true）
   */
  async writeEventDirectly(projectId, event) {
    if (!FolderConnector.isConnected()) return false;
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return false;

    try {
      const projDir = await this.getOrCreateSubdir(rootHandle, projectId);
      const eventsDir = await this.getOrCreateSubdir(projDir, 'events');

      const clientId = event.clientInfo?.clientId || (await this.getClientId());
      const ts = event.timestamp || Date.now();
      const safeEventId = (event.eventId || `evt_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `evt_${ts}_${clientId}_${safeEventId}.json`;

      await this.writeJsonFile(eventsDir, fileName, event);
      return true;
    } catch (err) {
      console.error('イベント直接書き込み失敗:', err);
      return false;
    }
  },

  /**
   * イベントオブジェクトを生成・記録し、共有フォルダまたは未送信キューへ保存
   * @param {string} projectId
   * @param {Object} eventOptions { action, studentId, nichinokenId, data, recordedBy }
   */
  async recordEvent(projectId, { action, studentId, nichinokenId, data, recordedBy }) {
    const clientId = await this.getClientId();
    const timestamp = Date.now();
    const uuid = Math.random().toString(36).substring(2, 9);
    const eventId = `evt_${timestamp}_${clientId}_${uuid}`;

    const event = {
      eventId,
      action, // 'APPROVE' | 'UPDATE' | 'STATUS_CHANGE'
      studentId: studentId || '',
      nichinokenId: nichinokenId || '',
      timestamp,
      data: data || {},
      clientInfo: {
        clientId,
        recordedBy: recordedBy || data?.approvedBy || ''
      }
    };

    // ローカル IndexedDB の syncEvents にもキャッシュとして記録
    try {
      await db.syncEvents.put({
        eventId,
        projectId,
        studentId: event.studentId,
        timestamp,
        event
      });
    } catch (err) {
      console.warn('syncEvents キャッシュ書き込み失敗:', err);
    }

    // 共有フォルダへ書き出し試行
    if (FolderConnector.isConnected()) {
      const ok = await this.writeEventDirectly(projectId, event);
      if (ok) {
        // ついでに未送信キューがあればバックグラウンドでフラッシュ
        this.flushPendingQueueInBackground();
        return { success: true, eventId, queued: false };
      }
    }

    // 未接続または書き込み失敗時は未送信キューに追加
    await PendingQueue.enqueue(projectId, event);
    return { success: false, eventId, queued: true };
  },

  /**
   * 未送信キューのバックグラウンド送信
   */
  async flushPendingQueueInBackground() {
    try {
      await PendingQueue.flush(async (pId, ev) => {
        return await this.writeEventDirectly(pId, ev);
      });
    } catch (e) {
      console.warn('バックグラウンドフラッシュ失敗:', e);
    }
  },

  /* ================= 共有フォルダからのデータ同期 (Sync from Shared Folder) ================= */

  /**
   * 指定プロジェクトの共有フォルダ内イベントを全走査し、ローカル IndexedDB に反映
   * （排他制御により、同一プロジェクトの同時実行や連打時は先行処理の完了を待機して重複を防ぐ）
   * @param {string} projectId
   * @returns {Promise<{ newEventsCount: number, totalEvents: number }>}
   */
  async syncFromSharedFolder(projectId) {
    if (!projectId) {
      return { newEventsCount: 0, totalEvents: 0, connected: false };
    }

    // 既に同一プロジェクトの同期が実行中の場合は、既存のPromiseを共有（二重処理を完全防止）
    if (this._activeSyncPromises.has(projectId)) {
      return await this._activeSyncPromises.get(projectId);
    }

    const syncPromise = (async () => {
      if (!FolderConnector.isConnected()) {
        return { newEventsCount: 0, totalEvents: 0, connected: false };
      }

      const rootHandle = FolderConnector.getDirHandle();
      if (!rootHandle) {
        return { newEventsCount: 0, totalEvents: 0, connected: false };
      }

      try {
        const projDir = await this.getSubdir(rootHandle, projectId);
        if (!projDir) {
          return { newEventsCount: 0, totalEvents: 0, notFound: true };
        }

        // 1. meta.json の確認と更新（タイトル・受講期表記正規化およびステータス同期）
        const meta = await this.readJsonFile(projDir, 'meta.json');
        if (meta) {
          const localProj = await db.projects.get(projectId);
          if (localProj) {
            const cleanTitle = UI.formatProjectTitle(meta.title || localProj.title);
            const cleanSession = UI.formatSession(meta.sessionName || localProj.sessionName);
            const updates = {};
            if (localProj.title !== cleanTitle) updates.title = cleanTitle;
            if (localProj.sessionName !== cleanSession) updates.sessionName = cleanSession;
            if (localProj.status !== meta.status) updates.status = meta.status;
            if (localProj.completedAt !== (meta.completedAt || null)) updates.completedAt = meta.completedAt || null;
            if (Object.keys(updates).length > 0) {
              await db.projects.update(projectId, updates);
            }
          }
        }

        // 1.5 students.json の確認と同期（新規生徒の追加および情報修正を同期、削除は事故防止のため非実行）
        let studentsAdded = 0;
        let studentsUpdated = 0;
        const sharedStudents = await this.readJsonFile(projDir, 'students.json');
        if (Array.isArray(sharedStudents) && sharedStudents.length > 0) {
          const stuSyncRes = await this.syncStudentsFromShared(projectId, sharedStudents);
          studentsAdded = stuSyncRes.studentsAdded;
          studentsUpdated = stuSyncRes.studentsUpdated;
        }

        // 2. events/ ディレクトリの走査
        const eventsDir = await this.getSubdir(projDir, 'events');
        if (!eventsDir) {
          return { newEventsCount: 0, totalEvents: 0, studentsAdded, studentsUpdated, connected: true };
        }

        let newEventsCount = 0;
        const existingEvents = await db.syncEvents.where('projectId').equals(projectId).toArray();
        const existingEventIds = new Set(existingEvents.map(e => e.eventId));

        // events ディレクトリ内のすべての .json ファイルを探索
        for await (const [name, handle] of eventsDir.entries()) {
          if (handle.kind === 'file' && name.endsWith('.json')) {
            try {
              const file = await handle.getFile();
              const text = await file.text();
              const event = JSON.parse(text);

              if (event && event.eventId && !existingEventIds.has(event.eventId)) {
                await db.syncEvents.put({
                  eventId: event.eventId,
                  projectId,
                  studentId: event.studentId || '',
                  timestamp: event.timestamp || Date.now(),
                  event
                });
                existingEventIds.add(event.eventId);
                newEventsCount++;
              }
            } catch (fileErr) {
              console.warn(`イベントファイル読み込みスキップ: ${name}`, fileErr);
            }
          }
        }

        // 3. 新規イベントがあった場合、イベントを時系列にリプレイして submissions テーブルを更新
        if (newEventsCount > 0 || existingEvents.length > 0) {
          await this.replayEventsToSubmissions(projectId);
        }

        this.lastSyncTimes.set(projectId, new Date());
        return {
          newEventsCount,
          totalEvents: existingEventIds.size,
          studentsAdded,
          studentsUpdated,
          connected: true,
          lastSync: new Date()
        };
      } catch (err) {
        console.error(`同期エラー (${projectId}):`, err);
        throw err;
      } finally {
        this._activeSyncPromises.delete(projectId);
      }
    })();

    this._activeSyncPromises.set(projectId, syncPromise);
    return await syncPromise;
  },

  /**
   * 共有フォルダの students.json をローカルDBと照合し、新規生徒の追加および情報更新を反映
   * （※事故防止のため、生徒の削除は行わない）
   * @param {string} projectId
   * @param {Array} sharedStudents
   * @returns {Promise<{ studentsAdded: number, studentsUpdated: number }>}
   */
  async syncStudentsFromShared(projectId, sharedStudents) {
    let studentsAdded = 0;
    let studentsUpdated = 0;

    if (!Array.isArray(sharedStudents) || sharedStudents.length === 0) {
      return { studentsAdded, studentsUpdated };
    }

    const localStudents = await db.students.where('projectId').equals(projectId).toArray();
    const localMap = new Map(localStudents.map(s => [s.id, s]));
    const localNidMap = new Map(localStudents.map(s => [s.nichinokenId?.toUpperCase(), s]));

    const toAddStudents = [];
    const toAddSubmissions = [];
    const toUpdateStudents = [];

    for (const s of sharedStudents) {
      if (!s || !s.nichinokenId) continue;
      const cleanNid = s.nichinokenId.trim().toUpperCase();
      const local = localMap.get(s.id) || localNidMap.get(cleanNid);

      if (!local) {
        // 新規追加生徒
        const studentId = s.id || ('stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
        const cleanName = (s.name || '').trim();
        const cleanKana = (s.nameKana || '').trim();
        const cleanClass = (s.className || '').trim();
        const cleanCourse = (s.course || '4科').trim();

        toAddStudents.push({
          id: studentId,
          projectId,
          nichinokenId: cleanNid,
          name: cleanName,
          nameKana: cleanKana,
          className: cleanClass,
          course: cleanCourse
        });

        toAddSubmissions.push({
          id: 'sub_' + studentId,
          projectId,
          studentId,
          status: '未提出',
          hasChange: false,
          enrollmentClass: cleanClass,
          enrollmentCourse: cleanCourse,
          inputMethod: '',
          approvedBy: '',
          submittedAt: null,
          approvedAt: null,
          remarks: '',
          scanImageBlob: null,
          history: [],
          reviewStatus: 'unreviewed',
          reviewedAt: null,
          reviewedBy: '',
          reviewNote: ''
        });

        studentsAdded++;
      } else {
        // 既存生徒の情報更新チェック
        const cleanName = (s.name || '').trim();
        const cleanKana = (s.nameKana || '').trim();
        const cleanClass = (s.className || '').trim();
        const cleanCourse = (s.course || '4科').trim();

        const isChanged = (
          local.name !== cleanName ||
          (local.nameKana || '') !== cleanKana ||
          local.className !== cleanClass ||
          (local.course || '4科') !== cleanCourse
        );

        if (isChanged) {
          toUpdateStudents.push({
            id: local.id,
            updates: {
              name: cleanName,
              nameKana: cleanKana,
              className: cleanClass,
              course: cleanCourse
            }
          });
          studentsUpdated++;
        }
      }
    }

    if (toAddStudents.length > 0 || toUpdateStudents.length > 0) {
      await db.transaction('rw', db.students, db.submissions, async () => {
        if (toAddStudents.length > 0) {
          await db.students.bulkAdd(toAddStudents);
          await db.submissions.bulkAdd(toAddSubmissions);
        }
        for (const item of toUpdateStudents) {
          await db.students.update(item.id, item.updates);
        }
      });
    }

    return { studentsAdded, studentsUpdated };
  },

  /**
   * プロジェクト内の全イベントをタイムスタンプ順に適用して submissions を最新化
   */
  async replayEventsToSubmissions(projectId) {
    const allEventsRecords = await db.syncEvents
      .where('projectId')
      .equals(projectId)
      .sortBy('timestamp');

    if (allEventsRecords.length === 0) return;

    // studentId ごとに最新のイベントおよび履歴を集約
    const studentEventsMap = new Map(); // studentId -> [events]
    for (const record of allEventsRecords) {
      const ev = record.event;
      if (!ev || !ev.studentId) continue;
      if (!studentEventsMap.has(ev.studentId)) {
        studentEventsMap.set(ev.studentId, []);
      }
      studentEventsMap.get(ev.studentId).push(ev);
    }

    const submissions = await db.submissions.where('projectId').equals(projectId).toArray();
    const subMap = new Map(submissions.map(s => [s.studentId, s]));

    for (const [studentId, events] of studentEventsMap.entries()) {
      const sub = subMap.get(studentId);
      if (!sub) continue;

      // 最新のイベント
      const latestEv = events[events.length - 1];
      const data = latestEv.data || {};

      // 既存の履歴とマージ
      const history = Array.isArray(sub.history) ? [...sub.history] : [];
      for (const ev of events) {
        const histId = `hist_${ev.eventId}`;
        const alreadyInHistory = history.some(h => h.id === histId || h.eventId === ev.eventId);
        if (!alreadyInHistory) {
          history.push({
            id: histId,
            eventId: ev.eventId,
            timestamp: new Date(ev.timestamp).toISOString(),
            approvedAt: data.approvedAt || new Date(ev.timestamp).toISOString(),
            inputMethod: ev.data?.inputMethod || '手動',
            approvedBy: ev.data?.approvedBy || ev.clientInfo?.recordedBy || '',
            status: ev.data?.status || '承認済',
            hasChange: ev.data?.hasChange || false,
            enrollmentClass: ev.data?.enrollmentClass || '',
            enrollmentCourse: ev.data?.enrollmentCourse || '',
            remarks: ev.data?.remarks || '',
            scanImageBlob: null // 共有イベントからは画像は渡されない
          });
        }
      }

      // レビュー関連情報のマージ（ローカル情報優先、なければ最新イベントから）
      const reviewStatus = sub.reviewStatus || data.reviewStatus || 'unreviewed';
      const reviewedAt = sub.reviewedAt || data.reviewedAt || null;
      const reviewedBy = sub.reviewedBy || data.reviewedBy || '';
      const reviewNote = sub.reviewNote || data.reviewNote || '';

      // submissions レコード更新（scanImageBlob はローカルキャッシュをそのまま保持）
      await db.submissions.update(sub.id, {
        status: data.status || sub.status || '承認済',
        hasChange: data.hasChange !== undefined ? data.hasChange : sub.hasChange,
        enrollmentClass: data.enrollmentClass || sub.enrollmentClass,
        enrollmentCourse: data.enrollmentCourse || sub.enrollmentCourse,
        inputMethod: data.inputMethod || sub.inputMethod || '手動',
        approvedBy: data.approvedBy || sub.approvedBy,
        remarks: data.remarks !== undefined ? data.remarks : sub.remarks,
        submittedAt: data.submittedAt || sub.submittedAt || new Date(latestEv.timestamp).toISOString(),
        approvedAt: data.approvedAt || sub.approvedAt || new Date(latestEv.timestamp).toISOString(),
        history,
        reviewStatus,
        reviewedAt,
        reviewedBy,
        reviewNote
      });
    }
  },

  /**
   * 共有フォルダ内のすべてのプロジェクトをスキャンして一覧取得
   */
  async scanSharedProjects() {
    if (!FolderConnector.isConnected()) return [];
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return [];

    const sharedProjects = [];
    try {
      for await (const [name, handle] of rootHandle.entries()) {
        if (handle.kind === 'directory' && name.startsWith('proj_')) {
          const meta = await this.readJsonFile(handle, 'meta.json');
          if (meta) {
            meta.sessionName = UI.formatSession(meta.sessionName);
            meta.title = UI.formatProjectTitle(meta.title);
            sharedProjects.push({
              dirName: name,
              meta,
              handle
            });
          }
        }
      }
    } catch (err) {
      console.error('共有フォルダプロジェクト一覧取得失敗:', err);
    }

    return sharedProjects;
  },

  /**
   * 共有フォルダのプロジェクト（meta.json + students.json + events）をこのPCのIndexedDBにインポート
   */
  async importProjectFromShared(projectId) {
    if (!FolderConnector.isConnected()) {
      throw new Error('共有フォルダが接続されていません。');
    }

    const rootHandle = FolderConnector.getDirHandle();
    const projDir = await this.getSubdir(rootHandle, projectId);
    if (!projDir) {
      throw new Error(`共有フォルダ内にプロジェクト「${projectId}」が見つかりません。`);
    }

    let meta = await this.readJsonFile(projDir, 'meta.json');
    if (!meta) {
      // 一時ファイルのフォールバック確認
      meta = await this.readJsonFile(projDir, '_tmp_meta.json');
    }
    if (!meta) {
      throw new Error('共有フォルダ内の「meta.json」が見つからないか破損しています。プロジェクトを作成したPCで該当プロジェクトを開き、「共有フォルダへ再書き出し」を実行してから再度取り込んでください。');
    }

    let students = await this.readJsonFile(projDir, 'students.json');
    if (!Array.isArray(students) || students.length === 0) {
      // 一時ファイル _tmp_students.json が残っているかフォールバック確認
      const tmpStudents = await this.readJsonFile(projDir, '_tmp_students.json');
      if (Array.isArray(tmpStudents) && tmpStudents.length > 0) {
        console.info('students.json が空のため、一時ファイル _tmp_students.json から復元します');
        students = tmpStudents;
        try {
          await this.writeJsonFileWithRetry(projDir, 'students.json', students);
        } catch (recoverErr) {
          console.warn('students.json 一時ファイルからの正規復元書き込み例外:', recoverErr);
        }
      }
    }

    if (!Array.isArray(students) || students.length === 0) {
      throw new Error('共有フォルダ内の「students.json」が空または破損しています。プロジェクトを作成したPCで該当プロジェクトを開き、「共有フォルダへ再書き出し」を実行してから再度取り込んでください。');
    }

    // 既存プロジェクトがあるか確認
    const existing = await db.projects.get(projectId);
    if (existing) {
      // 既存があれば同期を実行して完了
      await this.syncFromSharedFolder(projectId);
      return existing;
    }

    // ローカル IndexedDB にプロジェクト・生徒・空提出レコードを登録
    await db.transaction('rw', db.projects, db.students, db.submissions, async () => {
      await db.projects.put({
        id: meta.id,
        year: meta.year,
        grade: meta.grade,
        sessionName: UI.formatSession(meta.sessionName),
        title: UI.formatProjectTitle(meta.title),
        status: meta.status || '進行中',
        scanTemplate: meta.scanTemplate || null,
        createdAt: meta.createdAt || new Date().toISOString(),
        completedAt: meta.completedAt || null
      });

      const studentEntities = students.map(s => ({
        id: s.id || ('stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
        projectId: meta.id,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana || '',
        className: s.className,
        course: s.course || '4科'
      }));
      await db.students.bulkPut(studentEntities);

      const submissionEntities = studentEntities.map(s => ({
        id: 'sub_' + s.id,
        projectId: meta.id,
        studentId: s.id,
        status: '未提出',
        hasChange: false,
        enrollmentClass: s.className,
        enrollmentCourse: s.course || '4科',
        inputMethod: '',
        approvedBy: '',
        submittedAt: null,
        approvedAt: null,
        remarks: '',
        scanImageBlob: null,
        history: [],
        reviewStatus: 'unreviewed',
        reviewedAt: null,
        reviewedBy: '',
        reviewNote: ''
      }));
      await db.submissions.bulkPut(submissionEntities);
    });

    // イベントの同期を実行して最新状態にする
    await this.syncFromSharedFolder(projectId);

    return await db.projects.get(projectId);
  },

  /**
   * 最終同期日時の取得
   */
  getLastSyncTime(projectId) {
    return this.lastSyncTimes.get(projectId) || null;
  },

  /* ================= アーカイブ（退避・復元・削除・自動クリーンアップ） ================= */

  /**
   * ディレクトリ内容を再帰的に別のディレクトリハンドル配下へコピー
   */
  async copyDirectoryRecursive(srcHandle, destHandle) {
    for await (const [name, handle] of srcHandle.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const destFileHandle = await destHandle.getFileHandle(name, { create: true });
        const writable = await destFileHandle.createWritable({ keepExistingData: false });
        try {
          await writable.write(await file.arrayBuffer());
        } finally {
          await writable.close();
        }
      } else if (handle.kind === 'directory') {
        const subDestHandle = await destHandle.getDirectoryHandle(name, { create: true });
        await this.copyDirectoryRecursive(handle, subDestHandle);
      }
    }
  },

  /**
   * ディレクトリを指定先へ移動（move API または再帰コピー＆元削除フォールバック）
   */
  async moveDirectory(parentSrcHandle, dirName, parentDestHandle) {
    const srcHandle = await parentSrcHandle.getDirectoryHandle(dirName);
    // move API がサポートされているか試行
    if (typeof srcHandle.move === 'function') {
      try {
        await srcHandle.move(parentDestHandle, dirName);
        return;
      } catch (moveErr) {
        console.warn('handle.move 失敗のため、再帰コピー＆削除フォールバックを実行:', moveErr);
      }
    }

    // フォールバック: 再帰コピー
    const destDirHandle = await parentDestHandle.getDirectoryHandle(dirName, { create: true });
    await this.copyDirectoryRecursive(srcHandle, destDirHandle);

    // 元ディレクトリの削除
    await parentSrcHandle.removeEntry(dirName, { recursive: true });
  },

  /**
   * プロジェクトを完了（アーカイブ）にし、共有フォルダの archive/ フォルダへ退避
   * 同時にローカル IndexedDB からも削除する
   */
  async archiveProject(projectId) {
    if (!FolderConnector.isConnected()) {
      throw new Error('共有フォルダが接続されていません。アーカイブには共有フォルダの接続が必要です。');
    }
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) {
      throw new Error('共有フォルダのハンドルが取得できません。');
    }

    const projDir = await this.getSubdir(rootHandle, projectId);
    if (!projDir) {
      throw new Error(`共有フォルダ内にプロジェクト「${projectId}」が見つかりません。`);
    }

    // 1. meta.json を更新（ステータス: 完了、完了日時、アーカイブ日時）
    let meta = await this.readJsonFile(projDir, 'meta.json');
    if (meta) {
      meta.status = '完了';
      meta.completedAt = meta.completedAt || new Date().toISOString();
      meta.archivedAt = new Date().toISOString();
      await this.writeJsonFileWithRetry(projDir, 'meta.json', meta);
    }

    // 2. archive ディレクトリを取得または作成
    const archiveDir = await rootHandle.getDirectoryHandle('archive', { create: true });

    // 3. proj_{projectId} を archive/ 配下へ移動
    await this.moveDirectory(rootHandle, projectId, archiveDir);

    // 4. ローカル IndexedDB から削除（他PCの手元からも後で削除される）
    await DB.deleteProject(projectId);

    return true;
  },

  /**
   * 完了（アーカイブ）プロジェクトを共有フォルダの archive/ から通常領域へ戻し、進行中に復元する
   */
  async restoreProjectFromArchive(projectId) {
    if (!FolderConnector.isConnected()) {
      throw new Error('共有フォルダが接続されていません。');
    }
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) {
      throw new Error('共有フォルダのハンドルが取得できません。');
    }

    const archiveDir = await this.getSubdir(rootHandle, 'archive');
    if (!archiveDir) {
      throw new Error('archive フォルダが見つかりません。');
    }

    const archivedProjDir = await this.getSubdir(archiveDir, projectId);
    if (!archivedProjDir) {
      throw new Error(`アーカイブ内にプロジェクト「${projectId}」が見つかりません。`);
    }

    // 1. meta.json を更新（ステータス: 進行中、completedAt: null）
    let meta = await this.readJsonFile(archivedProjDir, 'meta.json');
    if (meta) {
      meta.status = '進行中';
      meta.completedAt = null;
      meta.restoredAt = new Date().toISOString();
      await this.writeJsonFileWithRetry(archivedProjDir, 'meta.json', meta);
    }

    // 2. archive/ から rootHandle 直下へ移動
    await this.moveDirectory(archiveDir, projectId, rootHandle);

    // 3. ローカル IndexedDB に取り込み
    return await this.importProjectFromShared(projectId);
  },

  /**
   * 共有フォルダの archive/ フォルダ内のプロジェクト一覧を走査
   */
  async scanArchivedProjects() {
    if (!FolderConnector.isConnected()) return [];
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return [];

    const archiveDir = await this.getSubdir(rootHandle, 'archive');
    if (!archiveDir) return [];

    const archivedProjects = [];
    try {
      for await (const [name, handle] of archiveDir.entries()) {
        if (handle.kind === 'directory' && name.startsWith('proj_')) {
          const meta = await this.readJsonFile(handle, 'meta.json');
          if (meta) {
            meta.sessionName = UI.formatSession(meta.sessionName);
            meta.title = UI.formatProjectTitle(meta.title);

            let studentCount = 0;
            try {
              const students = await this.readJsonFile(handle, 'students.json');
              if (Array.isArray(students)) {
                studentCount = students.length;
              }
            } catch (e) {
              // 無視
            }

            archivedProjects.push({
              dirName: name,
              id: meta.id || name,
              meta,
              studentCount,
              handle
            });
          }
        }
      }
    } catch (err) {
      console.error('アーカイブ一覧スキャン失敗:', err);
    }

    // 完了日または作成日の降順でソート
    archivedProjects.sort((a, b) => {
      const dateA = new Date(a.meta.completedAt || a.meta.archivedAt || a.meta.createdAt || 0).getTime();
      const dateB = new Date(b.meta.completedAt || b.meta.archivedAt || b.meta.createdAt || 0).getTime();
      return dateB - dateA;
    });

    return archivedProjects;
  },

  /**
   * 指定した複数のアーカイブプロジェクトを共有フォルダから完全物理削除
   * @param {string[]} projectIds
   */
  async deleteArchivedProjects(projectIds) {
    if (!FolderConnector.isConnected()) {
      throw new Error('共有フォルダが接続されていません。');
    }
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) {
      throw new Error('共有フォルダのハンドルが取得できません。');
    }

    const archiveDir = await this.getSubdir(rootHandle, 'archive');
    if (!archiveDir) {
      throw new Error('archive フォルダが見つかりません。');
    }

    const results = { successCount: 0, failedCount: 0, errors: [] };

    for (const pid of projectIds) {
      try {
        await archiveDir.removeEntry(pid, { recursive: true });
        // ローカルに残っていればそれも削除
        await DB.deleteProject(pid);
        results.successCount++;
      } catch (err) {
        console.error(`アーカイブプロジェクト削除失敗 (${pid}):`, err);
        results.failedCount++;
        results.errors.push({ id: pid, error: err.message });
      }
    }

    return results;
  },

  /**
   * 他の端末によってアーカイブされたプロジェクトが手元IndexedDBに残っている場合、自動で削除する
   * @param {Array} localProjects
   */
  async cleanupArchivedFromLocal(localProjects) {
    if (!FolderConnector.isConnected() || !Array.isArray(localProjects) || localProjects.length === 0) {
      return 0;
    }
    const rootHandle = FolderConnector.getDirHandle();
    if (!rootHandle) return 0;

    const archiveDir = await this.getSubdir(rootHandle, 'archive');
    if (!archiveDir) return 0;

    let cleanedCount = 0;
    try {
      const archivedIds = new Set();
      for await (const [name, handle] of archiveDir.entries()) {
        if (handle.kind === 'directory' && name.startsWith('proj_')) {
          archivedIds.add(name);
        }
      }

      for (const p of localProjects) {
        if (archivedIds.has(p.id)) {
          console.info(`[cleanupArchivedFromLocal] 共有フォルダでアーカイブ済みのプロジェクトを手元から削除: ${p.title} (${p.id})`);
          await DB.deleteProject(p.id);
          cleanedCount++;
        }
      }
    } catch (err) {
      console.warn('アーカイブクリーンアップエラー:', err);
    }

    return cleanedCount;
  }
};
