/* Optional quote/receipt reads. Never intercepts a write, stores a credential,
 * or retries a write on the legacy route. */
(function(root){
  'use strict';
  async function requestCarrier(carrier){
    if(!carrier||carrier.v!==1||!['shadow','direct'].includes(carrier.mode)||!carrier.ticket)throw Error('unavailable');
    var url=new URL(carrier.endpoint),ticket=JSON.parse(carrier.ticket.payload);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.run.app')||url.pathname!=='/v1/form-direct-read'||url.port||url.username||url.password||url.search||url.hash||ticket.origin!==root.location.origin||ticket.aud!=='system-form-direct-read-v1'||ticket.mode!==carrier.mode||Date.now()>=ticket.exp)throw Error('unavailable');
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},20000);
    try{
      var response=await root.fetch(url.href,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify(carrier.ticket)});
      if(!response.ok)throw Error('unavailable');
      var result=await response.json();
      if(carrier.mode==='shadow'){if(result.status!=='compared'||typeof result.match!=='boolean')throw Error('unavailable');return null;}
      if(result.status!=='ready'||!result.dto||typeof result.dto.ok!=='boolean'||result.dto.case_id_valid!==true)throw Error('unavailable');
      return result.dto;
    }finally{clearTimeout(timer);}
  }
  root.formDirectGasRead=async function(gasCall,payload,options){
    if(!payload||!['quote_lookup','receipt_lookup'].includes(payload.form_type))return gasCall(payload,options);
    var first=await gasCall(Object.assign({},payload,{form_direct_v:1,form_direct_origin:root.location.origin}),options);
    if(!first||!first._form_direct)return first;
    var carrier=first._form_direct;delete first._form_direct;
    if(carrier.mode==='shadow'){requestCarrier(carrier).catch(function(){});return first;}
    try{return await requestCarrier(carrier);}
    catch(_){return gasCall(Object.assign({},payload,{form_direct_v:1,form_direct_origin:root.location.origin,form_direct_fallback:1}),options);}
  };
})(window);
