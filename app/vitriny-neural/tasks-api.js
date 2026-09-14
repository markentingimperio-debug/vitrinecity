const ADMIN_BASE='/api/admin/vitriny-neural/tasks';
const STORE_BASE='/api/store-portal/:reference/neural/tasks';
const SUBMIT_FIELDS=new Set(['instruction','idempotencyKey','token']);
const CONTROL_FIELDS=new Set(['token']);
const ERROR_RESPONSES={
  billing_subscription_required:[402,'Seu acesso à IA precisa de um período de plano ativo.'],
  billing_insufficient_credits:[402,'Saldo de créditos de IA insuficiente para reservar esta tarefa.'],
  billing_credits_exhausted:[402,'Saldo de créditos de IA insuficiente para reservar esta tarefa.'],
  billing_usage_review_required:[409,'O consumo desta tarefa está pendente de conferência.'],
  billing_task_budget_exhausted:[402,'O limite de créditos reservado para a tarefa foi atingido.'],
  billing_disabled:[503,'O controle de créditos de IA está desabilitado.'],
  task_not_found:[404,'Tarefa não encontrada.'],
  task_file_not_found:[404,'Arquivo não encontrado.'],
  file_not_found:[404,'Arquivo não encontrado.'],
  task_invalid:[400,'Revise os dados da tarefa.'],
  task_input_invalid:[400,'Revise os dados da tarefa.'],
  task_kind_invalid:[400,'Tipo de tarefa não permitido.'],
  task_instruction_invalid:[400,'Informe uma instrução válida.'],
  task_path_invalid:[400,'Caminho de arquivo inválido.'],
  invalid_path:[400,'Caminho de arquivo inválido.'],
  task_idempotency_conflict:[409,'Esta chave já identifica uma tarefa diferente.'],
  task_conflict:[409,'A tarefa não permite esta operação no estado atual.'],
  task_not_runnable:[409,'A tarefa não pode ser executada no estado atual.'],
  task_not_cancellable:[409,'A tarefa não pode ser cancelada no estado atual.'],
  task_limit_exceeded:[429,'Limite de tarefas atingido. Aguarde e tente novamente.'],
  task_budget_exhausted:[429,'Limite de uso atingido.'],
  task_quota_exhausted:[429,'Limite de uso atingido.'],
  task_busy:[429,'Uma tarefa já está em execução. Aguarde e tente novamente.'],
  task_capacity_exhausted:[429,'Capacidade de tarefas atingida. Aguarde e tente novamente.'],
  tasks_disabled:[503,'O serviço de tarefas ainda não foi habilitado.'],
  task_disabled:[503,'O serviço de tarefas ainda não foi habilitado.'],
  tasks_unavailable:[503,'Serviço de tarefas temporariamente indisponível.'],
  store_not_enabled:[403,'O serviço de tarefas ainda não foi habilitado para esta loja.'],
  task_scope_disabled:[403,'O serviço de tarefas ainda não foi habilitado para esta loja.'],
  task_scope_denied:[403,'O serviço de tarefas ainda não foi habilitado para esta loja.'],
  task_provider_unqualified:[503,'Nenhum modelo validado está disponível para esta tarefa.'],
  task_file_invalid:[400,'Caminho de arquivo inválido.'],
  model_unavailable:[503,'Nenhum modelo habilitado está disponível para esta tarefa.']
};

function fail(res,status,code,error){return res.status(status).json({ok:false,error,code});}
function safeError(res,error){
  const code=error?.code;
  const known=typeof code==='string'&&Object.hasOwn(ERROR_RESPONSES,code)?ERROR_RESPONSES[code]:null;
  if(known)return fail(res,known[0],error.code,known[1]);
  return fail(res,500,'task_internal_error','Não foi possível concluir a operação.');
}
function validatedBody(req,allowed){
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.has(key))){
    throw Object.assign(new Error('Invalid task payload'),{code:'task_input_invalid'});
  }
  if(Buffer.byteLength(JSON.stringify(body),'utf8')>64*1024){
    throw Object.assign(new Error('Task payload limit'),{code:'task_input_invalid'});
  }
  return body;
}
function setPrivateHeaders(_req,res,next){res.set('Cache-Control','no-store');return next();}

