/**
 * オフライン時または書き込み失敗時の未送信イベントキュー管理
 */

import { db } from '../db.js';

export const PendingQueue = {
  /**
   * 未送信イベントをキューに追加
   */
  async enqueue(projectId, event) {
    try {
      const id = await db.pendingEvents.add({
        projectId,
        eventId: event.eventId,
        event,
        timestamp: event.timestamp || Date.now(),
        createdAt: new Date().toISOString()
      });
      return id;
    } catch (err) {
      console.error('未送信キューへの追加失敗:', err);
      throw err;
    }
  },

  /**
   * キュー内の未送信イベントを共有フォルダへ一括フラッシュ
   * @param {Function} writeFn (projectId, event) => Promise<boolean> 書き込み成功時に true を返す関数
   * @returns {Promise<{ flushed: number, failed: number }>}
   */
  async flush(writeFn) {
    const items = await db.pendingEvents.orderBy('timestamp').toArray();
    let flushed = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const ok = await writeFn(item.projectId, item.event);
        if (ok) {
          await db.pendingEvents.delete(item.id);
          flushed++;
        } else {
          failed++;
        }
      } catch (err) {
        console.warn(`イベント ${item.eventId} の送信失敗:`, err);
        failed++;
      }
    }

    return { flushed, failed };
  },

  /**
   * 未送信イベント件数を取得
   */
  async getPendingCount(projectId = null) {
    try {
      if (projectId) {
        return await db.pendingEvents.where('projectId').equals(projectId).count();
      }
      return await db.pendingEvents.count();
    } catch (err) {
      console.warn('未送信件数取得失敗:', err);
      return 0;
    }
  },

  /**
   * 未送信イベント一覧を取得
   */
  async getPendingEvents(projectId = null) {
    try {
      if (projectId) {
        return await db.pendingEvents.where('projectId').equals(projectId).toArray();
      }
      return await db.pendingEvents.toArray();
    } catch (err) {
      console.warn('未送信イベント一覧取得失敗:', err);
      return [];
    }
  },

  /**
   * キューを全消去
   */
  async clear() {
    await db.pendingEvents.clear();
  }
};
