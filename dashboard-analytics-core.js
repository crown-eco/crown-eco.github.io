(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashboardAnalyticsCore = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function date(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
  }
  function key(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function shift(value, months) {
    var d = date(value); if (!d) return '';
    var first = new Date(d.getFullYear(), d.getMonth() + months, 1);
    return key(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate())));
  }
  function comparisonRange(range, kind) {
    var months = kind === 'year' ? -12 : -1;
    var start = date(range.start), end = date(range.end);
    if (!start || !end) throw new Error('日付を確認してください。');
    var fullMonth = start.getDate() === 1 && end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
    var shiftedStart = shift(range.start, months), shiftedEnd = shift(range.end, months);
    if (fullMonth) {
      var se = date(shiftedEnd);
      shiftedEnd = key(new Date(se.getFullYear(), se.getMonth() + 1, 0));
    }
    return { start: shiftedStart, end: shiftedEnd };
  }
  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value); return Number.isFinite(n) ? n : null;
  }
  function sum(values) {
    var available = values.map(number);
    return available.length && available.every(function (v) { return v !== null; }) ? available.reduce(function (a, b) { return a + b; }, 0) : null;
  }
  function rate(current, previous) {
    var c = number(current), p = number(previous);
    return c === null || p === null || p === 0 ? null : (c - p) / Math.abs(p) * 100;
  }
  function metricSeries(response, metric) {
    var candidates = (response && response.series || []).filter(function (s) { return s.metric === metric; });
    if (candidates.length !== 1 || !Array.isArray(candidates[0].data)) return null;
    return candidates[0].data.map(number);
  }
  function money(value) { var n = number(value); return n === null ? '未取得' : (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); }
  function income(k) {
    var keys = ['koukoku_rieki', 'royalty', 'card_fee_profit'];
    return keys.every(function (name) { return number(k[name]) !== null; }) ? sum(keys.map(function (name) { return k[name]; })) : null;
  }
  function waterfall(k) {
    if (['uriage_amount', 'koukoku_rieki', 'royalty', 'card_fee_profit', 'keihi', 'tenokori'].some(function (name) { return number(k[name]) === null; })) return [];
    var steps = [
      { label: '売上', value: +k.uriage_amount, total: true },
      { label: '売上と広告利益の差', value: +k.koukoku_rieki - +k.uriage_amount },
      { label: '広告利益', value: +k.koukoku_rieki, total: true },
      { label: 'ロイヤリティ', value: +k.royalty },
      { label: '手数料利益', value: +k.card_fee_profit }
    ];
    if (number(k.kameikin) !== null) steps.push({ label: '加盟金', value: +k.kameikin });
    steps.push({ label: '経費', value: -(+k.keihi) });
    var expected = income(k) + (number(k.kameikin) || 0) - +k.keihi;
    var adjustment = +k.tenokori - expected;
    if (Math.abs(adjustment) >= 1) steps.push({ label: 'その他調整（差額）', value: adjustment });
    steps.push({ label: '手残り', value: +k.tenokori, total: true });
    var running = 0;
    return steps.map(function (s) { var from = s.total ? 0 : running; running = s.total ? s.value : running + s.value; return Object.assign({}, s, { from: from, to: running }); });
  }
  function csv(rows) {
    return '\ufeff' + rows.map(function (row) { return row.map(function (value) {
      var s = value === null || value === undefined ? '' : String(value);
      if (/^[\s]*[=+@-]/.test(s) && typeof value !== 'number') s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(','); }).join('\r\n');
  }
  function pointRange(labels, index, periodType, range) {
    var label = String(labels[index] || '');
    var start = date(label.slice(0, 10));
    if (!start && periodType === 'month' && /^\d{4}-\d{2}$/.test(label)) start = date(label + '-01');
    if (!start) {
      // Some graph responses use short display labels. Map them only when the
      // returned bucket count agrees with the requested calendar interval.
      var first = date(range.start), last = date(range.end), buckets = [];
      if (!first || !last) return null;
      if (periodType === 'week') first = addDays(first, -((first.getDay() - 4 + 7) % 7));
      if (periodType === 'month') first = new Date(first.getFullYear(), first.getMonth(), 1);
      for (var cursor = first; cursor <= last && buckets.length <= 732; cursor = periodType === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) : addDays(cursor, periodType === 'week' ? 7 : 1)) buckets.push(cursor);
      if (buckets.length === labels.length) start = buckets[index];
    }
    if (!start) return null;
    var end = periodType === 'week' ? addDays(start, 6) : periodType === 'month' ? new Date(start.getFullYear(), start.getMonth() + 1, 0) : start;
    return { start: key(start) < range.start ? range.start : key(start), end: key(end) > range.end ? range.end : key(end) };
  }
  function groupBuckets(range, unit) {
    var first = date(range.start), last = date(range.end), buckets = [];
    if (!first || !last || first > last || ['day','week','month'].indexOf(unit) < 0) throw new Error('期間を確認してください。');
    if (unit === 'week') first = addDays(first, -((first.getDay() + 3) % 7));
    if (unit === 'month') first = new Date(first.getFullYear(), first.getMonth(), 1);
    for (var d = first; d <= last; d = unit === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : addDays(d, unit === 'week' ? 7 : 1)) {
      var end = unit === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 0) : addDays(d, unit === 'week' ? 6 : 0);
      buckets.push({ start: key(d) < range.start ? range.start : key(d), end: key(end) > range.end ? range.end : key(end) });
      if (buckets.length > 62) throw new Error('日別は62日、週別は62週、月別は62か月以内にしてください。');
    }
    return buckets;
  }
  var groupFields = ['uriage_amount','ad_cost','keihi','co_fee','royalty_yoshida','tenokori','juchu_count','uriage_count'];
  function groupResponse(value, id, range) {
    if (!value || value.ok !== true || value.mode !== 'group' || !value.group || value.group.id !== id || !value.period || value.period.start !== range.start || value.period.end !== range.end || !value.kpi || !Array.isArray(value.ranking)) throw new Error('対象グループの集計を確認できませんでした。');
    var kpi = {}; groupFields.forEach(function (field) { kpi[field] = number(value.kpi[field]); });
    return { group: { id: id, display_name: String(value.group.display_name || id) }, range: { start: range.start, end: range.end }, kpi: kpi, ranking: value.ranking.map(function (row) {
      var result = { staff_id: String(row.staff_id || ''), staff_name: String(row.staff_name || ''), area: String(row.area || 'その他') };
      ['uriage_amount','ad_cost','juchu_count','uriage_count'].forEach(function (field) { result[field] = number(row[field]); });
      return result;
    }) };
  }
  function groupPayload(id, site, token, range, ua) {
    if (!/^[a-z0-9_]+$/.test(id || '') || id === 'main' || site && site !== id) throw new Error('グループを確認してください。');
    var payload = { action: 'company_dashboard', token: token, group: id === 'all' ? 'group:all' : id, period_type: 'day', start_date: range.start, end_date: range.end, ua: ua || '' };
    if (site) payload.siteGroup = site;
    return payload;
  }
  function groupWaterfall(k) {
    if (groupFields.slice(0,6).some(function (field) { return number(k[field]) === null; })) return [];
    var steps = [{label:'売上',value:k.uriage_amount,total:true},{label:'CO差額',value:-k.co_fee},{label:'広告費',value:-k.ad_cost},{label:'経費',value:-k.keihi},{label:'吉田さんロイヤリティ',value:-k.royalty_yoshida}];
    var delta = k.tenokori - (k.uriage_amount-k.co_fee-k.ad_cost-k.keihi-k.royalty_yoshida);
    if (Math.abs(delta) >= 1) steps.push({label:'集計差額',value:delta});
    steps.push({label:'手残り',value:k.tenokori,total:true});
    var running = 0;
    return steps.map(function (step) { var from = step.total ? 0 : running; running = step.total ? step.value : running + step.value; return Object.assign({},step,{from:from,to:running}); });
  }
  async function groupLoad(buckets, read, active, progress) {
    var index = 0, done = 0, results = new Array(buckets.length).fill(null);
    async function worker() {
      while (active() && index < buckets.length) {
        var i = index++;
        try { var value = await read(buckets[i]); if (active()) results[i] = value; } catch (_) {}
        if (active()) progress(results, ++done);
      }
    }
    await Promise.all([worker(),worker()]);
    return results;
  }
  return { date: date, key: key, addDays: addDays, shift: shift, comparisonRange: comparisonRange, number: number, sum: sum, rate: rate, metricSeries: metricSeries, money: money, income: income, waterfall: waterfall, csv: csv, pointRange: pointRange, groupBuckets:groupBuckets, groupResponse:groupResponse, groupPayload:groupPayload, groupWaterfall:groupWaterfall, groupLoad:groupLoad, groupFields:groupFields };
});
