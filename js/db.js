/**
 * IndexedDB (Dexie.js) データアクセス層
 */

import { CheckboxEngine } from './checkbox.js';

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
  }
}

export const db = new AppDatabase();

export const DB = {
  /**
   * DB初期化およびデフォルト設定の投入
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
   * 設定を保存
   */
  async saveSettings(settingsData) {
    await db.settings.put({
      key: 'app_settings',
      ...settingsData,
      updatedAt: new Date().toISOString()
    });
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
   * プロジェクトを新規作成
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

    await db.transaction('rw', db.projects, db.students, db.submissions, async () => {
      // 1. プロジェクト保存
      await db.projects.add(project);

      // 2. 生徒リスト保存
      const studentRecords = students.map(s => ({
        id: 'stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        projectId,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana || '',
        className: s.className
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
        inputMethod: '',
        approvedBy: '',
        remarks: '',
        submittedAt: null,
        approvedAt: null
      }));
      await db.submissions.bulkAdd(initialSubmissions);
    });

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
  },

  /**
   * プロジェクトの更新（テンプレート更新等）
   */
  async updateProject(projectId, updates) {
    await db.projects.update(projectId, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
  },

  /**
   * プロジェクトを削除（関連生徒・提出データも完全削除）
   */
  async deleteProject(projectId) {
    await db.transaction('rw', db.projects, db.students, db.submissions, async () => {
      await db.submissions.where('projectId').equals(projectId).delete();
      await db.students.where('projectId').equals(projectId).delete();
      await db.projects.delete(projectId);
    });
  },

  /* ================= 生徒・提出データ操作 ================= */

  /**
   * プロジェクトに紐づく全生徒と提出状況を結合して取得
   */
  async getProjectStudentsWithSubmissions(projectId) {
    const students = await db.students.where('projectId').equals(projectId).toArray();
    const submissions = await db.submissions.where('projectId').equals(projectId).toArray();

    const subMap = new Map();
    for (const sub of submissions) {
      subMap.set(sub.studentId, sub);
    }

    return students.map(s => {
      const sub = subMap.get(s.id) || {
        status: '未提出',
        hasChange: false,
        enrollmentClass: '',
        inputMethod: '',
        approvedBy: '',
        remarks: '',
        history: [],
        submittedAt: null,
        approvedAt: null
      };

      let history = Array.isArray(sub.history) ? [...sub.history] : [];
      // 既存レコードでhistoryが未生成かつ承認済の場合のフォールバック
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
          remarks: sub.remarks || '',
          scanImageBlob: sub.scanImageBlob || null
        });
      }

      return {
        studentId: s.id,
        nichinokenId: s.nichinokenId,
        name: s.name,
        nameKana: s.nameKana,
        className: s.className,
        submissionId: sub.id,
        status: sub.status,
        hasChange: sub.hasChange,
        enrollmentClass: sub.enrollmentClass || (sub.status === '承認済' && !sub.hasChange ? s.className : (sub.status === '未提出' ? '-' : sub.enrollmentClass)),
        inputMethod: sub.inputMethod,
        approvedBy: sub.approvedBy,
        remarks: sub.remarks,
        scanImageBlob: sub.scanImageBlob,
        history,
        submittedAt: sub.submittedAt,
        approvedAt: sub.approvedAt
      };
    });
  },

  /**
   * 日能研番号から生徒を取得
   */
  async findStudentByNichinokenId(projectId, nichinokenId) {
    const cleaned = (nichinokenId || '').trim().toUpperCase();
    return await db.students
      .where('projectId')
      .equals(projectId)
      .filter(s => s.nichinokenId.toUpperCase() === cleaned)
      .first();
  },

  /**
   * 生徒を1名プロジェクトに追加（初期未提出レコードも自動作成）
   */
  async addStudentToProject(projectId, { nichinokenId, name, nameKana = '', className }) {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    if (project.status === '完了') {
      throw new Error('このプロジェクトは「完了」しているため生徒を追加できません。「進行中に戻す」を行ってから操作してください。');
    }

    const cleanId = (nichinokenId || '').trim().toUpperCase();
    const cleanName = (name || '').trim();
    const cleanKana = (nameKana || '').trim();
    const cleanClass = (className || '').trim();

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
      className: cleanClass
    };

    const submissionRecord = {
      id: submissionId,
      projectId,
      studentId,
      status: '未提出',
      hasChange: false,
      enrollmentClass: '',
      inputMethod: '',
      approvedBy: '',
      remarks: '',
      history: [],
      submittedAt: null,
      approvedAt: null
    };

    await db.transaction('rw', db.students, db.submissions, async () => {
      await db.students.add(studentRecord);
      await db.submissions.add(submissionRecord);
    });

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
    const existingIdSet = new Set(existingStudents.map(s => s.nichinokenId.toUpperCase()));

    const toAddStudents = [];
    const toAddSubmissions = [];
    const addedList = [];
    const skippedList = [];

    const seenInBatch = new Set();

    for (const s of studentsArray) {
      const cleanId = (s.nichinokenId || '').trim().toUpperCase();
      const cleanName = (s.name || '').trim();
      const cleanKana = (s.nameKana || '').trim();
      const cleanClass = (s.className || '').trim();

      if (!cleanId || !cleanName || !cleanClass) {
        skippedList.push({ id: cleanId || '(不明)', name: cleanName, reason: '必須項目不足' });
        continue;
      }

      if (existingIdSet.has(cleanId) || seenInBatch.has(cleanId)) {
        skippedList.push({ id: cleanId, name: cleanName, reason: '番号が既存登録またはファイル内で重複' });
        continue;
      }

      seenInBatch.add(cleanId);

      const studentId = 'stu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

      const stuRec = {
        id: studentId,
        projectId,
        nichinokenId: cleanId,
        name: cleanName,
        nameKana: cleanKana,
        className: cleanClass
      };

      const subRec = {
        id: submissionId,
        projectId,
        studentId,
        status: '未提出',
        hasChange: false,
        enrollmentClass: '',
        inputMethod: '',
        approvedBy: '',
        remarks: '',
        history: [],
        submittedAt: null,
        approvedAt: null
      };

      toAddStudents.push(stuRec);
      toAddSubmissions.push(subRec);
      addedList.push(stuRec);
    }

    if (toAddStudents.length > 0) {
      await db.transaction('rw', db.students, db.submissions, async () => {
        await db.students.bulkAdd(toAddStudents);
        await db.submissions.bulkAdd(toAddSubmissions);
      });
    }

    return {
      addedCount: toAddStudents.length,
      skippedCount: skippedList.length,
      addedList,
      skippedList
    };
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
   * 提出結果の保存・承認更新（変更履歴も自動記録）
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
      remarks: submissionData.remarks !== undefined ? submissionData.remarks : (existing.remarks || ''),
      scanImageBlob: submissionData.scanImageBlob !== undefined ? submissionData.scanImageBlob : (existing.scanImageBlob || null)
    };

    currentHistory.push(newHistoryItem);

    // スキャン画像は、新しい指定があればそれ、指定がなければ既存のものを保持
    const scanImageToSave = submissionData.scanImageBlob !== undefined 
      ? submissionData.scanImageBlob 
      : (existing.scanImageBlob || null);

    await db.submissions.update(submissionId, {
      ...submissionData,
      scanImageBlob: scanImageToSave,
      history: currentHistory,
      status: submissionData.status || '承認済',
      approvedAt: submissionData.approvedAt || nowIso
    });
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

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        projects,
        students,
        submissions,
        settings
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

    const { projects, students, submissions, settings } = backupJson.data;

    await db.transaction('rw', db.projects, db.students, db.submissions, db.settings, async () => {
      await db.projects.clear();
      await db.students.clear();
      await db.submissions.clear();
      await db.settings.clear();

      if (projects?.length) await db.projects.bulkAdd(projects);
      if (students?.length) await db.students.bulkAdd(students);
      if (submissions?.length) await db.submissions.bulkAdd(submissions);
      if (settings?.length) await db.settings.bulkAdd(settings);
    });
  }
};
