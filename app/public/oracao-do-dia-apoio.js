const STORAGE_PREFIX='vitrinecity:prayer-support:';
const SUPPORT_AMOUNTS=Object.freeze([50,100,200,300,500]);

export function supportAmountLabel(amountCents){
  if(!SUPPORT_AMOUNTS.includes(amountCents))return '';
  return 'R$ '+(amountCents/100).toLocaleString('pt-BR',{minimumFractionDigits:amountCents%100?2:0,maximumFractionDigits:2});
}

export function validatedSupportCheckoutUrl(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!['mercadopago.com.br','www.mercadopago.com.br','mercadopago.com','www.mercadopago.com'].includes(url.hostname)||url.username||url.password||url.port||!url.pathname.startsWith('/checkout/'))return null;
    return url.href;
  }catch{return null;}
}

export function validSupportConfiguration(config){
  return config?.enabled===true&&Array.isArray(config.amountsCents)&&config.amountsCents.length>0&&config.amountsCents.every(value=>SUPPORT_AMOUNTS.includes(value))&&config.currency==='BRL'&&config.oneTime===true&&typeof config.beneficiary==='string'&&config.beneficiary.trim().length>0;
}

export function supportStatusMessage(status,amountCents=500){
  if(status==='approved')return `Seu apoio de ${supportAmountLabel(amountCents)} foi confirmado. Obrigado por contribuir com este espaço.`;
  if(['creating','pending','authorized','in_process','in_mediation'].includes(status))return 'O apoio ainda aguarda confirmação. Você pode verificar novamente; nenhum pagamento foi confirmado nesta página.';
  if(status==='rejected')return 'O pagamento não foi aprovado. Nenhum apoio foi confirmado.';
  if(status==='cancelled'||status==='canceled')return 'Este pagamento foi cancelado. Nenhum apoio foi confirmado.';
  if(status==='refunded')return 'Este apoio foi reembolsado.';
  if(status==='partially_refunded')return 'Este apoio teve um reembolso parcial.';
  if(status==='charged_back')return 'Este pagamento foi contestado e não é tratado como apoio confirmado.';
  if(status==='review_required')return 'Este apoio está em verificação. Ainda não há uma confirmação disponível.';
  if(status==='creation_rejected')return 'Não foi possível abrir o pagamento deste valor. Nenhuma cobrança foi confirmada. Você pode escolher outro valor, se desejar.';
  return 'Ainda não há confirmação disponível para este apoio.';
}

