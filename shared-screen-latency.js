(function(root) {
  'use strict';
  // Diagnostic values only. Never copy request/response bodies or identifiers.
  var scenes = ['order', 'estimate', 'receipt_lookup', 'receipt', 'quote_lookup', 'quote',
    'contract_list', 'generate_doc', 'bootstrap', 'changeDate', 'company_dashboard',
    'business_portal_login_cache_hit', 'business_portal_login_cache_miss',
    'business_portal_json_cache_hit', 'business_portal_json_cache_miss',
    'business_portal_cases_cache_hit', 'business_portal_cases_cache_miss'];
  function now() { return root.performance.now(); }
  function valid(value) { return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 600000; }
  function begin() { try { return { start: now(), ended: false }; } catch (ignored) { return null; } }
  function finish(operation, response, options) {
    try {
      if (!operation || operation.ended) return;
      operation.ended = true;
      var sample = response && response._latency_sample;
      if (!sample || scenes.indexOf(sample.scene) < 0 || !valid(sample.server_ms)) return;
      // Snapshot only the fixed diagnostic fields; don't retain the business DTO.
      var scene = sample.scene, serverMs = sample.server_ms;
      options = options || {};
      var endpoint = options.url, portal = options.portal === true;
      var credential = options.token || (root.ECOPITA_SESSION && root.ECOPITA_SESSION.token);
      if (!credential || !endpoint) return;
      // Two frames allow the DOM result to paint before measuring and sending.
      // Hidden tabs have no visible result, so don't manufacture a timing sample.
      root.requestAnimationFrame(function() {
        try { root.requestAnimationFrame(function() {
          try {
            if (root.document && root.document.hidden) return;
            var browserMs = Math.round(now() - operation.start);
            if (!valid(browserMs) || browserMs < serverMs) return;
            var fields = { scene: scene, browser_ms: browserMs, server_ms: serverMs };
            var request;
            if (portal) {
              var query = new URLSearchParams({ mode: 'latency_browser', token: credential,
                scene: scene, browser_ms: String(browserMs), server_ms: String(serverMs) });
              endpoint += (endpoint.indexOf('?') < 0 ? '?' : '&') + query.toString();
              request = { redirect: 'follow' };
            } else {
              fields.form_type = 'latency_browser'; fields.sessionToken = credential;
              request = { method: 'POST', body: JSON.stringify(fields), redirect: 'follow' };
            }
            // Deliberately not awaited; telemetry can never delay the business UI.
            Promise.resolve(root.fetch(endpoint, request)).catch(function() {});
          } catch (ignored) {}
        }); } catch (ignored) {}
      });
    } catch (ignored) {}
  }
  root.ECOPITA_SCREEN_LATENCY = { begin: begin, finish: finish };
})(window);
