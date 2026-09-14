import {createReadStream} from 'node:fs';
import {assertChatReceipt,assertChatQueueStatus,assertChatArtifact,assertChatWallet,assertChatPayment} from '../public/neural-chat-contract.js';

const ADMIN='/api/admin/vitriny-neural/chat';
const STORE='/api/store-portal/:reference/neural/chat';
const ERRORS={
  chat_not_found:[404,'Conversa, pedido ou anexo não encontrado para este acesso.'],
  chat_access_denied:[403,'Este acesso não está habilitado para o chat.'],
  chat_input_invalid:[400,'Revise o pedido e os arquivos enviados.'],
  chat_attachment_invalid:[400,'Envie um arquivo válido: PNG, JPEG, WebP, TXT, MD ou CSV em UTF-8.'],
  chat_attachment_too_large:[413,'A imagem pode ter até 2 MB e o documento de texto até 64 KB.'],
  chat_attachment_quota:[429,'O limite de anexos armazenados para este acesso foi atingido.'],
  chat_conversation_limit:[429,'Esta conversa atingiu o limite de mensagens. Inicie uma nova conversa.'],
  chat_quota:[429,'O limite de uso do chat foi atingido. Tente novamente mais tarde.'],
  chat_conflict:[409,'Este identificador já pertence a outro pedido. Confira o histórico antes de reenviar.'],
  chat_busy:[409,'Já existe uma resposta em andamento. Aguarde ou cancele antes de enviar outro pedido.']
};
Object.assign(ERRORS,{
  chat_artifact_invalid:[400,'O arquivo gerado não passou na verificação de segurança.'],
  chat_artifact_unavailable:[503,'O arquivo não está disponível para entrega. Não gere novamente; confira o pedido.'],
  chat_artifact_quota:[429,'O espaço privado de mídia deste acesso está cheio.'],
  ai_wallet_insufficient:[402,'Saldo de Vitrine Coins insuficiente. Adicione saldo antes de confirmar.'],
  ai_wallet_scope_denied:[403,'Este acesso não autoriza o saldo pessoal. Entre na sua conta.'],
  coin_wallet_insufficient:[402,'Saldo de Vitrine Coins insuficiente. Adicione saldo antes de confirmar.'],
  ai_wallet_frozen:[409,'O saldo está em conferência por um evento de pagamento.'],
  ai_wallet_conflict:[409,'Este consumo já possui um registro diferente. Confira o pedido.'],
  paid_quote_expired:[409,'Este orçamento venceu. Envie um novo pedido para conferir o preço atualizado.'],
  paid_quote_invalid:[400,'O orçamento não corresponde a este pedido.'],
  paid_not_found:[404,'Pedido não encontrado para este acesso.']
});
Object.assign(ERRORS,{
  chat_payment_unavailable:[503,'A geração paga está indisponível para este acesso.'],
  chat_pricing_unavailable:[503,'O preço está aguardando atualização. Nenhuma geração foi enviada.'],
  chat_payment_quote_mismatch:[409,'O orçamento não corresponde a este pedido.'],
  chat_payment_quote_expired:[409,'Este orçamento venceu. Envie um novo pedido para conferir o preço atualizado.'],
  chat_payment_limit:[402,'O valor estimado ultrapassa o limite de segurança por pedido.'],
  chat_media_prompt_too_long:[400,'Reduza a descrição para gerar a mídia.'],
  chat_video_duration_invalid:[400,'Informe uma duração de 3 a 15 segundos.'],
  chat_media_settings_unavailable:[400,'Neste momento, gere uma imagem ou um vídeo de 720p sem áudio por pedido.'],
  chat_media_reference_invalid:[400,'Envie uma imagem PNG ou JPEG com ao menos 300 pixels de largura e altura.']
});
function safeError(res,error){const known=typeof error?.code==='string'&&Object.hasOwn(ERRORS,error.code)?ERRORS[error.code]:null;
  return res.status(known?.[0]||503).json({ok:false,code:known?error.code:'chat_unavailable',error:known?.[1]||'Não foi possível acessar o chat agora. O pedido pode ter sido recebido; confira o histórico antes de reenviar.'});}
function privateHeaders(_req,res,next){res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next();}

