/**
 * 共有フォルダ接続・パーミッション管理（File System Access API）
 * 社内LANのファイルサーバーやローカル共有フォルダへの接続・切断・永続化を担当
 */

import { db } from '../db.js';

export const FolderConnector = {
  currentHandle: null,
  folderName: '',
  permissionGranted: false,

  /**
   * File System Access API がサポートされているか判定
   */
  isSupported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  },

  /**
   * 共有フォルダの接続ダイアログを開き、ハンドルを取得・保存する
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  async connect() {
    if (!this.isSupported()) {
      throw new Error('お使いのブラウザは File System Access API に対応していません。Google Chrome または Microsoft Edge をご利用ください。');
    }

    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });

      // 読み書き権限を確認
      const permission = await this.verifyPermission(handle, true);
      if (!permission) {
        throw new Error('共有フォルダへの読み書き権限が許可されませんでした。');
      }

      this.currentHandle = handle;
      this.folderName = handle.name;
      this.permissionGranted = true;

      // IndexedDB の appState テーブルに保存（ブラウザ再起動後の復元用）
      await this.saveHandleToStorage(handle);

      return handle;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('フォルダの選択がキャンセルされました。');
      }
      throw err;
    }
  },

  /**
   * 保存済みハンドルから接続を復元する（起動時・ページロード時）
   * @returns {Promise<boolean>} 復元および書き込み権限の確認に成功したかどうか
   */
  async restore() {
    if (!this.isSupported()) return false;

    try {
      const stored = await db.appState.get('sharedFolderHandle');
      if (!stored || !stored.handle) {
        this.currentHandle = null;
        this.folderName = '';
        this.permissionGranted = false;
        return false;
      }

      const handle = stored.handle;
      this.currentHandle = handle;
      this.folderName = stored.name || handle.name;

      // パーミッションの確認（ユーザー操作なしでは queryPermission のみ実行）
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') {
        this.permissionGranted = true;
        return true;
      }

      // 'prompt' または 'denied' の場合はユーザー操作による再認可（ensurePermission）が必要
      this.permissionGranted = false;
      return false; // 要ユーザー認可
    } catch (err) {
      console.warn('フォルダハンドルの復元に失敗しました:', err);
      this.currentHandle = null;
      this.folderName = '';
      this.permissionGranted = false;
      return false;
    }
  },

  /**
   * ユーザーのクリック操作を伴ってパーミッションを確実に要求・昇格する
   * （ブラウザ再起動後の 'prompt' 状態の復旧や書き込み直前チェック用）
   * @param {boolean} withWrite
   * @returns {Promise<boolean>}
   */
  async ensurePermission(withWrite = true) {
    if (!this.currentHandle) return false;
    try {
      const opts = { mode: withWrite ? 'readwrite' : 'read' };
      const current = await this.currentHandle.queryPermission(opts);
      if (current === 'granted') {
        this.permissionGranted = true;
        return true;
      }

      const requestResult = await this.currentHandle.requestPermission(opts);
      if (requestResult === 'granted') {
        this.permissionGranted = true;
        return true;
      }

      this.permissionGranted = false;
      return false;
    } catch (err) {
      console.warn('パーミッション確認/要求エラー:', err);
      this.permissionGranted = false;
      return false;
    }
  },

  /**
   * 互換用エイリアス
   */
  async requestPermission() {
    return await this.ensurePermission(true);
  },

  /**
   * 読み書き権限を確認・要求するヘルパー
   */
  async verifyPermission(handle, withWrite = true) {
    const opts = { mode: withWrite ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') {
      return true;
    }
    if ((await handle.requestPermission(opts)) === 'granted') {
      return true;
    }
    return false;
  },

  /**
   * 接続解除（ハンドル破棄）
   */
  async disconnect() {
    this.currentHandle = null;
    this.folderName = '';
    this.permissionGranted = false;
    try {
      await db.appState.delete('sharedFolderHandle');
    } catch (err) {
      console.warn('保存済みハンドルの削除エラー:', err);
    }
  },

  /**
   * 現在、共有フォルダに正常にアクセス（読み書き権限が付与）可能かどうか
   */
  isConnected() {
    return this.currentHandle !== null && this.permissionGranted === true;
  },

  /**
   * 以前接続したフォルダがIndexedDBまたはメモリ上に保存されているか（権限保留中含む）
   */
  hasSavedFolder() {
    return this.currentHandle !== null;
  },

  /**
   * フォルダハンドルは保存されているが、ブラウザ再起動等によりアクセス許可が保留（prompt）状態か
   */
  isPermissionPending() {
    return this.currentHandle !== null && !this.permissionGranted;
  },

  /**
   * 現在のディレクトリハンドルを返す
   */
  getDirHandle() {
    return this.currentHandle;
  },

  /**
   * 現在のフォルダ名を返す
   */
  getFolderName() {
    return this.folderName || (this.currentHandle ? this.currentHandle.name : '');
  },

  /**
   * ハンドルを IndexedDB に保存
   */
  async saveHandleToStorage(handle) {
    try {
      await db.appState.put({
        key: 'sharedFolderHandle',
        handle: handle,
        name: handle.name,
        connectedAt: new Date().toISOString()
      });
    } catch (err) {
      console.warn('ハンドルのIndexedDB保存に失敗しました:', err);
    }
  }
};
