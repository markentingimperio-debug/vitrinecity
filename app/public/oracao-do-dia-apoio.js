const STORAGE_PREFIX='vitrinecity:prayer-support:';
const SUPPORT_AMOUNTS=Object.freeze([50,100,200,300,500]);
const TERMINAL=new Set(['approved','rejected','cancelled','canceled','refunded','partially_refunded','charged_back','creation_rejected']);
const VALID_REFERENCE=/^[a-zA-Z0-9_-]{1,160}$/;
const VALID_REQUEST=/^[a-zA-Z0-9_-]{20,100}$/;
const validToken=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\x00-\x20\x7f]/.test(value);

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
export function validatedSupportPix(pix,now=Date.now()){
  if(!pix||typeof pix.qrCode!=='string'||pix.qrCode.length<32||pix.qrCode.length>4096||!pix.qrCode.startsWith('000201')||!(/br\.gov\.bcb\.pix/i.test(pix.qrCode))||!(/6304[0-9a-f]{4}$/i.test(pix.qrCode))||/[\x00-\x1f\x7f<>]/.test(pix.qrCode))return null;
  const expiresMs=typeof pix.expiresAt==='string'?Date.parse(pix.expiresAt):NaN;
  if(!Number.isFinite(expiresMs)||expiresMs<=now||typeof pix.qrCodeBase64!=='string')return null;
  const base64=pix.qrCodeBase64.replace(/^data:image\/png;base64,/, '');
  if(base64.length>500000||base64.length%4||!(/^[A-Za-z0-9+/]+={0,2}$/.test(base64)))return null;
  try{
    const bytes=globalThis.atob(base64);
    const int32=at=>((bytes.charCodeAt(at)*16777216)+(bytes.charCodeAt(at+1)<<16)+(bytes.charCodeAt(at+2)<<8)+bytes.charCodeAt(at+3));
    if(bytes.length<45||bytes.slice(0,8)!=='\x89PNG\r\n\x1a\n'||bytes.slice(12,16)!=='IHDR'||bytes.slice(-12)!=='\x00\x00\x00\x00IEND\xaeB\x60\x82'||![int32(16),int32(20)].every(size=>size>0&&size<=2048))return null;
  }catch{return null;}
  return {code:pix.qrCode,imageSrc:'data:image/png;base64,'+base64,expiresAt:pix.expiresAt,expiresMs};
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

export async function installPrayerSupport({document,fetch,location,storage,crypto,window:win=globalThis.window,now=Date.now}){
  const node=id=>document.getElementById(id);
  const button=node('supportButton'),status=node('supportStatus'),amounts=node('supportAmounts'),amountOptions=[...document.querySelectorAll('input[name="supportAmount"]')],beneficiary=node('supportBeneficiary'),refresh=node('refreshSupport');
  if(!button||!status||!amounts||!refresh||!beneficiary)return {checkReturn:async()=>{},destroy(){}};
  const email=node('supportPayerEmail'),panel=node('supportPix'),qr=node('supportPixQr'),code=node('supportPixCode'),copy=node('copySupportPix'),expiry=node('supportPixExpiry'),copyStatus=node('supportPixCopyStatus'),alternative=node('supportAlternative');
  const pixNodes=Boolean(email&&panel&&qr&&code&&copy&&expiry&&copyStatus);
  let busy=false,checking=false,enabled=false,pixEnabled=false,requestKey=null,requestMethod=null,returnReference=null,returnToken=null,selectedAmount=500,lockedAmount=null,allowedAmounts=[],terminal=false,currentPix=null,timer=null,destroyed=false,saved=true,pageActive=true;
  function read(key){try{return storage?.getItem(STORAGE_PREFIX+key)||null;}catch{return null;}}
  function write(key,value){try{if(!storage?.setItem)return false;storage.setItem(STORAGE_PREFIX+key,value);return true;}catch{return false;}}
  function remove(key){try{storage?.removeItem(STORAGE_PREFIX+key);}catch{}}
  function stopPoll(){if(timer!==null){win?.clearTimeout?.(timer);timer=null;}}
  const visible=()=>pageActive&&document.visibilityState!=='hidden';
  const pending=()=>Boolean(returnReference&&returnToken&&!terminal);
  function schedulePoll(){
    stopPoll();
    if(!destroyed&&pending()&&visible()&&typeof win?.setTimeout==='function')timer=win.setTimeout(()=>{timer=null;void checkReturn();},15000);
  }
  function hidePix(){
    currentPix=null;
    if(!pixNodes)return;
    panel.hidden=true;code.value='';qr.removeAttribute?.('src');copy.disabled=true;expiry.textContent='';copyStatus.textContent='';
  }
  function updateButton(){
    const primary=pixEnabled?'pix':'checkout';
    button.disabled=!enabled||busy||checking||pending()||Boolean(requestKey&&requestMethod!==primary);
    amounts.disabled=!enabled||busy||checking||lockedAmount!==null;
    if(email)email.disabled=!enabled||!pixEnabled||busy||checking||pending();
    if(enabled)button.textContent=primary==='pix'?`Gerar Pix de ${supportAmountLabel(selectedAmount)}`:`Apoiar com ${supportAmountLabel(selectedAmount)} pelo Mercado Pago`;
    if(alternative){alternative.hidden=!pixEnabled;alternative.disabled=!enabled||busy||checking||pending()||Boolean(requestKey&&requestMethod!=='checkout');}
  }
  function clearRequest(){
    requestKey=null;requestMethod=null;lockedAmount=null;
    for(const key of ['request-state','request-key','request-amount','request-method','request-reference','request-token'])remove(key);
    stopPoll();updateButton();
  }
  function saveRequest(){
    const atomic=write('request-state',JSON.stringify({requestKey,amountCents:lockedAmount,method:requestMethod,reference:returnReference,token:returnToken}));
    const results=[write('request-key',requestKey),write('request-amount',String(lockedAmount)),write('request-method',requestMethod)];
    if(returnReference&&returnToken)results.push(write(returnReference,returnToken),write('request-reference',returnReference),write('request-token',returnToken));
    saved=atomic||results.every(Boolean);
  }
  function selectAmount(value){selectedAmount=value;for(const input of amountOptions)input.checked=Number(input.value)===value;}
  function rememberReceipt(payment){
    const valid=typeof payment.reference==='string'&&VALID_REFERENCE.test(payment.reference)&&validToken(payment.statusToken);
    if(!valid||(returnReference&&returnReference!==payment.reference))return false;
    returnReference=payment.reference;returnToken=payment.statusToken;
    // Only opaque recovery credentials are retained, never email or payment QR.
    saveRequest();
    return true;
  }
  function renderOrder(order){
    if(order.reference!==returnReference||!SUPPORT_AMOUNTS.includes(order.amountCents)||order.currency!=='BRL'||(lockedAmount!==null&&order.amountCents!==lockedAmount)||typeof order.status!=='string'||(order.method&&requestMethod&&order.method!==requestMethod))throw Error('Invalid support status');
    selectAmount(order.amountCents);lockedAmount=order.amountCents;
    if(order.method==='pix')requestMethod='pix';
    terminal=TERMINAL.has(order.status);
    hidePix();status.textContent=supportStatusMessage(order.status,order.amountCents);
    if(typeof order.beneficiary==='string'&&order.beneficiary.trim()){beneficiary.textContent='Recebedor: '+order.beneficiary.trim();beneficiary.hidden=false;}
    refresh.hidden=terminal;
    if(terminal){clearRequest();return;}
    if(requestMethod==='pix'&&pixNodes){
      currentPix=order.status==='pending'?validatedSupportPix(order.pix,now()):null;
      if(currentPix){
        panel.hidden=false;qr.src=currentPix.imageSrc;qr.alt=`QR Code Pix do apoio de ${supportAmountLabel(order.amountCents)}`;
        code.value=currentPix.code;code.readOnly=true;copy.disabled=false;
        expiry.textContent='Válido até '+new Date(currentPix.expiresMs).toLocaleString('pt-BR')+'.';
        status.textContent='Pix pronto. Confira o valor e o recebedor no aplicativo do seu banco antes de confirmar. O apoio ainda não foi confirmado.';
      }else if(order.status==='pending')status.textContent='O código Pix está indisponível ou expirou. Verifique a confirmação antes de tentar outro pagamento; o apoio ainda está em acompanhamento.';
    }
    if(!saved)status.textContent+=' Mantenha esta página aberta: este navegador não permitiu salvar a recuperação do apoio.';
    updateButton();
  }
  async function checkReturn(){
    if(!returnReference||!returnToken||checking||busy||destroyed)return;
    checking=true;stopPoll();refresh.disabled=true;updateButton();
    if(!currentPix)status.textContent='Verificando a confirmação do apoio…';
    if(currentPix&&currentPix.expiresMs<=now()){hidePix();status.textContent='O prazo do código Pix terminou. Estamos verificando o apoio; aguarde a confirmação antes de gerar outro.';}
    try{
      const response=await fetch(`/api/prayer-support/orders/${encodeURIComponent(returnReference)}`,{headers:{'X-Support-Token':returnToken},credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Status unavailable');
      const order=await response.json();if(destroyed)return;
      renderOrder(order);
    }catch{status.textContent='Não foi possível confirmar o apoio agora. Use “Verificar confirmação do apoio” antes de tentar outro pagamento.';refresh.hidden=false;}
    finally{checking=false;refresh.disabled=false;updateButton();schedulePoll();}
  }
  for(const input of amountOptions)input.addEventListener('change',()=>{
    if(!enabled||busy||checking||lockedAmount!==null||!input.checked)return;
    const value=Number(input.value);if(!allowedAmounts.includes(value))return;
    selectAmount(value);updateButton();
  });
  refresh.addEventListener('click',()=>checkReturn());
  async function createPayment(method){
    if(!enabled||busy||checking||pending()||!allowedAmounts.includes(selectedAmount)||(requestKey&&requestMethod!==method)||(method==='pix'&&!pixEnabled))return;
    let payerEmail;
    if(method==='pix'){
      payerEmail=String(email.value||'').trim();
      if(payerEmail.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail))||email.checkValidity?.()===false){status.textContent='Informe seu e-mail para gerar o Pix. Ele será usado no pagamento e não será salvo neste navegador.';email.reportValidity?.();email.focus?.();return;}
    }
    terminal=false;returnReference=null;returnToken=null;hidePix();busy=true;lockedAmount=selectedAmount;requestMethod=method;updateButton();
    status.textContent=`Preparando seu apoio único de ${supportAmountLabel(selectedAmount)}…`;
    try{
      requestKey=requestKey||crypto.randomUUID();
      if(!VALID_REQUEST.test(requestKey))throw Error('Request key unavailable');
      saveRequest();
      const body={requestKey,amountCents:selectedAmount,accepted:true,...(method==='pix'?{payerEmail}:{})};
      const response=await fetch('/api/prayer-support/'+method,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
      const payment=await response.json();if(destroyed)return;
      const receiptValid=rememberReceipt(payment);
      if(!response.ok){
        if(receiptValid){
          refresh.hidden=false;
          if(payment.status==='creation_rejected'&&payment.amountCents===selectedAmount&&payment.currency==='BRL'&&(method!=='pix'||payment.method==='pix')){terminal=true;clearRequest();status.textContent=supportStatusMessage(payment.status,selectedAmount);return;}
          status.textContent='A abertura do apoio ainda precisa de confirmação. Use “Verificar confirmação do apoio” antes de tentar novamente.';return;
        }
        throw Error('Payment unavailable');
      }
      if(!receiptValid||payment.amountCents!==selectedAmount||payment.currency!=='BRL')throw Error('Invalid payment receipt');
      if(method==='pix'){
        if(payment.method!=='pix')throw Error('Invalid payment method');
        renderOrder(payment);
        if(!terminal&&!currentPix)refresh.hidden=false;
        return;
      }
      const checkoutUrl=validatedSupportCheckoutUrl(payment.checkoutUrl);
      if(!checkoutUrl||!saved)throw Error('Invalid checkout');
      status.textContent='Abrindo o Mercado Pago. Revise o recebedor e o valor antes de pagar.';refresh.hidden=false;
      if(typeof win?.vcLiaNavigate==='function'&&win.vcLiaNavigate(checkoutUrl)===true)status.textContent='Seu link de apoio está pronto. Continue pelo link de pagamento na conversa com a Lia e confira o recebedor e o valor no Mercado Pago. Nenhum pagamento foi confirmado nesta página.';
      else location.assign(checkoutUrl);
    }catch{
      status.textContent=pending()?'A abertura do apoio precisa de verificação. Nenhum pagamento foi confirmado; verifique antes de tentar outro.':'Não foi possível concluir a abertura agora. Nenhum pagamento foi confirmado. Tente novamente para recuperar a mesma solicitação, sem mudar o valor.';
      refresh.hidden=!pending();
    }finally{busy=false;updateButton();schedulePoll();}
  }
  button.addEventListener('click',()=>createPayment(pixEnabled?'pix':'checkout'));
  alternative?.addEventListener('click',()=>createPayment('checkout'));
  copy?.addEventListener('click',async()=>{
    if(!currentPix||currentPix.expiresMs<=now()){hidePix();status.textContent='O código Pix expirou. Verifique a confirmação do apoio antes de tentar outro pagamento.';void checkReturn();return;}
    const text=currentPix.code;
    try{
      if(typeof win?.navigator?.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');
      await win.navigator.clipboard.writeText(text);
      if(currentPix?.code===text)copyStatus.textContent='Código Pix copiado. Cole no aplicativo do seu banco e confira o recebedor e o valor.';
    }catch{if(currentPix?.code===text){code.focus?.();code.select?.();code.setSelectionRange?.(0,text.length);copyStatus.textContent='Selecione e copie o código acima. Depois cole no aplicativo do seu banco.';}}
  });
  const onVisibility=()=>{if(visible()&&pending())void checkReturn();else stopPoll();};
  const onPageHide=()=>{pageActive=false;stopPoll();};
  const onPageShow=()=>{pageActive=true;onVisibility();};
  document.addEventListener?.('visibilitychange',onVisibility);win?.addEventListener?.('pagehide',onPageHide);win?.addEventListener?.('pageshow',onPageShow);
  try{
    const response=await fetch('/api/prayer-support/config',{credentials:'same-origin',cache:'no-store'});
    const config=response.ok?await response.json():null;
    if(validSupportConfiguration(config)){
      enabled=true;pixEnabled=pixNodes&&config.pixEnabled===true;allowedAmounts=config.amountsCents;
      selectAmount(allowedAmounts.includes(config.defaultAmountCents)?config.defaultAmountCents:allowedAmounts.at(-1));
      for(const input of amountOptions)input.disabled=!allowedAmounts.includes(Number(input.value));
      beneficiary.textContent='Recebedor: '+config.beneficiary.trim();beneficiary.hidden=false;
      status.textContent=pixEnabled?'Apoio único e opcional. Gere um Pix para pagar no aplicativo do seu banco.':'Apoio único pelo Mercado Pago. Você revisa e confirma o pagamento no próximo passo.';
    }
  }catch{/* Keep the unavailable state, but still try recovering an existing order. */}
  let previous;
  try{previous=JSON.parse(read('request-state'));}catch{}
  const validPrevious=previous&&typeof previous.requestKey==='string'&&VALID_REQUEST.test(previous.requestKey)&&SUPPORT_AMOUNTS.includes(previous.amountCents)&&['pix','checkout'].includes(previous.method);
  const previousKey=validPrevious?previous.requestKey:read('request-key'),previousAmount=validPrevious?previous.amountCents:Number(read('request-amount'));
  if(previousKey&&VALID_REQUEST.test(previousKey)&&SUPPORT_AMOUNTS.includes(previousAmount)){
    requestKey=previousKey;lockedAmount=previousAmount;selectAmount(previousAmount);requestMethod=validPrevious?previous.method:read('request-method')==='pix'?'pix':'checkout';
    const reference=validPrevious?previous.reference:read('request-reference'),token=validPrevious?previous.token:read('request-token');
    if(typeof reference==='string'&&VALID_REFERENCE.test(reference)&&validToken(token)){returnReference=reference;returnToken=token;}
    if(!returnReference)status.textContent='Há uma solicitação em acompanhamento. Tente novamente com o mesmo valor para recuperá-la; não foi confirmado um pagamento.';
  }
  const params=new URL(location.href).searchParams,reference=params.get('ref');
  if(params.get('apoio')==='retorno'&&reference&&VALID_REFERENCE.test(reference)&&(!returnReference||returnReference===reference)){
    const storedToken=read(reference);
    returnReference=reference;returnToken=validToken(storedToken)?storedToken:returnToken;terminal=false;
    if(!returnToken)status.textContent='Não encontramos a confirmação deste apoio neste aparelho. A volta do pagamento, sozinha, não confirma o recebimento.';
  }
  updateButton();
  if(returnReference&&returnToken){refresh.hidden=false;await checkReturn();}
  return {checkReturn,destroy(){destroyed=true;stopPoll();document.removeEventListener?.('visibilitychange',onVisibility);win?.removeEventListener?.('pagehide',onPageHide);win?.removeEventListener?.('pageshow',onPageShow);}};
}

if(typeof document!=='undefined'){
  let storage;
  try{storage=window.sessionStorage;}catch{}
  installPrayerSupport({document,fetch:window.fetch.bind(window),location:window.location,storage,crypto:window.crypto});
}
