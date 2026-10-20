/**
 * アプリケーション初期ロード用グローバルエラートラップ
 */
(function() {
  window.addEventListener('error', function(e) {
    var c = document.getElementById('app-content');
    if (c && c.innerHTML.indexOf('アプリケーションを読み込み中') !== -1) {
      var safeMsg = (e.message || 'スクリプトの実行中にエラーが発生しました')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      var safeFile = ((e.filename ? e.filename.split('/').pop() : '') + ':' + (e.lineno || 0))
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      c.innerHTML =
        '<div class="card" style="margin: 40px auto; max-width: 600px; text-align: center; border-color: var(--danger-solid);">' +
          '<h3 style="color: var(--danger-solid); margin-bottom: 8px;">⚠️ アプリケーション起動エラー</h3>' +
          '<p style="color: var(--gray-700); font-size: 0.9rem; margin-bottom: 12px;">' + safeMsg + '</p>' +
          '<div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--gray-500); background: var(--gray-100); padding: 8px; border-radius: var(--radius-sm); word-break: break-all;">' +
            safeFile +
          '</div>' +
          '<button class="btn btn-primary btn-sm" id="btn-bootstrap-reload" style="margin-top: 16px;">ページの再読み込み（キャッシュ更新）</button>' +
        '</div>';
      var btn = document.getElementById('btn-bootstrap-reload');
      if (btn) {
        btn.onclick = function() {
          location.reload(true);
        };
      }
    }
  });
})();
