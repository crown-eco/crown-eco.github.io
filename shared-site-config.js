window.ECOPITA_SITE = {"group":"crown","baseUrl":"https://crown-eco.github.io"};

// Site identity is a display hint; the server independently authorizes every group read.
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
  root.ECOPITA_SITE_ADMIN_GROUPS = function(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function(id, index, all) {
      return typeof id === 'string' && /^[a-z0-9_]+$/.test(id) && id !== 'main' && all.indexOf(id) === index;
    });
  };
  root.ECOPITA_SITE_GROUP_ADMIN = function(session) {
    if (!session) return false;
    if (Array.isArray(session.adminGroupIds) && root.ECOPITA_SITE.group !== 'main') {
      return root.ECOPITA_SITE_ADMIN_GROUPS(session.adminGroupIds).indexOf(root.ECOPITA_SITE.group) >= 0;
    }
    return session.groupAdmin === true;
  };
  root.ECOPITA_SITE_NOTICE = function(session) {
    if (!session) return false;
    var admin = session.isAdmin === true || String(session.role || '').toLowerCase() === 'admin';
    var group = typeof session.groupId === 'string' ? session.groupId.trim().toLowerCase() : 'main';
    if (!/^[a-z0-9_]+$/.test(group)) group = 'main';
    var managed = root.ECOPITA_SITE_ADMIN_GROUPS(session.adminGroupIds).indexOf(root.ECOPITA_SITE.group) >= 0;
    if (!root.ECOPITA_SITE_BLOCKED && (admin || group === root.ECOPITA_SITE.group || managed)) return false;
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

(function(root) {
  'use strict';
  var LABEL = "Crown";
  function mark() {
    try {
    var doc = root.document;
    if (doc.title.indexOf('【' + LABEL + '】') !== 0) doc.title = '【' + LABEL + '】' + doc.title;
    if (!doc.body || doc.getElementById('ecopita-group-site-band')) return;
    var band = doc.createElement('div');
    band.id = 'ecopita-group-site-band';
    band.textContent = LABEL + ' 用のサイトです';
    band.style.cssText = 'display:block;margin:0;padding:6px 12px;background:#7c2d12;color:#fff;font:bold 14px/1.4 sans-serif;text-align:center;letter-spacing:.05em;';
    doc.body.insertBefore(band, doc.body.firstChild);
    } catch (e) {}
  }
  try {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mark, { once: true });
    else mark();
  } catch (e) {}
})(window);
