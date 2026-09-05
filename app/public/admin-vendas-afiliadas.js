const $ = s => document.querySelector(s);
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {mercadolivre:'Mercado Livre',shopee:'Shopee',tiktok:'TikTok'};
const healthNames = {unchecked:'Ainda não verificado',reachable:'Endereço respondeu; estoque não confirmado',broken:'Erro 404/410: revisar link',review:'Verificação inconclusiva: revisar na plataforma'};
let platform = new URLSearchParams(location.search).get('plataforma');
if (!names[platform]) platform='mercadolivre';
let rows=[],revision=0;
async function api(url,options){const response=await fetch(url,options);const data=await response.json();if(response.status===401||response.status===403){location.href='/admin-login.html';throw Error('Entre na administração.');}if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
async function load(){
  $('#message').textContent='Carregando…';
  try{
    const data=await api('/api/admin/affiliate-catalog');rows=data.items;
    const visible=rows.filter(p=>p.platform===platform);
    $('#summary').textContent=`${names[platform]} · ${visible.length} produtos`;
    document.querySelectorAll('[data-platform]').forEach(a=>{if(a.dataset.platform===platform)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('#items').innerHTML=visible.map(p=>`<article class="admin-item"><h2>${esc(p.title)}</h2><p>${esc({published:'Publicado',paused:'Pausado',draft:'Rascunho'}[p.status])} · Disponibilidade: ${esc({available:'informada disponível',unavailable:'indisponível',unknown:'não confirmada'}[p.availability])} · ${p.clicks} cliques registrados</p><p>${esc(healthNames[p.health])} · ${p.checked_at?esc(new Date(p.checked_at).toLocaleString('pt-BR')):'Sem verificação'}</p><div class="toolbar"><button data-edit="${p.slug}">Editar / trocar link</button><button data-check="${p.slug}" class="secondary">Verificar endereço</button>${p.status!=='draft'?`<a href="/ofertas/${p.slug}" target="_blank" rel="noopener">Abrir página</a>`:''}</div></article>`).join('')||'<p>Nenhum produto cadastrado nesta plataforma. Cadastre uma oferta com o link da sua conta de afiliado.</p>';
    const slugs=new Set(visible.map(p=>p.slug));
    $('#history').innerHTML=data.audit.filter(a=>slugs.has(a.slug)).map(a=>`<li>${esc(a.created_at)} · ${esc(a.slug)} · ${esc(a.action)}<br>${esc(a.detail)}</li>`).join('')||'<li>Sem alterações registradas.</li>';
    $('#message').textContent=data.running?'Verificação em andamento. Atualize o painel em instantes.':'';
  }catch(e){$('#message').textContent=e.message;}
}
function edit(p){
  const form=$('#product-form');form.reset();revision=p?.revision||0;
  const defaults={platform,status:'draft',availability:'unknown'};
  for(const key of ['slug','platform','title','description','category','keywords','affiliate_url','image','status','availability','evidence'])form.elements.namedItem(key).value=p?.[key]??defaults[key]??'';
  form.elements.namedItem('slug').readOnly=!!p;
  $('#form-message').textContent='';$('#editor').showModal();
}
$('#new-item').onclick=()=>edit();$('#cancel').onclick=()=>$('#editor').close();$('#refresh').onclick=load;
$('#items').onclick=async e=>{
  const editButton=e.target.closest('[data-edit]');if(editButton){edit(rows.find(p=>p.slug===editButton.dataset.edit));return;}
  const check=e.target.closest('[data-check]');if(!check)return;
  check.disabled=true;$('#message').textContent='Verificando endereço…';
  try{await api('/api/admin/affiliate-catalog/'+check.dataset.check+'/check',{method:'POST'});await load();}catch(err){$('#message').textContent=err.message;}finally{check.disabled=false;}
};
$('#product-form').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  const payload=Object.fromEntries(new FormData(e.currentTarget));payload.revision=revision;
  try{await api('/api/admin/affiliate-catalog/'+encodeURIComponent(payload.slug),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#editor').close();await load();$('#message').textContent='Produto salvo. A página permanente foi mantida.';}catch(err){$('#form-message').textContent=err.message;}finally{button.disabled=false;}
};
load();
