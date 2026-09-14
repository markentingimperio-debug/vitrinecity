const ADMIN_BASE='/api/admin/vitriny-neural/billing';
const STORE_BASE='/api/store-portal/:reference/neural/billing';
const REFERENCE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PLAN_FIELDS=new Set(['code','name','monthlyCredits','taskReserveCredits','inputCreditsPer1000','outputCreditsPer1000']);
const PERIOD_FIELDS=new Set(['planCode','periodStart','periodEnd','idempotencyKey']);
const RESOLUTION_FIELDS=new Set(['chargeCredits','reason','idempotencyKey']);
const EMPTY_FIELDS=new Set();
const ERROR_RESPONSES={
  billing_input_invalid:[400,'Revise os dados enviados.'],
  billing_scope_invalid:[400,'Loja inválida.'],
  billing_plan_invalid:[400,'Revise a configuração do plano.'],
  billing_period_invalid:[400,'Revise o período da assinatura.'],
  billing_resolution_invalid:[400,'Revise os dados da conciliação.'],
  billing_actor_invalid:[403,'Administrador não identificado.'],
  billing_scope_denied:[403,'Acesso à loja não autorizado.'],
  billing_plan_not_found:[404,'Plano não encontrado.'],
  billing_store_not_found:[404,'Loja não encontrada.'],
  billing_period_not_found:[404,'Período não encontrado.'],
  billing_reservation_not_found:[404,'Reserva de créditos não encontrada.'],
  billing_plan_conflict:[409,'Já existe um plano com esse identificador.'],
  billing_period_overlap:[409,'O período coincide com outra assinatura da loja.'],
  billing_idempotency_conflict:[409,'Esta chave já identifica uma operação diferente.'],
  billing_period_conflict:[409,'O período não permite esta operação.'],
  billing_reservation_conflict:[409,'A reserva não permite esta operação.'],
  billing_reservation_not_reconcilable:[409,'A reserva ainda não permite conciliação.'],
  billing_task_unsettled:[409,'A tarefa ainda possui execução pendente ou não está disponível para conciliação.'],
  billing_conflict:[409,'Esta chave já identifica uma operação diferente.'],
  billing_attempt_conflict:[409,'O registro de consumo diverge de uma tentativa anterior.'],
  billing_reservation_closed:[409,'A reserva de créditos já foi encerrada.'],
  billing_review_required:[409,'O consumo exige conciliação administrativa.'],
  billing_usage_review_required:[409,'O consumo exige conciliação administrativa.'],
  billing_subscription_required:[402,'A loja precisa de uma assinatura de IA ativa.'],
  billing_insufficient_credits:[402,'Créditos de IA insuficientes.'],
  billing_credits_exhausted:[402,'Créditos de IA insuficientes.'],
  billing_task_budget_exhausted:[402,'A tarefa atingiu seu limite de créditos.'],
  billing_attempt_limit:[429,'A tarefa atingiu seu limite de tentativas.'],
  billing_disabled:[503,'O controle de créditos de IA ainda não foi habilitado.'],
  billing_unavailable:[503,'Controle de créditos de IA temporariamente indisponível.'],
  billing_tasks_unavailable:[503,'Não foi possível verificar o encerramento da tarefa.']
};

function fail(res,status,code,error){return res.status(status).json({ok:false,error,code});}
function safeError(res,error){
  const code=error?.code;
  const known=typeof code==='string'&&Object.hasOwn(ERROR_RESPONSES,code)?ERROR_RESPONSES[code]:null;
  return known?fail(res,known[0],code,known[1]):fail(res,500,'billing_internal_error','Não foi possível concluir a operação.');
}
function validatedBody(req,allowed){
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==allowed.size||Object.keys(body).some(key=>!allowed.has(key))||Buffer.byteLength(JSON.stringify(body),'utf8')>16*1024){
    throw Object.assign(new Error('Invalid billing payload'),{code:'billing_input_invalid'});
  }
  return body;
}
function actor(req){
  const id=req.user?.id;
  if((typeof id!=='string'&&typeof id!=='number')||String(id).length===0){
    throw Object.assign(new Error('Missing administrative actor'),{code:'billing_actor_invalid'});
  }
  return String(id);
}
function privateHeaders(_req,res,next){res.set('Cache-Control','no-store');return next();}

