import { validLiaQuote, sameLiaQuote } from './lia-discount.js';
const money=value=>(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export function mountLiaShopDiscount({doc=document,fetchImpl=fetch,getItems,getShippingCents}) {
  const panel=doc.createElement('div');panel.className='notice';panel.id='lia-shop-benefit';panel.setAttribute('aria-live','polite');
  doc.getElementById('total').before(panel);
  let quote=null,signature='',generation=0,pending=null;
  const key=()=>JSON.stringify(getItems());
  function current(){return signature===key()?quote:null;}
  function render(){
    const value=current();panel.replaceChildren();
    if(!getItems().length){panel.hidden=true;return;}panel.hidden=false;
    const add=text=>{const line=doc.createElement('p');line.textContent=text;panel.append(line);};
    if(!value){add('Consulte o total atualizado antes de pagar.');return;}
    add('Produtos: '+money(value.originalAmountCents));
    if(value.eligible){add('Cupom LIA5 · 5% de desconto: − '+money(value.discountCents));add('Benefício da Lia nos produtos Agrotécnica. Frete separado; não acumula com outros descontos.');}
    const shipping=getShippingCents();add('Entrega: '+(Number.isSafeInteger(shipping)?money(shipping):'a calcular'));
    doc.getElementById('total').textContent=money(value.amountCents+(Number.isSafeInteger(shipping)?shipping:0));
    const local=doc.getElementById('orderBreakdown');if(local)local.hidden=true;
  }
  async function refresh(){
    const items=getItems(),requested=JSON.stringify(items),token=++generation,previous=current();
    if(!items.length){quote=null;signature=requested;render();return null;}
    if(signature!==requested){quote=null;doc.getElementById('marketplaceTerms').checked=false;render();}
    try {
      const response=await fetchImpl('/api/marketplace/checkout/quote',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});
      const data=await response.json(),value=validLiaQuote(data.quote);
      if(token!==generation||requested!==key())return null;
      if(!response.ok||!value)throw Error(data.error||'Não foi possível confirmar o total do carrinho. Consulte novamente.');
      quote=value;signature=requested;if(previous&&!sameLiaQuote(previous,value))doc.getElementById('marketplaceTerms').checked=false;render();return value;
    } catch(error){if(token===generation){quote=null;signature='';render();doc.getElementById('status').textContent=error.message||'Não foi possível confirmar o valor da compra.';}return null;}
  }
  function changed(){if(signature!==key()&&!pending){const requested=key();pending=refresh().finally(()=>{pending=null;if(requested!==key())changed();});}render();return pending;}
  return {current,refresh,changed,render};
}
