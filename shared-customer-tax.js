(function(root) {
  'use strict';
  function integer(n) { if (!Number.isSafeInteger(n)) throw new Error('customer_amount_integer_invalid'); return n; }
  function add(a,b) { return integer(integer(a)+integer(b)); }
  function floorTax(ex) { if(ex<0)return Math.round(ex*0.1);integer(ex);return Number(BigInt(ex)/10n); }
  function amount(ex,legacy) { legacy=legacy||ex<0;var tax=legacy?Math.round(ex*0.1):floorTax(ex); return {ex:ex,tax:tax,inc:legacy?ex+tax:add(ex,tax)}; }
  function receipt(inc) { integer(inc); if(inc<0)throw new Error('customer_amount_integer_invalid');var tax=Number(BigInt(inc)/11n);return {ex:inc-tax,tax:tax,inc:inc}; }
  function coupon(before,discount) { return amount(Math.max(0,before)).inc-amount(Math.max(0,before-discount)).inc; }
  function splits(exes,ex,inc) {
    integer(ex);integer(inc);var sum=exes.reduce(add,0),out=exes.map(function(n){if(integer(n)<0)throw new Error('customer_amount_integer_invalid');return amount(n).inc;});
    if(out.length&&sum===ex) { var allocated=out.slice(0,-1).reduce(add,0);out[out.length-1]=integer(inc-allocated);if(out[out.length-1]<0)throw new Error('customer_amount_split_invalid'); }
    return out;
  }
  // The canonical string contains only JSON numbers and punctuation; UTF-8 is ASCII here.
  function sha256(ascii) {
    var h=[],k=[],composite={},n=2;while(k.length<64){if(!composite[n]){for(var j=n*n;j<400;j+=n)composite[j]=true;if(h.length<8)h.push((Math.sqrt(n)*4294967296)|0);k.push((Math.cbrt(n)*4294967296)|0);}n++;}
    var bytes=Array.from(ascii,function(c){var v=c.charCodeAt(0);if(v>127)throw new Error('customer_amount_hash_invalid');return v;}),bits=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);for(var b=7;b>=0;b--)bytes.push(Math.floor(bits/Math.pow(256,b))%256);
    function r(x,n){return (x>>>n)|(x<<(32-n));}
    for(var offset=0;offset<bytes.length;offset+=64){var w=[];for(var i=0;i<16;i++)w[i]=(bytes[offset+i*4]<<24)|(bytes[offset+i*4+1]<<16)|(bytes[offset+i*4+2]<<8)|bytes[offset+i*4+3];for(i=16;i<64;i++){var a=w[i-15],z=w[i-2];w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(z,17)^r(z,19)^(z>>>10)))|0;}var v=h.slice();for(i=0;i<64;i++){var t1=(v[7]+(r(v[4],6)^r(v[4],11)^r(v[4],25))+((v[4]&v[5])^(~v[4]&v[6]))+k[i]+w[i])|0,t2=((r(v[0],2)^r(v[0],13)^r(v[0],22))+((v[0]&v[1])^(v[0]&v[2])^(v[1]&v[2])))|0;v=[(t1+t2)|0,v[0],v[1],v[2],(v[3]+t1)|0,v[4],v[5],v[6]];}for(i=0;i<8;i++)h[i]=(h[i]+v[i])|0;}
    return h.map(function(x){return (x>>>0).toString(16).padStart(8,'0');}).join('');
  }
  function hash(items) { return sha256(JSON.stringify(items.map(function(it){return [Number(it.price||0),Number(it.qty||1),Number(it.subtotal||(it.price||0)*(it.qty||1))];}))); }
  function shape(s) {
    if(!s||Object.keys(s).sort().join(',')!=='ex,inc,items_sha256,policy,tax,v'||s.v!==1||['legacy_round_v1','customer_tax_floor_v2'].indexOf(s.policy)<0||
      ['ex','tax','inc'].some(function(k){return typeof s[k]!=='number'||!isFinite(s[k])||s[k]<0;})||s.ex+s.tax!==s.inc||typeof s.items_sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.items_sha256))throw new Error('customer_amount_snapshot_invalid');
    if(s.policy==='customer_tax_floor_v2') ['ex','tax','inc'].forEach(function(k){integer(s[k]);});
  }
  function content(items,s) {
    var strict=s.policy==='customer_tax_floor_v2';
    if(strict)items.forEach(function(it){var price=Number(it.price||0),qty=Number(it.qty||1),subtotal=Number(it.subtotal||price*qty);if(!isFinite(qty))throw new Error('customer_amount_integer_invalid');[price,price*qty,subtotal].forEach(integer);});
    if(hash(items)!==s.items_sha256)return false;
    var ex=items.reduce(function(a,it){var next=a+(it.subtotal||(it.price||0)*(it.qty||1));return strict?integer(next):next;},0),pdf=items.reduce(function(a,it){var next=a+(it.subtotal||it.price*it.qty);return strict?integer(next):next;},0);
    return ex===s.ex&&pdf===s.ex;
  }
  function leaf(items,s) { shape(s);return content(items,s)&&(s.policy==='legacy_round_v1'?Math.round(s.ex*0.1):floorTax(s.ex))===s.tax?s:null; }
  function saved(items) {
    if(!Array.isArray(items))return null;
    var has=function(it,key){return it&&Object.prototype.hasOwnProperty.call(it,key);};
    if(items.slice(1).some(function(it){return has(it,'_amount_sources');}))throw new Error('customer_amount_sources_invalid');
    var first=items[0],hasSnapshot=has(first,'_amount_snapshot'),hasProof=has(first,'_amount_sources'),s=hasSnapshot?first._amount_snapshot:null,proof=hasProof?first._amount_sources:null;
    if(hasSnapshot)shape(s);
    if(hasProof){
      if(!hasSnapshot||!proof||Object.keys(proof).sort().join(',')!=='parts,v'||proof.v!==1||!Array.isArray(proof.parts)||!proof.parts.length||proof.parts.length>items.length||JSON.stringify(items).length>50000)throw new Error('customer_amount_sources_invalid');
      var cursor=0;proof.parts.forEach(function(p){if(!p||Object.keys(p).sort().join(',')!=='count,snapshot,start'||!Number.isSafeInteger(p.start)||p.start!==cursor||!Number.isSafeInteger(p.count)||p.count<=0||p.count>items.length-cursor)throw new Error('customer_amount_sources_invalid');shape(p.snapshot);['ex','tax','inc'].forEach(function(k){integer(p.snapshot[k]);});cursor+=p.count;});
      if(cursor!==items.length)throw new Error('customer_amount_sources_invalid');
    }
    if(!hasSnapshot)return null;
    if(!content(items,s))return null;
    if(!hasProof)return (s.policy==='legacy_round_v1'?Math.round(s.ex*0.1):floorTax(s.ex))===s.tax?s:null;
    var total={ex:0,tax:0,inc:0};for(var i=0;i<proof.parts.length;i++){var p=proof.parts[i],child=leaf(items.slice(p.start,p.start+p.count),p.snapshot);if(!child)return null;['ex','tax','inc'].forEach(function(k){total[k]=add(total[k],child[k]);});}
    return total.ex===s.ex&&total.tax===s.tax&&total.inc===s.inc?s:null;
  }
  function receiptReissue(rows,total) {
    var originals=Object.create(null);rows.forEach(function(row){if(!Array.isArray(row.receipt_originals))throw new Error('receipt_reissue_original_unavailable');row.receipt_originals.forEach(function(o){if(!o||!o.receipt_id||!['tax_ex','tax','total_inc'].every(function(k){return typeof o[k]==='number'&&isFinite(o[k])&&o[k]>=0;})||o.tax_ex+o.tax!==o.total_inc)throw new Error('receipt_reissue_original_invalid');var old=originals[o.receipt_id];if(old&&(old.tax_ex!==o.tax_ex||old.tax!==o.tax||old.total_inc!==o.total_inc))throw new Error('receipt_reissue_original_invalid');originals[o.receipt_id]=o;});});
    var ids=Object.keys(originals);if(ids.length>1)throw new Error('receipt_reissue_original_ambiguous');var original=ids.length?originals[ids[0]]:null;return original&&original.total_inc===total?{ex:original.tax_ex,tax:original.tax,inc:original.total_inc}:receipt(total);
  }
  function sumSources(sources) {
    var values=sources.map(function(s){return saved(s.items||[]);});
    if(values.length===1&&values[0])return {ex:values[0].ex,tax:values[0].tax,inc:values[0].inc};
    if(values.length&&values.every(Boolean)){var sum={ex:0,tax:0,inc:0};values.forEach(function(s){['ex','tax','inc'].forEach(function(k){sum[k]=add(sum[k],s[k]);});});return sum;}
    var ex=0;sources.forEach(function(s){if(s.items&&s.items.length)s.items.forEach(function(it){ex+=it.subtotal||(it.price||0)*(it.qty||1);});else ex+=s.amount_ex||Math.round((s.amount||0)/1.1);});return amount(ex,true);
  }
  root.ECOPITA_CUSTOMER_TAX={amount:amount,tax:floorTax,receipt:receipt,receiptReissue:receiptReissue,coupon:coupon,splits:splits,saved:saved,sumSources:sumSources,hash:hash};
})(window);
