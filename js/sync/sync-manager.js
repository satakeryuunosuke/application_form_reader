/**
 * 共有フォルダ同期マネージャー
 * イベントソーシング（差分ログ追記方式）による複数PC間のデータ共有とローカルIndexedDB同期を一元管理
 */

import { db, DB } from '../db.js';
import { FolderConnector } from './folder-connector.js';
import { PendingQueue } from './pending-queue.js';

export const SyncManager = {
  lastSyncTimes: new Map(), // projectId -> Date

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
   * 文字列・JSONをファイルにアトミック書き出し
   */
  async writeJsonFile(dirHandle, fileName, data) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      await writable.write(jsonStr);
    } finally {
      await writable.close();
    }
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

      await this.writeJsonFile(rootHandle, 'settings.json', sharedData);
      return true;
    } catch (err) {
      console.error('settings.json 書き込みエラー:', err);
      return false;
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
        sessionName: project.sessionName,
        title: project.title,
        status: project.status || '進行中',
        scanTemplate: project.scanTemplate || null,
        createdAt: project.createdAt,
        completedAt: project.completedAt || null,
        updatedAt: new Date().toISOString()
      };
      await this.writeJsonFile(projDir, 'meta.json', meta);
      return true;
    } catch (err) {
      console.error(`meta.json 書き込みエラー (${project.id}):`, err);
      return false;
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
      const stuList = students.map(s => ({
        id: s.id,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana || '',
        className: s.className,
        course: s.course || '4科'
      }));
      await this.writeJsonFile(projDir, 'students.json', stuList);
      return true;
    } catch (err) {
      console.error(`students.json 書き込みエラー (${projectId}):`, err);
      return false;
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
   * @param {string} projectId
   * @returns {Promise<{ newEventsCount: number, totalEvents: number }>}
   */
  async syncFromSharedFolder(projectId) {
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

      // 1. meta.json の確認と更新（ステータス変更等の同期）
      const meta = await this.readJsonFile(projDir, 'meta.json');
      if (meta) {
        const localProj = await db.projects.get(projectId);
        if (localProj && localProj.status !== meta.status) {
          await db.projects.update(projectId, {
            status: meta.status,
            completedAt: meta.completedAt || null
          });
        }
      }

      // 2. events/ ディレクトリの走査
      const eventsDir = await this.getSubdir(projDir, 'events');
      if (!eventsDir) {
        return { newEventsCount: 0, totalEvents: 0, connected: true };
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
        connected: true,
        lastSync: new Date()
      };
    } catch (err) {
      console.error(`同期エラー (${projectId}):`, err);
      throw err;
    }
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

    const meta = await this.readJsonFile(projDir, 'meta.json');
    if (!meta) {
      throw new Error('meta.json が見つかりません。');
    }

    const students = await this.readJsonFile(projDir, 'students.json');
    if (!Array.isArray(students) || students.length === 0) {
      throw new Error('students.json が見つからないか、生徒データが空です。');
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
        sessionName: meta.sessionName,
        title: meta.title,
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
  }
};