/** AI credits are separate from Ads balances and money; no merchant mutation or checkout is exposed here. */
export function mountNeuralBillingApi({app,billing,tasks,requireAdmin,sameOriginOnly,getAuthorizedStore,storeExists}={}){
  if(!app||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function'||typeof getAuthorizedStore!=='function'||typeof storeExists!=='function'){
    throw new TypeError('A API de créditos requer autenticação, proteção de origem e validação da loja.');
  }
  const mutationGuard=(req,res,next)=>{
    if(req.get('x-neural-request')!=='1'||!req.is('application/json')){
      return fail(res,403,'billing_request_invalid','Requisição de créditos não autorizada.');
    }
    return sameOriginOnly(req,res,next);
  };
  const adminStoreScope=async(req,res,next)=>{
    try{
      const reference=req.params.reference;
      if(typeof reference!=='string'||!REFERENCE.test(reference))return fail(res,400,'billing_scope_invalid','Loja inválida.');
      if(await storeExists(reference)!==true)return fail(res,404,'billing_store_not_found','Loja não encontrada.');
      res.locals.neuralBillingScope=`store:${reference}`;
      return next();
    }catch(error){return safeError(res,error);}
  };
  const storeScope=async(req,res,next)=>{
    try{
      const authorized=await getAuthorizedStore(req,res);
      if(!authorized){
        if(!res.headersSent)return fail(res,403,'store_access_denied','Acesso à loja não autorizado.');
        return;
      }
      const reference=authorized.storeReference;
      if(typeof reference!=='string'||!REFERENCE.test(reference))return fail(res,403,'store_access_denied','Acesso à loja não autorizado.');
      res.locals.neuralBillingScope=`store:${reference}`;
      return next();
    }catch(error){return safeError(res,error);}
  };
  const route=(methods,handler)=>async(req,res)=>{
    try{
      if(methods.some(method=>typeof billing?.[method]!=='function'))return fail(res,503,'billing_unavailable','Controle de créditos de IA temporariamente indisponível.');
      return await handler(req,res,res.locals.neuralBillingScope);
    }catch(error){if(!res.headersSent)return safeError(res,error);}
  };
  const status=route(['periodStatus'],async(_req,res,scope)=>res.json({ok:true,...await billing.periodStatus(scope),enabled:billing.enabled===true,currency:'ai_credits'}));
  const ledger=route(['ledger'],async(_req,res,scope)=>res.json({ok:true,items:await billing.ledger(scope)}));
  const adminRead=[privateHeaders,requireAdmin];
  const adminStoreRead=[...adminRead,adminStoreScope];
  const adminWrite=[...adminRead,mutationGuard];
  const adminStoreWrite=[...adminRead,mutationGuard,adminStoreScope];

  app.get(ADMIN_BASE+'/plans',...adminRead,route(['plans'],async(_req,res)=>res.json({ok:true,items:await billing.plans()})));
  app.post(ADMIN_BASE+'/plans',...adminWrite,route(['createPlan'],async(req,res)=>{
    const item=await billing.createPlan(validatedBody(req,PLAN_FIELDS),actor(req));
    return res.status(item?.duplicate===true?200:201).json({ok:true,item});
  }));
  app.get(ADMIN_BASE+'/stores/:reference/status',...adminStoreRead,status);
  app.get(ADMIN_BASE+'/stores/:reference/ledger',...adminStoreRead,ledger);
  app.get(ADMIN_BASE+'/stores/:reference/periods',...adminStoreRead,route(['periods'],async(_req,res,scope)=>res.json({ok:true,items:await billing.periods(scope)})));
  app.post(ADMIN_BASE+'/stores/:reference/periods',...adminStoreWrite,route(['grantPeriod'],async(req,res,scope)=>{
    const body=validatedBody(req,PERIOD_FIELDS);
    const item=await billing.grantPeriod({...body,scope},actor(req));
    return res.status(item?.duplicate===true?200:201).json({ok:true,item});
  }));
  app.post(ADMIN_BASE+'/stores/:reference/periods/:id/revoke',...adminStoreWrite,route(['getPeriod','revokePeriod'],async(req,res,scope)=>{
    validatedBody(req,EMPTY_FIELDS);
    const period=await billing.getPeriod(scope,req.params.id);
    if(!period||String(period.id)!==req.params.id)return fail(res,404,'billing_period_not_found','Período não encontrado.');
    return res.json({ok:true,item:await billing.revokePeriod(req.params.id,actor(req))});
  }));
  app.post(ADMIN_BASE+'/stores/:reference/tasks/:id/resolve',...adminStoreWrite,route(['resolve'],async(req,res,scope)=>{
    const body=validatedBody(req,RESOLUTION_FIELDS);
    if(typeof tasks?.billingCanResolve!=='function')return fail(res,503,'billing_tasks_unavailable','Não foi possível verificar o encerramento da tarefa.');
    if(await tasks.billingCanResolve(scope,req.params.id)!==true)return fail(res,409,'billing_task_unsettled','A tarefa ainda possui execução pendente ou não está disponível para conciliação.');
    return res.json({ok:true,item:await billing.resolve(scope,req.params.id,body,actor(req))});
  }));

  // Keep store authorization on each parameterized route; never accept a scope from query/body.
  app.get(STORE_BASE+'/status',privateHeaders,storeScope,status);
  app.get(STORE_BASE+'/ledger',privateHeaders,storeScope,ledger);
}
