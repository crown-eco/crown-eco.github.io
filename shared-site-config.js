window.ECOPITA_SITE = {"group":"crown","baseUrl":"https://crown-eco.github.io"};

// Site identity is presentation only; server authorization never uses this value.
(function(root) {
  'use strict';
  var MAIN_URL = '';
  var AUTH_URL = 'https://script.google.com/macros/s/AKfycbyvjri6i0fe11hzfoqfhSxWCsn1aP2WyT9ELZOzNMrVyEOx-ZsKqlhJQONzlaFLmPw/exec';
  var revoked = Object.create(null);
  var siteFetch = root.fetch;
  if (siteFetch) root.fetch = function(url, options) {
    if (root.ECOPITA_SITE_BLOCKED) return Promise.reject(new Error('このサイトは使えません。'));
    return siteFetch.call(this, url, options);
  };
  root.ECOPITA_SITE_URL = function(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '';
    value = value.trim().replace(/\/+$/, '');
    if (/[\s\\?#]/.test(value)) return '';
    var parts = /^https:\/\/([A-Za-z0-9.-]+)(?::([0-9]+))?((?:\/[A-Za-z0-9_~.-]+)*)$/.exec(value);
    if (!parts || parts[1].length > 253 || parts[1].split('.').some(function(label) { return label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label); }) ||
        parts[2] && (Number(parts[2]) < 1 || Number(parts[2]) > 65535) || /\/(?:\.|\.\.)(?:\/|$)/.test(parts[3])) return '';
    try {
      var url = new URL(value);
      if (url.hostname !== parts[1].toLowerCase()) return '';
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch(e) { return ''; }
  };
  root.ECOPITA_SITE_NOTICE = function(session) {
    if (!session) return false;
    var admin = session.isAdmin === true || String(session.role || '').toLowerCase() === 'admin';
    var group = typeof session.groupId === 'string' ? session.groupId.trim().toLowerCase() : 'main';
    if (!/^[a-z0-9_]+$/.test(group)) group = 'main';
    if (!root.ECOPITA_SITE_BLOCKED && (admin || group === root.ECOPITA_SITE.group)) return false;
    root.ECOPITA_SITE_BLOCKED = true;
    root.ECOPITA_SESSION = null;
    try { root.localStorage.removeItem('ecopita_session'); } catch(e) {}
    // Both deployments use the same session ledger. Revoke once, even if several
    // pending login responses or initialization paths reach this guard.
    if (session.token && !revoked[session.token]) {
      revoked[session.token] = true;
      try {
        var payload = { action: 'logout', sessionToken: session.token };
        var encoded = root.btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        siteFetch.call(root, AUTH_URL + '?_portal_data=' + encodeURIComponent(encoded), { redirect: 'follow', keepalive: true }).catch(function() {});
      } catch(e) {}
    }
    var doc = root.document;
    if (!doc.getElementById('ecopita-site-block-style')) {
      var style = doc.createElement('style');
      style.id = 'ecopita-site-block-style';
      style.textContent = 'body > :not(#ecopita-site-notice){display:none!important}body > #ecopita-site-notice{display:block!important}';
      doc.head.appendChild(style);
    }
    var target = group === 'main' ? MAIN_URL : root.ECOPITA_SITE_URL(session.groupSiteUrl);
    function render() {
      if (doc.getElementById('ecopita-site-notice')) return;
      var box = doc.createElement('div');
      box.id = 'ecopita-site-notice';
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:relative;z-index:100000;padding:18px;margin:12px;border:2px solid #0f766e;border-radius:12px;background:#fff;color:#18212f;font:16px/1.6 sans-serif;';
      var message = doc.createElement('p');
      message.textContent = target ? 'このサイトは使えません。こちらからログインしてください。' : 'このサイトは使えません。ログイン先のURLを管理者に確認してください。';
      box.appendChild(message);
      if (target) {
        var link = doc.createElement('a');
        link.href = target + '/login.html';
        link.textContent = target + '/login.html';
        box.appendChild(link);
      }
      doc.body.insertBefore(box, doc.body.firstChild);
    }
    if (root.document.body) render();
    else root.document.addEventListener('DOMContentLoaded', render, { once: true });
    return true;
  };
})(window);
