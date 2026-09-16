const API='/api/admin/lia';
const DEFAULT_ORIGIN='http://lia-agent:8090';
const TASK_FIELDS=new Set(['instruction']);

function truthy(value){return ['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());}
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

  const route=fn=>async(req,res)=>{try{return res.json(await fn(req,res));}catch(error){return res.status(error?.status||500).json({ok:false,code:error?.code||'lia_internal_error',error:error?.status?error.message:'Não foi possível concluir a operação da LIA.'});}};

  app.get(API+'/status',route(async()=>configured?call('/v1/status',{timeoutMs:5000}):{ok:true,name:'LIA',enabled:false,configured:false,mode:'admin_workspace'}));
  app.get(API+'/tasks',route(()=>call('/v1/tasks',{timeoutMs:10000})));
  app.post(API+'/tasks',route(async req=>{
    if(req.get('x-lia-request')!=='1'||!req.is('application/json'))throw Object.assign(new Error('Requisição LIA inválida.'),{status:403,code:'lia_request_invalid'});
    const body=safeBody(req.body,TASK_FIELDS),instruction=String(body.instruction||'').trim();
    if(instruction.length<3||instruction.length>12000)throw Object.assign(new Error('Informe uma tarefa entre 3 e 12.000 caracteres.'),{status:400,code:'lia_input_invalid'});
    return call('/v1/tasks',{method:'POST',body:{instruction,actor:`admin:${req.user?.id||'unknown'}`}});
  }));
  app.get(API+'/tasks/:id',route(req=>call('/v1/tasks/'+encodeURIComponent(req.params.id),{timeoutMs:10000})));
  app.post(API+'/tasks/:id/cancel',route(async req=>{
    if(req.get('x-lia-request')!=='1'||!req.is('application/json'))throw Object.assign(new Error('Requisição LIA inválida.'),{status:403,code:'lia_request_invalid'});
    return call('/v1/tasks/'+encodeURIComponent(req.params.id)+'/cancel',{method:'POST',body:{}});
  }));

  return{enabled:configured,status:()=>({name:'LIA',enabled:configured,configured,mode:'admin_workspace'})};
}
