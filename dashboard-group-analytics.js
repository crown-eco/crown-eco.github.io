(function () {
  'use strict';
  var C = window.DashboardAnalyticsCore;
  var G = { version:0, active:false, data:[], previous:[], region:'全体', cache:new Map(), queue:[], running:0 };
  var metrics = [
    {key:'uriage_amount',label:'売上',color:'#2563eb'},
    {key:'ad_cost',label:'広告費',color:'#d97706'},
    {key:'keihi',label:'経費',color:'#c2410c'},
    {key:'royalty_yoshida',label:'吉田さんロイヤリティ',color:'#7c3aed'},
    {key:'tenokori',label:'手残り',color:'#0f766e'}
  ];
  var labels = {uriage_amount:'売上',ad_cost:'広告費',keihi:'経費',co_fee:'CO差額',royalty_yoshida:'吉田さんロイヤリティ',tenokori:'手残り',juchu_count:'受注件数',uriage_count:'売上件数'};
  function el(id) { return document.getElementById('group' + id); }
  function esc(value) { var node=document.createElement('span'); node.textContent=String(value == null ? '' : value); return node.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function amount(value,metric) { return /_count$/.test(metric) ? C.number(value) === null ? '未取得' : Number(value).toLocaleString('ja-JP')+'件' : C.money(value); }
  function caption(range) { return range.start + (range.start === range.end ? '' : ' 〜 ' + range.end); }
  function status(text,error) { el('Status').textContent=text; el('Status').classList.toggle('error',!!error); }
  function table(headers,rows) { return '<table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+row.map(function(v){return '<td>'+esc(v)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>'; }
  function mount() {
    if(el('Analytics'))return;
    var section=document.createElement('section'); section.id='groupAnalytics'; section.className='analytics'; section.hidden=true;
    section.innerHTML='<div class="analytics-header"><h2 id="groupTitle">グループの収支を詳しく見る</h2><button type="button" class="ghost" id="groupExport">グラフの数値をCSV保存</button></div>'
      +'<div class="analytics-controls"><label>グラフの開始日<input type="date" id="groupStart"></label><label>終了日<input type="date" id="groupEnd"></label><label>集計単位<select id="groupUnit"><option value="day">日別</option><option value="week">週別（木〜水）</option><option value="month">月別</option></select></label><label>比較期間<select id="groupCompare"><option value="none">表示しない</option><option value="month">前月の同期間</option><option value="year">前年の同期間</option></select></label><button type="button" class="primary" id="groupApply">グラフを更新</button></div>'
      +'<p id="groupScope" class="analytics-caption"></p><p id="groupStatus" class="analytics-status" role="status" aria-live="polite"></p><div id="groupResults">'
      +'<div id="groupSummary" class="comparison-summary"></div><p id="groupReconciliation" class="analytics-caption"></p><div class="analytics-trends">'
      +'<article class="analytics-chart"><div class="analytics-chart-head"><h3>売上の推移</h3><small>単位：円</small></div><div id="groupRevenue" class="analytics-plot"></div><div id="groupRevenueLegend" class="analytics-legend"></div></article>'
      +'<article class="analytics-chart"><div class="analytics-chart-head"><h3>広告費・経費・ロイヤリティ・手残り</h3><small>単位：円</small></div><div id="groupProfit" class="analytics-plot"></div><div id="groupProfitLegend" class="analytics-legend"></div></article></div>'
      +'<details class="analytics-data"><summary>推移の数値・比較対象期間を見る</summary><div id="groupTrendTable" class="analytics-scroll"></div></details>'
      +'<div class="analytics-lower"><article class="analytics-chart"><h3>担当者・所属地域を比較</h3><div class="analytics-controls"><label>比較する軸<select id="groupAxis"><option value="staff">担当者</option><option value="area">所属地域</option></select></label><label>比較する数字<select id="groupBarMetric"><option value="uriage_amount">売上</option><option value="ad_cost">広告費</option><option value="juchu_count">受注件数</option><option value="uriage_count">売上件数</option></select></label></div><p id="groupBarScope" class="analytics-caption"></p><div id="groupBars" class="analytics-plot"></div><details class="analytics-data"><summary>全員の数値を見る</summary><div id="groupBarTable" class="analytics-scroll"></div></details></article>'
      +'<article class="analytics-chart"><div class="analytics-chart-head"><h3>売上から手残りまで</h3><small>単位：円</small></div><div id="groupWaterfall" class="analytics-plot"></div><details class="analytics-data"><summary>内訳の数字を見る</summary><div id="groupWaterfallTable" class="analytics-scroll"></div></details></article></div></div>'
      +'<details class="analytics-explanation"><summary>このグラフの見方・集計方法</summary><dl>'
      +'<dt>表示範囲</dt><dd>画面に表示したグループの集計です。売上推移・費用・手残りはグループ全体、担当者比較は上部で選んだ所属地域で絞ります。</dd>'
      +'<dt>横軸と縦軸</dt><dd>横軸は日・週・月、縦軸は円。週は木曜〜水曜で、選択期間の外の日は含めません。点を押すと、その期間の集計と担当者別の数字を確認できます。</dd>'
      +'<dt>手残り</dt><dd>売上 − CO差額 − 広告費 − 経費 − 吉田さんロイヤリティ。すべて既存ダッシュボードの集計値を使います。</dd>'
      +'<dt>期間ごとの計算</dt><dd>ロイヤリティや手残りは各期間ごとに計算されます。赤字の扱いや丸めにより、日別・週別の合計と期間全体の額が一致しない場合は差額を表示します。上の比較カードは期間全体の集計値です。</dd>'
      +'<dt>比較線</dt><dd>実線は選択期間、破線は前月または前年の同期間を先頭から重ねたものです。対応期間は数値表に表示します。月全体を選ぶと比較先も月全体になるため、日数の違いを含みます。比較額が0円の場合、増減率は算出しません。</dd>'
      +'<dt>集計日</dt><dd>受注・広告費は受付日、売上は契約日、経費は申請日時、CO差額はCO日が基準です。担当者別に取得できない経費やロイヤリティは配分しません。</dd>'
      +'<dt>読み込みと未取得</dt><dd>選択した単位ごとに集計するため、初回は順に表示されます。月を開いた直後は週別、1週間以内は日別です。日別にも切り替えられます。未取得の点は線をつながず、0円に置き換えません。</dd></dl></details>';
    document.getElementById('kpiGrid').insertAdjacentElement('afterend',section);
    var dialog=document.createElement('dialog'); dialog.id='groupDetail'; dialog.className='analytics-dialog';
    dialog.innerHTML='<div class="analytics-dialog-header"><h2 id="groupDetailTitle">期間の内訳</h2><button id="groupClose" class="ghost" type="button">閉じる</button></div><div class="analytics-dialog-body"><p id="groupDetailNote" class="analytics-caption"></p><div id="groupDetailBody" class="analytics-scroll"></div></div>';
    document.body.appendChild(dialog);
    el('Close').addEventListener('click',function(){dialog.close();});
    el('Apply').addEventListener('click',function(){try { var range={start:el('Start').value,end:el('End').value}; C.groupBuckets(range,el('Unit').value); if(el('Compare').value!=='none')C.groupBuckets(C.comparisonRange(range,el('Compare').value),el('Unit').value); G.range=range; G.unit=el('Unit').value; G.compare=el('Compare').value; startLoad(); }catch(e){status(e.message,true);} });
    el('Compare').addEventListener('change',function(){try{if(this.value!=='none')C.groupBuckets(C.comparisonRange(G.range,this.value),G.unit);G.compare=this.value;startLoad();}catch(e){this.value=G.compare;status(e.message,true);}});
    ['Axis','BarMetric'].forEach(function(id){el(id).addEventListener('change',renderBars);});
    el('Export').addEventListener('click',exportCsv);
    section.addEventListener('click',function(event){var target=event.target.closest('[data-group-point]');if(target)openDetail(+target.dataset.groupPoint);});
    new ResizeObserver(function(){if(G.active&&!section.hidden){renderTrends();renderBars();renderWaterfall();}}).observe(section);
  }
  function pump() {
    while(G.running<2&&G.queue.length){var job=G.queue.shift();if(!job.active()){job.reject(new Error('cancelled'));continue;}G.running++;(function(j){Promise.resolve().then(j.run).then(j.resolve,j.reject).finally(function(){G.running--;pump();});})(job);}
  }
  function enqueue(run,active){return new Promise(function(resolve,reject){G.queue.push({run:run,active:active,resolve:resolve,reject:reject});pump();});}
  function reader(scope,active){return function(range){
    var key=scope.id+'|'+scope.site+'|'+range.start+'|'+range.end, hit=G.cache.get(key);
    if(hit&&Date.now()-hit.time<120000)return Promise.resolve(hit.value);
    return enqueue(function(){return callApi_(C.groupPayload(scope.id,scope.site,scope.token,range,navigator.userAgent)).then(function(res){var value=C.groupResponse(res,scope.id,range);if(active())G.cache.set(key,{time:Date.now(),value:value});return value;});},active);
  };}
  async function load(){
    var version=++G.version, scope=Object.assign({},G.scope), range=Object.assign({},G.range), unit=G.unit, compare=G.compare;
    function active(){return G.active&&version===G.version;}
    var read=reader(scope,active);G.buckets=C.groupBuckets(range,unit);G.data=new Array(G.buckets.length).fill(null);G.previous=[];G.previousTotal=null;G.previousRange=compare==='none'?null:C.comparisonRange(range,compare);G.previousBuckets=G.previousRange?C.groupBuckets(G.previousRange,unit):[];
    G.total=range.start===G.dashboard.range.start&&range.end===G.dashboard.range.end?G.dashboard:null;
    G.loading=true;el('Export').disabled=true;el('Detail').close();renderAll();status('グループの推移を読み込み中…');
    if(!G.total){try{var total=await read(range);if(!active())return;G.total=total;renderAll();}catch(e){if(!active())return;status('期間合計は未取得です。推移を先に読み込みます。',true);}}
    var points=await C.groupLoad(G.buckets,read,active,function(data,done){G.data=data.slice();renderTrends();status('推移を読み込み中：'+done+' / '+G.buckets.length+'期間');});
    if(!active())return;G.data=points;renderAll();el('Export').disabled=!points.some(Boolean);
    var failed=points.filter(function(p){return !p;}).length;
    if(compare!=='none'){
      status('比較期間を読み込み中…');
      try{var prior=await read(G.previousRange);if(!active())return;G.previousTotal=prior;renderSummary();}catch(e){if(!active())return;}
      var previous=await C.groupLoad(G.previousBuckets,read,active,function(data,done){G.previous=data.slice();renderTrends();status('比較期間を読み込み中：'+done+' / '+G.previousBuckets.length+'期間');});
      if(!active())return;G.previous=previous;failed+=previous.filter(function(p){return !p;}).length;
      if(!G.previousTotal)failed++;
    }
    G.loading=false;renderAll();status(failed||!G.total?'一部の数値が未取得です。「グラフを更新」で再取得できます。':'表示しました。グラフの点を押すと期間の内訳を確認できます。',failed||!G.total);
  }
  function startLoad(){var version=G.version+1;load().catch(function(){if(G.active&&G.version===version){G.loading=false;renderTrends();status('集計を取得できませんでした。日別は62日以内にして、グラフを更新してください。',true);}});}
  function renderAll(){renderSummary();renderTrends();renderBars();renderWaterfall();}
  function renderSummary(){
    var k=G.total?G.total.kpi:{}, previous=G.previousTotal?G.previousTotal.kpi:{};
    el('Summary').innerHTML=['uriage_amount','ad_cost','royalty_yoshida','tenokori'].map(function(key){var rate=C.rate(k[key],previous[key]);return '<div class="comparison-stat"><span>'+labels[key]+'・期間合計</span><strong>'+C.money(k[key])+'</strong>'+(G.compare==='none'?'':'<small>'+(G.compare==='year'?'前年':'前月')+' '+C.money(previous[key])+' / '+(rate===null?'増減率 —':(rate>0?'+':'')+rate.toFixed(1)+'%')+'</small>')+(key==='tenokori'?'<small>手残り率 '+(C.number(k.uriage_amount)&&C.number(k.tenokori)!==null?(k.tenokori/k.uriage_amount*100).toFixed(1)+'%':'—')+'</small>':'')+'</div>';}).join('');
    var differences=[];
    [{name:'選択期間',points:G.data,total:G.total},{name:'比較期間',points:G.previous,total:G.previousTotal}].forEach(function(group){if(!group.total||!group.points.length||group.points.some(function(p){return !p;}))return;metrics.forEach(function(m){var sum=C.sum(group.points.map(function(p){return p.kpi[m.key];})),total=C.number(group.total.kpi[m.key]);if(sum!==null&&total!==null&&Math.abs(sum-total)>=1)differences.push(group.name+' '+m.label+' '+C.money(sum-total));});});
    el('Reconciliation').textContent=differences.length?'推移の合計 − 期間合計：'+differences.join(' / ')+'。ロイヤリティ等の期間ごとの計算差を含みます。':'';
  }
  function svg(width,height,title){return '<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title>';}
  function compact(value){return Math.abs(value)>=10000?(value/10000).toLocaleString('ja-JP',{maximumFractionDigits:1})+'万':Math.round(value).toLocaleString('ja-JP');}
  function lineChart(id,list){
    var box=el(id),width=Math.max(280,box.clientWidth),height=250,left=58,right=12,top=15,bottom=38;
    var series=list.map(function(m){return {metric:m,points:G.data,previous:false};});
    if(G.previous.length)list.forEach(function(m){series.push({metric:m,points:G.previous,previous:true});});
    var values=series.flatMap(function(s){return s.points.map(function(p){return p&&C.number(p.kpi[s.metric.key]);}).filter(function(n){return n!==null;});});
    if(!values.length){box.innerHTML='<p class="case-empty">'+(G.loading?'推移を読み込み中です。':'この期間の推移は未取得です。グラフを更新して再取得できます。')+'</p>';return;}
    var min=Math.min(0,...values),max=Math.max(0,...values);if(min===max)max+=1000;var pad=(max-min)*.08;max+=pad;if(min<0)min-=pad;
    function x(i){return left+(G.buckets.length===1?(width-left-right)/2:i/(G.buckets.length-1)*(width-left-right));}
    function y(n){return top+(max-n)/(max-min)*(height-top-bottom);}
    var html=svg(width,height,id==='Revenue'?'売上の推移、円':'広告費・経費・吉田さんロイヤリティ・手残りの推移、円');
    for(var tick=0;tick<=4;tick++){var n=min+(max-min)*tick/4;html+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y(n)+'" y2="'+y(n)+'" stroke="#e2e8f0"/><text x="'+(left-7)+'" y="'+(y(n)+4)+'" text-anchor="end">'+compact(n)+'</text>';}
    html+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#94a3b8"/>';
    series.forEach(function(s){var path='',open=false;s.points.slice(0,G.buckets.length).forEach(function(p,i){var n=p?C.number(p.kpi[s.metric.key]):null;if(n===null){open=false;return;}path+=(open?'L':'M')+x(i)+','+y(n);open=true;html+='<circle cx="'+x(i)+'" cy="'+y(n)+'" r="3" fill="'+s.metric.color+'" opacity="'+(s.previous?.4:1)+'"/>';});html+='<path d="'+path+'" fill="none" stroke="'+s.metric.color+'" stroke-width="2.3"'+(s.previous?' stroke-dasharray="5 4" opacity=".5"':'')+'/>';});
    var step=G.buckets.length===1?width-left-right:(width-left-right)/(G.buckets.length-1);
    G.buckets.forEach(function(bucket,i){var tip=caption(bucket)+'\n'+list.map(function(m){return m.label+'：'+C.money(G.data[i]&&G.data[i].kpi[m.key]);}).join('\n');html+='<rect data-group-point="'+i+'" class="chart-hit" data-tip="'+esc(tip)+'" x="'+Math.max(left,x(i)-step/2)+'" y="'+top+'" width="'+Math.min(step,width-right-Math.max(left,x(i)-step/2))+'" height="'+(height-top-bottom)+'" fill="transparent"><title>'+esc(tip)+'</title></rect>';});
    var ticks=Math.min(G.buckets.length,width<400?3:5);
    for(var t=0;t<ticks;t++){var i=ticks===1?0:Math.round(t/(ticks-1)*(G.buckets.length-1));html+='<text x="'+x(i)+'" y="'+(height-12)+'" text-anchor="'+(ticks===1?'middle':t===0?'start':t===ticks-1?'end':'middle')+'">'+G.buckets[i].start.slice(5).replace('-','/')+'</text>';}
    box.innerHTML=html+'</svg>';tooltip(box);
  }
  function tooltip(box){var tip=document.createElement('div');tip.className='analytics-tooltip';tip.hidden=true;box.appendChild(tip);box.onpointermove=function(event){var mark=event.target.closest('[data-tip]');if(!mark){tip.hidden=true;return;}tip.textContent=mark.dataset.tip;tip.hidden=false;var r=box.getBoundingClientRect();tip.style.left=Math.max(0,Math.min(event.clientX-r.left+10,r.width-tip.offsetWidth))+'px';tip.style.top=Math.max(0,event.clientY-r.top-tip.offsetHeight-8)+'px';};box.onpointerleave=function(){tip.hidden=true;};}
  function renderTrends(){
    if(!G.buckets)return;lineChart('Revenue',metrics.slice(0,1));lineChart('Profit',metrics.slice(1));
    ['Revenue','Profit'].forEach(function(id){el(id+'Legend').innerHTML=(id==='Revenue'?metrics.slice(0,1):metrics.slice(1)).map(function(m){return '<span><i style="background:'+m.color+'"></i>'+m.label+'</span>';}).join('')+(G.previous.length?'<span><i class="dashed"></i>比較期間：破線</span>':'');});
    var comparing=G.compare!=='none',count=Math.max(G.buckets.length,comparing?G.previousBuckets.length:0),rows='';
    for(var i=0;i<count;i++){var b=G.buckets[i],prior=G.previousBuckets[i];rows+='<tr><td>'+(b?'<button type="button" data-group-point="'+i+'">'+caption(b)+'</button>':'対応期間なし')+'</td>'+metrics.map(function(m){return '<td class="num">'+(b?C.money(G.data[i]&&G.data[i].kpi[m.key]):'—')+'</td>';}).join('')+(comparing?'<td>'+(prior?caption(prior):'対応期間なし')+'</td><td>'+(prior?C.money(G.previous[i]&&G.previous[i].kpi.uriage_amount):'—')+'</td><td>'+(prior?C.money(G.previous[i]&&G.previous[i].kpi.tenokori):'—')+'</td>':'')+'</tr>';}
    el('TrendTable').innerHTML='<table><thead><tr><th>対象期間</th>'+metrics.map(function(m){return '<th>'+m.label+'</th>';}).join('')+(comparing?'<th>比較期間</th><th>比較の売上</th><th>比較の手残り</th>':'')+'</tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function renderBars(){
    var metric=el('BarMetric').value,axis=el('Axis').value,rows=G.total?(G.total.ranking||[]).filter(function(row){return G.region==='全体'||row.area===G.region;}):[];
    if(axis==='area'){var grouped=Object.create(null);rows.forEach(function(r){if(!grouped[r.area])grouped[r.area]=[];grouped[r.area].push(r[metric]);});rows=Object.keys(grouped).map(function(area){var row={staff_name:area};row[metric]=C.sum(grouped[area]);return row;});}
    rows=rows.slice().sort(function(a,b){return (C.number(b[metric])||0)-(C.number(a[metric])||0);});
    el('BarScope').textContent=(G.region==='全体'?'グループ全体':'所属：'+G.region)+' / '+labels[metric]+' 上位8件。全件は数値表に表示します。';
    el('BarTable').innerHTML=table(['担当者・地域',labels[metric]],rows.map(function(r){return [r.staff_name||r.staff_id,amount(r[metric],metric)];}));
    var items=rows.filter(function(r){return C.number(r[metric])!==null;}).slice(0,8);
    if(!items.length){el('Bars').innerHTML='<p class="case-empty">この期間の担当者別集計はありません。</p>';return;}
    var width=Math.max(280,el('Bars').clientWidth),left=100,right=70,height=items.length*36+30,min=Math.min(0,...items.map(function(r){return r[metric];})),max=Math.max(1,...items.map(function(r){return r[metric];}));
    function x(n){return left+(n-min)/(max-min)*(width-left-right);}
    var html=svg(width,height,labels[metric]+'の比較');items.forEach(function(r,i){var y=i*36+10,name=r.staff_name||r.staff_id;html+='<text x="'+(left-8)+'" y="'+(y+14)+'" text-anchor="end">'+esc(name.length>8?name.slice(0,7)+'…':name)+'</text><rect x="'+Math.min(x(0),x(r[metric]))+'" y="'+y+'" width="'+Math.abs(x(r[metric])-x(0))+'" height="20" rx="3" fill="#0f766e"><title>'+esc(name+'：'+amount(r[metric],metric))+'</title></rect><text x="'+(width-2)+'" y="'+(y+14)+'" text-anchor="end">'+compact(r[metric])+(/_count$/.test(metric)?'件':'円')+'</text>';});el('Bars').innerHTML=html+'</svg>';
  }
  function renderWaterfall(){
    var steps=G.total?C.groupWaterfall(G.total.kpi):[];el('WaterfallTable').innerHTML=table(['項目','増減・合計','累計'],steps.map(function(s){return [s.label,C.money(s.value),C.money(s.to)];}));
    if(!steps.length){el('Waterfall').innerHTML='<p class="case-empty">期間合計は未取得です。</p>';return;}
    var width=Math.max(280,el('Waterfall').clientWidth),height=steps.length*36+35,left=145,right=12,min=Math.min(0,...steps.flatMap(function(s){return [s.from,s.to];})),max=Math.max(1,...steps.flatMap(function(s){return [s.from,s.to];}));
    function x(n){return left+(n-min)/(max-min)*(width-left-right);}
    var html=svg(width,height,'売上から手残りへの増減、円');steps.forEach(function(s,i){var y=i*36+10;html+='<text x="'+(left-7)+'" y="'+(y+14)+'" text-anchor="end">'+s.label+'</text><rect x="'+Math.min(x(s.from),x(s.to))+'" y="'+y+'" width="'+Math.abs(x(s.to)-x(s.from))+'" height="20" rx="3" fill="'+(s.total?'#0f766e':s.value<0?'#d97706':'#7c3aed')+'"/><rect data-tip="'+esc(s.label+'：'+C.money(s.value)+'\n累計：'+C.money(s.to))+'" x="0" y="'+y+'" width="'+width+'" height="30" fill="transparent"><title>'+esc(s.label+'：'+C.money(s.value))+'</title></rect>';if(i<steps.length-1)html+='<line x1="'+x(s.to)+'" x2="'+x(s.to)+'" y1="'+(y+20)+'" y2="'+(y+36)+'" stroke="#cbd5e1" stroke-dasharray="2 2"/>';});html+='<text x="'+left+'" y="'+(height-5)+'">'+compact(min)+'</text><text x="'+(width-right)+'" y="'+(height-5)+'" text-anchor="end">'+compact(max)+'円</text>';el('Waterfall').innerHTML=html+'</svg>';tooltip(el('Waterfall'));
  }
  function openDetail(index){var data=G.data[index];if(!data){status('この期間は未取得です。読み込み完了後に再度押してください。',true);return;}el('DetailTitle').textContent=G.scope.name+' / '+caption(G.buckets[index]);el('DetailNote').textContent='この期間のグループ全体の集計です。経費・ロイヤリティ・手残りは担当者ごとに配分していません。';el('DetailBody').innerHTML=table(['項目','数値'],C.groupFields.map(function(key){return [labels[key],amount(data.kpi[key],key)];}))+'<h3>担当者別</h3>'+table(['担当者','所属地域','受注','売上件数','売上','広告費'],data.ranking.map(function(r){return [r.staff_name||r.staff_id,r.area,amount(r.juchu_count,'juchu_count'),amount(r.uriage_count,'uriage_count'),C.money(r.uriage_amount),C.money(r.ad_cost)];}));el('Detail').showModal();}
  function exportCsv(){var rows=[['集計対象',G.scope.name,G.scope.id],['対象期間',G.range.start,G.range.end],['集計単位',G.unit],['比較',G.compare],['区分','開始日','終了日'].concat(C.groupFields.map(function(key){return labels[key];}))];
    function append(kind,range,value){rows.push([kind,range.start,range.end].concat(C.groupFields.map(function(key){return value?value.kpi[key]:null;})));}
    append('期間合計',G.range,G.total);G.buckets.forEach(function(b,i){append(G.data[i]?'推移':'推移・未取得',b,G.data[i]);});if(G.previousRange){append('比較の期間合計',G.previousRange,G.previousTotal);G.previousBuckets.forEach(function(b,i){append(G.previous[i]?'比較の推移':'比較の推移・未取得',b,G.previous[i]);});}
    var url=URL.createObjectURL(new Blob([C.csv(rows)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=G.scope.id+'_収支推移_'+G.range.start+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  window.DashboardGroupAnalytics={
    invalidate:function(){G.version++;G.active=false;G.data=[];G.previous=[];G.total=null;if(el('Analytics')){el('Analytics').hidden=true;el('Detail').close();}},
    refresh:function(response,state){
      mount();var id=response.group&&response.group.id,site=siteGroup_()||'',range={start:response.period.start,end:response.period.end};
      try{if(!canUseDashboard_())throw new Error('permission_denied');C.groupPayload(id,site,SESSION.token,range,'');G.dashboard=C.groupResponse(response,id,range);}catch(e){this.invalidate();return;}
      // A fresh dashboard total must not be paired with older cached points.
      G.cache.clear();G.token=SESSION.token;
      G.scope={id:id,name:G.dashboard.group.display_name,site:site,token:SESSION.token};G.cache.set(id+'|'+site+'|'+range.start+'|'+range.end,{time:Date.now(),value:G.dashboard});G.active=true;G.region=state.region||'全体';G.range=range;G.unit=(C.date(range.end)-C.date(range.start))/86400000<7?'day':'week';G.compare='none';
      el('Analytics').hidden=false;el('Title').textContent=G.scope.name+'の収支を詳しく見る';el('Scope').textContent=G.scope.name+'全体の売上・費用・手残りを表示します。担当者比較には上部の所属地域の選択を反映します。';
      el('Start').value=range.start;el('End').value=range.end;el('Unit').value=G.unit;el('Compare').value='none';startLoad();
    },
    regionChanged:function(region){G.region=region;if(G.active)renderBars();}
  };
})();
