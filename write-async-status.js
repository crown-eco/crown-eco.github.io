(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WriteAsyncStatusV1 = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  // 1受付につき4回だけGASを起動する。画面再描画用のlocal timerとは共用しない。
  var POLL_DELAYS_MS = [3000, 8000, 16000, 30000];
  var UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var COPY = {
    reportPending: '報告は保存できました。売上一覧への反映は少し時間がかかります。',
    invoicePending: '売上の記録は保存できました。売上一覧への反映は少し時間がかかります。',
    reflected: '売上一覧へ反映しました。',
    unknown: '反映の状況が確認できませんでした。もう一度確認してください。',
    manual: '売上一覧への反映に失敗しました。管理者へ通知済みです。',
    receiptGate: '反映確認中のため、いまは発行できません。'
  };

  function ids_(value) {
    var list = Array.isArray(value) ? value : [];
    var seen = Object.create(null);
    return list.map(function(item) { return String(item || '').trim().toLowerCase(); })
      .filter(function(item) {
        if (!UUID_V4.test(item) || seen[item]) return false;
        seen[item] = true;
        return true;
      });
  }

  function sameIds_(left, right) {
    var a = ids_(left).slice().sort();
    var b = ids_(right).slice().sort();
    return a.length > 0 && a.length === b.length && a.every(function(value, index) { return value === b[index]; });
  }

  function classify(response, expectedIds) {
    var expected = ids_(expectedIds);
    if (!response || response.enabled !== true || !sameIds_(response.operation_ids, expected)) return 'unknown';
    if (response.state === 'manual') return 'manual';
    if (response.state === 'reflected' && response.ok === true) return 'reflected';
    if (response.state === 'pending' && response.ok === true) return 'pending';
    return 'unknown';
  }

  function callGasStatus(gasUrl, operationIds) {
    if (typeof gasCall !== 'function') return Promise.reject(new Error('GAS_CALL_UNAVAILABLE'));
    return gasCall({
      form_type: 'write_async_status',
      operation_ids: ids_(operationIds)
    }, { mode: 'lookup', url: gasUrl });
  }

  function render_(target, state, options, reference) {
    if (!target) return;
    var message = state === 'pending' || state === 'timed_out' ? options.pendingMessage
      : state === 'reflected' ? COPY.reflected
      : state === 'manual' ? COPY.manual : COPY.unknown;
    target.textContent = '';
    target.style.color = state === 'manual' ? '#c62828' : state === 'reflected' ? '#2e7d32' : '#5f6368';
    var text = document.createElement('div');
    text.textContent = message;
    target.appendChild(text);
    if (state === 'timed_out') {
      // 新しい文言を決めず、契約v2で麗香決定済みの2文を組み合わせる。
      var retryGuidance = document.createElement('div');
      retryGuidance.style.cssText = 'margin-top:6px';
      retryGuidance.textContent = COPY.unknown;
      target.appendChild(retryGuidance);
    }
    if (state === 'manual' && reference) {
      var ref = document.createElement('div');
      ref.style.cssText = 'font-size:.8rem;margin-top:6px';
      ref.textContent = '問い合わせ番号: ' + reference;
      target.appendChild(ref);
    }
    if (state === 'unknown' || state === 'manual' || state === 'timed_out') {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'もう一度確認';
      button.style.cssText = 'margin-top:10px;padding:8px 14px;border:0;border-radius:8px;background:#546e7a;color:#fff;font-weight:700;cursor:pointer';
      button.onclick = options.onRetry;
      target.appendChild(button);
    }
  }

  function start(options) {
    options = options || {};
    var acceptance = options.acceptance || {};
    var operationIds = ids_(acceptance.operation_ids);
    if (acceptance.enabled !== true || !operationIds.length || typeof options.callStatus !== 'function') return null;
    var target = options.target;
    var stopped = false;
    var attempt = 0;
    var timer = null;
    var reference = String(acceptance.reference || '');
    var controller = {};

    function stopTimer_() {
      if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
      timer = null;
    }
    function schedule_() {
      if (stopped) return;
      if (attempt >= POLL_DELAYS_MS.length) {
        stopped = true;
        render_(target, 'timed_out', renderOptions_, reference);
        return;
      }
      timer = setTimeout(poll_, POLL_DELAYS_MS[attempt]);
    }
    function poll_() {
      if (stopped) return Promise.resolve('stopped');
      stopTimer_();
      attempt++;
      return Promise.resolve(options.callStatus(operationIds.slice())).then(function(response) {
        var state = classify(response, operationIds);
        reference = String(response && response.reference || reference || '');
        if (state === 'pending') {
          render_(target, state, renderOptions_, reference);
          schedule_();
        } else {
          stopped = true;
          render_(target, state, renderOptions_, reference);
          if (state === 'reflected' && typeof options.onReflected === 'function') options.onReflected();
        }
        return state;
      }).catch(function() {
        stopped = true;
        render_(target, 'unknown', renderOptions_, reference);
        return 'unknown';
      });
    }
    function retry_() {
      stopped = false;
      attempt = 0;
      render_(target, 'pending', renderOptions_, reference);
      schedule_();
      return controller;
    }
    var renderOptions_ = {
      pendingMessage: options.pendingMessage || COPY.reportPending,
      onRetry: retry_
    };
    controller.poll = poll_;
    controller.retry = retry_;
    controller.stop = function() { stopped = true; stopTimer_(); };
    controller.operationIds = operationIds.slice();
    render_(target, 'pending', renderOptions_, reference);
    schedule_();
    return controller;
  }

  return {
    COPY: COPY,
    callGasStatus: callGasStatus,
    classify: classify,
    sameIds: sameIds_,
    start: start,
    pollDelaysMs: POLL_DELAYS_MS.slice()
  };
});
