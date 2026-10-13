/** Authenticated chat-facing API. Register on the SAME app/session as the LIA.
 * No publication endpoint and no provider credentials appear in request/response JSON.
 */
import {requireValue} from './providers.mjs';
const BASE='/api/neural/chat/postproduction';
const CODES={postproduction_access_denied:403,postproduction_not_found:404,postproduction_disabled:503,
  postproduction_approval_mismatch:409,postproduction_confirmation_conflict:409,postproduction_quote_expired:409,
  postproduction_output_not_ready:409,postproduction_output_not_found:404,postproduction_active_limit:429,
  postproduction_reservation_missing:402,voice_not_authorized:403,source_not_authorized:403};
export function mountLiaPostProductionApi({app,executor,requireUser,sameOriginOnly}={}) {
  requireValue(app&&executor&&typeof requireUser==='function'&&typeof sameOriginOnly==='function','postproduction_http_configuration_invalid');
  const scope=req=>{requireValue(Number.isSafeInteger(req.user?.id)&&req.user.id>0,'postproduction_access_denied');return 'user:'+req.user.id;};
  const privateHeaders=(_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});next();};
  const mutation=(req,res,next)=>{
    if(req.get('x-neural-request')!=='1'||!req.is('application/json')||Object.keys(req.query||{}).length)return res.status(403).json({ok:false,code:'postproduction_request_denied'});
    next();
  };
  const route=handler=>async(req,res)=>{try{await handler(req,res,scope(req));}catch(error){
    if(res.headersSent)return res.destroy();
    const code=typeof error?.code==='string'&&/^[a-z0-9_]{1,80}$/.test(error.code)?error.code:'postproduction_unavailable';
    return res.status(CODES[code]||400).json({ok:false,code});
  }};
  const read=[privateHeaders,requireUser],write=[...read,sameOriginOnly,mutation];
  app.get(BASE+'/status',...read,route((_req,res)=>res.json({ok:true,enabled:executor.enabled,paidRetry:false,automaticPublication:false})));
  app.get(BASE,...read,route((req,res,who)=>res.json({ok:true,items:executor.list(who,req.query.conversationId)})));
  app.post(BASE,...write,route(async(req,res,who)=>{
    requireValue(req.body&&Object.keys(req.body).sort().join(',')==='conversationId,sourceJobId,specification','postproduction_input_invalid');
    return res.status(201).json({ok:true,item:await executor.prepare(who,req.body)});
  }));
  app.get(BASE+'/:id',...read,route((req,res,who)=>res.json({ok:true,item:executor.get(who,req.params.id)})));
  app.post(BASE+'/:id/approve',...write,route((req,res,who)=>res.status(202).json({ok:true,item:executor.approve(who,req.params.id,req.body)})));
  app.post(BASE+'/:id/review',...write,route((req,res,who)=>res.json({ok:true,item:executor.review(who,req.params.id,req.body)})));
  app.post(BASE+'/:id/cancel',...write,route((req,res,who)=>{
    requireValue(req.body&&Object.keys(req.body).length===0,'postproduction_input_invalid');return res.json({ok:true,item:executor.cancel(who,req.params.id)});
  }));
  for(const kind of ['video','captions'])app.get(BASE+'/:id/'+kind,...read,route((req,res,who)=>{
    const item=executor.output(who,req.params.id,kind),total=item.data.length;let start=0,end=total-1;
    res.set({'Content-Type':item.mimeType,'Content-Disposition':`${kind==='video'?'inline':'attachment'}; filename="${item.name}"`,'Content-Security-Policy':"sandbox; default-src 'none'",'Accept-Ranges':'bytes'});
    if(req.get('range')){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.get('range'));
      if(!match||!match[1]&&!match[2])return res.status(416).set('Content-Range',`bytes */${total}`).end();
      if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):end;}
      else {const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return res.status(416).set('Content-Range',`bytes */${total}`).end();start=Math.max(0,total-suffix);}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start)return res.status(416).set('Content-Range',`bytes */${total}`).end();
      end=Math.min(total-1,end);res.status(206).set('Content-Range',`bytes ${start}-${end}/${total}`);
    }
    return res.set('Content-Length',String(end-start+1)).send(item.data.subarray(start,end+1));
  }));
  let timer=null,inFlight=null;
  return {start(){if(timer||!executor.enabled)return;timer=setInterval(()=>{if(inFlight)return;inFlight=executor.tick().catch(()=>false).finally(()=>{inFlight=null;});},1000);timer.unref();},
    async close(){if(timer)clearInterval(timer);timer=null;executor.close();await inFlight;}};
}
