// A configured external shop remains the purchase destination for physical
// products, matching the store page and the individual product page.
export function externalPhysicalProductDestination(product,{origin='https://vitrinecity.com'}={}){
  if(String(product?.product_type||'').toLowerCase()==='digital')return null;
  const value=String(product?.product_url||'').trim();
  if(!/^https?:\/\//i.test(value)||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value)||/%(?:0[ad]|5c)/i.test(value))return null;
  try{
    const url=new URL(value),base=new URL(origin);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.origin===base.origin)return null;
    return {href:url.href,host:url.host.replace(/^www\./,''),label:'Ver opções na loja'};
  }catch{return null;}
}

export function applyExternalPhysicalProductLinks(container,products,{origin='https://vitrinecity.com'}={}){
  let changed=0;
  for(const product of Array.isArray(products)?products:[]){
    const destination=externalPhysicalProductDestination(product,{origin}),id=Number(product?.id);
    if(!destination||!Number.isSafeInteger(id)||id<1)continue;
    const button=container.querySelector(`[data-add="${id}"]`);
    if(!button)continue;
    const document=container.ownerDocument,link=document.createElement('a');
    link.className='button';link.href=destination.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=destination.label;
    link.style.cssText='display:block;text-align:center;margin-top:10px';
    const note=document.createElement('small');note.className='external-purchase-note';note.textContent=`Compra em ${destination.host} · abre em outra aba`;
    note.style.cssText='display:block;margin-top:8px;line-height:1.4;overflow-wrap:anywhere';
    button.replaceWith(link,note);changed++;
  }
  return changed;
}
