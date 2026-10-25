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
  var active = null, responses = new WeakMap();
  function begin() {
    try {
      if (active) active.ambiguous = true;
      active = { start: now(), ended: false, calls: 0, records: [], spans: [], spanCount: 0 };
      return active;
    } catch (ignored) { return null; }
  }
  function capture() { return active && !active.ended ? active : null; }
  function startCall(operation) {
    try {
      if (!operation || operation.ended || operation.ambiguous) return null;
      operation.calls++;
      if (operation.records.length >= 20) return null;
      var record = { operation: operation, start: now() };
      operation.records.push(record); return record;
    } catch (ignored) { return null; }
  }
  function endCall(record, response) {
    try {
      if (!record || record.operation.ended) return;
      record.end = now();
      if (response && typeof response === 'object') responses.set(response, record);
    } catch (ignored) {}
  }
  function bind(response, record) {
    try { if (record && response && typeof response === 'object') responses.set(response, record); } catch (ignored) {}
  }
  function bindResponse(value, response) {
    try { bind(value, responses.get(response)); } catch (ignored) {}
    return value;
  }
  function mark(operation, kind) {
    try {
      if (!operation || operation.ended || ['recaptcha', 'user_wait', 'retry_wait'].indexOf(kind) < 0) return null;
      if (++operation.spanCount > 60) { operation.ambiguous = true; return null; }
      return { operation: operation, kind: kind, start: now() };
    } catch (ignored) { return null; }
  }
  function endMark(span) {
    try { if (span && !span.done && !span.operation.ended) { span.done = true; span.end = now(); span.operation.spans.push(span); } } catch (ignored) {}
  }
  function union(intervals) {
    var end = -Infinity, sum = 0;
    intervals.slice().sort(function(a,b) { return a[0]-b[0]; }).forEach(function(r) {
      sum += Math.max(0,r[1]-Math.max(end,r[0])); end = Math.max(end,r[1]);
    }); return sum;
  }
  function breakdown(operation, main, serverMs, end) {
    if (operation.ambiguous || !operation.records.length) return null;
    var first = operation.records[0].start;
    var all = [], fetches = [], values = { schema: 1, calls: operation.calls, truncated: Math.max(0,operation.calls-20) };
    function interval(start, stop) {
      if (!valid(start-operation.start) || !valid(stop-start) || stop>end) throw Error('invalid clock');
      return [start, stop];
    }
    values.pre_ms = first-operation.start; all.push(interval(operation.start,first));
    values.fetch_total_ms = 0; values.pending_calls = 0;
    operation.records.forEach(function(r) {
      if (typeof r.end !== 'number') { values.pending_calls++; return; }
      var i = interval(r.start,r.end); fetches.push(i); all.push(i); values.fetch_total_ms += r.end-r.start;
    });
    values.fetch_wall_ms = union(fetches);
    ['recaptcha','user_wait','retry_wait'].forEach(function(kind) {
      var spans = operation.spans.filter(function(s) { return s.kind===kind; });
      if (kind==='recaptcha' && !spans.length) return;
      values[kind+'_ms'] = spans.reduce(function(sum,s) { var i=interval(s.start,s.end); if(kind!=='recaptcha')all.push(i); return sum+s.end-s.start; },0);
    });
    var last = operation.records.reduce(function(n,r) { return typeof r.end==='number'?Math.max(n,r.end):n; },first);
    if (values.truncated || values.pending_calls) last = operation.finishedAt;
    values.render_ms = end-last; all.push(interval(last,end));
    values.other_ms = end-operation.start-union(all);
    if (main && main.operation===operation && typeof main.end==='number' && main.end-main.start>=serverMs) {
      values.main_fetch_ms=main.end-main.start; values.transport_ms=values.main_fetch_ms-serverMs;
    }
    Object.keys(values).forEach(function(key) { values[key]=Math.round(values[key]); if(!valid(values[key]))throw Error('invalid duration'); });
    return values;
  }
  // Only new Pages with an active, visible, consumed request opt in. Old library
  // versions have no hooks and keep the server's synchronous recording.
  function relayRequest(operation, url, request) {
    try {
      if (!operation || operation.ended || operation.ambiguous || (root.document && root.document.hidden)) return null;
      if (typeof root.setTimeout !== 'function' || typeof root.fetch !== 'function') return null;
      var target = new URL(String(url), root.location && root.location.href), wire = Object.assign({}, request || {});
      var method = String(wire.method || 'GET').toUpperCase(), data, portal = false, encoded = false;
      if (method === 'POST') {
        // The business request must already be materialized to fetch; its size is
        // not the bounded telemetry cache payload. Large photo/signature calls opt in too.
        if (typeof wire.body !== 'string') return null;
        data = JSON.parse(wire.body);
      } else if (method === 'GET') {
        if (target.searchParams.has('_portal_data')) {
          data = JSON.parse(decodeURIComponent(escape(root.atob(target.searchParams.get('_portal_data'))))); encoded = true;
        } else { data = Object.fromEntries(target.searchParams); portal = true; }
      } else return null;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      var ft = String(data.form_type || ''), action = String(data.action || ''), mode = String(data.mode || '');
      // These business calls consume JSON in shared-gas-call. order_async and
      // other fire-and-forget endpoints are deliberately not in this list.
      var accepted = portal ? ['json','cases','group_reward'].indexOf(mode)>=0 :
        ['order','estimate','receipt_lookup','receipt','quote_lookup','quote','contract_list','generate_doc'].indexOf(ft)>=0 ||
        ((!ft || ft==='portal_api') && ['bootstrap','changeDate','viewReferree','company_dashboard'].indexOf(action)>=0);
      if (!accepted) return null;
      data = Object.assign({}, data, {_latency_relay:1});
      if (method === 'POST') wire.body = JSON.stringify(data);
      else if (encoded) target.searchParams.set('_portal_data', root.btoa(unescape(encodeURIComponent(JSON.stringify(data)))));
      else target.searchParams.set('_latency_relay','1');
      return {url:target.toString(), request:wire, endpoint:target.origin+target.pathname, portal:portal,
        token:typeof data.sessionToken === 'string' && data.sessionToken ? data.sessionToken : (typeof data.token === 'string' ? data.token : '')};
    } catch (ignored) { return null; }
  }
  function relayResponse(context, value) {
    try {
      // Parsing text is restricted to this already-opted-in request.
      if (typeof value === 'string') value = JSON.parse(value);
      var receipt = value && value._latency_receipt;
      if (!context || context.sent || typeof receipt !== 'string' || !/^[a-f0-9]{64}$/.test(receipt)) return;
      context.sent = true;
      var sent = false;
      function send() {
        if (sent) return; sent = true;
        try {
          var endpoint = context.endpoint, fields = {_latency_receipt:receipt}, request;
          if (context.portal) {
            fields.mode = 'latency_server'; if (context.token) fields.token = context.token;
            endpoint += '?' + new URLSearchParams(fields).toString(); request = {redirect:'follow'};
          } else {
            fields.form_type = 'latency_server'; if (context.token) fields.sessionToken = context.token;
            request = {method:'POST', body:JSON.stringify(fields), redirect:'follow'};
          }
          Promise.resolve(root.fetch(endpoint, request)).catch(function() {});
        } catch (ignored) {}
      }
      // Response is already consumed. Paint first when possible; a hidden-tab
      // timer also drains the server sample without inventing browser timings.
      root.setTimeout(send,300);
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(function() { root.requestAnimationFrame(send); });
    } catch (ignored) {}
  }

  function finish(operation, response, options) {
    try {
      if (!operation || operation.ended) return;
      operation.finishedAt = now();
      operation.ended = true;
      if (active === operation) active = null;
      var sample = response && response._latency_sample;
      if (!sample || scenes.indexOf(sample.scene) < 0 || !valid(sample.server_ms)) return;
      // Snapshot only the fixed diagnostic fields; don't retain the business DTO.
      var scene = sample.scene, serverMs = sample.server_ms, main = responses.get(response);
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
            try { var detail = breakdown(operation, main, serverMs, now()); if (detail) fields.breakdown = detail; } catch (ignored) {}
            var request;
            if (portal) {
              var query = new URLSearchParams({ mode: 'latency_browser', token: credential,
                scene: scene, browser_ms: String(browserMs), server_ms: String(serverMs) });
              if (fields.breakdown) query.set('breakdown', JSON.stringify(fields.breakdown));
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
  root.ECOPITA_SCREEN_LATENCY = { relayRequest: relayRequest, relayResponse: relayResponse, begin: begin, finish: finish, capture: capture, startCall: startCall, endCall: endCall, bind: bind, bindResponse: bindResponse, mark: mark, endMark: endMark };
})(window);
