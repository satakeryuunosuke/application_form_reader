/**
 * 日能研番号および入力バリデーションユーティリティ
 */

export const Validator = {
  /**
   * 日能研番号の仕様検証
   * 例: TDN60013
   * - TD: 校舎コード（アルファベット2文字）
   * - N: 生徒区分（N: 室生, A: 外部生）
   * - 6: 学年（1〜6）
   * - 0013: 個人固有番号（4桁, 13の倍数）
   * 
   * @param {string} rawId
   * @returns {{ isValid: boolean, campus: string, type: string, grade: number, personalNum: number, reason?: string }}
   */
  validateNichinokenId(rawId) {
    if (!rawId || typeof rawId !== 'string') {
      return { isValid: false, reason: '番号が入力されていません' };
    }

    // 前後の空白やCode 39のアスタリスクを除去
    const cleaned = rawId.trim().replace(/^\*+|\*+$/g, '').toUpperCase();
    const regex = /^([A-Z]{2})([NA])([1-6])(\d{4})$/;
    const match = cleaned.match(regex);

    if (!match) {
      return {
        isValid: false,
        cleaned,
        reason: '形式が不正です（例: TDN60013 校舎2桁+N/A+学年1桁+番号4桁）'
      };
    }

    const [_, campus, type, gradeStr, numStr] = match;
    const grade = parseInt(gradeStr, 10);
    const personalNum = parseInt(numStr, 10);

    // チェックデジット（13の倍数）の検証
    if (personalNum % 13 !== 0) {
      return {
        isValid: false,
        cleaned,
        campus,
        type,
        grade,
        personalNum,
        reason: 'チェックデジットエラー: 下4桁が13の倍数ではありません'
      };
    }

    return {
      isValid: true,
      cleaned,
      campus,
      type,
      grade,
      personalNum
    };
  }
};
