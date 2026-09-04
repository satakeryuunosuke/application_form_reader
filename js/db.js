/**
 * IndexedDB (Dexie.js) データアクセス層
 * 共有フォルダ（File System Access API）同期およびレビュー管理対応
 */

import { CheckboxEngine } from './checkbox.js';
import { FolderConnector } from './sync/folder-connector.js';
import { SyncManager } from './sync/sync-manager.js';

// グローバル Dexie インスタンスの取得
const Dexie = window.Dexie;

class AppDatabase extends Dexie {
  constructor() {
    super('NichinokenAppFormDB');

    this.version(1).stores({
      projects: 'id, year, grade, sessionName, createdAt',
      students: 'id, projectId, nichinokenId, className',
      submissions: 'id, projectId, studentId, status, enrollmentClass',
      settings: 'key'
    });

    this.version(2).stores({
      projects: 'id, year, grade, sessionName, createdAt',
      students: 'id, projectId, nichinokenId, className',
      submissions: 'id, projectId, studentId, status, enrollmentClass, reviewStatus',
      settings: 'key',
      syncEvents: 'eventId, projectId, studentId, timestamp',
      pendingEvents: '++id, projectId, eventId, timestamp',
      appState: 'key'
    }).upgrade(tx => {
      return tx.table('submissions').toCollection().modify(sub => {
        if (!sub.reviewStatus) {
          sub.reviewStatus = 'unreviewed';
          sub.reviewedAt = null;
          sub.reviewedBy = '';
          sub.reviewNote = '';
        }
      });
    });
  }
}

export const db = new AppDatabase();

