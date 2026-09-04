/**
 * アプリケーション バージョン & システム情報定義
 */

export const APP_VERSION = 'v1.2.0';
export const APP_BUILD_DATE = '2026-09-04';
export const APP_NAME = '受講確認票 処理システム';

export const SYSTEM_INFO = {
  name: APP_NAME,
  version: APP_VERSION,
  buildDate: APP_BUILD_DATE,
  storageType: 'ブラウザ内 IndexedDB (Dexie.js)',
  retentionPeriod: '3年間（超過時アーカイブ警告）',
  security: '完全クライアントサイド（外部通信ゼロ・個人情報保護）',
  features: [
    'CODE 39 バーコードアンカー相対座標読取',
    '進行中 / 完了ステータス管理 & 完了時編集ロック',
    '交換票（受講確認票）の共通既定書式設定 & キャリブレーション',
    'サーバーレス・ファイル共有同期（LAN共有フォルダ差分ログ連携）',
    'スキャン原票 2ペイン照合レビュー ＆ 不一致修正機能',
    '提出状況リアルタイム集計 & CSV / Excel (.xlsx) 出力',
    '完全ローカル バックアップ (JSON) & 復元'
  ]
};