/** Mounts authenticated task routes; scopes and store credentials never come from model input. */
export function mountNeuralTasksApi({app,tasks,requireAdmin,sameOriginOnly,getAuthorizedStore}={}){
  if(!app||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function'||typeof getAuthorizedStore!=='function'){
    throw new TypeError('A API de tarefas requer autenticação administrativa, de loja e proteção de origem.');
  }
  const mutationGuard=(req,res,next)=>{
    if(req.get('x-neural-request')!=='1'||!req.is('application/json')){
      return fail(res,403,'task_request_invalid','Requisição de tarefa não autorizada.');
    }
    return sameOriginOnly(req,res,next);
  };
  const adminScope=(req,res,next)=>{res.locals.neuralTaskScope='admin';return next();};
  const storeScope=(req,res,next)=>{
    try{
      const authorized=getAuthorizedStore(req,res);
      if(!authorized){
        if(!res.headersSent)return fail(res,403,'store_access_denied','Acesso à loja não autorizado.');
        return;
      }
      const reference=authorized.storeReference;
      if(typeof reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(reference)){
        return fail(res,403,'store_access_denied','Acesso à loja não autorizado.');
      }
      res.locals.neuralTaskScope=`store:${reference}`;
      return next();
    }catch(error){return safeError(res,error);}
  };
  const route=(method,handler)=>async(req,res)=>{
    try{
      if(typeof tasks?.[method]!=='function')return fail(res,503,'tasks_unavailable','Serviço de tarefas temporariamente indisponível.');
      await handler(req,res,res.locals.neuralTaskScope);
    }catch(error){if(!res.headersSent)return safeError(res,error);}
  };

  const mount=(base,auth)=>{
    // The store auth callback must run on each fully parameterized route.
    const read=[setPrivateHeaders,...auth],write=[...read,mutationGuard];
    app.get(base+'/status',...read,route('status',async(_req,res,scope)=>res.json({ok:true,...await tasks.status(scope)})));
    app.get(base,...read,route('list',async(_req,res,scope)=>res.json({ok:true,items:await tasks.list(scope)})));
    app.post(base,...write,route('submit',async(req,res,scope)=>{
      const body=validatedBody(req,SUBMIT_FIELDS);
      const item=await tasks.submit(scope,{instruction:body.instruction,idempotencyKey:body.idempotencyKey});
      return res.status(item?.duplicate===true?200:201).json({ok:true,item});
    }));
    app.get(base+'/:id',...read,route('get',async(req,res,scope)=>{
      const item=await tasks.get(scope,req.params.id);
      if(!item)return fail(res,404,'task_not_found','Tarefa não encontrada.');
      return res.json({ok:true,item});
    }));
    app.post(base+'/:id/run',...write,route('start',async(req,res,scope)=>{
      validatedBody(req,CONTROL_FIELDS);
      return res.status(202).json({ok:true,item:await tasks.start(scope,req.params.id)});
    }));
    app.post(base+'/:id/cancel',...write,route('cancel',async(req,res,scope)=>{
      validatedBody(req,CONTROL_FIELDS);
      return res.json({ok:true,item:await tasks.cancel(scope,req.params.id)});
    }));
    app.get(base+'/:id/file',...read,route('readFile',async(req,res,scope)=>{
      const filePath=req.query.path;
      if(typeof filePath!=='string'||!filePath||filePath.length>1024||/[\x00-\x1f\x7f]/.test(filePath)){
        return fail(res,400,'task_path_invalid','Caminho de arquivo inválido.');
      }
      const file=await tasks.readFile(scope,req.params.id,filePath);
      if(!file)return fail(res,404,'task_file_not_found','Arquivo não encontrado.');
      if(typeof file.path!=='string'||typeof file.content!=='string')throw new Error('Invalid file response');
      const filename=file.path.split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120)||'neural-file.txt';
      res.set('Content-Type','text/plain; charset=utf-8');
      res.set('Content-Disposition',`attachment; filename="${filename}"`);
      res.set('Content-Security-Policy',"sandbox; default-src 'none'");
      res.set('X-Content-Type-Options','nosniff');
      return res.send(file.content);
    }));
  };
  mount(ADMIN_BASE,[requireAdmin,adminScope]);
  mount(STORE_BASE,[storeScope]);
}
