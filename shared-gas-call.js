(function(root) {
  'use strict';

  var inflightLookups = new Map();
  var p1SfLookupStates = new Map();
  var DEFAULT_RETRY_DELAYS = [2000, 5000];
  var LOOKUP_START = '検索中…';
  var LOOKUP_BUSY = '混雑しています。このまましばらくお待ちください（自動で確認を続けます）';
  var TRANSPORT_MESSAGE = '通信が不安定です。電波の良い場所でもう一度お試しください';
  var P1_SF_CAPABILITY = 'p1_sf_v1';
  var P1_SF_BUSY_CODE = 'busy_caseid_check';
  var P1_SF_HONEST_MESSAGE = '案件番号の確認処理が続いています。しばらくして再操作してください';
  var P1_SF_DEADLINE_MS = 75000;
  var P1_SF_MAX_BUSY_RETRIES = 8;
  var P1_SF_MIN_RETRY_MS = 1000;
  var P1_SF_MAX_RETRY_MS = 15000;
  var P1_SF_MIN_REMAINING_MS = 3000;
  var P1_SF_ROUTES = {
    lookup: true,
    contract_list: true,
    quote_lookup: true,
    receipt_lookup: true,
    reserve_lookup: true
  };

  // 0051: business-read allowlist. Authentication and writes never enter retries.
  var READ_POST_ROUTES = ['lookup', 'contract_list', 'quote_lookup', 'receipt_lookup', 'reserve_lookup',
    'coupon_lookup', 'staff_lookup', 'staff_flags', 'duplicate_guard_lookup', 'resend_lookup',
    'resend_nonbounce_lookup', 'expense_lookup', 'write_async_status'];
  var READ_GET_ACTIONS = ['bootstrap', 'changeDate', 'viewReferree', 'expense_lookup',
    'company_dashboard', 'company_dashboard_graph', 'company_dashboard_advconfirm'];
  var READ_RETRY_MESSAGE = '返事が届かなかったので取り直しています…';
  var READ_FINAL_MESSAGE = '数分待ってからもう一度開いてください';
  var readInflight = new Map();
  var credentialIds = new Map();
  var objectIds = new WeakMap();
  var nextIdentity = 0;

  function opaqueIdentity(value) {
    if (!value) return '';
    var registry = typeof value === 'object' || typeof value === 'function' ? objectIds : credentialIds;
    if (!registry.has(value)) registry.set(value, ++nextIdentity);
    return registry.get(value);
  }

  function canonicalReadValue(value, name) {
    if (/token|authorization|cookie|secret|password|pin/i.test(name || '')) return ['credential', opaqueIdentity(value)];
    if (Array.isArray(value)) return value.map(function(item) { return canonicalReadValue(item, name); });
    if (value && typeof value === 'object') {
      var result = Object.create(null);
      Object.keys(value).sort().forEach(function(key) { result[key] = canonicalReadValue(value[key], key); });
      return result;
    }
    return value;
  }

  function describeReadRequest(url, request) {
    request = request || {};
    var parsed = new URL(String(url), root.location && root.location.href || (root.ECOPITA_SITE ? root.ECOPITA_SITE.baseUrl + '/' : undefined));
    var method = String(request.method || 'GET').toUpperCase();
    var payload = null;
    var route = '';
    var query = [];
    parsed.searchParams.forEach(function(value, key) { if (key !== '_portal_data') query.push([key, value]); });
    if (method === 'POST') {
      payload = JSON.parse(request.body);
      route = payload && payload.form_type;
      if (READ_POST_ROUTES.indexOf(route) < 0) throw new Error('GAS_READ_ROUTE_DENIED');
    } else if (method === 'GET' && parsed.searchParams.has('_portal_data')) {
      var bytes = root.atob(parsed.searchParams.get('_portal_data'));
      payload = JSON.parse(decodeURIComponent(Array.prototype.map.call(bytes, function(ch) {
        return '%' + ('0' + ch.charCodeAt(0).toString(16)).slice(-2);
      }).join('')));
      route = payload && payload.action;
      if (READ_GET_ACTIONS.indexOf(route) < 0) throw new Error('GAS_READ_ROUTE_DENIED');
    } else if (method === 'GET') {
      route = parsed.searchParams.get('mode');
      // group_reward＝グループのサイトの報酬確認（読むだけ・票 1850）。2026-09-24 実機で GAS_READ_ROUTE_DENIED になっていたのを通す。
      if (route !== 'json' && route !== 'cases' && route !== 'group_reward') throw new Error('GAS_READ_ROUTE_DENIED');
    } else throw new Error('GAS_READ_ROUTE_DENIED');
    var headers = [];
    if (request.headers) new Headers(request.headers).forEach(function(value, key) { headers.push([key, canonicalReadValue(value, key)]); });
    var options = {};
    ['credentials', 'redirect', 'cache', 'mode', 'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'priority', 'duplex'].forEach(function(key) {
      if (request[key] !== undefined) options[key] = request[key];
    });
    // shared-auth injects this credential for POST. Include its identity before coalescing.
    var session = root.ECOPITA_SESSION || {};
    return { route: route, key: JSON.stringify({ endpoint: parsed.origin + parsed.pathname, method: method,
      query: query.map(function(pair) { return [pair[0], canonicalReadValue(pair[1], pair[0])]; }),
      payload: canonicalReadValue(payload), headers: headers, options: options,
      implicit_principal: method === 'POST' && !(payload && payload.sessionToken) ? opaqueIdentity(session.token || '') : '',
      signal: opaqueIdentity(request.signal) }) };
  }

  function readError(code) {
    var error = new Error(READ_FINAL_MESSAGE);
    error.code = code;
    error.userMessage = READ_FINAL_MESSAGE;
    return error;
  }

  function readMetric(value, opts) {
    try {
      if (typeof opts.onMetric === 'function') opts.onMetric(value);
      else if (root.console && typeof root.console.info === 'function') root.console.info(JSON.stringify(value));
    } catch (ignored) {}
  }

  // A caller-owned JSON response facade: coalesced consumers never share a used body
  // or a mutable parsed object. Raw request/response data is never included in metrics.
  function readResponse(record) {
    return { ok: true, status: record.status, statusText: record.statusText, headers: record.headers,
      redirected: record.redirected, url: record.url,
      text: function() { return Promise.resolve(record.text); },
      json: function() { return Promise.resolve(JSON.parse(record.text)); },
      clone: function() { return readResponse(record); } };
  }

  function gasReadFetch(url, request, opts) {
    request = Object.assign({}, request || {}); opts = opts || {};
    url = String(url);
    if (request.headers) request.headers = new Headers(request.headers);
    var descriptor;
    try { descriptor = describeReadRequest(url, request); } catch (error) { return Promise.reject(error); }
    var fetchFn = opts.fetchFn || root.fetch;
    var now = opts.nowFn || Date.now;
    var setTimer = opts.setTimeoutFn || root.setTimeout.bind(root);
    var clearTimer = opts.clearTimeoutFn || root.clearTimeout.bind(root);
    var key = descriptor.key + ':' + opaqueIdentity(fetchFn);
    var listener = typeof opts.onStatus === 'function' ? opts.onStatus : function() {};
    var existing = readInflight.get(key);
    if (existing) {
      existing.listeners.push(listener);
      if (existing.message) { try { listener(existing.message); } catch (ignored) {} }
      readMetric({ event: 'gas_read_delivery', route: descriptor.route, cache_hit: true,
        attempts: 0, retries: 0, elapsed_ms: 0, outcome: 'coalesced' }, opts);
      return existing.promise.then(readResponse);
    }
    var entry = { listeners: [listener], message: '', promise: null };
    var started = now();
    var deadline = started + 75000;
    var controller = typeof (opts.AbortControllerImpl || root.AbortController) === 'function'
      ? new (opts.AbortControllerImpl || root.AbortController)() : null;
    var attempts = 0, outcome = 'transport_error', timeoutId, waitId, expired = false;
    var cancel = function() { if (controller) { try { controller.abort(); } catch (ignored) {} } };
    var rejectDeadline;
    var deadlinePromise = new Promise(function(_, reject) { rejectDeadline = reject; });
    // An immediate external abort can precede the first race consumer.
    deadlinePromise.catch(function() {});
    function endDeadline(code) { expired = true; cancel(); rejectDeadline(readError(code)); }
    function notify(message) {
      entry.message = message;
      entry.listeners.forEach(function(fn) { try { fn(message); } catch (ignored) {} });
    }
    var externalAbort = function() { endDeadline('GAS_READ_ABORTED'); };
    if (request.signal) {
      if (request.signal.aborted) expired = true;
      else request.signal.addEventListener('abort', externalAbort, { once: true });
    }
    timeoutId = setTimer(function() { endDeadline('GAS_READ_DEADLINE'); }, 75000);
    async function race(promise) { return Promise.race([promise, deadlinePromise]); }
    entry.promise = Promise.resolve().then(async function() {
      try {
        if (expired) throw readError('GAS_READ_ABORTED');
        for (var attempt = 0; attempt < 3; attempt++) {
          if (now() >= deadline) throw readError('GAS_READ_DEADLINE');
          if (attempt) {
            notify(READ_RETRY_MESSAGE);
            await race(new Promise(function(resolve) { waitId = setTimer(resolve, DEFAULT_RETRY_DELAYS[attempt - 1]); }));
            if (expired || now() >= deadline) throw readError('GAS_READ_DEADLINE');
          }
          attempts++;
          try {
            var wire = Object.assign({}, request);
            if (controller) wire.signal = controller.signal;
            var record = await race((async function() {
              var response = await fetchFn.call(root, url, wire);
              if (!response || response.ok === false) throw readError('GAS_READ_HTTP');
              var text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
              var data = JSON.parse(text);
              if (!data || typeof data !== 'object') throw readError('GAS_READ_JSON');
              return { text: text, status: response.status || 200, statusText: response.statusText || '',
                headers: response.headers, redirected: !!response.redirected, url: response.url || '', businessOk: data.ok !== false };
            })());
            outcome = record.businessOk ? 'ok' : 'business_error';
            notify('');
            return record;
          } catch (error) {
            if (expired || now() >= deadline || (error && error.code === 'GAS_READ_ABORTED')) throw error;
            if (attempt === 2) throw readError('GAS_READ_TRANSPORT');
          }
        }
      } catch (error) {
        outcome = error && error.code === 'GAS_READ_ABORTED' ? 'aborted'
          : expired || now() >= deadline ? 'deadline' : 'transport_error';
        notify(READ_FINAL_MESSAGE);
        throw error;
      } finally {
        clearTimer(timeoutId);
        if (waitId !== undefined) clearTimer(waitId);
        if (request.signal) request.signal.removeEventListener('abort', externalAbort);
        readInflight.delete(key);
        readMetric({ event: 'gas_read_delivery', route: descriptor.route, cache_hit: false,
          attempts: attempts, retries: Math.max(0, attempts - 1), elapsed_ms: Math.max(0, now() - started), outcome: outcome }, opts);
      }
    });
    readInflight.set(key, entry);
    return entry.promise.then(readResponse);
  }

  function gasReadStatusTarget(target) {
    var original, previous;
    return function(message) {
      var element = typeof target === 'string' ? root.document.getElementById(target) : target;
      if (!element) return;
      if (message) {
        if (!original) original = { text: element.textContent, display: element.style.display, hidden: !!(element.classList && element.classList.contains('hidden')) };
        element.textContent = message; element.style.display = '';
        if (element.classList) element.classList.remove('hidden');
        previous = message;
      } else if (original && element.textContent === previous) {
        element.textContent = original.text; element.style.display = original.display;
        if (original.hidden && element.classList) element.classList.add('hidden');
        original = null;
      }
    };
  }

  function lookupKey(payload) {
    return String((payload && payload.form_type) || '') + ':' +
      String((payload && payload.case_id) || '').trim().toUpperCase();
  }

  function isP1SfPayload(payload) {
    var route = String((payload && payload.form_type) || '');
    return !!P1_SF_ROUTES[route] && payload && payload.p1_sf === P1_SF_CAPABILITY;
  }

  function delay(ms, setTimeoutFn) {
    return new Promise(function(resolve) {
      setTimeoutFn(resolve, ms);
    });
  }

  function transportError(cause) {
    var error = new Error(TRANSPORT_MESSAGE);
    error.code = 'GAS_TRANSPORT_FAILED';
    error.userMessage = TRANSPORT_MESSAGE;
    error.cause = cause;
    return error;
  }

  async function requestJson(url, payload, fetchFn, signal) {
    var requestOptions = {
      method: 'POST',
      body: JSON.stringify(payload)
    };
    if (signal) requestOptions.signal = signal;
    var response = await fetchFn(url, requestOptions);
    if (!response || response.ok === false) {
      var status = response && response.status;
      throw new Error('GAS_HTTP_' + (status || 'ERROR'));
    }
    return response.json();
  }

  function clampP1SfRetryAfter(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = P1_SF_MIN_RETRY_MS;
    return Math.min(P1_SF_MAX_RETRY_MS, Math.max(P1_SF_MIN_RETRY_MS, n));
  }

  function p1SfJitterMs(retryIndex, randomFn) {
    var cap = Math.min(P1_SF_MAX_RETRY_MS, 2000 * Math.pow(2, retryIndex));
    var random = Number(randomFn());
    if (!Number.isFinite(random)) random = 0;
    random = Math.min(1, Math.max(0, random));
    return Math.floor(500 + (cap - 500) * random);
  }

  function p1SfHonestResponse() {
    return {
      ok: false,
      code: P1_SF_BUSY_CODE,
      error: P1_SF_HONEST_MESSAGE
    };
  }

  function setP1SfLookupState(payload, state) {
    var key = lookupKey(payload);
    if (!key) return;
    if (state) p1SfLookupStates.set(key, state);
    else p1SfLookupStates.delete(key);
  }

  function gasP1SfLookupBlocked(formType, caseId) {
    return p1SfLookupStates.has(lookupKey({ form_type: formType, case_id: caseId }));
  }

  function gasP1SfGuard(formType, caseId, showMessage) {
    var state = p1SfLookupStates.get(lookupKey({ form_type: formType, case_id: caseId }));
    if (!state) return false;
    if (typeof showMessage === 'function') {
      showMessage(state === 'honest' ? P1_SF_HONEST_MESSAGE : LOOKUP_BUSY);
    }
    return true;
  }

  async function requestP1Sf(url, payload, opts, deps) {
    var deadlineMs = opts.deadlineMs == null ? P1_SF_DEADLINE_MS : opts.deadlineMs;
    var maxBusyRetries = opts.maxBusyRetries == null ? P1_SF_MAX_BUSY_RETRIES : opts.maxBusyRetries;
    var retryDelays = opts.retryDelays || DEFAULT_RETRY_DELAYS;
    var startedAt = deps.nowFn();
    var deadlineAt = startedAt + deadlineMs;
    var activeController = null;
    var deadlineTimer = null;
    var finished = false;
    var honestShown = false;

    function showHonest() {
      setP1SfLookupState(payload, 'honest');
      if (!honestShown) {
        honestShown = true;
        deps.onStatus(P1_SF_HONEST_MESSAGE);
      }
      return p1SfHonestResponse();
    }

    var deadlinePromise = new Promise(function(resolve) {
      deadlineTimer = deps.setTimeoutFn(function() {
        if (finished) return;
        var response = showHonest();
        if (activeController) {
          try { activeController.abort(); } catch (e) {}
        }
        resolve({ kind: 'deadline', data: response });
      }, Math.max(0, deadlineMs));
    });

    async function raceDeadline(promise) {
      return Promise.race([
        promise.then(function(data) {
          return { kind: 'value', data: data };
        }, function(error) {
          return { kind: 'error', error: error };
        }),
        deadlinePromise
      ]);
    }

    setP1SfLookupState(payload, 'checking');
    deps.onStatus(LOOKUP_START);

    var busyRetries = 0;
    var transportFailures = 0;
    try {
      while (true) {
        if (deadlineAt - deps.nowFn() < P1_SF_MIN_REMAINING_MS) return showHonest();

        activeController = deps.AbortControllerImpl ? new deps.AbortControllerImpl() : null;
        var requestResult = await raceDeadline(requestJson(
          url,
          payload,
          deps.fetchFn,
          activeController && activeController.signal
        ));
        activeController = null;

        if (requestResult.kind === 'deadline') return requestResult.data;
        if (requestResult.kind === 'error') {
          transportFailures++;
          if (transportFailures >= retryDelays.length + 1) {
            setP1SfLookupState(payload, null);
            throw transportError(requestResult.error);
          }
          var transportRemaining = deadlineAt - deps.nowFn();
          if (transportRemaining < P1_SF_MIN_REMAINING_MS) return showHonest();
          var transportWait = Math.min(transportRemaining, retryDelays[transportFailures - 1]);
          var transportDelayResult = await raceDeadline(delay(transportWait, deps.setTimeoutFn));
          if (transportDelayResult.kind === 'deadline') return transportDelayResult.data;
          continue;
        }

        transportFailures = 0;
        var data = requestResult.data;
        if (!data || data.code !== P1_SF_BUSY_CODE || data.ok !== false) {
          setP1SfLookupState(payload, null);
          return data;
        }

        setP1SfLookupState(payload, 'busy');
        deps.onStatus(LOOKUP_BUSY);
        if (busyRetries >= maxBusyRetries) return showHonest();

        var remaining = deadlineAt - deps.nowFn();
        if (remaining < P1_SF_MIN_REMAINING_MS) return showHonest();
        var serverWait = clampP1SfRetryAfter(data.retry_after_ms);
        var jitterWait = p1SfJitterMs(busyRetries, deps.randomFn);
        var actualWait = Math.min(remaining, Math.max(serverWait, jitterWait));
        var waitResult = await raceDeadline(delay(actualWait, deps.setTimeoutFn));
        if (waitResult.kind === 'deadline') return waitResult.data;
        busyRetries++;
      }
    } finally {
      finished = true;
      if (deadlineTimer !== null) deps.clearTimeoutFn(deadlineTimer);
    }
  }

  function gasCall(payload, opts) {
    opts = opts || {};
    var mode = opts.mode === 'lookup' ? 'lookup' : 'submit';
    var url = opts.url || root.GAS_API_URL || root.GAS_URL;
    var fetchFn = opts.fetchFn || root.fetch.bind(root);
    var setTimeoutFn = opts.setTimeoutFn || root.setTimeout.bind(root);
    var clearTimeoutFn = opts.clearTimeoutFn || root.clearTimeout.bind(root);
    var retryDelays = opts.retryDelays || DEFAULT_RETRY_DELAYS;
    var busyAfterMs = opts.busyAfterMs == null ? 30000 : opts.busyAfterMs;
    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function() {};
    var isP1Sf = mode === 'lookup' && isP1SfPayload(payload);

    if (!url) return Promise.reject(transportError(new Error('GAS_URL_MISSING')));

    if (mode === 'lookup' && !isP1Sf && READ_POST_ROUTES.indexOf(payload && payload.form_type) >= 0) {
      return gasReadFetch(url, { method: 'POST', body: JSON.stringify(payload) }, opts).then(function(response) { return response.json(); });
    }
    var key = mode === 'lookup' ? describeReadRequest(url, { method: 'POST', body: JSON.stringify(payload) }).key + ':' + opaqueIdentity(fetchFn) : '';
    if (key && inflightLookups.has(key)) return inflightLookups.get(key);

    var operation = (async function() {
      if (isP1Sf) {
        return requestP1Sf(url, payload, opts, {
          fetchFn: fetchFn,
          setTimeoutFn: setTimeoutFn,
          clearTimeoutFn: clearTimeoutFn,
          onStatus: onStatus,
          randomFn: opts.randomFn || Math.random,
          nowFn: opts.nowFn || Date.now,
          AbortControllerImpl: opts.AbortControllerImpl === undefined ? root.AbortController : opts.AbortControllerImpl
        });
      }

      var busyTimer = null;
      if (mode === 'lookup') {
        onStatus(LOOKUP_START);
        busyTimer = setTimeoutFn(function() {
          onStatus(LOOKUP_BUSY);
        }, busyAfterMs);
      }
      try {
        var attempts = mode === 'lookup' ? retryDelays.length + 1 : 1;
        var lastError = null;
        for (var attempt = 0; attempt < attempts; attempt++) {
          if (attempt > 0) await delay(retryDelays[attempt - 1], setTimeoutFn);
          try {
            // ok:false is a valid business response and is returned without retry.
            return await requestJson(url, payload, fetchFn);
          } catch (error) {
            lastError = error;
          }
        }
        throw transportError(lastError);
      } finally {
        if (busyTimer !== null) clearTimeoutFn(busyTimer);
      }
    })();

    if (key) {
      inflightLookups.set(key, operation);
      operation.finally(function() {
        if (inflightLookups.get(key) === operation) inflightLookups.delete(key);
      }).catch(function() {});
    }
    return operation;
  }

  function gasCallErrorMessage(error) {
    return error && error.userMessage ? error.userMessage : TRANSPORT_MESSAGE;
  }

  function gasLandingCountIncreased(beforeCount, afterCount) {
    var before = Number(beforeCount);
    var after = Number(afterCount);
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
  }

  function gasOrderLandingDetected(baselineGuard, currentGuard, expectedAmount) {
    if (!baselineGuard || !currentGuard) return false;
    var before = Array.isArray(baselineGuard.contracts)
      ? baselineGuard.contracts.length
      : NaN;
    var current = Array.isArray(currentGuard.contracts)
      ? currentGuard.contracts
      : [];
    if (!gasLandingCountIncreased(before, current.length)) return false;
    var expected = Number(expectedAmount);
    if (!Number.isFinite(expected)) return true;
    return current.slice(before).some(function(contract) {
      return Math.abs(Number((contract && contract.amount) || 0) - expected) < 1;
    });
  }

  root.gasCall = gasCall;
  root.gasReadFetch = gasReadFetch;
  root.gasReadStatusTarget = gasReadStatusTarget;
  root.GAS_READ_FINAL_MESSAGE = READ_FINAL_MESSAGE;
  root.gasCallErrorMessage = gasCallErrorMessage;
  root.gasP1SfLookupBlocked = gasP1SfLookupBlocked;
  root.gasP1SfGuard = gasP1SfGuard;
  root.GAS_P1_SF_HONEST_MESSAGE = P1_SF_HONEST_MESSAGE;
  root.gasLandingCountIncreased = gasLandingCountIncreased;
  root.gasOrderLandingDetected = gasOrderLandingDetected;
  root.__gasCallTestables = {
    lookupKey: lookupKey,
    describeReadRequest: describeReadRequest,
    readInflight: readInflight,
    inflightLookups: inflightLookups,
    p1SfLookupStates: p1SfLookupStates,
    retryDelays: DEFAULT_RETRY_DELAYS.slice(),
    lookupStart: LOOKUP_START,
    lookupBusy: LOOKUP_BUSY,
    transportMessage: TRANSPORT_MESSAGE,
    p1SfCapability: P1_SF_CAPABILITY,
    p1SfBusyCode: P1_SF_BUSY_CODE,
    p1SfHonestMessage: P1_SF_HONEST_MESSAGE,
    p1SfDeadlineMs: P1_SF_DEADLINE_MS,
    p1SfMaxBusyRetries: P1_SF_MAX_BUSY_RETRIES,
    clampP1SfRetryAfter: clampP1SfRetryAfter,
    p1SfJitterMs: p1SfJitterMs,
    isP1SfPayload: isP1SfPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
