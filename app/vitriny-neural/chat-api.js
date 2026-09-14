import {assertChatReceipt,assertChatQueueStatus} from '../public/neural-chat-contract.js';

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
function safeError(res,error){const known=typeof error?.code==='string'&&Object.hasOwn(ERRORS,error.code)?ERRORS[error.code]:null;
  return res.status(known?.[0]||503).json({ok:false,code:known?error.code:'chat_unavailable',error:known?.[1]||'Não foi possível acessar o chat agora. O pedido pode ter sido recebido; confira o histórico antes de reenviar.'});}
function privateHeaders(_req,res,next){res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next();}

/** Authority is resolved on every route; client and model payloads never select a tenant. */
export function mountNeuralChatApi({app,chat,requireAdmin,sameOriginOnly,getAuthorizedStore}={}){
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
  const route=(method,fn)=>async(req,res)=>{
    try{if(typeof chat?.[method]!=='function')throw Error('chat unavailable');await fn(req,res,res.locals.neuralChatScope);}
    catch(error){if(!res.headersSent)safeError(res,error);}
  };
  const mount=(base,auth)=>{
    const read=[privateHeaders,...auth],write=[...read,mutate];
    app.get(base+'/status',...read,route('status',(_req,res,scope)=>{
      const status=chat.status(scope);if(status.queue!==undefined)assertChatQueueStatus(status.queue);
      return res.json({ok:true,...status});
    }));
    app.get(base+'/conversations',...read,route('list',(_req,res,scope)=>res.json({ok:true,items:chat.list(scope)})));
    app.get(base+'/conversations/:id',...read,route('conversation',(req,res,scope)=>res.json({ok:true,...chat.conversation(scope,req.params.id)})));
    app.post(base+'/messages',...write,route('submit',(req,res,scope)=>{
      const result=assertChatReceipt(chat.submit(scope,req.body));return res.status(result.duplicate?200:202).json({ok:true,...result});
    }));
    app.get(base+'/requests/by-key/:key',...read,route('requestByKey',(req,res,scope)=>res.json({ok:true,request:assertChatReceipt(chat.requestByKey(scope,req.params.key))})));
    app.get(base+'/requests/:id',...read,route('request',(req,res,scope)=>res.json({ok:true,request:assertChatReceipt(chat.request(scope,req.params.id))})));
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
  };
  mount(ADMIN,[requireAdmin,adminScope]);mount(STORE,[storeScope]);
}
