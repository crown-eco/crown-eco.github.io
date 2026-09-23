/**
 * shared-auth.js — 全ページ共通認証チェック
 *
 * 各HTMLの <head> 内または <body> 冒頭で読み込む。
 * セッションが無ければ login.html にリダイレクト。
 * ログイン済みなら window.ECOPITA_SESSION にセッション情報をセット。
 *
 * 使い方:
 *   <script src="./shared-auth.js"></script>
 *
 * ページ側から参照:
 *   window.ECOPITA_SESSION.staffId
 *   window.ECOPITA_SESSION.displayName
 *   window.ECOPITA_SESSION.token
 *   window.ECOPITA_SESSION.rewardHidden
 *   window.ECOPITA_SESSION.canUseRm
 *   window.ECOPITA_SESSION.casePrefixes
 *   window.ECOPITA_SESSION.groupId
 *   window.ECOPITA_SESSION.groupAdmin
 */
(function() {
  'use strict';

  var LOGIN_URL = window.ECOPITA_SITE.baseUrl + '/login.html';

  // privacy.html はログイン不要（注文フォームからリンクで飛ぶため）
  var currentPath = decodeURIComponent(location.pathname).toLowerCase();
  // This site has no reward screen yet, including for global administrators.
  if (currentPath.endsWith('/reward.html') && window.ECOPITA_SITE.group !== 'main') return;
  if (currentPath.indexOf('login.html') > -1) return; // login.html自身はスキップ
  if (currentPath.indexOf('privacy.html') > -1) {
    // privacy.html は直接アクセス → index.htmlにリダイレクト
    // ただしリファラーが同一ドメインならそのまま表示（フォーム内リンクから来た場合）
    var ref = document.referrer || '';
    var fromSite = false;
    try { var refUrl = new URL(ref); fromSite = refUrl.origin === new URL(window.ECOPITA_SITE.baseUrl).origin || refUrl.hostname === 'localhost'; } catch(e) {}
    if (!fromSite) {
      location.href = window.ECOPITA_SITE.baseUrl + '/index.html';
      return;
    }
    return; // フォームから来た場合はそのまま表示
  }

  // セッション確認
  var raw = localStorage.getItem('ecopita_session');
  var session = null;
  if (raw) {
    try { session = JSON.parse(raw); } catch(e) { session = null; }
  }

  if (!session || !session.token || !session.staffId) {
    redirectToLogin();
    return;
  }

  // フロント側の期限チェック（GAS側でも検証するが、UX改善のため）
  if (session.expiresAt && Date.now() > session.expiresAt) {
    localStorage.removeItem('ecopita_session');
    redirectToLogin();
    return;
  }

  // 所属は保存された表示用情報だけ。既存の認可・管理者判定には使わない。
  var groupId = typeof session.groupId === 'string' ? session.groupId.trim().toLowerCase() : '';
  session.groupId = /^[a-z0-9_]+$/.test(groupId) ? groupId : 'main';
  session.groupAdmin = session.groupAdmin === true;
  session.groupSiteUrl = window.ECOPITA_SITE_URL(session.groupSiteUrl);

  // サイト不一致は公開前に止め、保存済みtokenも失効要求する。
  if (window.ECOPITA_SITE_NOTICE(session)) return;
  // セッション有効 → グローバルに公開
  window.ECOPITA_SESSION = session;

  // 案件prefixはサーバーがセッション確立時に返した配列を正本にする。
  // RMだけは明示的なcanUseRm（または管理者role）のみで追加し、旧セッションはfail-closed。
  var CASE_PREFIXES_FALLBACK = ['YA', 'HM', 'CP', 'EC', 'HC'];
  function sessionCanUseRm_() {
    return session.canUseRm === true || session.isAdmin === true ||
      String(session.role || '').toLowerCase() === 'admin';
  }

  function validCasePrefixes_(value) {
    if (!Array.isArray(value) || value.length === 0) value = CASE_PREFIXES_FALLBACK;
    var result = [];
    value.forEach(function(prefix) {
      var normalized = String(prefix || '').trim().toUpperCase();
      if (normalized === 'RM') return;
      if (!/^[A-Z]{2}$/.test(normalized) || result.indexOf(normalized) >= 0) return;
      result.push(normalized);
    });
    if (!result.length) result = CASE_PREFIXES_FALLBACK.slice();
    if (sessionCanUseRm_()) result.push('RM');
    return result;
  }

  function applyCasePrefixes_() {
    var prefixes = validCasePrefixes_(session.casePrefixes);
    var selects = document.querySelectorAll('[data-ecopita-case-prefixes]');
    for (var i = 0; i < selects.length; i++) {
      var select = selects[i];
      var previous = String(select.value || '').toUpperCase();
      while (select.firstChild) select.removeChild(select.firstChild);
      prefixes.forEach(function(prefix) {
        var option = document.createElement('option');
        option.value = prefix;
        option.textContent = prefix;
        select.appendChild(option);
      });
      select.value = prefixes.indexOf(previous) >= 0 ? previous : prefixes[0];
    }
  }
  window.ECOPITA_APPLY_CASE_PREFIXES = applyCasePrefixes_;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyCasePrefixes_);
  } else {
    applyCasePrefixes_();
  }

  // ログアウトボタンとユーザー表示を挿入
  insertUserBar();

  function redirectToLogin() {
    var redirect = encodeURIComponent(location.href);
    location.href = LOGIN_URL + '?redirect=' + redirect;
  }

  function insertUserBar() {
    // ページのDOMが準備できてから挿入
    function doInsert() {
      // 既に挿入済みなら何もしない
      if (document.getElementById('ecopita-user-bar')) return;

      var bar = document.createElement('div');
      bar.id = 'ecopita-user-bar';
      bar.style.cssText = 'background:#f0f4f8;padding:8px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;border-bottom:1px solid #dce1e8;';
      bar.innerHTML = '<span style="color:#333;font-weight:600">' + escHtml(session.displayName) + '（' + escHtml(session.staffId) + '）</span>'
        + '<button onclick="(function(){localStorage.removeItem(\'ecopita_session\');location.href=\'' + LOGIN_URL + '?redirect=\'+encodeURIComponent(location.href);})()" '
        + 'style="background:#e0e0e0;border:none;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;color:#555">ログアウト</button>';

      // hero要素の直後、またはbodyの先頭に挿入
      var hero = document.querySelector('.hero, .header, .topbar, .lcard-hdr');
      if (hero && hero.parentElement) {
        hero.parentElement.insertBefore(bar, hero.nextSibling);
      } else {
        document.body.insertBefore(bar, document.body.firstChild);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doInsert);
    } else {
      doInsert();
    }
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // GAS API呼び出し時にsessionTokenを自動注入＋セッション切れ自動検出
  // 最適化: GAS URL のみ介入（zipcloud 等外部APIには触らない）
  var _origFetch = window.fetch;
  function _isGasApiUrl(url) {
    if (!url) return false;
    var s = typeof url === 'string' ? url : (url.url || '');
    return s.indexOf('script.google.com') !== -1 || s.indexOf('googleusercontent') !== -1;
  }
  window.fetch = function(url, opts) {
    var isGas = _isGasApiUrl(url);
    if (isGas && opts && opts.body && typeof opts.body === 'string' && session.token) {
      try {
        var body = JSON.parse(opts.body);
        if (body.form_type && !body.sessionToken) {
          body.sessionToken = session.token;
          opts = Object.assign({}, opts, { body: JSON.stringify(body) });
        }
      } catch(e) {}
    }
    var p = _origFetch.call(window, url, opts);
    if (!isGas) return p; // 外部APIには後処理挟まず即return
    return p.then(function(res) {
      // GAS側がセッション無効を返した時、自動で再ログインモーダル表示
      try {
        var ct = (res.headers && res.headers.get('content-type')) || '';
        if (ct.indexOf('json') !== -1) {
          res.clone().json().then(function(data) {
            var msg = (data && (data.error || data.reason || data.message)) || '';
            if (typeof msg === 'string' && (
              msg.indexOf('セッション無効') !== -1 ||
              msg.indexOf('セッション切れ') !== -1 ||
              msg.indexOf('セッションが切れ') !== -1 ||
              msg === 'invalid_session_token' ||
              msg === 'invalid_pass_token'
            )) {
              if (window.ECOPITA_RELOGIN && !window._ecopitaReloginShown) {
                window._ecopitaReloginShown = true;
                window.ECOPITA_RELOGIN();
              }
            }
          }).catch(function(){});
        }
      } catch(e) {}
      return res;
    });
  };

  // セッション切れ時のモーダル再ログイン
  window.ECOPITA_RELOGIN = function(callback) {
    // APIレスポンスで「セッション切れ」が返った時に呼ぶ
    // モーダルでログインフォームを表示し、ログイン成功後にcallbackを呼ぶ
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:90%;max-width:380px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;';
    modal.innerHTML = '<h3 style="margin-bottom:16px;color:#c62828">セッションが切れました</h3>'
      + '<p style="font-size:14px;color:#555;margin-bottom:16px">もう一度ログインしてください</p>'
      + '<button onclick="localStorage.removeItem(\'ecopita_session\');location.href=\'' + LOGIN_URL + '?redirect=' + encodeURIComponent(location.href) + '\'" '
      + 'style="background:#0055a4;color:#fff;border:none;border-radius:10px;padding:12px 32px;font-size:15px;font-weight:700;cursor:pointer">ログイン画面へ</button>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  };
})();