/** Authority is resolved on every route; client and model payloads never select a tenant. */
export function mountNeuralChatApi({app,chat,artifacts,requireAdmin,requireUser,sameOriginOnly,getAuthorizedStore}={}){
  if(!app||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function'||typeof getAuthorizedStore!=='function')throw new TypeError('Chat API requires authenticated scope and origin guards.');
  const mutate=(req,res,next)=>{
    if(req.get('x-neural-request')!=='1'||!req.is('application/json'))return res.status(403).json({ok:false,code:'chat_request_invalid',error:'Requisição de chat não autorizada.'});
    if(Object.keys(req.query||{}).length)return res.status(400).json({ok:false,code:'chat_input_invalid',error:'O pedido não aceita parâmetros na URL.'});
    return sameOriginOnly(req,res,next);
  };
  const adminScope=(req,res,next)=>{
    const id=String(req.user?.id??'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id))return res.status(403).json({ok:false,code:'chat_access_denied',error:'Acesso administrativo não identificado.'});
    res.locals.neuralChatScope=`admin:${id}`;next();
  };
  const storeScope=(req,res,next)=>{
    try{
      const allowed=getAuthorizedStore(req,res);if(!allowed){if(!res.headersSent)res.status(403).json({ok:false,code:'chat_access_denied',error:'Loja não autorizada.'});return;}
      if(typeof allowed.storeReference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(allowed.storeReference))return res.status(403).json({ok:false,code:'chat_access_denied',error:'Loja não autorizada.'});
      res.locals.neuralChatScope=`store:${allowed.storeReference}`;next();
    }catch(error){safeError(res,error);}
  };
  const userScope=(req,res,next)=>{const id=String(req.user?.id??'');if(!/^[1-9]\d{0,14}$/.test(id))return safeError(res,{code:'chat_access_denied'});res.locals.neuralChatScope=`user:${id}`;next();};
  const route=(method,fn)=>async(req,res)=>{
    try{if(typeof chat?.[method]!=='function')throw Error('chat unavailable');await fn(req,res,res.locals.neuralChatScope);}
    catch(error){if(!res.headersSent)safeError(res,error);}
  };
  const mount=(base,auth)=>{
    const read=[privateHeaders,...auth],write=[...read,mutate];
    app.get(base+'/status',...read,route('status',(_req,res,scope)=>{
      const status=chat.status(scope);if(status.queue!==undefined)assertChatQueueStatus(status.queue);
      if(status.wallet!==undefined)assertChatWallet(status.wallet);
      return res.json({ok:true,...status});
    }));
    app.get(base+'/conversations',...read,route('list',(_req,res,scope)=>res.json({ok:true,items:chat.list(scope)})));
    app.get(base+'/conversations/:id',...read,route('conversation',(req,res,scope)=>{
      const result=chat.conversation(scope,req.params.id);
      for(const message of result.messages){if(message.payment)assertChatPayment(message.payment);for(const artifact of message.artifacts||[])assertChatArtifact(artifact);}
      return res.json({ok:true,...result});
    }));
    app.post(base+'/messages',...write,route('submit',(req,res,scope)=>{
      const result=assertChatReceipt(chat.submit(scope,req.body));return res.status(result.duplicate?200:202).json({ok:true,...result});
    }));
    app.get(base+'/requests/by-key/:key',...read,route('requestByKey',(req,res,scope)=>res.json({ok:true,request:assertChatReceipt(chat.requestByKey(scope,req.params.key))})));
    app.get(base+'/requests/:id',...read,route('request',(req,res,scope)=>res.json({ok:true,request:assertChatReceipt(chat.request(scope,req.params.id))})));
    app.post(base+'/requests/:id/confirm',...write,route('confirm',(req,res,scope)=>{
      const input=req.body;if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='idempotencyKey,quoteId')return res.status(400).json({ok:false,code:'chat_input_invalid',error:'Confirmação inválida.'});
      return res.status(202).json({ok:true,...assertChatReceipt(chat.confirm(scope,req.params.id,input))});
    }));
    app.post(base+'/requests/:id/cancel',...write,route('cancel',(req,res,scope)=>{
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length)return res.status(400).json({ok:false,code:'chat_input_invalid',error:'Cancelamento inválido.'});
      return res.json({ok:true,...assertChatReceipt(chat.cancel(scope,req.params.id))});
    }));
    app.post(base+'/attachments',...write,route('upload',(req,res,scope)=>res.status(201).json({ok:true,attachment:chat.upload(scope,req.body)})));
    app.get(base+'/attachments/:id',...read,route('readAttachment',(req,res,scope)=>{
      const item=chat.readAttachment(scope,req.params.id),filename=item.name.replace(/[^A-Za-z0-9._-]/g,'_')||'anexo';
      res.set('Content-Type',item.kind==='image'?item.mimeType:'text/plain; charset=utf-8');
      res.set('Content-Disposition',`${item.kind==='image'?'inline':'attachment'}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(item.name).replace(/'/g,'%27')}`);
      res.set('Content-Security-Policy',"sandbox; default-src 'none'");
      return res.send(item.data);
    }));
    for(const operation of ['content','download'])app.get(base+'/artifacts/:id/'+operation,...read,route('status',(req,res,scope)=>{
      // Recheck chat allowlist/session before EACH binary or Range request.
      chat.status(scope);const item=artifacts?.read(scope,req.params.id);if(!item)throw Object.assign(Error('missing'),{code:'chat_not_found'});
      const filename=item.name.replace(/[^A-Za-z0-9._-]/g,'_');
      res.set('Content-Type',item.mimeType);res.set('Content-Disposition',`${operation==='download'?'attachment':'inline'}; filename="${filename}"`);
      res.set('Content-Security-Policy',"sandbox; default-src 'none'");res.set('Accept-Ranges','bytes');
      let start=0,end=item.bytes-1;const range=req.get('range');
      if(range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match||!match[1]&&!match[2])return res.status(416).set('Content-Range',`bytes */${item.bytes}`).end();
        if(match[1]){start=Number(match[1]);if(match[2])end=Number(match[2]);}
        else{const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return res.status(416).set('Content-Range',`bytes */${item.bytes}`).end();start=Math.max(0,item.bytes-suffix);}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=item.bytes||end<start)return res.status(416).set('Content-Range',`bytes */${item.bytes}`).end();
        end=Math.min(end,item.bytes-1);res.status(206).set('Content-Range',`bytes ${start}-${end}/${item.bytes}`);
      }
      res.set('Content-Length',String(end-start+1));const stream=createReadStream(item.path,{start,end});
      stream.on('error',()=>{if(!res.headersSent)res.status(503).end();else res.destroy();});res.on('close',()=>stream.destroy());stream.pipe(res);
    }));
  };
  mount(ADMIN,[requireAdmin,adminScope]);mount(STORE,[storeScope]);
  if(typeof requireUser==='function')mount('/api/neural/chat',[requireUser,userScope]);
}
