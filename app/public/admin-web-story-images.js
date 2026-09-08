// The library exposes only validated local images already used publicly or shipped editorial assets.
export function createStoryImagePicker({api,document=globalThis.document}) {
  const node=(tag,text,attrs={})=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;Object.assign(el,attrs);return el;};
  const dialog=node('dialog',undefined,{className:'image-picker'});dialog.setAttribute('aria-labelledby','image-picker-title');
  const head=node('div',undefined,{className:'section-head'}),title=node('h2','Escolha uma imagem',{id:'image-picker-title'}),close=node('button','Fechar',{type:'button',className:'secondary'});
  head.append(title,close);dialog.append(head,node('p','Escolha uma imagem que represente o texto. As capas abaixo já pertencem à biblioteca pública da VitrineCity.'));
  const form=node('form',undefined,{className:'actions'}),label=node('label','Buscar imagem por assunto'),search=node('input',undefined,{type:'search',maxLength:80,placeholder:'Ex.: receitas, cinema ou tecnologia'}),submit=node('button','Buscar',{type:'submit'});
  label.append(search);form.append(label,submit);dialog.append(form);
  const message=node('p',undefined,{className:'muted'});message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const grid=node('div',undefined,{className:'image-library-grid'}),allLabel=node('label',undefined,{className:'check'}),all=node('input',undefined,{type:'checkbox'});
  allLabel.append(all,node('span','Usar a imagem escolhida em todas as páginas desta história'));
  const navigation=node('nav',undefined,{className:'actions image-library-pages'}),previous=node('button','← Anteriores',{type:'button',className:'secondary'}),pageLabel=node('span'),next=node('button','Próximas →',{type:'button',className:'secondary'});navigation.setAttribute('aria-label','Páginas de imagens');navigation.append(previous,pageLabel,next);
  dialog.append(message,allLabel,grid,navigation);document.body.append(dialog);
  let sequence=0,controller=null,resolveChoice=null,choice=null,articleId='',currentUrl='',page=1,pages=1,returnFocus=null;
  async function load(requested=1) {
    const generation=++sequence;controller?.abort();controller=new AbortController();message.textContent='Carregando imagens…';previous.disabled=true;next.disabled=true;submit.disabled=true;grid.replaceChildren();
    try {
      const query=new URLSearchParams({q:search.value.trim(),articleId,p:String(requested)}),data=await api('/api/admin/web-stories/images?'+query,{signal:controller.signal});
      if(generation!==sequence||!dialog.open)return;
      page=data.page;pages=data.pages;
      for(const item of data.items){
        const button=node('button',undefined,{type:'button',className:'image-library-item'});button.setAttribute('aria-label','Escolher '+item.title);button.setAttribute('aria-pressed',String(item.url===currentUrl));
        button.append(node('img',undefined,{src:item.url,alt:'',loading:'lazy',width:item.width,height:item.height}),node('strong',item.title),node('small',`${item.category} · ${item.width} × ${item.height}`));
        if(item.generic)button.append(node('small','Capa genérica: prefira uma imagem do assunto',{className:'image-warning'}));
        button.addEventListener('click',()=>{choice={...item,allPages:all.checked};dialog.close();});grid.append(button);
      }
      message.textContent=data.items.length?'Toque em uma imagem para escolhê-la.':'Nenhuma imagem compatível encontrada nesta página. Tente outro assunto ou outra página.';
      pageLabel.textContent=`Página ${page} de ${pages}`;previous.disabled=page<=1;next.disabled=page>=pages;
    } catch(error){if(generation===sequence&&error.name!=='AbortError')message.textContent=error.message||'Não foi possível carregar as imagens. Tente novamente.';}
    finally{if(generation===sequence)submit.disabled=false;}
  }
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{sequence++;controller?.abort();const resolve=resolveChoice;resolveChoice=null;resolve?.(choice);if(returnFocus?.isConnected)returnFocus.focus();});
  form.addEventListener('submit',event=>{event.preventDefault();load(1);});previous.addEventListener('click',()=>load(page-1));next.addEventListener('click',()=>load(page+1));
  return {open(options={}){if(dialog.open)dialog.close();articleId=options.articleId||'';currentUrl=options.currentUrl||'';choice=null;all.checked=false;search.value='';returnFocus=document.activeElement;dialog.showModal();search.focus();load(1);return new Promise(resolve=>{resolveChoice=resolve;});},destroy(){dialog.close();controller?.abort();dialog.remove();}};
}