export const DB = {
  /**
   * DB初期化およびデフォルト設定の投入・共有フォルダ復元
   */
  async init() {
    const settings = await db.settings.get('app_settings');
    const defaultTemplate = CheckboxEngine.getDefaultTemplate();

    if (!settings) {
      await db.settings.put({
        key: 'app_settings',
        staffNames: ['山田 太郎', '佐藤 花子', '鈴木 一郎'],
        checkThreshold: 0.25,
        defaultScanTemplate: defaultTemplate,
        updatedAt: new Date().toISOString()
      });
    } else if (!settings.defaultScanTemplate) {
      await db.settings.update('app_settings', {
        defaultScanTemplate: defaultTemplate,
        updatedAt: new Date().toISOString()
      });
    }

    // 共有フォルダ接続ハンドルの復元試行
    try {
      const restored = await FolderConnector.restore();
      if (restored) {
        // 接続復帰時は共有設定を同期
        await SyncManager.readSharedSettings();
      }
    } catch (e) {
      console.warn('起動時の共有フォルダ復元スキップ:', e);
    }
  },

  /**
   * 設定を取得
   */
  async getSettings() {
    let settings = await db.settings.get('app_settings');
    if (!settings) {
      await this.init();
      settings = await db.settings.get('app_settings');
    }
    return settings;
  },

  /**
   * 設定を保存（共有フォルダ接続時は settings.json にも反映）
   */
  async saveSettings(settingsData) {
    await db.settings.put({
      key: 'app_settings',
      ...settingsData,
      updatedAt: new Date().toISOString()
    });

    if (FolderConnector.isConnected()) {
      try {
        await SyncManager.writeSharedSettings(settingsData);
      } catch (err) {
        console.warn('共有フォルダへの settings.json 書き出し失敗:', err);
      }
    }
  },

  /* ================= プロジェクト操作 ================= */

  /**
   * 全プロジェクト一覧を取得（新しい順）
   */
  async getProjects() {
    const list = await db.projects.toArray();
    return list.map(p => ({
      ...p,
      status: p.status || '進行中'
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  /**
   * 共有フォルダ上のプロジェクト一覧をスキャン取得
   */
  async getSharedProjects() {
    return await SyncManager.scanSharedProjects();
  },

  /**
   * 共有フォルダからプロジェクトをローカルに取り込み
   */
  async importProjectFromShared(projectId) {
    return await SyncManager.importProjectFromShared(projectId);
  },

  /**
   * プロジェクト詳細を取得
   */
  async getProject(projectId) {
    const project = await db.projects.get(projectId);
    if (project) {
      project.status = project.status || '進行中';
    }
    return project;
  },

  /**
   * プロジェクトを新規作成（メインPC操作）
   */
  async createProject({ year, grade, sessionName, students, scanTemplate }) {
    const projectId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const title = `${year}年度 ${grade}年 ${sessionName}講習`;

    const project = {
      id: projectId,
      year: parseInt(year, 10),
      grade: parseInt(grade, 10),
      sessionName,
      title,
      status: '進行中',
      completedAt: null,
      scanTemplate: scanTemplate || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let studentRecords = [];
    await db.transaction('rw', db.projects, db.students, db.submissions, async () => {
      // 1. プロジェクト保存
      await db.projects.add(project);

      // 2. 生徒リスト保存
      studentRecords = students.map(s => ({
        id: 'stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        projectId,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana || '',
        className: s.className,
        course: s.course || '4科'
      }));
      await db.students.bulkAdd(studentRecords);

      // 3. 各生徒の初期提出ステータス（未提出）レコードを作成
      const initialSubmissions = studentRecords.map(s => ({
        id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        projectId,
        studentId: s.id,
        status: '未提出',
        hasChange: false,
        enrollmentClass: '',
        enrollmentCourse: '',
        inputMethod: '',
        approvedBy: '',
        remarks: '',
        submittedAt: null,
        approvedAt: null,
        history: [],
        reviewStatus: 'unreviewed',
        reviewedAt: null,
        reviewedBy: '',
        reviewNote: ''
      }));
      await db.submissions.bulkAdd(initialSubmissions);
    });

    // 共有フォルダ接続時は meta.json, students.json を書き出し
    if (FolderConnector.isConnected()) {
      try {
        await SyncManager.writeProjectMeta(project);
        await SyncManager.writeStudentList(projectId, studentRecords);
      } catch (syncErr) {
        console.warn('新規プロジェクトの共有フォルダ書き出し失敗:', syncErr);
      }
    }

    return project;
  },

  /**
   * プロジェクトのステータス（進行中／完了）を更新
   */
  async updateProjectStatus(projectId, status) {
    const isCompleted = status === '完了';
    await db.projects.update(projectId, {
      status,
      completedAt: isCompleted ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    });

    // 共有フォルダへの反映
    if (FolderConnector.isConnected()) {
      try {
        const updated = await db.projects.get(projectId);
        await SyncManager.writeProjectMeta(updated);
        await SyncManager.recordEvent(projectId, {
          action: 'STATUS_CHANGE',
          data: { status, completedAt: updated.completedAt }
        });
      } catch (syncErr) {
        console.warn('ステータス変更の共有反映失敗:', syncErr);
      }
    }
  },

  /**
   * プロジェクトの更新（テンプレート更新等）
   */
  async updateProject(projectId, updates) {
    await db.projects.update(projectId, {
      ...updates,
      updatedAt: new Date().toISOString()
    });

    if (FolderConnector.isConnected()) {
      try {
        const updated = await db.projects.get(projectId);
        await SyncManager.writeProjectMeta(updated);
      } catch (syncErr) {
        console.warn('プロジェクト更新の共有反映失敗:', syncErr);
      }
    }
  },

  /**
   * プロジェクトを削除（関連生徒・提出データも完全削除）
   */
  async deleteProject(projectId) {
    await db.transaction('rw', db.projects, db.students, db.submissions, db.syncEvents, async () => {
      await db.submissions.where('projectId').equals(projectId).delete();
      await db.students.where('projectId').equals(projectId).delete();
      await db.syncEvents.where('projectId').equals(projectId).delete();
      await db.projects.delete(projectId);
    });
  },

  /* ================= 生徒・提出データ操作 ================= */

  /**
   * プロジェクトに紐づく全生徒と提出状況を結合して取得
   * @param {string} projectId
   * @param {boolean} syncFirst 呼び出し前に共有フォルダと同期を行うか
   */
  async getProjectStudentsWithSubmissions(projectId, syncFirst = false) {
    if (syncFirst && FolderConnector.isConnected()) {
      try {
        await SyncManager.syncFromSharedFolder(projectId);
      } catch (syncErr) {
        console.warn('共有フォルダ同期スキップ:', syncErr);
      }
    }

    const students = await db.students.where('projectId').equals(projectId).toArray();
    const submissions = await db.submissions.where('projectId').equals(projectId).toArray();

    // テンプレート生徒の漢字修復マッピング
    const KNOWN_TEMPLATE_STUDENTS = {
      'TDN60013': { name: '日能研太郎', nameKana: 'ニチノウケンタロウ' },
      'TDN60026': { name: '日能研花子', nameKana: 'ニチノウケンハナコ' },
      'TDN60039': { name: '日能研次郎', nameKana: 'ニチノウケンジロウ' },
      'TDN60052': { name: '日能研三郎', nameKana: 'ニチノウケンサブロウ' },
      'TDN60065': { name: '日能研四郎', nameKana: 'ニチノウケンシロウ' }
    };

    for (const s of students) {
      const hasKanji = /[\u4e00-\u9faf]/.test(s.name || '');
      const known = KNOWN_TEMPLATE_STUDENTS[s.nichinokenId?.toUpperCase()];
      if (!hasKanji && known) {
        s.name = known.name;
        if (!s.nameKana || s.nameKana === s.name) s.nameKana = known.nameKana;
        db.students.update(s.id, { name: known.name, nameKana: s.nameKana }).catch(() => {});
      } else if (!hasKanji && s.nameKana && /[\u4e00-\u9faf]/.test(s.nameKana)) {
        const tmp = s.name;
        s.name = s.nameKana;
        s.nameKana = tmp;
        db.students.update(s.id, { name: s.name, nameKana: s.nameKana }).catch(() => {});
      }
    }

    const subMap = new Map();
    for (const sub of submissions) {
      subMap.set(sub.studentId, sub);
    }

    return students.map(s => {
      const course = s.course || '4科';
      const sub = subMap.get(s.id) || {
        status: '未提出',
        hasChange: false,
        enrollmentClass: '',
        enrollmentCourse: '',
        inputMethod: '',
        approvedBy: '',
        remarks: '',
        history: [],
        submittedAt: null,
        approvedAt: null,
        reviewStatus: 'unreviewed',
        reviewedAt: null,
        reviewedBy: '',
        reviewNote: ''
      };

      let history = Array.isArray(sub.history) ? [...sub.history] : [];
      if (history.length === 0 && sub.status === '承認済') {
        history.push({
          id: 'hist_init_' + (sub.id || s.id),
          timestamp: sub.approvedAt || sub.submittedAt || new Date().toISOString(),
          approvedAt: sub.approvedAt,
          inputMethod: sub.inputMethod || 'スキャン',
          approvedBy: sub.approvedBy || '',
          status: sub.status,
          hasChange: sub.hasChange,
          enrollmentClass: sub.enrollmentClass || s.className,
          enrollmentCourse: sub.enrollmentCourse || (sub.enrollmentClass === '非受講' ? '非受講' : course),
          remarks: sub.remarks || '',
          scanImageBlob: sub.scanImageBlob || null
        });
      }

      let enrollmentCourse = sub.enrollmentCourse;
      if (!enrollmentCourse) {
        if (sub.status === '承認済') {
          enrollmentCourse = sub.enrollmentClass === '非受講' ? '非受講' : (!sub.hasChange ? course : course);
        } else {
          enrollmentCourse = '-';
        }
      } else if (sub.status === '未提出') {
        enrollmentCourse = '-';
      }

      return {
        studentId: s.id,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana,
        className: s.className,
        course,
        submissionId: sub.id,
        status: sub.status,
        hasChange: sub.hasChange,
        enrollmentClass: sub.enrollmentClass || (sub.status === '承認済' && !sub.hasChange ? s.className : (sub.status === '未提出' ? '-' : sub.enrollmentClass)),
        enrollmentCourse,
        inputMethod: sub.inputMethod,
        approvedBy: sub.approvedBy,
        remarks: sub.remarks,
        scanImageBlob: sub.scanImageBlob,
        history,
        submittedAt: sub.submittedAt,
        approvedAt: sub.approvedAt,
        reviewStatus: sub.reviewStatus || 'unreviewed',
        reviewedAt: sub.reviewedAt || null,
        reviewedBy: sub.reviewedBy || '',
        reviewNote: sub.reviewNote || ''
      };
    });
  },

  /**
   * 日能研番号から生徒を取得
   */
  async findStudentByNichinokenId(projectId, nichinokenId) {
    const cleaned = (nichinokenId || '').trim().toUpperCase();
    const s = await db.students
      .where('projectId')
      .equals(projectId)
      .filter(st => st.nichinokenId.toUpperCase() === cleaned)
      .first();

    if (s) {
      const KNOWN_TEMPLATE_STUDENTS = {
        'TDN60013': { name: '日能研太郎', nameKana: 'ニチノウケンタロウ' },
        'TDN60026': { name: '日能研花子', nameKana: 'ニチノウケンハナコ' },
        'TDN60039': { name: '日能研次郎', nameKana: 'ニチノウケンジロウ' },
        'TDN60052': { name: '日能研三郎', nameKana: 'ニチノウケンサブロウ' },
        'TDN60065': { name: '日能研四郎', nameKana: 'ニチノウケンシロウ' }
      };
      const hasKanji = /[\u4e00-\u9faf]/.test(s.name || '');
      const known = KNOWN_TEMPLATE_STUDENTS[cleaned];
      if (!hasKanji && known) {
        s.name = known.name;
        if (!s.nameKana || s.nameKana === s.name) s.nameKana = known.nameKana;
        db.students.update(s.id, { name: known.name, nameKana: s.nameKana }).catch(() => {});
      } else if (!hasKanji && s.nameKana && /[\u4e00-\u9faf]/.test(s.nameKana)) {
        const tmp = s.name;
        s.name = s.nameKana;
        s.nameKana = tmp;
        db.students.update(s.id, { name: s.name, nameKana: s.nameKana }).catch(() => {});
      }
    }
    return s;
  },

  /**
   * 生徒を1名プロジェクトに追加（初期未提出レコードも自動作成）
   */
  async addStudentToProject(projectId, { nichinokenId, name, nameKana = '', className, course = '4科' }) {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    if (project.status === '完了') {
      throw new Error('このプロジェクトは「完了」しているため生徒を追加できません。「進行中に戻す」を行ってから操作してください。');
    }

    const cleanId = (nichinokenId || '').trim().toUpperCase();
    const cleanName = (name || '').trim();
    const cleanKana = (nameKana || '').trim();
    const cleanClass = (className || '').trim();
    const cleanCourse = (course || '4科').trim();

    if (!cleanId) throw new Error('日能研番号を入力してください');
    if (!cleanName) throw new Error('氏名を入力してください');
    if (!cleanClass) throw new Error('クラス名を入力してください');

    const existing = await this.findStudentByNichinokenId(projectId, cleanId);
    if (existing) {
      throw new Error(`日能研番号「${cleanId}」の生徒はすでにこのプロジェクトに登録されています（${existing.name}）`);
    }

    const studentId = 'stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    const studentRecord = {
      id: studentId,
      projectId,
      nichinokenId: cleanId,
      name: cleanName,
      nameKana: cleanKana,
      className: cleanClass,
      course: cleanCourse || '4科'
    };

    const submissionRecord = {
      id: submissionId,
      projectId,
      studentId,
      status: '未提出',
      hasChange: false,
      enrollmentClass: '',
      enrollmentCourse: '',
      inputMethod: '',
      approvedBy: '',
      remarks: '',
      history: [],
      submittedAt: null,
      approvedAt: null,
      reviewStatus: 'unreviewed',
      reviewedAt: null,
      reviewedBy: '',
      reviewNote: ''
    };

    await db.transaction('rw', db.students, db.submissions, async () => {
      await db.students.add(studentRecord);
      await db.submissions.add(submissionRecord);
    });

    if (FolderConnector.isConnected()) {
      try {
        const allStudents = await db.students.where('projectId').equals(projectId).toArray();
        await SyncManager.writeStudentList(projectId, allStudents);
      } catch (syncErr) {
        console.warn('生徒追加後の共有フォルダ反映失敗:', syncErr);
      }
    }

    return studentRecord;
  },

  /**
   * 複数生徒をまとめてプロジェクトに追加（CSV追加インポート用）
   */
  async addStudentsBulkToProject(projectId, studentsArray) {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    if (project.status === '完了') {
      throw new Error('このプロジェクトは「完了」しているため生徒を追加できません。「進行中に戻す」を行ってから操作してください。');
    }

    const existingStudents = await db.students.where('projectId').equals(projectId).toArray();
    const existingStudentMap = new Map(existingStudents.map(s => [s.nichinokenId.toUpperCase(), s]));

    const toAddStudents = [];
    const toAddSubmissions = [];
    const toUpdateStudents = [];
    const addedList = [];
    const updatedList = [];
    const skippedList = [];

    const seenInBatch = new Set();

    for (const s of studentsArray) {
      const cleanId = (s.nichinokenId || '').trim().toUpperCase();
      const cleanName = (s.name || '').trim();
      const cleanKana = (s.nameKana || '').trim();
      const cleanClass = (s.className || '').trim();
      const cleanCourse = (s.course || '4科').trim();

      if (!cleanId || !cleanName || !cleanClass) {
        skippedList.push({ id: cleanId || '(不明)', name: cleanName, reason: '必須項目不足' });
        continue;
      }

      if (seenInBatch.has(cleanId)) {
        skippedList.push({ id: cleanId, name: cleanName, reason: 'CSVファイル内で番号が重複' });
        continue;
      }
      seenInBatch.add(cleanId);

      if (existingStudentMap.has(cleanId)) {
        const existing = existingStudentMap.get(cleanId);
        toUpdateStudents.push({
          id: existing.id,
          name: cleanName,
          nameKana: cleanKana,
          className: cleanClass,
          course: cleanCourse || '4科'
        });
        updatedList.push({ id: cleanId, name: cleanName, prevName: existing.name });
        continue;
      }

      const studentId = 'stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

      const stuRec = {
        id: studentId,
        projectId,
        nichinokenId: cleanId,
        name: cleanName,
        nameKana: cleanKana,
        className: cleanClass,
        course: cleanCourse || '4科'
      };

      const subRec = {
        id: submissionId,
        projectId,
        studentId,
        status: '未提出',
        hasChange: false,
        enrollmentClass: '',
        enrollmentCourse: '',
        inputMethod: '',
        approvedBy: '',
        remarks: '',
        history: [],
        submittedAt: null,
        approvedAt: null,
        reviewStatus: 'unreviewed',
        reviewedAt: null,
        reviewedBy: '',
        reviewNote: ''
      };

      toAddStudents.push(stuRec);
      toAddSubmissions.push(subRec);
      addedList.push(stuRec);
    }

    await db.transaction('rw', db.students, db.submissions, async () => {
      if (toAddStudents.length > 0) {
        await db.students.bulkAdd(toAddStudents);
        await db.submissions.bulkAdd(toAddSubmissions);
      }
      for (const item of toUpdateStudents) {
        await db.students.update(item.id, {
          name: item.name,
          nameKana: item.nameKana,
          className: item.className,
          course: item.course
        });
      }
    });

    if (FolderConnector.isConnected()) {
      try {
        const allStudents = await db.students.where('projectId').equals(projectId).toArray();
        await SyncManager.writeStudentList(projectId, allStudents);
      } catch (syncErr) {
        console.warn('一括生徒追加後の共有フォルダ反映失敗:', syncErr);
      }
    }

    return {
      addedCount: toAddStudents.length,
      updatedCount: toUpdateStudents.length,
      skippedCount: skippedList.length,
      addedList,
      updatedList,
      skippedList
    };
  },

  /**
   * 生徒の基本情報（氏名・カナ・クラス・科目）を個別に更新
   */
  async updateStudent(studentId, { name, nameKana, className, course }) {
    const student = await db.students.get(studentId);
    if (!student) throw new Error('生徒が見つかりません');

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (nameKana !== undefined) updates.nameKana = nameKana.trim();
    if (className !== undefined) updates.className = className.trim();
    if (course !== undefined) updates.course = course.trim();

    await db.students.update(studentId, updates);

    if (FolderConnector.isConnected()) {
      try {
        const allStudents = await db.students.where('projectId').equals(student.projectId).toArray();
        await SyncManager.writeStudentList(student.projectId, allStudents);
      } catch (syncErr) {
        console.warn('生徒更新後の共有フォルダ反映失敗:', syncErr);
      }
    }

    return await db.students.get(studentId);
  },

  /**
   * 生徒をプロジェクトから削除（紐づく提出データ・スキャン画像・変更履歴も完全削除）
   */
  async deleteStudentFromProject(projectId, studentId) {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    if (project.status === '完了') {
      throw new Error('このプロジェクトは「完了」しているため生徒を削除できません。「進行中に戻す」を行ってから操作してください。');
    }

    const student = await db.students.get(studentId);
    if (!student || student.projectId !== projectId) {
      throw new Error('対象の生徒データが見つかりません');
    }

    await db.transaction('rw', db.students, db.submissions, async () => {
      await db.submissions.where('studentId').equals(studentId).delete();
      await db.students.delete(studentId);
    });

    if (FolderConnector.isConnected()) {
      try {
        const allStudents = await db.students.where('projectId').equals(projectId).toArray();
        await SyncManager.writeStudentList(projectId, allStudents);
      } catch (syncErr) {
        console.warn('生徒削除後の共有フォルダ反映失敗:', syncErr);
      }
    }

    return student;
  },

  /**
   * プロジェクト内のクラス名一覧を取得
   */
  async getProjectClasses(projectId) {
    const students = await db.students.where('projectId').equals(projectId).toArray();
    const classSet = new Set(students.map(s => s.className).filter(Boolean));
    return Array.from(classSet).sort();
  },

  /**
   * 提出結果の保存・承認更新（変更履歴も自動記録、共有イベント自動記録）
   */
  async saveSubmission(submissionId, submissionData) {
    const existing = await db.submissions.get(submissionId);
    if (!existing) {
      throw new Error(`提出レコードが見つかりません: ${submissionId}`);
    }

    const project = await db.projects.get(existing.projectId);
    if (project && project.status === '完了') {
      throw new Error('このプロジェクトは「完了」しているためデータを変更できません。「進行中に戻す」を行ってから操作してください。');
    }

    const nowIso = new Date().toISOString();
    let currentHistory = Array.isArray(existing.history) ? [...existing.history] : [];

    // 既存レコードに履歴配列がなく、かつすでに承認済の場合は過去状態を初版として登録
    if (currentHistory.length === 0 && existing.status === '承認済') {
      currentHistory.push({
        id: 'hist_legacy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        timestamp: existing.approvedAt || existing.submittedAt || nowIso,
        approvedAt: existing.approvedAt,
        inputMethod: existing.inputMethod || '手動',
        approvedBy: existing.approvedBy || '',
        status: existing.status,
        hasChange: existing.hasChange || false,
        enrollmentClass: existing.enrollmentClass || '',
        enrollmentCourse: existing.enrollmentCourse || '',
        remarks: existing.remarks || '',
        scanImageBlob: existing.scanImageBlob || null
      });
    }

    // 新しい変更履歴エントリ
    const newHistoryItem = {
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      timestamp: submissionData.submittedAt || submissionData.approvedAt || nowIso,
      approvedAt: submissionData.approvedAt || nowIso,
      inputMethod: submissionData.inputMethod || existing.inputMethod || '手動',
      approvedBy: submissionData.approvedBy || existing.approvedBy || '',
      status: submissionData.status || '承認済',
      hasChange: submissionData.hasChange !== undefined ? submissionData.hasChange : (existing.hasChange || false),
      enrollmentClass: submissionData.enrollmentClass || existing.enrollmentClass || '',
      enrollmentCourse: submissionData.enrollmentCourse || existing.enrollmentCourse || '',
      remarks: submissionData.remarks !== undefined ? submissionData.remarks : (existing.remarks || ''),
      scanImageBlob: submissionData.scanImageBlob !== undefined ? submissionData.scanImageBlob : (existing.scanImageBlob || null)
    };

    currentHistory.push(newHistoryItem);

    // スキャン画像は指定があれば更新、なければ既存を維持
    const scanImageToSave = submissionData.scanImageBlob !== undefined 
      ? submissionData.scanImageBlob 
      : (existing.scanImageBlob || null);

    // レビュー情報の保持・更新
    const reviewStatus = submissionData.reviewStatus !== undefined
      ? submissionData.reviewStatus
      : (existing.reviewStatus || 'unreviewed');
    const reviewedAt = submissionData.reviewedAt !== undefined
      ? submissionData.reviewedAt
      : (existing.reviewedAt || null);
    const reviewedBy = submissionData.reviewedBy !== undefined
      ? submissionData.reviewedBy
      : (existing.reviewedBy || '');
    const reviewNote = submissionData.reviewNote !== undefined
      ? submissionData.reviewNote
      : (existing.reviewNote || '');

    const finalSubmission = {
      ...submissionData,
      scanImageBlob: scanImageToSave,
      history: currentHistory,
      status: submissionData.status || '承認済',
      approvedAt: submissionData.approvedAt || nowIso,
      reviewStatus,
      reviewedAt,
      reviewedBy,
      reviewNote
    };

    await db.submissions.update(submissionId, finalSubmission);

    // 共有フォルダ同期イベントの記録（差分ログ追記方式）
    try {
      const student = await db.students.get(existing.studentId);
      const isScan = (submissionData.inputMethod || existing.inputMethod) === 'スキャン';
      const action = isScan ? 'APPROVE' : (existing.status === '承認済' ? 'UPDATE' : 'APPROVE');

      await SyncManager.recordEvent(existing.projectId, {
        action,
        studentId: existing.studentId,
        nichinokenId: student?.nichinokenId || '',
        data: {
          status: finalSubmission.status,
          hasChange: finalSubmission.hasChange,
          enrollmentClass: finalSubmission.enrollmentClass,
          enrollmentCourse: finalSubmission.enrollmentCourse,
          inputMethod: finalSubmission.inputMethod,
          approvedBy: finalSubmission.approvedBy,
          remarks: finalSubmission.remarks,
          submittedAt: finalSubmission.submittedAt,
          approvedAt: finalSubmission.approvedAt,
          reviewStatus,
          reviewedAt,
          reviewedBy,
          reviewNote
        },
        recordedBy: finalSubmission.approvedBy || ''
      });
    } catch (syncErr) {
      console.warn('共有イベント記録の警告:', syncErr);
    }
  },

  /* ================= スキャン照合レビュー機能 ================= */

  /**
   * 照合レビュー結果の保存
   */
  async updateReviewStatus(submissionId, { reviewStatus, reviewedBy, reviewNote }) {
    const existing = await db.submissions.get(submissionId);
    if (!existing) {
      throw new Error(`提出レコードが見つかりません: ${submissionId}`);
    }

    const nowIso = new Date().toISOString();
    const updates = {
      reviewStatus: reviewStatus || 'unreviewed',
      reviewedAt: reviewStatus !== 'unreviewed' ? nowIso : null,
      reviewedBy: reviewedBy || '',
      reviewNote: reviewNote !== undefined ? reviewNote : (existing.reviewNote || '')
    };

    await db.submissions.update(submissionId, updates);

    // 共有イベントも更新（他のPCへレビュー結果を同期）
    try {
      const student = await db.students.get(existing.studentId);
      await SyncManager.recordEvent(existing.projectId, {
        action: 'UPDATE',
        studentId: existing.studentId,
        nichinokenId: student?.nichinokenId || '',
        data: {
          status: existing.status,
          hasChange: existing.hasChange,
          enrollmentClass: existing.enrollmentClass,
          enrollmentCourse: existing.enrollmentCourse,
          inputMethod: existing.inputMethod,
          approvedBy: existing.approvedBy,
          remarks: existing.remarks,
          ...updates
        },
        recordedBy: reviewedBy || ''
      });
    } catch (e) {
      console.warn('レビュー更新イベント記録例外:', e);
    }
  },

  /**
   * スキャン照合レビューの進捗統計を取得
   */
  async getReviewStats(projectId) {
    const list = await this.getProjectStudentsWithSubmissions(projectId);
    // スキャン登録されたものまたは画像が存在するもの
    const scanItems = list.filter(item => item.status === '承認済' && (item.inputMethod === 'スキャン' || item.scanImageBlob));

    let unreviewed = 0;
    let confirmed = 0;
    let mismatch = 0;

    for (const item of scanItems) {
      if (item.reviewStatus === 'confirmed') {
        confirmed++;
      } else if (item.reviewStatus === 'mismatch') {
        mismatch++;
      } else {
        unreviewed++;
      }
    }

    return {
      total: scanItems.length,
      unreviewed,
      confirmed,
      mismatch
    };
  },

  /* ================= 統計サマリー ================= */

  /**
   * プロジェクトの提出状況サマリー統計を取得
   */
  async getProjectStats(projectId) {
    const list = await this.getProjectStudentsWithSubmissions(projectId);
    const total = list.length;
    let submitted = 0;
    let unsubmitted = 0;
    let noChange = 0;
    let hasChange = 0;
    let notEnrolled = 0;

    for (const item of list) {
      if (item.status === '未提出') {
        unsubmitted++;
      } else {
        submitted++;
        if (item.enrollmentClass === '非受講') {
          notEnrolled++;
        } else if (item.hasChange) {
          hasChange++;
        } else {
          noChange++;
        }
      }
    }

    return { total, submitted, unsubmitted, noChange, hasChange, notEnrolled };
  },

  /* ================= 3年保持管理 & バックアップ ================= */

  /**
   * 3年以上経過したプロジェクト一覧を検出
   */
  async getExpiredProjects(yearsThreshold = 3) {
    const now = new Date();
    const all = await this.getProjects();
    return all.filter(p => {
      const created = new Date(p.createdAt);
      const diffYears = (now - created) / (1000 * 60 * 60 * 24 * 365.25);
      return diffYears >= yearsThreshold;
    });
  },

  /**
   * 全データをJSON形式でエクスポート
   */
  async exportFullBackup() {
    const projects = await db.projects.toArray();
    const students = await db.students.toArray();
    const submissions = await db.submissions.toArray();
    const settings = await db.settings.toArray();
    const syncEvents = await db.syncEvents.toArray();
    const pendingEvents = await db.pendingEvents.toArray();
    const appState = await db.appState.toArray();

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      data: {
        projects,
        students,
        submissions,
        settings,
        syncEvents,
        pendingEvents,
        appState
      }
    };
  },

  /**
   * JSONバックアップから復元（既存データを置き換え）
   */
  async importFullBackup(backupJson) {
    if (!backupJson || !backupJson.data) {
      throw new Error('無効なバックアップファイルです');
    }

    const { projects, students, submissions, settings, syncEvents, pendingEvents, appState } = backupJson.data;

    await db.transaction('rw', db.projects, db.students, db.submissions, db.settings, db.syncEvents, db.pendingEvents, db.appState, async () => {
      await db.projects.clear();
      await db.students.clear();
      await db.submissions.clear();
      await db.settings.clear();
      await db.syncEvents.clear();
      await db.pendingEvents.clear();
      await db.appState.clear();

      if (projects?.length) await db.projects.bulkAdd(projects);
      if (students?.length) await db.students.bulkAdd(students);
      if (submissions?.length) await db.submissions.bulkAdd(submissions);
      if (settings?.length) await db.settings.bulkAdd(settings);
      if (syncEvents?.length) await db.syncEvents.bulkAdd(syncEvents);
      if (pendingEvents?.length) await db.pendingEvents.bulkAdd(pendingEvents);
      if (appState?.length) await db.appState.bulkAdd(appState);
    });
  }
};