export async function installPrayerSupport({document,fetch,location,storage,crypto}){
  const button=document.getElementById('supportButton'),status=document.getElementById('supportStatus'),amounts=document.getElementById('supportAmounts'),amountOptions=[...document.querySelectorAll('input[name="supportAmount"]')],beneficiary=document.getElementById('supportBeneficiary'),refresh=document.getElementById('refreshSupport');
  let busy=false,enabled=false,requestKey=null,returnReference=null,returnToken=null,selectedAmount=500,lockedAmount=null,allowedAmounts=[];
  function read(key){try{return storage?.getItem(STORAGE_PREFIX+key)||null;}catch{return null;}}
  function write(key,value){if(!storage?.setItem)return false;try{storage.setItem(STORAGE_PREFIX+key,value);return true;}catch{return false;}}
  function clearRequest(){requestKey=null;lockedAmount=null;try{storage?.removeItem(STORAGE_PREFIX+'request-key');storage?.removeItem(STORAGE_PREFIX+'request-amount');}catch{}updateButton();}
  function selectAmount(value){selectedAmount=value;for(const input of amountOptions)input.checked=Number(input.value)===value;}
  function updateButton(){button.disabled=!enabled||busy;amounts.disabled=!enabled||busy||lockedAmount!==null;if(enabled)button.textContent=`Apoiar com ${supportAmountLabel(selectedAmount)} pelo Mercado Pago`;}
  function failure(message){status.textContent=message;busy=false;updateButton();}
  async function checkReturn(){
    if(!returnReference||!returnToken)return;
    refresh.disabled=true;status.textContent='Verificando a confirmação do apoio…';
    try{
      const response=await fetch(`/api/prayer-support/orders/${encodeURIComponent(returnReference)}`,{headers:{'X-Support-Token':returnToken},credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error('status unavailable');
      const order=await response.json();
      if(order.reference!==returnReference||!SUPPORT_AMOUNTS.includes(order.amountCents)||order.currency!=='BRL')throw new Error('invalid status');
      status.textContent=supportStatusMessage(order.status,order.amountCents);
      if(typeof order.beneficiary==='string'&&order.beneficiary.trim()){beneficiary.textContent='Recebedor: '+order.beneficiary.trim();beneficiary.hidden=false;}
      refresh.hidden=['approved','rejected','cancelled','refunded','partially_refunded','charged_back','creation_rejected'].includes(order.status);
      if(refresh.hidden)clearRequest();
    }catch{status.textContent='Não foi possível confirmar o apoio agora. Você pode tentar verificar novamente.';refresh.hidden=false;}
    refresh.disabled=false;
  }
  for(const input of amountOptions)input.addEventListener('change',()=>{
    if(!enabled||busy||lockedAmount!==null||!input.checked)return;
    const value=Number(input.value);if(!allowedAmounts.includes(value))return;
    selectAmount(value);updateButton();
  });
  refresh.addEventListener('click',checkReturn);
  button.addEventListener('click',async()=>{
    if(!enabled||busy||!allowedAmounts.includes(selectedAmount))return;
    busy=true;lockedAmount=selectedAmount;updateButton();status.textContent=`Preparando seu apoio único de ${supportAmountLabel(selectedAmount)}…`;
    try{
      requestKey=requestKey||read('request-key')||crypto.randomUUID();write('request-key',requestKey);write('request-amount',String(selectedAmount));
      const response=await fetch('/api/prayer-support/checkout',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({requestKey,amountCents:selectedAmount,accepted:true})});
      const payment=await response.json(),checkoutUrl=validatedSupportCheckoutUrl(payment.checkoutUrl);
      const receiptValid=typeof payment.reference==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(payment.reference)&&typeof payment.statusToken==='string'&&payment.statusToken.length>0;
      if(receiptValid){
        if(!write(payment.reference,payment.statusToken))throw new Error('status storage unavailable');
        returnReference=payment.reference;returnToken=payment.statusToken;
      }
      if(!response.ok){
        if(receiptValid){refresh.hidden=false;if(payment.status==='creation_rejected'){clearRequest();failure(supportStatusMessage(payment.status,selectedAmount));return;}failure('A abertura do apoio ainda precisa de confirmação. Use “Verificar confirmação do apoio” antes de tentar novamente.');return;}
        throw new Error('checkout unavailable');
      }
      if(!checkoutUrl||!receiptValid||payment.amountCents!==selectedAmount||payment.currency!=='BRL')throw new Error('invalid checkout');
      status.textContent='Abrindo o Mercado Pago. Revise o recebedor e o valor antes de pagar.';
      location.assign(checkoutUrl);
    }catch{failure('Não foi possível abrir o apoio agora. Nenhum pagamento foi confirmado nesta página. Tente novamente quando desejar.');}
  });
  try{
    const response=await fetch('/api/prayer-support/config',{credentials:'same-origin',cache:'no-store'});
    const config=response.ok?await response.json():null;
    if(validSupportConfiguration(config)){
      enabled=true;allowedAmounts=config.amountsCents;
      const previousAmount=Number(read('request-amount'));
      if(read('request-key')&&allowedAmounts.includes(previousAmount)){lockedAmount=previousAmount;selectAmount(previousAmount);}else selectAmount(allowedAmounts.includes(config.defaultAmountCents)?config.defaultAmountCents:allowedAmounts.at(-1));
      for(const input of amountOptions)input.disabled=!allowedAmounts.includes(Number(input.value));
      beneficiary.textContent='Recebedor: '+config.beneficiary.trim();beneficiary.hidden=false;
      status.textContent='Apoio único pelo Mercado Pago. Você revisa e confirma o pagamento no próximo passo.';updateButton();
    }
  }catch{/* The initial, unavailable state remains visible. */}
  const params=new URL(location.href).searchParams,reference=params.get('ref');
  if(params.get('apoio')==='retorno'&&reference&&/^[a-zA-Z0-9_-]{1,160}$/.test(reference)){
    returnReference=reference;returnToken=read(reference);
    if(returnToken){refresh.hidden=false;await checkReturn();}
    else status.textContent='Não encontramos a confirmação deste apoio neste aparelho. A volta do pagamento, sozinha, não confirma o recebimento.';
  }
  return {checkReturn};
}

if(typeof document!=='undefined'){
  let storage;
  try{storage=window.sessionStorage;}catch{}
  installPrayerSupport({document,fetch:window.fetch.bind(window),location:window.location,storage,crypto:window.crypto});
}
