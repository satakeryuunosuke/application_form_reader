/**
 * 共有フォルダ接続・パーミッション管理（File System Access API）
 * 社内LANのファイルサーバーやローカル共有フォルダへの接続・切断・永続化を担当
 */

import { db } from '../db.js';

export const FolderConnector = {
  currentHandle: null,
  folderName: '',

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
   * 保存済みハンドルから接続を復元する
   * @returns {Promise<boolean>} 復元に成功したかどうか
   */
  async restore() {
    if (!this.isSupported()) return false;

    try {
      const stored = await db.appState.get('sharedFolderHandle');
      if (!stored || !stored.handle) return false;

      const handle = stored.handle;
      // パーミッションの確認（ユーザー操作なしでは queryPermission のみ実行）
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') {
        this.currentHandle = handle;
        this.folderName = handle.name;
        return true;
      }

      // 'prompt' の場合は requestPermission が必要（ユーザーのクリック操作時に呼ぶ）
      this.currentHandle = handle;
      this.folderName = handle.name;
      return false; // 要ユーザー認可
    } catch (err) {
      console.warn('フォルダハンドルの復元に失敗しました:', err);
      return false;
    }
  },

  /**
   * ユーザーのクリック操作を伴ってパーミッションを再要求する
   * @returns {Promise<boolean>}
   */
  async requestPermission() {
    if (!this.currentHandle) return false;
    try {
      const state = await this.currentHandle.requestPermission({ mode: 'readwrite' });
      return state === 'granted';
    } catch (err) {
      console.error('パーミッション要求エラー:', err);
      return false;
    }
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
    try {
      await db.appState.delete('sharedFolderHandle');
    } catch (err) {
      console.warn('保存済みハンドルの削除エラー:', err);
    }
  },

  /**
   * 現在接続中かどうか
   */
  isConnected() {
    return this.currentHandle !== null;
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
