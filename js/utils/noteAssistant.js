/**
 * 特記事項・手書きメモ 意図解析スマートアシスタントモジュール
 * 
 * 特記事項テキストから「2科変更」「非受講」「他教室受講」などの典型的な変更意図を
 * 高速かつ軽量（Pure JS / 0ms / 0MB）に検出し、入力フォーム補助のアクションへ変換します。
 */

export const NoteAssistant = {
  /**
   * 特記事項テキストを解析し、受講確認・継続確認の変更アクションを返す
   * @param {string} text 特記事項の文字列
   * @param {Object} options コンテキストオプション（classList, changeOptions等）
   * @returns {Object} 解析結果
   */
  analyze(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return {
        hasAction: false,
        course: null,
        enrollmentChoice: null,
        classOption: null,
        campusName: null,
        summary: null,
        badgeText: null,
        badgeType: null
      };
    }

    const raw = text.trim();
    if (!raw) {
      return {
        hasAction: false,
        course: null,
        enrollmentChoice: null,
        classOption: null,
        campusName: null,
        summary: null,
        badgeText: null,
        badgeType: null
      };
    }

    // 全角英数・スペースの正規化
    const normalized = raw
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[\s\u3000]+/g, ' ');

    let hasAction = false;
    let course = null;
    let enrollmentChoice = null;
    let classOption = null;
    let campusName = null;
    const summaries = [];

    // 1. 非受講（不参加・辞退・キャンセル）の判定（最優先）
    const notEnrolledRegex = /(非受講|不参加|辞退|キャンセル|受けま?せん|受講し(ない|ません)|参加し(ない|ません)|欠席|取りやめ|受講中止)/i;
    if (notEnrolledRegex.test(normalized)) {
      hasAction = true;
      enrollmentChoice = 'has-change';
      classOption = '非受講';
      summaries.push('🚫 非受講');
    }

    // 2. 他教室・他校舎受講の判定
    const campusRegex = /(他教室|他校舎|他校|振替)/i;
    const campusNameMatch = normalized.match(/([^\s（()）]{1,10}(?:校|教室|校舎))[でにてへ]?受講/i)
      || normalized.match(/[（(]([^\s（()）]{1,10}(?:校|教室|校舎))[）)]/i);

    if (campusRegex.test(normalized) || campusNameMatch) {
      hasAction = true;
      enrollmentChoice = 'has-change';
      classOption = '他教室で受講';
      if (campusNameMatch && campusNameMatch[1]) {
        campusName = campusNameMatch[1].trim();
        summaries.push(`🏫 他教室受講（${campusName}）`);
      } else {
        summaries.push('🏫 他教室受講');
      }
    }

    // 3. 科目変更判定（2科 / 4科）
    const subject2Regex = /(2科|２科|二科|2教科|２教科|二教科|算国のみ|算・国のみ|算数・国語のみ)/;
    const subject4Regex = /(4科|４科|四科|4教科|４教科|四教科|4科すべて|４科すべて|全科目)/;

    // 「2科に変更」「2科受講」などの文脈確認
    if (subject2Regex.test(normalized) && !normalized.includes('4科から2科へ戻さない')) {
      hasAction = true;
      course = '2科';
      enrollmentChoice = 'has-change';
      summaries.push('📚 2科変更');
    } else if (subject4Regex.test(normalized)) {
      hasAction = true;
      course = '4科';
      enrollmentChoice = 'has-change';
      summaries.push('📚 4科変更');
    }

    // 4. 特定クラスへの変更判定（options.classList が渡されている場合）
    if (options.classList && Array.isArray(options.classList) && !classOption) {
      for (const cls of options.classList) {
        if (!cls) continue;
        const safeCls = String(cls).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const clsRegex = new RegExp(`(?:${safeCls}|${safeCls}クラス)(?:へ変更|に変更|希望)?`, 'i');
        if (clsRegex.test(normalized) && normalized.includes('変更')) {
          hasAction = true;
          enrollmentChoice = 'has-change';
          classOption = cls;
          summaries.push(`🏷️ ${cls}クラス変更`);
          break;
        }
      }
    }

    if (!hasAction) {
      return {
        hasAction: false,
        course: null,
        enrollmentChoice: null,
        classOption: null,
        campusName: null,
        summary: null,
        badgeText: null,
        badgeType: null
      };
    }

    // バッジ用テキストとスタイルの決定
    let badgeType = 'primary';
    if (classOption === '非受講') {
      badgeType = 'danger';
    } else if (classOption === '他教室で受講') {
      badgeType = 'info';
    } else if (course === '2科') {
      badgeType = 'primary';
    }

    const summaryText = summaries.join(' ＋ ');
    const badgeText = `🤖 特記事項連動: 【${summaryText}】を自動検出`;

    return {
      hasAction: true,
      course,
      enrollmentChoice,
      classOption,
      campusName,
      summary: summaryText,
      badgeText,
      badgeType
    };
  }
};
