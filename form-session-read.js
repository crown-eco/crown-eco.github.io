(function (root) {
  'use strict';
  const caseIdPattern = /^(?:(?:HM-|YA-C|CP-|HC-|EC-)[A-Za-z0-9-]+|(?:RM-|CPD-|CPM-)\d+)$/;
  const receiptFields = ['ok', 'case_id_valid', 'case_id', 'can_issue', 'doc_requirement_met', 'paper_slip',
    'warning', 'name', 'recipient_name', 'email', 'cc_emails', 'tel', 'address', 'equipment', 'staff_id', 'customer_type',
    'company_name', 'contact_name', 'contract_ids', 'contract_doc_nos', 'estimate_doc_nos', 'invoice_doc_nos', 'service_date',
    'service_date_jp', 'default_receipt_site', 'default_receipt_work', 'default_receipt_proviso_base', 'paid_rows',
    'aggregate_available', 'existing_receipt_count', 'paid_total_inc', 'default_payment_method'];
  const fields = {
    receipt_lookup: receiptFields,
    quote_lookup: ['ok', 'case_id_valid', 'case_id', 'registered', 'source', 'name', 'email', 'cc_emails', 'tel',
      'address', 'banchi', 'building', 'equipment', 'staff_id', 'prefix', 'estimate_versions',
      'diag_estimate_versions', 'versions', 'customer_type', 'company_name', 'contact_name', 'dummy_case'],
    reserve_lookup: ['ok', 'case_id_valid', 'case_id', 'name', 'status', 'reserve_date', 'reserve_time', 'staff_id', 'equipment', 'address']
  };
  const versionKeys = ['ver', 'doc_type', 'items', 'expiry', 'note', 'coupon', 'staff_id', 'created'];
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  const scalar = value => typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
  const validCase = value => typeof value === 'string' && value.length <= 100 && caseIdPattern.test(value);
  const allowedError = new Set(['案件番号が正しくありません　確認してください', 'この案件の予約情報が見つかりません',
    '案件が見つかりません', '権限がありません', 'ダミー案件番号ではこの画面は試せません', 'RM案件を使用する権限がありません',
    '案件番号の確認処理が続いています。しばらくして再操作してください', '再ログインしてください']);

  function project(value, operation, caseId) {
    if (!value || typeof value.ok !== 'boolean') throw Error('dto_invalid');
    if (!value.ok && operation === 'receipt_lookup' && value.reason === 'write_visibility_pending') {
      return { ok: false, reason: 'write_visibility_pending', error: '書類の反映を確認しています。' };
    }
    if (!value.ok && operation === 'receipt_lookup') {
      if (value.maintenance === true) return { ok: false, maintenance: true, error: 'ただいまメンテナンス中です。時間をおいて再度お試しください。' };
      if (value.error === 'Error: 領収書の売上対応を確認してください（要人確認）') return { ok: false, error: value.error };
    }
    if (!value.ok) return { ...pick(value, ['ok', 'case_id_valid']),
      ...(value.code === 'busy_caseid_check' ? { code: value.code } : {}),
      error: allowedError.has(value.error) ? value.error : '照会できませんでした' };
    if (value.case_id !== caseId || value.case_id_valid !== true) throw Error('dto_invalid');
    const dto = pick(value, fields[operation]);
    if (operation === 'receipt_lookup') return receiptView(dto);
    if (Object.entries(dto).some(([key, field]) => !['cc_emails', 'versions', 'dummy_case'].includes(key) && !scalar(field))) {
      throw Error('dto_invalid');
    }
    if (operation === 'quote_lookup') {
      if (!Array.isArray(value.cc_emails) || !value.cc_emails.every(email => typeof email === 'string')) throw Error('dto_invalid');
      dto.versions = value.versions.map(version => ({
        ...pick(version, versionKeys),
        items: version.items.map(item => {
          const clean = pick(item, ['name', 'qty', 'price', 'subtotal']);
          if (!Object.values(clean).every(scalar)) throw Error('dto_invalid');
          return clean;
        })
      }));
      if (dto.versions.some(version => Object.entries(version).some(([key, field]) => key !== 'items' && !scalar(field)))) {
        throw Error('dto_invalid');
      }
      if (dto.dummy_case) {
        if (!/^(?:CP|EC|HC)-00000000$/.test(caseId) || dto.dummy_case.case_id !== caseId ||
            dto.dummy_case.run_id !== '' || !Array.isArray(dto.dummy_case.mail_results) ||
            dto.dummy_case.mail_results.length || typeof dto.dummy_case.message !== 'string') throw Error('dto_invalid');
        dto.dummy_case = pick(dto.dummy_case, ['case_id', 'message', 'run_id', 'mail_results']);
      }
    }
    return dto;
  }

  function receiptView(dto) {
    const arrays = ['cc_emails', 'contract_ids', 'contract_doc_nos', 'estimate_doc_nos', 'invoice_doc_nos'];
    const base = receiptFields.filter(key => !arrays.includes(key) && !['paper_slip', 'paid_rows'].includes(key));
    if (base.some(key => !scalar(dto[key])) || arrays.some(key => !Array.isArray(dto[key]) ||
        !dto[key].every(item => typeof item === 'string'))) throw Error('dto_invalid');
    dto.paper_slip = pick(dto.paper_slip, ['status', 'request_id', 'requested_at', 'approved_at', 'approver']);
    if (!['none', 'pending', 'approved'].includes(dto.paper_slip.status) ||
        Object.values(dto.paper_slip).some(value => typeof value !== 'string')) throw Error('dto_invalid');
    dto.paid_rows = dto.paid_rows.map(row => {
      const view = pick(row, ['audit_row_hint', 'z_key', 'sales_record_id', 'case_id', 'contract_id', 'arrival_date', 'arrival_date_csv',
        'name', 'payment_method', 'equipment', 'amount_inc', 'tax_ex', 'tax', 'payment_split_index', 'payment_split_count',
        'is_split_payment', 'receipt_category',
        'receipt_identity_state', 'already_receipted', 'receipt_id']);
      if (view.case_id !== dto.case_id || !Object.values(view).every(scalar)) throw Error('dto_invalid');
      view.receipt_originals = row.receipt_originals.map(item => {
        const original = pick(item, ['receipt_id', 'tax_ex', 'tax', 'total_inc']);
        if (!Object.values(original).every(scalar)) throw Error('dto_invalid');
        return original;
      });
      return view;
    });
    return dto;
  }

  function create({ f5, config, context, control, fallbackPermit, gasCall, fetch, gasFetch, clearCache, relogin, metric, permitDto }) {
    if (![context, control, fallbackPermit, gasCall, fetch, gasFetch, clearCache, relogin, permitDto].every(fn => typeof fn === 'function')) {
      throw Error('configuration');
    }
    const clients = Object.fromEntries(Object.keys(fields).map(operation => [operation,
      f5.create({ baseUrl: config.baseUrl, siteSlot: config.siteSlot, timeoutMs: config.timeoutMs,
        enabled: config.enabled?.[operation] === true }, {
        context, control, fetch, clearCache, relogin, metric, fallbackPermit,
        gas: (op, payload, session, { signal }) => {
          const fetchOnce = f5.oneAttemptFetch((url, init) => gasFetch(url, {
            ...init,
            signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : signal || init?.signal
          }));
          return gasCall({
            form_type: op, case_id: payload.case_id, p1_sf: 'p1_sf_v1',
            ...(op !== 'reserve_lookup' ? { form_direct_fallback: 1 } : {}),
            sessionToken: session.token
          }, { mode: 'lookup', url: config.gasUrl, signal, maxBusyRetries: 0, retryDelays: [], fetchFn: fetchOnce });
        }
      })]));
    return Object.freeze({
      async read(operation, caseId, { signal } = {}) {
        const client = Object.hasOwn(clients, operation) && clients[operation];
        if (!client || !validCase(caseId)) throw Error('invalid_case');
        return client.call(operation, { case_id: caseId }, {
          project: value => project(value, operation, caseId),
          validate: dto => permitDto(dto, { operation, caseId }) === true
        }, { signal });
      },
      invalidate() { Object.values(clients).forEach(client => client.invalidate()); }
    });
  }
  const instance = Object.freeze({ create, validCase });
  if (typeof module === 'object' && module.exports) module.exports = instance;
  else root.S2FormRead = instance;
})(typeof globalThis === 'object' ? globalThis : window);
