const API='/api/admin/lia';
const DEFAULT_ORIGIN='http://lia-agent:8090';
const TASK_FIELDS=new Set(['instruction','artifactPath']);

function truthy(value){return ['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());}
function normalize(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function operationIntent(instruction){
  const text=normalize(instruction);
  return /https:\/\//.test(text)||/\b(abra|abrir|acesse|acessar|navegue|navegar|pagina|site|clique|captura|screenshot|video|foto|imagem|thumbnail|capa|cortar|corte|redimensionar|vertical|audio|normalizar)\b/.test(text);
}
function safeBody(value,allowed){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.has(key)))throw Object.assign(new Error('lia_input_invalid'),{status:400});
  const raw=JSON.stringify(value);
  if(Buffer.byteLength(raw,'utf8')>64*1024)throw Object.assign(new Error('lia_input_invalid'),{status:400});
  return JSON.parse(raw);
}

export function mountLiaAdmin({app,requireAdmin,sameOriginOnly,env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!app||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function')throw new TypeError('LIA Admin requer app e middlewares administrativos.');
  const enabled=truthy(env.LIA_ENABLED);
  const origin=String(env.LIA_EXECUTOR_URL||DEFAULT_ORIGIN).replace(/\/+$/,'');
  const token=String(env.LIA_EXECUTOR_TOKEN||'');
  const configured=enabled&&token.length>=24;
  const operationsOrigin=String(env.LIA_OPERATIONS_URL||'https://lia.vitrinecity.com').replace(/\/+$/,'');
  const operationsToken=String(env.LIA_OPERATIONS_TOKEN||'');
  const operationsConfigured=truthy(env.LIA_OPERATIONS_ENABLED??'1')&&/^https:\/\//i.test(operationsOrigin)&&operationsToken.length>=32;

  app.use(API,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireAdmin,(req,res,next)=>req.method==='GET'?next():sameOriginOnly(req,res,next));

  async function call(path,{method='GET',body=null,timeoutMs=180000}={}){
    if(!configured)throw Object.assign(new Error('LIA ainda não está habilitada na VPS.'),{status:503,code:'lia_disabled'});
    const headers={'x-lia-internal-token':token};
    if(body!==null)headers['content-type']='application/json';
    let response;
    try{
      response=await fetchImpl(origin+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs),...(body!==null?{body:JSON.stringify(body)}:{})});
    }catch(error){throw Object.assign(new Error('Executor LIA indisponível.'),{status:502,code:'lia_unavailable',cause:error});}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(String(data?.error||'Falha no executor LIA.').slice(0,500)),{status:response.status>=400&&response.status<600?response.status:502,code:data?.code||'lia_executor_error'});
    return data;
  }

  async function operationCall(path,{method='GET',body=null,timeoutMs=180000,headers={}}={}){
    if(!operationsConfigured)throw Object.assign(new Error('Operações de navegador/mídia ainda não estão conectadas.'),{status:503,code:'lia_operations_disabled'});
    const requestHeaders={authorization:`Bearer ${operationsToken}`,...headers};
    if(body!==null&&!Buffer.isBuffer(body)&&typeof body!=='string')requestHeaders['content-type']='application/json';
    let response;
    try{
      response=await fetchImpl(operationsOrigin+path,{method,headers:requestHeaders,redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        ...(body!==null?{body:Buffer.isBuffer(body)||typeof body==='string'?body:JSON.stringify(body)}:{})});
    }catch(error){throw Object.assign(new Error('Operations Gateway da LIA indisponível.'),{status:502,code:'lia_operations_unavailable',cause:error});}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(String(data?.error||'Falha operacional da LIA.').slice(0,500)),{status:response.status,code:data?.error||'lia_operations_error'});
    return data;
  }

  const route=fn=>async(req,res)=>{try{return res.json(await fn(req,res));}catch(error){return res.status(error?.status||500).json({ok:false,code:error?.code||'lia_internal_error',error:error?.status?error.message:'Não foi possível concluir a operação da LIA.'});}};

  app.get(API+'/status',route(async()=>{
    let core={ok:true,name:'LIA',enabled:false,configured:false,mode:'admin_workspace'};
    if(configured){try{core=await call('/v1/status',{timeoutMs:5000});}catch(error){core={...core,error:error.message};}}
    let operations={enabled:false};
    if(operationsConfigured){try{operations=await operationCall('/v1/operations/health',{timeoutMs:5000});}catch(error){operations={enabled:false,error:error.message};}}
    return {...core,enabled:Boolean(core.enabled||operations.enabled),configured:Boolean(configured||operationsConfigured),operations};
  }));
  app.get(API+'/tasks',route(async()=>{
    const items=[];
    if(configured){try{const data=await call('/v1/tasks',{timeoutMs:10000});items.push(...(data.items||data.tasks||[]));}catch{}}
    if(operationsConfigured){try{const data=await operationCall('/v1/operations/tasks',{timeoutMs:10000});items.push(...(data.items||[]));}catch{}}
    items.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    return {ok:true,items:items.slice(0,100)};
  }));
  app.post(API+'/tasks',route(async req=>{
    if(req.get('x-lia-request')!=='1'||!req.is('application/json'))throw Object.assign(new Error('Requisição LIA inválida.'),{status:403,code:'lia_request_invalid'});
    const body=safeBody(req.body,TASK_FIELDS),instruction=String(body.instruction||'').trim();
    if(instruction.length<3||instruction.length>12000)throw Object.assign(new Error('Informe uma tarefa entre 3 e 12.000 caracteres.'),{status:400,code:'lia_input_invalid'});
    if(operationIntent(instruction)&&operationsConfigured){
      const artifactPath=String(body.artifactPath||'').trim();
      if(artifactPath&&!/^incoming\/[A-Za-z0-9._-]{1,180}$/.test(artifactPath))throw Object.assign(new Error('Arquivo operacional inválido.'),{status:400,code:'lia_input_invalid'});
      return operationCall('/v1/operations/tasks',{method:'POST',body:{instruction,artifactPath,actor:`admin:${req.user?.id||'unknown'}`}});
    }
    if(body.artifactPath)throw Object.assign(new Error('O arquivo anexado só pode ser usado em tarefa de mídia.'),{status:400,code:'lia_input_invalid'});
    return call('/v1/tasks',{method:'POST',body:{instruction,actor:`admin:${req.user?.id||'unknown'}`}});
  }));
  app.post(API+'/upload',route(async req=>{
    if(req.get('x-lia-request')!=='1')throw Object.assign(new Error('Requisição LIA inválida.'),{status:403,code:'lia_request_invalid'});
    if(!operationsConfigured)throw Object.assign(new Error('Operações de mídia ainda não estão conectadas.'),{status:503,code:'lia_operations_disabled'});
    const mime=String(req.get('content-type')||'').split(';')[0].toLowerCase();
    const allowed=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/ogg']);
    if(!allowed.has(mime))throw Object.assign(new Error('Tipo de arquivo não permitido.'),{status:415,code:'lia_upload_invalid'});
    const length=Number(req.get('content-length')||0);if(length>50*1024*1024)throw Object.assign(new Error('Arquivo maior que 50 MB.'),{status:413,code:'lia_upload_too_large'});
    let response;
    try{response=await fetchImpl(operationsOrigin+'/v1/operations/upload',{method:'POST',headers:{authorization:`Bearer ${operationsToken}`,'content-type':mime},body:req,duplex:'half',redirect:'error',signal:AbortSignal.timeout(180000)});}
    catch(error){throw Object.assign(new Error('Não foi possível enviar o arquivo para a LIA.'),{status:502,code:'lia_upload_failed',cause:error});}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(String(data.error||'Falha no upload.')),{status:response.status,code:data.error||'lia_upload_failed'});
    return data;
  }));
  app.get(API+'/tasks/:id',route(req=>String(req.params.id).startsWith('op_')
    ?operationCall('/v1/operations/tasks/'+encodeURIComponent(req.params.id),{timeoutMs:10000})
    :call('/v1/tasks/'+encodeURIComponent(req.params.id),{timeoutMs:10000})));
  app.post(API+'/tasks/:id/cancel',route(async req=>{
    if(req.get('x-lia-request')!=='1'||!req.is('application/json'))throw Object.assign(new Error('Requisição LIA inválida.'),{status:403,code:'lia_request_invalid'});
    return String(req.params.id).startsWith('op_')?operationCall('/v1/operations/tasks/'+encodeURIComponent(req.params.id)+'/cancel',{method:'POST',body:{}}):call('/v1/tasks/'+encodeURIComponent(req.params.id)+'/cancel',{method:'POST',body:{}});
  }));

  return{enabled:configured||operationsConfigured,status:()=>({name:'LIA',enabled:configured||operationsConfigured,configured:configured||operationsConfigured,operationsConfigured,mode:'admin_workspace'})};
}
