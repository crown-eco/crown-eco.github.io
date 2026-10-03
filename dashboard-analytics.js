(function () {
  'use strict';
  var C = window.DashboardAnalyticsCore;
  var metrics = [
    { key: 'uriage_amount', label: '売上', color: '#2563eb' },
    { key: 'income', label: '収益合計', color: '#7c3aed' },
    { key: 'keihi', label: '経費', color: '#d97706' },
    { key: 'tenokori', label: '手残り', color: '#0f766e' }
  ];
  var graphMetrics = ['uriage_amount', 'koukoku_rieki', 'royalty', 'card_fee_profit', 'keihi', 'tenokori'];
  var A = { version: 0, range: null, source: null, graph: null, previous: {}, period: 'day', compare: 'month', axis: 'staff', barMetric: 'koukoku_rieki', cases: null, casePromise: null, caseQuery: null };
  function el(id) { return document.getElementById(id); }
  function openDashboardCases(card) {
    var regional = A.region !== '全体';
    var ids = regional ? (A.dashboard.ranking || []).filter(function (row) { return row.area === A.region; }).map(function (row) { return String(row.staff_id); }) : null;
    openCases({ range: A.dashboardRange, title: 'ダッシュボードの元の案件' + (regional ? '（所属：' + A.region + '）' : ''), staffIds: ids, reference: card.dataset.detail !== 'uriage_amount' });
  }
  function organizeKpi() {
    var grid = el('kpiGrid'), old = el('analyticsKpiDetails');
    if (old) old.remove();
    var cards = Array.from(grid.querySelectorAll('.kpi'));
    var primaryLabels = ['売上金額', '広告利益', '経費合計', '手残り'];
    primaryLabels.forEach(function (label) { var card = cards.find(function (c) { return c.querySelector('.label').textContent.replace('（全体）', '') === label; }); if (card) grid.appendChild(card); });
    var secondary = document.createElement('details'); secondary.id = 'analyticsKpiDetails'; secondary.className = 'analytics-kpi-details';
    secondary.innerHTML = '<summary>受注・ロイヤリティなどの内訳</summary><div class="kpi-grid"></div>';
    cards.forEach(function (card) { if (primaryLabels.indexOf(card.querySelector('.label').textContent.replace('（全体）', '')) < 0) secondary.querySelector('.kpi-grid').appendChild(card); });
    grid.insertAdjacentElement('afterend', secondary);
    secondary.addEventListener('click', function (event) { if (event.target.closest('[data-loss-modal]')) { openLossModal_(); return; } var card = event.target.closest('[data-detail]'); if (card) openDashboardCases(card); });
    secondary.addEventListener('keydown', function (event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.hasAttribute('data-detail')) { event.preventDefault(); event.target.click(); } });
    cards.forEach(function (card) {
      var label = card.querySelector('.label').textContent;
      if (label === '売上金額' || label === '受注件数' || label === '売上件数') {
        card.dataset.detail = label === '売上金額' ? 'uriage_amount' : 'reference'; card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', label + 'の元の案件を確認');
        var caption = document.createElement('div'); caption.className = 'kpi-detail-label'; caption.textContent = '元の案件を確認'; card.appendChild(caption);
      }
    });
  }
  function escape(value) { var node = document.createElement('span'); node.textContent = value == null ? '' : String(value); return node.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function totalSeries(res, metric) {
    if (metric !== 'income') return C.metricSeries(res, metric);
    var parts = ['koukoku_rieki', 'royalty', 'card_fee_profit'].map(function (key) { return C.metricSeries(res, key); });
    if (parts.some(function (p) { return !p; })) return null;
    return parts[0].map(function (_, i) { return parts.every(function (p) { return C.number(p[i]) !== null; }) ? parts.reduce(function (sum, p) { return sum + p[i]; }, 0) : null; });
  }
  function mount() {
    if (el('dashboardAnalytics')) return;
    var section = document.createElement('section'); section.id = 'dashboardAnalytics'; section.className = 'analytics'; section.hidden = true;
    section.innerHTML = '<div class="analytics-header"><h2>収益を詳しく見る</h2><button class="ghost" type="button" id="analyticsExport">グラフの数値をCSV保存</button></div>'
      + '<div class="analytics-controls"><label>グラフの開始日<input type="date" id="analyticsStart"></label><label>終了日<input type="date" id="analyticsEnd"></label>'
      + '<label>集計単位<select id="analyticsPeriod"><option value="day">日別</option><option value="week">週別（木〜水）</option><option value="month">月別</option></select></label>'
      + '<label>重ねる比較線<select id="analyticsCompare"><option value="none">表示しない</option><option value="month" selected>前月の同期間</option><option value="year">前年の同期間</option></select></label><button type="button" class="primary" id="analyticsApply">グラフを更新</button></div>'
      + '<p class="analytics-caption">推移・期間比較・手残りの内訳は会社全体。下の担当者比較は、上部で選んだ地域に絞ります。</p>'
      + '<div id="analyticsStatus" class="analytics-status" role="status" aria-live="polite"></div><div id="analyticsResults" hidden>'
      + '<div id="analyticsSummary" class="comparison-summary"></div><p id="analyticsReconciliation" class="analytics-caption" hidden></p><div class="analytics-trends">'
      + '<article class="analytics-chart"><div class="analytics-chart-head"><h3>売上の推移</h3><small>単位：円</small></div><div class="analytics-plot" id="analyticsRevenue"></div><div class="analytics-legend" id="revenueLegend"></div></article>'
      + '<article class="analytics-chart"><div class="analytics-chart-head"><h3>収益・経費・手残りの推移</h3><small>単位：円</small></div><div class="analytics-plot" id="analyticsProfit"></div><div class="analytics-legend" id="profitLegend"></div></article></div>'
      + '<details class="analytics-data"><summary>推移の数値・比較対象日を見る</summary><div class="analytics-scroll" id="analyticsTrendTable"></div></details>'
      + '<div class="analytics-lower"><article class="analytics-chart"><div class="analytics-chart-head"><h3>内訳を比較</h3><span class="analytics-chip" id="analyticsBarScope"></span></div>'
      + '<div class="analytics-controls"><label>比較する軸<select id="analyticsAxis"><option value="staff">担当者</option><option value="pref">地域（都道府県）</option><option value="company">広告会社</option></select></label>'
      + '<label>比較する数字<select id="analyticsBarMetric"><option value="koukoku_rieki">広告利益</option><option value="royalty">ロイヤリティ</option><option value="income">収益合計</option><option value="uriage_amount">売上</option></select></label></div>'
      + '<p class="analytics-caption" id="analyticsBarNote"></p><div class="analytics-plot" id="analyticsBars"></div><details class="analytics-data"><summary>比較の数値を見る</summary><div class="analytics-scroll" id="analyticsBarTable"></div></details></article>'
      + '<article class="analytics-chart"><div class="analytics-chart-head"><h3>売上から手残りまで</h3><small>単位：円</small></div><div class="analytics-plot" id="analyticsWaterfall"></div>'
      + '<p class="analytics-caption">売上と広告利益の差は差額で表示します。原価・広告費・報酬の個別内訳は、現行の取得項目からは分けられません。</p><details class="analytics-data"><summary>内訳の数字を見る</summary><div class="analytics-scroll" id="analyticsWaterfallTable"></div></details></article></div></div>'
      + '<details class="analytics-explanation"><summary>このグラフの見方・集計方法</summary><dl>'
      + '<dt>横軸</dt><dd>選択期間の日・週・月。週は既存サイトと同じ木曜〜水曜です。</dd>'
      + '<dt>縦軸</dt><dd>金額（円）。売上と収益は桁が違うため、別のグラフにしています。各グラフの縦軸を確認してください。</dd>'
      + '<dt>収益合計</dt><dd>広告利益 ＋ ロイヤリティ ＋ 手数料利益。純利益とは異なり、経費を引く前の額です。</dd>'
      + '<dt>手残り率</dt><dd>手残り ÷ 売上 × 100。売上が0円のときは算出しません。</dd>'
      + '<dt>実線・破線</dt><dd>実線は選択期間、破線は比較期間。前月・前年を選択期間の先頭から順に重ねます。対応する日付は数値表で確認できます。</dd>'
      + '<dt>前月・前年</dt><dd>日付を1か月・1年戻した同期間。月全体を選ぶと比較先も月全体です。日数の違いによる増減も含みます。比較額が0円なら増減率は算出しません。</dd>'
      + '<dt>期間合計と推移</dt><dd>カードと前月・前年の比較は会社収益の期間合計、推移は日・週・月ごとのグラフ集計値です。元の集計に差がある場合は、グラフの上に差額を表示します。比較率は期間合計から計算します。</dd>'
      + '<dt>地域の違い</dt><dd>担当者の地域は担当者の所属地域。都道府県の比較は案件の地域です。2つの切り口は一致するとは限りません。</dd>'
      + '<dt>概算・未取得</dt><dd>地域・広告会社のロイヤリティは、元の集計が概算なら明記します。取得できない値は未取得と表示し、0円には置き換えません。</dd>'
      + '<dt>元の案件</dt><dd>点・棒・数値表から対象の案件を開けます。経費や手残りは会社全体の集計なので、案件に直接ひもづく額としては表示しません。</dd></dl><p id="analyticsFormulaNote"></p></details>';
    el('kpiGrid').insertAdjacentElement('afterend', section);
    var dialog = document.createElement('dialog'); dialog.id = 'analyticsDetail'; dialog.className = 'analytics-dialog';
    dialog.innerHTML = '<div class="analytics-dialog-header"><h2 id="analyticsDetailTitle">元の案件明細</h2><button type="button" class="ghost" id="analyticsDetailClose">閉じる</button></div><div class="analytics-dialog-body"><p class="analytics-caption" id="analyticsDetailScope"></p><div class="analytics-dialog-controls"><label>案件番号・担当者で検索 <input type="search" id="analyticsCaseSearch" placeholder="案件番号・担当者"></label><button type="button" class="ghost" id="analyticsCaseExport">明細をCSV保存</button></div><div id="analyticsCaseCount" class="analytics-caption" role="status" aria-live="polite"></div><div id="analyticsCaseBody" class="analytics-scroll"></div></div>';
    document.body.appendChild(dialog);
    el('analyticsDetailClose').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) { var box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
    el('analyticsApply').addEventListener('click', function () {
      var start = el('analyticsStart').value, end = el('analyticsEnd').value;
      if (!C.date(start) || !C.date(end) || start > end) { status('開始日と終了日を確認してください。', true); return; }
      if ((C.date(end) - C.date(start)) / 86400000 > 730) { status('一度に表示する期間は2年以内にしてください。', true); return; }
      A.range = { start: start, end: end }; A.period = el('analyticsPeriod').value; startLoad();
    });
    el('analyticsCompare').addEventListener('change', function () { A.compare = this.value; if (A.graph) renderTrends(); });
    el('analyticsAxis').addEventListener('change', function () { A.axis = this.value; renderBars(); });
    el('analyticsBarMetric').addEventListener('change', function () { A.barMetric = this.value; renderBars(); });
    el('analyticsExport').addEventListener('click', exportTrend);
    el('analyticsCaseSearch').addEventListener('input', renderCases);
    el('analyticsCaseExport').addEventListener('click', exportCases);
    section.addEventListener('click', function (event) {
      var target = event.target.closest('[data-trend-point],[data-bar-index],[data-waterfall-index]');
      if (!target) return;
      if (target.hasAttribute('data-trend-point')) {
        var range = C.pointRange(A.graph.labels, +target.dataset.trendPoint, A.period, A.range);
        if (range) openCases({ range: range, title: 'この期間の元の案件', reference: true });
        else status('日付ラベルを読み取れません。期間全体の明細から確認してください。', true);
      } else if (target.hasAttribute('data-bar-index')) {
        var row = A.barRows[+target.dataset.barIndex];
        if (row) openCases({ range: A.range, axis: A.axis, id: row.id, name: row.name, title: row.name + 'の元の案件', reference: A.barMetric !== 'uriage_amount' });
      } else {
        var step = C.waterfall(A.source.kpi)[+target.dataset.waterfallIndex];
        if (step) openCases({ range: A.range, title: step.label + 'の確認', reference: true, extra: step.label + '：' + C.money(step.value) + '。これは会社全体の集計です。下記の案件売上とは直接一致しません。' });
      }
    });
    el('kpiGrid').addEventListener('click', function (event) { var card = event.target.closest('[data-detail]'); if (card) openDashboardCases(card); });
    el('kpiGrid').addEventListener('keydown', function (event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.hasAttribute('data-detail')) { event.preventDefault(); event.target.click(); } });
    new ResizeObserver(function () { if (A.graph && !section.hidden && !el('analyticsResults').hidden) { renderTrends(); drawBars(); drawWaterfall(); } }).observe(section);
  }
  function status(text, error) { el('analyticsStatus').textContent = text; el('analyticsStatus').classList.toggle('error', !!error); }
  function requestGraph(range) { return callApi_({ action: 'company_dashboard_graph', token: SESSION ? SESSION.token : '', period_type: A.period, start_date: range.start, end_date: range.end, metrics: graphMetrics.slice(), groups: [{ type: 'all' }], ua: navigator.userAgent || '' }); }
  function requestTotals(range) { return callApi_({ action: 'company_dashboard', token: SESSION ? SESSION.token : '', period_type: 'day', start_date: range.start, end_date: range.end, group: 'all', ua: navigator.userAgent || '' }); }
  function assertResponse(res) { if (!res || !res.ok) throw new Error(res && (res.error || res.reason) || 'データを取得できませんでした。'); return res; }
  async function load() {
    var version = ++A.version, range = Object.assign({}, A.range);
    A.graph = null; A.previous = {}; A.barRows = []; A.barRequest = (A.barRequest || 0) + 1;
    el('analyticsResults').hidden = true; el('analyticsExport').disabled = true; status('会社全体の推移と比較を読み込み中…');
    var month = C.comparisonRange(range, 'month'), year = C.comparisonRange(range, 'year');
    var sameDashboardRange = range.start === A.dashboardRange.start && range.end === A.dashboardRange.end;
    A.previous = { month: { range: month, response: null, kpi: null }, year: { range: year, response: null, kpi: null } };
    var sourcePromise = sameDashboardRange ? Promise.resolve(A.dashboard) : requestTotals(range);
    // Daily rounding can differ from the period total. Compare authoritative
    // period totals and show the current charts while comparisons load.
    var comparisonsPromise = Promise.allSettled([requestGraph(month), requestGraph(year), requestTotals(month), requestTotals(year)]);
    var results = await Promise.allSettled([requestGraph(range), sourcePromise]);
    if (version !== A.version) return;
    if (results[0].status === 'rejected' || !results[0].value || !results[0].value.ok) { status('推移を取得できませんでした。「グラフを更新」で再取得できます。', true); return; }
    A.graph = results[0].value;
    A.source = results[1].status === 'fulfilled' && results[1].value && results[1].value.ok && results[1].value.mode !== 'group' ? results[1].value : null;
    el('analyticsResults').hidden = false;
    status(range.start + ' 〜 ' + range.end + ' / 会社全体。前月・前年の比較を読み込み中…');
    renderSummary(); renderTrends(); renderBars(); drawWaterfall();
    el('analyticsFormulaNote').textContent = '取得元：会社収益の集計と案件一覧。' + (A.graph.notes && A.graph.notes.keihi_allocation ? '取得した経費・手残りには売上金額比の按分が含まれます。' : '会社全体の経費・手残りは元の集計値を使います。');
    var comparisons = await comparisonsPromise;
    if (version !== A.version) return;
    ['month', 'year'].forEach(function (kind, i) {
      var graph = comparisons[i], totals = comparisons[i + 2];
      A.previous[kind].response = graph.status === 'fulfilled' && graph.value && graph.value.ok ? graph.value : null;
      A.previous[kind].kpi = totals.status === 'fulfilled' && totals.value && totals.value.ok && totals.value.mode !== 'group' ? totals.value.kpi : null;
    });
    var missing = !A.source || !A.previous.month.response || !A.previous.year.response || !A.previous.month.kpi || !A.previous.year.kpi;
    status(range.start + ' 〜 ' + range.end + ' / 会社全体' + (missing ? '。一部の比較・内訳を取得できませんでした。未取得の値は空欄で表示します。' : '。点・棒から明細を開けます。'), missing);
    el('analyticsExport').disabled = false;
    renderSummary(); renderTrends();
  }
  function renderSummary() {
    var kpi = A.source && A.source.kpi || {}, revenue = C.number(kpi.uriage_amount), net = C.number(kpi.tenokori);
    var values = [{ label: '選択期間の売上', value: C.money(revenue), metric: 'uriage_amount' }, { label: '選択期間の手残り', value: C.money(net), metric: 'tenokori' }, { label: '手残り率', value: revenue && net !== null ? (net / revenue * 100).toFixed(1) + '%' : '算出不可' }, { label: '選択期間の経費', value: C.money(kpi.keihi), metric: 'keihi' }];
    el('analyticsSummary').innerHTML = values.map(function (item) {
      var comparisons = item.metric ? ['month', 'year'].map(function (kind) {
        var previous = C.number((A.previous[kind].kpi || {})[item.metric]), current = C.number(kpi[item.metric]), change = C.rate(current, previous);
        return (kind === 'month' ? '前月比 ' : '前年比 ') + (previous === null || current === null ? '未取得' : change === null ? '算出不可（比較額0円）' : (change > 0 ? '+' : '') + change.toFixed(1) + '%') + (current !== null && previous !== null ? ' / 差額 ' + C.money(current - previous) : '');
      }).map(function (s) { return '<small>' + escape(s) + '</small>'; }).join('') : '<small>手残り ÷ 売上 × 100</small>';
      return '<div class="comparison-stat"><span>' + item.label + '</span><strong>' + item.value + '</strong>' + comparisons + '</div>';
    }).join('');
    var differences = [];
    [{ label: '当期', graph: A.graph, kpi: kpi }, { label: '前月', graph: A.previous.month.response, kpi: A.previous.month.kpi }, { label: '前年', graph: A.previous.year.response, kpi: A.previous.year.kpi }].forEach(function (period) {
      if (!period.graph || !period.kpi) return;
      [{ key: 'uriage_amount', label: '売上' }, { key: 'tenokori', label: '手残り' }, { key: 'keihi', label: '経費' }].forEach(function (metric) {
        var plotted = C.sum(totalSeries(period.graph, metric.key) || []), total = C.number(period.kpi[metric.key]);
        if (plotted !== null && total !== null && Math.abs(plotted - total) >= 1) differences.push(period.label + 'の' + metric.label + ' ' + C.money(plotted - total));
      });
    });
    el('analyticsReconciliation').hidden = !differences.length;
    el('analyticsReconciliation').textContent = differences.length ? '推移と期間合計の集計差（推移 − 期間合計）：' + differences.join(' / ') + '。比較率は期間合計から計算しています。' : '';
  }
  function svgStart(width, height, label) { return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(label) + '"><title>' + escape(label) + '</title>'; }
  function compact(value) { var a = Math.abs(value); return a >= 10000 ? (value / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万' : Math.round(value).toLocaleString('ja-JP'); }
  function lineChart(id, items, labels, previousLabels) {
    var container = el(id), width = Math.max(280, container.clientWidth), height = 252, left = width < 400 ? 56 : 65, right = 14, top = 15, bottom = 38;
    var all = items.flatMap(function (item) { return item.data.filter(function (n) { return n !== null; }); });
    if (!labels.length || !all.length) { container.innerHTML = '<p class="case-empty">対象期間の数値は未取得です。</p>'; return; }
    var min = Math.min(0, Math.min.apply(null, all)), max = Math.max(0, Math.max.apply(null, all));
    if (min === max) max = min + 1000;
    var pad = (max - min) * .08; max += pad; if (min < 0) min -= pad;
    var plotWidth = width - left - right, plotHeight = height - top - bottom;
    function x(i) { return left + (labels.length === 1 ? plotWidth / 2 : i / (labels.length - 1) * plotWidth); }
    function y(n) { return top + (max - n) / (max - min) * plotHeight; }
    var html = svgStart(width, height, id === 'analyticsRevenue' ? '売上の推移、単位は円' : '収益合計・経費・手残りの推移、単位は円');
    for (var t = 0; t <= 4; t++) { var value = min + (max - min) * t / 4, yy = y(value); html += '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e8f0"/><text x="' + (left - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + compact(value) + '</text>'; }
    html += '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#94a3b8"/>';
    var tickCount = Math.min(labels.length, width < 400 ? 4 : 6), used = {};
    for (var tick = 0; tick < tickCount; tick++) { var idx = tickCount === 1 ? 0 : Math.round(tick / (tickCount - 1) * (labels.length - 1)); if (used[idx]) continue; used[idx] = true; html += '<text x="' + x(idx) + '" y="' + (height - 15) + '" text-anchor="' + (idx === 0 && labels.length > 1 ? 'start' : idx === labels.length - 1 && labels.length > 1 ? 'end' : 'middle') + '">' + escape(String(labels[idx]).replace(/^\d{4}-/, '').replace('-', '/')) + '</text>'; }
    items.forEach(function (item) {
      var path = '', open = false;
      item.data.slice(0, labels.length).forEach(function (value, i) { if (value === null) { open = false; return; } path += (open ? 'L' : 'M') + x(i).toFixed(2) + ',' + y(value).toFixed(2); open = true; });
      html += '<path d="' + path + '" fill="none" stroke="' + item.color + '" stroke-width="2.4"' + (item.previous ? ' stroke-dasharray="5 4" opacity=".55"' : '') + '/>';
      if (labels.length <= 35) item.data.slice(0, labels.length).forEach(function (value, i) { if (value !== null) html += '<circle cx="' + x(i) + '" cy="' + y(value) + '" r="' + (labels.length === 1 ? 4 : 2) + '" fill="' + item.color + '"' + (item.previous ? ' opacity=".4"' : '') + '/>'; });
    });
    labels.forEach(function (label, i) { var tip = label + '\n' + items.map(function (item) { return item.label + (item.previous ? '（' + (previousLabels[i] || '対応日なし') + '）' : '') + '：' + C.money(item.data[i]); }).join('\n'); var step = labels.length === 1 ? plotWidth : plotWidth / (labels.length - 1); html += '<rect class="chart-hit" data-trend-point="' + i + '" data-tip="' + escape(tip) + '" x="' + Math.max(left, x(i) - step / 2) + '" y="' + top + '" width="' + Math.min(step, width - right - Math.max(left, x(i) - step / 2)) + '" height="' + plotHeight + '" fill="transparent"><title>' + escape(tip) + '</title></rect>'; });
    container.innerHTML = html + '</svg>'; attachTooltip(container);
  }
  function attachTooltip(container) {
    var tooltip = document.createElement('div'); tooltip.className = 'analytics-tooltip'; tooltip.hidden = true; container.appendChild(tooltip);
    container.onpointermove = function (event) { var mark = event.target.closest('[data-tip]'); if (!mark) { tooltip.hidden = true; return; } tooltip.textContent = mark.dataset.tip; tooltip.hidden = false; var box = container.getBoundingClientRect(); tooltip.style.left = Math.max(0, Math.min(event.clientX - box.left + 12, box.width - tooltip.offsetWidth)) + 'px'; tooltip.style.top = Math.max(0, event.clientY - box.top - tooltip.offsetHeight - 8) + 'px'; };
    container.onpointerleave = function () { tooltip.hidden = true; };
  }
  function renderTrends() {
    if (!A.graph) return;
    var previous = A.compare !== 'none' && A.previous[A.compare] ? A.previous[A.compare].response : null;
    var items = metrics.map(function (metric) { return Object.assign({}, metric, { data: totalSeries(A.graph, metric.key) || (A.graph.labels || []).map(function () { return null; }) }); });
    var prior = previous ? metrics.map(function (metric) { return Object.assign({}, metric, { label: metric.label + '・比較期間', data: totalSeries(previous, metric.key) || [], previous: true }); }) : [];
    lineChart('analyticsRevenue', [items[0]].concat(prior.filter(function (item) { return item.key === 'uriage_amount'; })), A.graph.labels || [], previous && previous.labels || []);
    lineChart('analyticsProfit', items.slice(1).concat(prior.filter(function (item) { return item.key !== 'uriage_amount'; })), A.graph.labels || [], previous && previous.labels || []);
    function legend(list) { return list.map(function (metric) { return '<span><i style="background:' + metric.color + '"></i>' + metric.label + '</span>'; }).join('') + (previous ? '<span><i class="dashed"></i>' + (A.compare === 'month' ? '前月' : '前年') + '：破線</span>' : ''); }
    el('revenueLegend').innerHTML = legend(metrics.slice(0, 1)); el('profitLegend').innerHTML = legend(metrics.slice(1));
    var headers = ['対象期間', '売上', '収益合計', '経費', '手残り']; if (previous) headers.push('比較対象日', '比較期間の売上', '比較期間の手残り');
    var count = Math.max((A.graph.labels || []).length, previous ? (previous.labels || []).length : 0), rows = '';
    for (var i = 0; i < count; i++) {
      var label = A.graph.labels[i];
      rows += '<tr><td>' + (label ? '<button type="button" data-trend-point="' + i + '">' + escape(label) + '</button>' : '対応期間なし') + '</td>' + items.map(function (item) { return '<td class="num">' + (label ? C.money(item.data[i]) : '—') + '</td>'; }).join('') + (previous ? '<td>' + escape(previous.labels[i] || '対応日なし') + '</td><td class="num">' + C.money((prior[0].data || [])[i]) + '</td><td class="num">' + C.money((prior[3].data || [])[i]) + '</td>' : '') + '</tr>';
    }
    el('analyticsTrendTable').innerHTML = '<table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function barValue(row) {
    if (A.barMetric === 'income') return C.income(row);
    return C.number(row[A.barMetric]);
  }
  async function renderBars() {
    var version = A.version, request = A.barRequest = (A.barRequest || 0) + 1;
    A.barRows = [];
    if (!A.source) { el('analyticsBars').innerHTML = '<p class="case-empty">比較用の内訳は未取得です。</p>'; el('analyticsBarTable').innerHTML = ''; return; }
    var cross = A.source.cross_table || {};
    el('analyticsBarScope').textContent = A.axis === 'staff' && A.region !== '全体' ? '所属：' + A.region : '会社全体';
    el('analyticsBarNote').textContent = A.axis === 'staff' ? '数値が大きい順に上位8名。全件は数値表で確認できます。' : A.axis === 'pref' ? '数値が大きい順に上位8件。地域は案件の都道府県です。' : '集計対象の広告会社を比較します。全社の合計には他の経路の売上も含む場合があります。';
    if (A.axis === 'staff') {
      A.barRows = (A.source.ranking || []).filter(function (row) { return A.region === '全体' || row.area === A.region; }).map(function (row) { return { id: String(row.staff_id || ''), name: row.staff_name || row.staff_id || '未設定', value: barValue(row) }; });
    } else if (A.barMetric === 'koukoku_rieki' || A.barMetric === 'royalty') {
      var totals = cross.totals && (A.axis === 'pref' ? cross.totals.byPref : cross.totals.byCompany) || {};
      A.barRows = Object.keys(totals).map(function (id) { return { id: id, name: id, value: C.number(totals[id][A.barMetric === 'koukoku_rieki' ? 'rieki' : 'royalty']) }; });
      if (A.barMetric === 'royalty' && cross.royalty_approx) el('analyticsBarNote').textContent += ' ロイヤリティは広告利益×20%の概算です。';
    } else {
      var options = A.graph && A.graph.options || {};
      var ids = (A.axis === 'pref' ? options.prefs || cross.prefectures || [] : options.companies || cross.companies || []).map(function (row) { return typeof row === 'string' ? row : row.id; }).filter(Boolean);
      if (A.axis === 'company') el('analyticsBarScope').textContent = '対象 ' + ids.length + '社';
      if (!ids.length) { el('analyticsBars').innerHTML = '<p class="case-empty">比較対象がありません。</p>'; el('analyticsBarTable').innerHTML = ''; return; }
      el('analyticsBars').innerHTML = '<p class="case-empty">比較する数字を読み込み中…</p>'; el('analyticsBarTable').innerHTML = '';
      try {
        // Prefer explicit group IDs; accept a label only when it identifies one requested group.
        var requestedMetrics = A.barMetric === 'income' ? ['koukoku_rieki', 'royalty', 'card_fee_profit'] : [A.barMetric];
        var res = assertResponse(await callApi_({ action: 'company_dashboard_graph', token: SESSION ? SESSION.token : '', period_type: A.period, start_date: A.range.start, end_date: A.range.end, metrics: requestedMetrics, groups: [{ type: A.axis, ids: ids }], ua: navigator.userAgent || '' }));
        if (version !== A.version || request !== A.barRequest) return;
        var groups = {};
        (res.series || []).forEach(function (series) {
          var groupId = series.group_id != null ? series.group_id : series.group && series.group.id != null ? series.group.id : series.id;
          if (groupId == null && ids.length === 1) groupId = ids[0];
          if (groupId == null && series.label) groupId = ids.find(function (id) { var escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp('(^|[ /:・｜])' + escapedId + '($|[ /:・｜])').test(series.label); });
          if (groupId == null) return;
          groupId = String(groupId); if (!groups[groupId]) groups[groupId] = { id: groupId, name: series.group_label || series.group_name || groupId, metrics: {} };
          groups[groupId].metrics[series.metric] = C.sum(series.data || []);
        });
        A.barRows = Object.keys(groups).map(function (id) { var row = groups[id]; return { id: id, name: row.name, value: A.barMetric === 'income' ? C.income(row.metrics) : C.number(row.metrics[A.barMetric]) }; });
        if (A.barMetric === 'income' && res.notes && res.notes.royalty_direct) el('analyticsBarNote').textContent += ' ロイヤリティは売上管理からの集計値です。';
        if (!A.barRows.length) el('analyticsBarNote').textContent += ' 比較対象ごとの数値を確認できませんでした。';
      } catch (error) {
        if (version === A.version && request === A.barRequest) { el('analyticsBars').innerHTML = '<p class="case-empty">この内訳を取得できませんでした。比較する数字を切り替えると再取得します。</p>'; }
        return;
      }
    }
    A.barRows.sort(function (a, b) { return (b.value === null ? -Infinity : b.value) - (a.value === null ? -Infinity : a.value); });
    drawBars();
    el('analyticsBarTable').innerHTML = '<table><thead><tr><th>対象</th><th class="num">' + escape(el('analyticsBarMetric').selectedOptions[0].textContent) + '</th></tr></thead><tbody>' + A.barRows.map(function (row, i) { return '<tr><td><button type="button" data-bar-index="' + i + '">' + escape(row.name) + '</button></td><td class="num">' + C.money(row.value) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function drawBars() {
    var container = el('analyticsBars'); if (!A.barRows) return;
    var rows = A.barRows.filter(function (row) { return row.value !== null; }).slice(0, 8);
    if (!rows.length) { container.innerHTML = '<p class="case-empty">対象期間の内訳はありません。</p>'; return; }
    var width = Math.max(280, container.clientWidth), left = width < 380 ? 82 : 110, right = 76, height = 35 + rows.length * 34;
    var min = Math.min(0, ...rows.map(function (r) { return r.value; })), max = Math.max(0, ...rows.map(function (r) { return r.value; })); if (min === max) max += 1;
    function x(n) { return left + (n - min) / (max - min) * (width - left - right); }
    var html = svgStart(width, height, el('analyticsBarMetric').selectedOptions[0].textContent + 'の比較、単位は円');
    html += '<line x1="' + x(0) + '" x2="' + x(0) + '" y1="8" y2="' + (height - 26) + '" stroke="#94a3b8"/>';
    rows.forEach(function (row) {
      var actualIndex = A.barRows.indexOf(row), y = rows.indexOf(row) * 34 + 13;
      html += '<text x="' + (left - 8) + '" y="' + (y + 14) + '" text-anchor="end">' + escape(row.name.length > 8 ? row.name.slice(0, 7) + '…' : row.name) + '</text><rect x="' + Math.min(x(0), x(row.value)) + '" y="' + y + '" width="' + Math.max(0, Math.abs(x(row.value) - x(0))) + '" height="20" rx="3" fill="' + (row.value < 0 ? '#dc2626' : '#0f766e') + '"/><text x="' + (width - 2) + '" y="' + (y + 14) + '" text-anchor="end">' + compact(row.value) + '</text><rect class="chart-hit" data-bar-index="' + actualIndex + '" data-tip="' + escape(row.name + '：' + C.money(row.value)) + '" x="0" y="' + (y - 4) + '" width="' + width + '" height="30" fill="transparent"><title>' + escape(row.name + '：' + C.money(row.value)) + '</title></rect>';
    });
    html += '<text x="' + left + '" y="' + (height - 5) + '">' + compact(min) + '</text><text x="' + (width - right) + '" y="' + (height - 5) + '" text-anchor="end">' + compact(max) + ' 円</text>';
    container.innerHTML = html + '</svg>'; attachTooltip(container);
  }
  function drawWaterfall() {
    var container = el('analyticsWaterfall'), steps = A.source ? C.waterfall(A.source.kpi || {}) : [];
    if (!steps.length) { container.innerHTML = '<p class="case-empty">内訳を取得できませんでした。</p>'; el('analyticsWaterfallTable').innerHTML = ''; return; }
    // Horizontal waterfall keeps all labels readable on narrow screens.
    var width = Math.max(280, container.clientWidth), height = steps.length * 34 + 35, left = width < 380 ? 118 : 142, right = 12;
    var min = Math.min(0, ...steps.flatMap(function (s) { return [s.from, s.to]; })), max = Math.max(0, ...steps.flatMap(function (s) { return [s.from, s.to]; })); if (min === max) max += 1;
    function x(n) { return left + (n - min) / (max - min) * (width - left - right); }
    var html = svgStart(width, height, '売上から手残りへの増減、単位は円');
    html += '<line x1="' + x(0) + '" x2="' + x(0) + '" y1="8" y2="' + (height - 24) + '" stroke="#94a3b8"/>';
    steps.forEach(function (step, i) {
      var y = 12 + i * 34, label = step.label === '売上と広告利益の差' ? '売上→広告利益の差' : step.label === 'その他調整（差額）' ? 'その他調整（差額）' : step.label;
      html += '<text x="' + (left - 8) + '" y="' + (y + 14) + '" text-anchor="end">' + escape(label) + '</text><rect x="' + Math.min(x(step.from), x(step.to)) + '" y="' + y + '" width="' + Math.abs(x(step.to) - x(step.from)) + '" height="20" rx="3" fill="' + (step.total ? i === steps.length - 1 ? '#0f766e' : '#2563eb' : step.value >= 0 ? '#7c3aed' : '#d97706') + '"/>';
      if (i < steps.length - 1) html += '<line x1="' + x(step.to) + '" x2="' + x(step.to) + '" y1="' + (y + 20) + '" y2="' + (y + 34) + '" stroke="#cbd5e1" stroke-dasharray="2 2"/>';
      html += '<rect class="chart-hit" data-waterfall-index="' + i + '" data-tip="' + escape(step.label + '：' + C.money(step.value) + '\n累計：' + C.money(step.to)) + '" x="0" y="' + (y - 4) + '" width="' + width + '" height="30" fill="transparent"><title>' + escape(step.label + '：' + C.money(step.value)) + '</title></rect>';
    });
    html += '<text x="' + left + '" y="' + (height - 5) + '">' + compact(min) + '</text><text x="' + (width - right) + '" y="' + (height - 5) + '" text-anchor="end">' + compact(max) + ' 円</text>';
    container.innerHTML = html + '</svg>'; attachTooltip(container);
    el('analyticsWaterfallTable').innerHTML = '<table><thead><tr><th>項目</th><th class="num">増減・合計</th><th class="num">累計</th></tr></thead><tbody>' + steps.map(function (step, i) { return '<tr><td><button type="button" data-waterfall-index="' + i + '">' + escape(step.label) + '</button></td><td class="num">' + C.money(step.value) + '</td><td class="num">' + C.money(step.to) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  async function getCases() {
    if (window.DashboardDemo) return window.DashboardDemo.cases();
    var endpoint = 'https://script.google.com/macros/s/AKfycbyWAsYrvJs4ihH046NL-tIzUBsPM7rOdm0MSdKjptR9KliR6Et0SvS_2z_egd4I7476FQ/exec';
    var response = await gasReadFetch(endpoint + '?mode=cases&token=' + encodeURIComponent(SESSION ? SESSION.token : ''), { redirect: 'follow' });
    var data = assertResponse(await response.json());
    if (data.is_admin !== true) throw new Error('管理者の案件一覧を確認できませんでした。');
    if (!Array.isArray(data.rows)) throw new Error('案件一覧を取得できませんでした。');
    return data.rows;
  }
  async function openCases(query) {
    A.caseQuery = query; A.filteredCases = [];
    var dialog = el('analyticsDetail'); el('analyticsDetailTitle').textContent = query.title;
    el('analyticsDetailScope').textContent = query.range.start + ' 〜 ' + query.range.end + '。' + (query.extra || '案件一覧の契約日で絞り込みます。売上計上日・承認日で集計した収益と一致するとは限りません。');
    el('analyticsCaseSearch').value = ''; el('analyticsCaseCount').textContent = '案件を読み込み中…'; el('analyticsCaseBody').innerHTML = ''; el('analyticsCaseExport').disabled = true;
    if (!dialog.open) dialog.showModal();
    try {
      if (!A.casePromise) {
        var caseVersion = A.caseVersion = (A.caseVersion || 0) + 1;
        A.casePromise = getCases().then(function (rows) { if (caseVersion === A.caseVersion) A.cases = rows; return rows; }).catch(function (error) { if (caseVersion === A.caseVersion) A.casePromise = null; throw error; });
      }
      await A.casePromise; if (A.caseQuery !== query) return; renderCases();
    } catch (error) { if (A.caseQuery !== query) return; el('analyticsCaseCount').textContent = '明細を取得できませんでした。'; el('analyticsCaseBody').innerHTML = '<p class="case-empty">閉じて開き直すと再取得します。続く場合は、ログインし直してからお試しください。</p>'; }
  }
  function renderCases() {
    if (!A.cases || !A.caseQuery) return;
    var query = A.caseQuery, search = el('analyticsCaseSearch').value.trim().toLowerCase();
    var missingPref = query.axis === 'pref' && A.cases.some(function (row) { var rowDate = String(row.date || '').slice(0, 10); return rowDate >= query.range.start && rowDate <= query.range.end && !row.pref && !row.prefecture; });
    if (missingPref) { A.filteredCases = []; el('analyticsCaseCount').textContent = '都道府県を含まない案件明細があるため、この地域の明細は確認できません。'; el('analyticsCaseBody').innerHTML = '<p class="case-empty">案件一覧に地域の情報がないため、担当者別または広告会社別の明細をご利用ください。</p>'; el('analyticsCaseExport').disabled = true; return; }
    var rows = A.cases.filter(function (row) {
      var rowDate = String(row.date || '').slice(0, 10);
      if (!C.date(rowDate) || rowDate < query.range.start || rowDate > query.range.end) return false;
      if (query.staffIds && query.staffIds.indexOf(String(row.staff_id)) < 0) return false;
      if (query.axis === 'staff' && String(row.staff_id) !== String(query.id)) return false;
      if (query.axis === 'pref' && (row.pref || row.prefecture) !== query.id) return false;
      if (query.axis === 'company' && String(row.company || row.case_id || '').slice(0, 2).toUpperCase() !== String(query.id).toUpperCase()) return false;
      return !search || [row.case_id, row.staff_name, row.staff_id].join(' ').toLowerCase().indexOf(search) >= 0;
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    A.filteredCases = rows; el('analyticsCaseExport').disabled = !rows.length;
    el('analyticsCaseCount').textContent = rows.length + '件 / 案件一覧の売上合計 ' + C.money(C.sum(rows.map(function (row) { return row.sales; }))) + (query.reference ? '。参考明細：会社収益の個別配賦ではありません。' : '。集計日・対象範囲の違いにより、ダッシュボードの売上と一致しない場合があります。');
    el('analyticsCaseBody').innerHTML = rows.length ? '<table><thead><tr><th>案件番号</th><th>契約日</th><th>担当者</th><th>地域</th><th>広告会社</th><th class="num">案件売上</th><th>契約状況</th><th>入金状態</th></tr></thead><tbody>' + rows.map(function (row) { return '<tr>' + [row.case_id, String(row.date).slice(0, 10), row.staff_name || row.staff_id, row.pref || row.prefecture || '未取得', row.company || String(row.case_id || '').slice(0, 2)].map(function (value) { return '<td>' + escape(value) + '</td>'; }).join('') + '<td class="num">' + C.money(row.sales) + '</td><td>' + escape(row.status) + '</td><td>' + escape(row.pay_status) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="case-empty">この条件の案件はありません。</p>';
  }
  function download(rows, name) { var blob = new Blob([C.csv(rows)], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function exportTrend() {
    if (!A.graph) return;
    var rows = [['取得区分', window.DashboardDemo ? '見本データ（実績ではありません）' : '会社全体'], ['対象期間', A.range.start, A.range.end], ['集計単位', A.period], ['比較方法', '前月・前年の同期間（暦月）'], ['前月期間', A.previous.month.range.start, A.previous.month.range.end], ['前年期間', A.previous.year.range.start, A.previous.year.range.end], ['日付', '売上', '収益合計', '経費', '手残り', '前月の対応日', '前月売上', '前年の対応日', '前年売上']];
    var data = metrics.map(function (m) { return totalSeries(A.graph, m.key) || []; });
    var month = A.previous.month.response, year = A.previous.year.response;
    var count = Math.max((A.graph.labels || []).length, month ? (month.labels || []).length : 0, year ? (year.labels || []).length : 0);
    for (var i = 0; i < count; i++) { rows.push([A.graph.labels[i]].concat(data.map(function (series) { return series[i]; })).concat([month && month.labels[i], (totalSeries(month, 'uriage_amount') || [])[i], year && year.labels[i], (totalSeries(year, 'uriage_amount') || [])[i]])); }
    download(rows, '会社収益推移_' + A.range.start + '_' + A.range.end + '.csv');
  }
  function exportCases() { if (!A.filteredCases || !A.filteredCases.length) return; var rows = [['取得区分', window.DashboardDemo ? '見本データ（実績ではありません）' : '案件一覧（契約日基準）'], ['案件番号', '契約日', '担当者', '地域', '広告会社', '案件売上', '契約状況', '入金状態']]; A.filteredCases.forEach(function (row) { rows.push([row.case_id, row.date, row.staff_name || row.staff_id, row.pref || row.prefecture || '', row.company || String(row.case_id || '').slice(0, 2), C.number(row.sales), row.status, row.pay_status]); }); download(rows, '案件明細_' + A.caseQuery.range.start + '.csv'); }
  function startLoad() { var version = A.version + 1; load().catch(function () { if (version === A.version) status('集計の読み込みに失敗しました。グラフを更新してください。', true); }); }
  window.DashboardAnalytics = {
    invalidate: function () { if (window.DashboardGroupAnalytics) window.DashboardGroupAnalytics.invalidate(); A.caseVersion = (A.caseVersion || 0) + 1; A.cases = null; A.casePromise = null; A.caseQuery = null; if (el('analyticsKpiDetails')) el('analyticsKpiDetails').remove(); if (el('dashboardAnalytics')) { A.version++; A.barRequest = (A.barRequest || 0) + 1; A.graph = null; el('dashboardAnalytics').hidden = true; if (el('analyticsDetail').open) el('analyticsDetail').close(); } },
    refresh: function (response, state) {
      mount(); A.version++; A.barRequest = (A.barRequest || 0) + 1;
      var allowed = response.mode !== 'group' && isAdminSession_() && !siteGroup_();
      el('dashboardAnalytics').hidden = !allowed;
      if (response.mode === 'group' && window.DashboardGroupAnalytics) window.DashboardGroupAnalytics.refresh(response, state);
      if (!allowed) { A.graph = null; A.cases = null; A.casePromise = null; if (el('analyticsDetail').open) el('analyticsDetail').close(); return; }
      A.dashboard = response; A.dashboardRange = { start: response.period.start, end: response.period.end };
      A.region = state.region; A.range = Object.assign({}, A.dashboardRange);
      el('analyticsStart').value = A.range.start; el('analyticsEnd').value = A.range.end; el('analyticsPeriod').value = A.period;
      organizeKpi();
      startLoad();
    },
    regionChanged: function (region) { if (window.DashboardGroupAnalytics) window.DashboardGroupAnalytics.regionChanged(region); A.region = region; if (A.graph) { organizeKpi(); renderBars(); } }
  };
})();
