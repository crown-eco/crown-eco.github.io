/* F5-1 isolated interface candidate. No page integration or production reader contract. */
(function (root) {
  'use strict';
  const VERSION = 'f5-fake-v1';
  const ROUTES = Object.freeze(Object.fromEntries([
    'bootstrap', 'changeDate', 'viewReferree', 'cases', 'portal',
    'company_dashboard', 'company_dashboard_graph', 'company_dashboard_advconfirm',
    'quote_lookup', 'receipt_lookup', 'reserve_lookup',
    'lookup',
    'staff_lookup',
    'staff_flags',
    'duplicate_guard_lookup'
  ].map(op => [op, Object.freeze({ path: '/interface/f5/read/' + op, version: VERSION, gas: true })])
    .concat([['legacy_read', Object.freeze({ path: null, version: VERSION, gas: true })]])));
  const CONTEXT = ['token', 'actor', 'site', 'scope', 'epoch', 'authVersion', 'conditionKey'];
  const SERVER_MS = ['accepted_ms', 'auth_ms', 'authorize_ms', 'read_ms', 'shape_ms'];
  const STATES = new Set(['ready', 'material_stale', 'db_unavailable', 'deny_unavailable',
    'pending', 'control_unknown', 'readback_unknown', 'revoked', 'auth_version_changed',
    'group_denied', 'scope_denied', 'unsupported']);
  function fault(reason) { const e = new Error(reason); e.reason = reason; return e; }
  // Pass a new wrapper to each legacy adapter call; retries cannot send a second request.
  function oneAttemptFetch(fetchFn) {
    let used = false;
    return function () {
      if (used) return Promise.reject(fault('fallback_limit'));
      used = true;
      return fetchFn.apply(undefined, arguments);
    };
  }
  function create(config, io) {
    if (!config || !['main', 'site_2', 'site_3'].includes(config.siteSlot) || !io ||
        !['fetch', 'context', 'control', 'fallbackPermit', 'gas', 'clearCache', 'relogin'].every(k => typeof io[k] === 'function')) throw fault('configuration');
    const base = new URL(config.baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw fault('configuration');
    const timeout = config.timeoutMs === undefined ? 15000 : config.timeoutMs;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 75000) throw fault('configuration');
    const now = io.now || (() => performance.now());
    const lanes = new Map();
    let epoch = 0, previous, blocked;
    function snapshot() {
      const source = io.context();
      if (!source || CONTEXT.some(k => !['string', 'number'].includes(typeof source[k])) || !source.token || !source.actor || !source.site || !source.scope) throw fault('control_unknown');
      return Object.freeze(Object.fromEntries(CONTEXT.map(k => [k, source[k]])));
    }
    const same = (a, b) => CONTEXT.every(k => a[k] === b[k]);
    function invalidate() { epoch++; lanes.clear(); previous = undefined; try { io.clearCache(); } catch (_) { blocked = true; } }
    async function call(operation, payload, adapter, options) {
      options = options || {};
      // Arbitrary operation names never reach a transport or a log.
      const route = Object.prototype.hasOwnProperty.call(ROUTES, operation) && ROUTES[operation];
      if (!route) throw fault('unsupported');
      if (!adapter || typeof adapter.project !== 'function' || typeof adapter.validate !== 'function') throw fault('dto_invalid');
      let ctx;
      try { ctx = snapshot(); } catch (_) { invalidate(); throw fault('control_unknown'); }
      if (blocked === true || (blocked && same(blocked, ctx))) throw fault('control_unknown');
      blocked = undefined;
      if (previous && !same(previous, ctx)) invalidate();
      previous = ctx;
      const lane = options.lane || operation, generation = (lanes.get(lane) || 0) + 1;
      lanes.set(lane, generation);
      const localEpoch = epoch, started = now();
      const requestId = root.crypto.randomUUID();
      let gasCount = 0, cloudMs = 0, gasMs = 0, cold = 'unknown', server = {}, finalReason;
      const external = options.signal;
      const controller = new AbortController();
      let cancelReject;
      const canceled = new Promise((_, reject) => { cancelReject = reject; });
      canceled.catch(() => {});
      const abort = () => { controller.abort(); cancelReject(fault('aborted')); };
      if (external) external.addEventListener('abort', abort, { once: true });
      function current() {
        if (external && external.aborted) throw fault('aborted');
        if (localEpoch !== epoch || lanes.get(lane) !== generation) throw fault('superseded');
        let fresh;
        try { fresh = snapshot(); } catch (_) { invalidate(); throw fault('control_unknown'); }
        if (!same(ctx, fresh)) { invalidate(); throw fault('superseded'); }
      }
      const race = promise => Promise.race([promise, canceled]);
      function metric(reason, phase) {
        const record = Object.assign({ reason, phase, request_id: requestId, site: config.siteSlot,
          operation, contract: VERSION, temperature: cold, outcome: gasCount ? 'fallback' : 'cloud',
          cloud_ms: cloudMs, gas_ms: gasMs, total_ms: Math.max(0, now() - started), count: gasCount }, server);
        try { if (io.metric) io.metric(Object.freeze(record)); } catch (_) { /* diagnostics cannot change authorization */ }
      }
      async function control(evidence) {
        current();
        let valid = false;
        try { valid = await race(Promise.resolve().then(() => io.control(ctx, evidence))); } catch (e) { current(); throw fault('control_unknown'); }
        current();
        if (valid !== true) throw fault('control_unknown');
      }
      async function fallback(reason) {
        current();
        let permit;
        try { permit = await race(Promise.resolve().then(() => io.fallbackPermit(ctx, operation, reason))); }
        catch (_) { current(); throw fault('control_unknown'); }
        current();
        if (!route.gas || !permit || permit.sessionCurrent !== true || permit.controlCurrent !== true || permit.compatibleValidator !== true) throw fault('control_unknown');
        if (gasCount) throw fault('fallback_limit');
        gasCount++;
        const start = now();
        try { return await race(Promise.resolve().then(() => io.gas(operation, payload, ctx, { signal: external }))); }
        catch (_) { current(); throw fault('gas_failed'); }
        finally { gasMs = Math.max(0, now() - start); }
      }
      async function cloud() {
        const start = now();
        let timer;
        let expire;
        const deadline = new Promise((_, reject) => { expire = () => { controller.abort(); reject(fault('timeout')); }; });
        timer = setTimeout(expire, timeout);
        try {
          const response = await race(Promise.race([Promise.resolve().then(() => io.fetch(new URL(route.path, base).href, {
            method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
            referrerPolicy: 'no-referrer', signal: controller.signal,
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ctx.token,
              'x-read-contract': VERSION, 'x-request-id': requestId },
            body: JSON.stringify({ operation, payload })
          })), deadline]));
          current();
          if (response.status === 401) throw fault('unauthenticated');
          if (response.status === 403) throw fault('denied');
          // Body timeout is covered too. No response body/error text is ever logged.
          const body = await race(Promise.race([Promise.resolve().then(() => response.json()), deadline]));
          current();
          if (!body || body.contract !== VERSION || !STATES.has(body.state)) throw fault('protocol_invalid');
          cold = ['cold', 'warm'].includes(body.temperature) ? body.temperature : 'unknown';
          SERVER_MS.forEach(k => { const n = body.timings && body.timings[k]; if (Number.isFinite(n) && n >= 0 && n <= 300000) server[k] = n; });
          if (['revoked', 'auth_version_changed'].includes(body.state)) throw fault('unauthenticated');
          if (['group_denied', 'scope_denied'].includes(body.state)) throw fault('denied');
          if (['pending', 'control_unknown', 'readback_unknown', 'db_unavailable', 'deny_unavailable'].includes(body.state)) throw fault(body.state);
          await race(Promise.race([control(body.control), deadline]));
          if ([502, 503, 504].includes(response.status)) throw fault('temporary_5xx');
          if (!response.ok) throw fault('http_failed');
          if (body.state === 'material_stale') throw fault('material_stale');
          if (body.state === 'unsupported') throw fault('unsupported');
          if (body.state !== 'ready') throw fault('protocol_invalid');
          return body.dto;
        } catch (e) {
          current();
          const reason = e && e.reason;
          if (['timeout', 'temporary_5xx', 'material_stale', 'unsupported', 'unauthenticated', 'denied',
            'pending', 'control_unknown', 'readback_unknown', 'db_unavailable', 'deny_unavailable',
            'protocol_invalid', 'http_failed', 'aborted', 'superseded'].includes(reason)) throw fault(reason);
          throw fault('transport_failed');
        } finally { clearTimeout(timer); cloudMs = Math.max(0, now() - start); }
      }
      try {
        current();
        let dto;
        if (!route.path || config.enabled !== true) {
          finalReason = !route.path ? 'unsupported' : 'stage_off';
          dto = await fallback(finalReason);
        } else {
          try { dto = await cloud(); finalReason = 'success'; }
          catch (e) {
            if (!['timeout', 'temporary_5xx', 'material_stale', 'unsupported'].includes(e.reason)) throw e;
            finalReason = e.reason;
            dto = await fallback(e.reason);
          }
        }
        current();
        let view;
        try { view = adapter.project(dto); if (adapter.validate(view) !== true) throw fault('dto_invalid'); }
        catch (_) { throw fault('dto_invalid'); }
        current();
        metric(finalReason, 'received');
        let rendered = false;
        return Object.freeze({ dto: view, assertCurrent: current, rendered: function () {
          current(); if (!rendered) { rendered = true; metric(finalReason, 'rendered'); }
        } });
      } catch (e) {
        const reason = e && e.reason || 'failed';
        // All thrown dependency messages are discarded at their boundary.
        if (['unauthenticated', 'pending', 'control_unknown', 'readback_unknown', 'db_unavailable', 'deny_unavailable', 'denied'].includes(reason)) {
          blocked = ctx;
          invalidate();
          if (reason === 'unauthenticated') { try { io.relogin(); } catch (_) {} }
        }
        metric(reason, 'failed');
        throw fault(reason);
      } finally { if (external) external.removeEventListener('abort', abort); controller.abort(); }
    }
    // Opaque in-memory key for the existing page cache. Never emit it to telemetry/storage logs.
    function partition() {
      const ctx = snapshot();
      return JSON.stringify(['actor', 'site', 'scope', 'epoch', 'authVersion', 'conditionKey'].map(k => ctx[k]));
    }
    return Object.freeze({ call, invalidate, partition, routes: ROUTES });
  }
  const api = Object.freeze({ create, routes: ROUTES, contract: VERSION, oneAttemptFetch });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SharedCloudCall = api;
})(typeof globalThis === 'object' ? globalThis : window);
