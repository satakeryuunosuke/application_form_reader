/**
 * 志望校別講座・読取枠の一括選択＆一括テキスト追加コンポーネント (Preact + HTM)
 */

import { html, render, useState } from '../framework.js';
import { UI } from '../utils/ui.js';

function BulkCoursePickerApp({ coursePresets = [], methodPresets = [], existingLabels = [], onBulkAdd }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState('matrix'); // 'matrix' | 'paste'
  const [selectedMethod, setSelectedMethod] = useState(methodPresets[0] || '');
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [pasteText, setPasteText] = useState('');
  const [layoutCols, setLayoutCols] = useState(1);

  const toggleCourse = (c) => {
    setSelectedCourses(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  const selectAllCourses = () => {
    setSelectedCourses([...coursePresets]);
  };

  const clearAllCourses = () => {
    setSelectedCourses([]);
  };

  const handleMatrixAdd = () => {
    if (selectedCourses.length === 0) {
      UI.showToast('追加する講座にチェックを入れてください', 'warning');
      return;
    }
    const labels = selectedCourses.map(c =>
      selectedMethod ? `${c}（${selectedMethod}）` : c
    );
    onBulkAdd(labels, layoutCols);
    setSelectedCourses([]);
  };

  const handlePasteAdd = () => {
    const raw = pasteText.trim();
    if (!raw) {
      UI.showToast('講座・項目名を入力（または貼り付け）してください', 'warning');
      return;
    }
    const labels = raw
      .split(/[\r\n,、]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (labels.length === 0) {
      UI.showToast('有効な項目名が見つかりませんでした', 'warning');
      return;
    }
    onBulkAdd(labels, layoutCols);
    setPasteText('');
  };

  return html`
    <div class="bulk-course-picker-wrap" style="margin-bottom: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: var(--radius-sm); padding: 8px 12px;">
        <div style="font-size: 0.82rem; color: #4c1d95; font-weight: 700; display: flex; align-items: center; gap: 6px;">
          <span>⚡ クイック一括追加（v2.0）</span>
          <span style="font-weight: normal; color: #5b21b6; font-size: 0.78rem;">
            複数の志望校別講座をチェック選択またはコピペでまとめて一括登録＆等間隔配置できます
          </span>
        </div>
        <button
          type="button"
          id="btn-toggle-bulk-course-picker"
          class="btn btn-primary btn-sm"
          style="background: #6d28d9; border-color: #5b21b6; font-size: 0.78rem; padding: 3px 10px; white-space: nowrap;"
          onClick=${() => setIsOpen(!isOpen)}
        >
          ${isOpen ? '▲ 一括追加パネルを閉じる' : '⚡ 複数講座をまとめて一括追加...'}
        </button>
      </div>

      ${isOpen && html`
        <div id="bulk-course-picker-panel" style="background: #ffffff; border: 1.5px solid #c4b5fd; border-top: none; border-radius: 0 0 var(--radius-sm) var(--radius-sm); padding: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; gap: 6px;">
              <button
                type="button"
                id="btn-bulk-mode-matrix"
                class="btn ${tab === 'matrix' ? 'btn-primary' : 'btn-secondary'} btn-sm"
                style="font-size: 0.78rem; padding: 3px 10px;"
                onClick=${() => setTab('matrix')}
              >
                ☑️ 講座マスタからチェック選択
              </button>
              <button
                type="button"
                id="btn-bulk-mode-text"
                class="btn ${tab === 'paste' ? 'btn-primary' : 'btn-secondary'} btn-sm"
                style="font-size: 0.78rem; padding: 3px 10px;"
                onClick=${() => setTab('paste')}
              >
                📋 テキスト・Excelから一括貼付
              </button>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: var(--gray-700);">
              <span class="font-bold">追加時の初期配置:</span>
              <select
                class="form-control"
                style="width: auto; height: 28px; padding: 2px 8px; font-size: 0.78rem;"
                value=${layoutCols}
                onChange=${(e) => setLayoutCols(parseInt(e.target.value, 10))}
              >
                <option value="1">縦1列で等間隔配置</option>
                <option value="2">左右2列グリッドで配置</option>
                <option value="3">3列グリッドで配置</option>
              </select>
            </div>
          </div>

          ${tab === 'matrix' ? html`
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--gray-700);">1. 付与する受講方法:</span>
                <button
                  type="button"
                  class="btn ${selectedMethod === '' ? 'btn-primary' : 'btn-secondary'} btn-sm"
                  style="padding: 2px 8px; font-size: 0.75rem;"
                  onClick=${() => setSelectedMethod('')}
                >
                  なし（講座名のみ）
                </button>
                ${methodPresets.map(m => html`
                  <button
                    type="button"
                    key=${m}
                    class="btn ${selectedMethod === m ? 'btn-primary' : 'btn-secondary'} btn-sm"
                    style="padding: 2px 8px; font-size: 0.75rem;"
                    onClick=${() => setSelectedMethod(m)}
                  >
                    ${m}
                  </button>
                `)}
              </div>

              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--gray-700);">
                  2. 追加する講座をチェック (${selectedCourses.length} 件選択中):
                </span>
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="btn btn-ghost btn-sm" style="padding: 1px 6px; font-size: 0.74rem;" onClick=${selectAllCourses}>全選択</button>
                  <button type="button" class="btn btn-ghost btn-sm" style="padding: 1px 6px; font-size: 0.74rem;" onClick=${clearAllCourses}>全解除</button>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; max-height: 160px; overflow-y: auto; padding: 8px; background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-sm); margin-bottom: 10px;">
                ${coursePresets.map(c => {
                  const fullLabel = selectedMethod ? `${c}（${selectedMethod}）` : c;
                  const alreadyExists = existingLabels.includes(fullLabel);
                  const checked = selectedCourses.includes(c);
                  return html`
                    <label
                      key=${c}
                      style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; padding: 4px 6px; border-radius: 4px; cursor: pointer; background: ${checked ? '#ede9fe' : '#ffffff'}; border: 1px solid ${checked ? '#8b5cf6' : 'var(--gray-200)'}; opacity: ${alreadyExists ? '0.55' : '1'};"
                    >
                      <input
                        type="checkbox"
                        checked=${checked}
                        onChange=${() => toggleCourse(c)}
                      />
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title=${fullLabel}>
                        ${c}${alreadyExists ? ' (済)' : ''}
                      </span>
                    </label>
                  `;
                })}
              </div>

              <div style="display: flex; justify-content: flex-end;">
                <button
                  type="button"
                  id="btn-exec-bulk-add"
                  class="btn btn-primary btn-sm"
                  style="font-weight: 700;"
                  onClick=${handleMatrixAdd}
                >
                  ⚡ 選択した ${selectedCourses.length} 講座を一括追加する
                </button>
              </div>
            </div>
          ` : html`
            <div>
              <p style="font-size: 0.78rem; color: var(--gray-600); margin-bottom: 6px;">
                改行またはカンマ区切りで複数の講座名・チェック項目名を入力すると、一度にすべての読取枠を作成します。
              </p>
              <textarea
                id="inp-bulk-course-text"
                class="form-control"
                rows="3"
                placeholder="例:&#10;開成日特（本科）&#10;麻布日特（本科）&#10;桜蔭日特（本科）"
                style="font-size: 0.82rem; margin-bottom: 8px;"
                value=${pasteText}
                onInput=${(e) => setPasteText(e.target.value)}
              ></textarea>
              <div style="display: flex; justify-content: flex-end;">
                <button
                  type="button"
                  id="btn-exec-bulk-add"
                  class="btn btn-primary btn-sm"
                  style="font-weight: 700;"
                  onClick=${handlePasteAdd}
                >
                  ⚡ 入力した項目を一括追加する
                </button>
              </div>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}

export function mountBulkCoursePicker(container, props) {
  if (!container) return;
  render(html`<${BulkCoursePickerApp} ...${props} />`, container);
}
