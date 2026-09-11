const form=document.getElementById('cultiva-lia-form'),open=document.getElementById('cultiva-lia-open'),status=document.getElementById('cultiva-lia-status'),log=document.getElementById('cultiva-lia-log');
const contextPath='/plantas-e-jardinagem';
let connected=false,busy=false;
async function api(endpoint,body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);try{const response=await fetch('/api/site-assistant/'+endpoint,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível consultar a Lia agora.');return data;}finally{clearTimeout(timer);}}
function bubble(label,message){const article=document.createElement('article'),strong=document.createElement('strong'),p=document.createElement('p');strong.textContent=label;p.textContent=String(message).slice(0,2000);article.append(strong,p);log.append(article);while(log.children.length>12)log.firstElementChild.remove();return article;}
// Only physical products from the published first-party catalog can open here.
export function physicalProductLink(offer,origin,products=[]){
  if(offer?.assetType!=='product'||typeof offer.url!=='string'||!Array.isArray(products))return '';
  try{
    const url=new URL(offer.url,origin),id=url.pathname.match(/^\/produto\/([1-9]\d*)(?:\/[a-z0-9-]+)?$/)?.[1];
    if(!id||url.origin!==origin||url.username||url.password||url.search||url.hash||String(offer.assetId)!==id)return '';
    const product=products.find(item=>String(item.id)===id);
    return product&&['retail','food'].includes(product.product_type)&&[true,1].includes(product.available)&&Number.isFinite(product.stock_quantity)&&product.stock_quantity>0&&Number.isSafeInteger(product.price_cents)&&product.price_cents>0?url.href:'';
  }catch{return '';}
}
async function showProducts(offers){
  const container=document.getElementById('cultiva-lia-products');container.replaceChildren();
  const candidates=(Array.isArray(offers)?offers:[]).slice(0,6).filter(offer=>offer?.assetType==='product');if(!candidates.length)return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    // This public endpoint only lists published, available catalog items. A missing item is not linked.
    const response=await fetch('/api/marketplace/products',{headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)return;
    const data=await response.json(),products=Array.isArray(data.products)?data.products:[],seen=new Set();
    for(const offer of candidates){
      const href=physicalProductLink(offer,location.origin,products);if(!href||seen.has(href))continue;seen.add(href);
      const product=products.find(item=>String(item.id)===String(offer.assetId));
      const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.className='button';link.textContent=String(product.name||'Consultar produto').slice(0,120)+' — ver na loja';container.append(link);
    }
  }catch{/* An unavailable catalog must not hide the completed conversation or invent a product link. */}
  finally{clearTimeout(timer);}
}
open.addEventListener('click',async()=>{
  if(connected||busy)return;busy=true;open.disabled=true;status.textContent='Conectando à Lia…';
  try{const data=await api('context?path='+encodeURIComponent(contextPath));if(!data.enabled)throw Error('A Lia está indisponível agora. Você pode continuar pelo guia.');connected=true;form.hidden=false;open.hidden=true;for(const message of (data.history||[]).slice(-8))if(['user','assistant'].includes(message.role))bubble(message.role==='user'?'Você':'Lia · IA',message.content);status.textContent='Conte sua dúvida sobre plantas. Não envie senhas ou documentos.';document.getElementById('cultiva-lia-input').focus();}
  catch(error){status.textContent=error.name==='AbortError'?'A conexão demorou. Tente novamente.':error.message;open.disabled=false;}finally{busy=false;}
});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!connected||busy)return;const input=document.getElementById('cultiva-lia-input'),message=input.value.trim();if(message.length<2)return;
  busy=true;const button=form.querySelector('button');button.disabled=true;status.textContent='Preparando sua resposta…';bubble('Você',message);input.value='';showProducts([]);
  try{const data=await api('chat',{message,contextPath});if(typeof data.reply!=='string'||!data.reply.trim())throw Error('Não foi possível confirmar a resposta.');const article=bubble('Lia · IA',data.reply);const report=document.createElement('a');report.href='/games/ajuda?assunto=lia';report.textContent='Reportar esta resposta';article.append(report);await showProducts(data.offers);status.textContent='Confira as condições e o uso indicado antes de escolher um produto.';}
  catch(error){input.value=message;status.textContent=error.name==='AbortError'?'A resposta demorou. Sua mensagem ficou no campo para tentar novamente.':error.message||'Sem conexão. Tente novamente.';}
  finally{busy=false;button.disabled=false;}
});
