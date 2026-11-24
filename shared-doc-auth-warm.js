(function(root) {
  'use strict';
  var lastToken, lastAt;
  root.ecopitaWarmDocumentSession = function(url) {
    try {
      var session = root.ECOPITA_SESSION, now = Date.now();
      if (!session || !session.token || (lastToken === session.token && now - lastAt <= 240000)) return;
      lastToken = session.token;
      lastAt = now;
      var endpoint = url || 'https://script.google.com/macros/s/AKfycbyvjri6i0fe11hzfoqfhSxWCsn1aP2WyT9ELZOzNMrVyEOx-ZsKqlhJQONzlaFLmPw/exec';
      Promise.resolve(root.fetch(endpoint, {method:'POST', body:JSON.stringify({form_type:'order_auth_warm', sessionToken:session.token})})).catch(function() {});
    } catch (_) {}
  };
})(window);
