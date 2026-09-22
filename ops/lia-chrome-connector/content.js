(() => {
  'use strict';
  const CHANNEL='vitrinecity-lia-connector';
  const VERSION=1;
  const reply=(id,ok,result,error='')=>window.postMessage({channel:CHANNEL,version:VERSION,direction:'response',id,ok,result,error},location.origin);
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==window||event.origin!==location.origin||!message||message.channel!==CHANNEL||message.version!==VERSION||message.direction!=='request'||typeof message.id!=='string')return;
    if(message.type==='ping')return reply(message.id,true,{connector:'lia-chrome-connector-v1',version:'1.0.1'});
    if(message.type!=='execute')return reply(message.id,false,null,'unsupported_request');
    chrome.runtime.sendMessage({type:'execute',target:message.payload?.target}).then(result=>{
      if(!result?.ok)return reply(message.id,false,null,String(result?.error||'connector_failed'));
      reply(message.id,true,result.result);
    }).catch(()=>reply(message.id,false,null,'connector_unavailable'));
  });
})();
