import {PRAYER_PAGE_CONFIG} from './oracao-do-dia-config.js?v=20260910-prayer-group';

export function buildPrayerShareText({title,edition,verse,paragraphs,url}){
  return [String(title).trim(),`VitrineCity · ${String(edition).trim()}`,...paragraphs.map(text=>String(text).trim()).filter(Boolean),`${String(verse).trim()} — Salmos 23:1 (ARA)`,`Fonte bíblica: https://www.sbb.org.br/biblia/ARA/PSA.23`,String(url).trim()].filter(Boolean).join('\n\n');
}

export function prayerShareUrl(locationHref,editionDay){
  const url=new URL(locationHref);
  url.search='';url.hash='oracao';
  if(typeof editionDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(editionDay)&&Number.isFinite(Date.parse(`${editionDay}T00:00:00Z`))&&new Date(`${editionDay}T00:00:00Z`).toISOString().slice(0,10)===editionDay)url.searchParams.set('dia',editionDay);
  return url.href;
}

export async function writePrayerClipboard(text,clipboard){
  if(!clipboard?.writeText)return false;
  try{await clipboard.writeText(text);return true;}catch{return false;}
}

export function installPrayerPage({document,navigator,location,config=PRAYER_PAGE_CONFIG}){
  const status=document.getElementById('shareStatus'),dialog=document.getElementById('manualCopy'),manualText=document.getElementById('manualCopyText');
  function editionUrl(){return prayerShareUrl(location.href,document.getElementById('prayerEdition').getAttribute('datetime'));}
  function shareText(){return buildPrayerShareText({title:document.getElementById('prayerTitle').textContent,edition:document.getElementById('prayerEdition').textContent,verse:document.getElementById('dailyVerse').textContent,paragraphs:[...document.querySelectorAll('[data-prayer-paragraph]')].map(node=>node.textContent),url:editionUrl()});}
  function showManualCopy(text){
    manualText.value=text;
    dialog.showModal();manualText.focus();manualText.select();
    status.textContent='Selecione e copie o texto na janela aberta.';
  }
  async function copy(text,success){
    if(await writePrayerClipboard(text,navigator.clipboard)){status.textContent=success;return;}
    showManualCopy(text);
  }
  document.getElementById('copyPrayer').addEventListener('click',()=>copy(shareText(),'Oração copiada. Você pode enviá-la a alguém com carinho.'));
  document.getElementById('copyPrayerLink').addEventListener('click',()=>copy(editionUrl(),'Link desta edição da oração copiado.'));
  document.getElementById('sharePrayer').addEventListener('click',async()=>{
    const text=shareText();
    if(typeof navigator.share!=='function'){await copy(text,'Oração copiada. Escolha onde deseja compartilhar.');return;}
    try{await navigator.share({title:'Oração do dia · VitrineCity',text});status.textContent='Compartilhamento concluído no seu aparelho.';}
    catch(error){if(error?.name==='AbortError'){status.textContent='Compartilhamento cancelado.';return;}await copy(text,'Oração copiada. Escolha onde deseja compartilhar.');}
  });
  document.getElementById('closeManualCopy').addEventListener('click',()=>dialog.close());
  document.getElementById('selectManualCopy').addEventListener('click',()=>{manualText.focus();manualText.select();});
  const amen=document.getElementById('amenButton');
  amen.addEventListener('click',()=>{
    const active=amen.getAttribute('aria-pressed')!=='true';amen.setAttribute('aria-pressed',String(active));
    document.getElementById('amenStatus').textContent=active?'Amém. Que você encontre paz para seguir o seu dia. Este gesto fica apenas nesta página.':'Seu amém fica apenas nesta página.';
  });
  const invitation=validatedWhatsAppGroupUrl(config.groupInviteUrl),join=document.getElementById('joinPrayerGroup');
  if(invitation){
    join.href=invitation;join.target='_blank';join.rel='noopener noreferrer';join.removeAttribute('tabindex');join.setAttribute('aria-disabled','false');
    document.getElementById('groupAvailability').textContent='Grupo exclusivo de orações';
    document.getElementById('signupStatus').textContent='O convite abre no WhatsApp em uma nova aba. Você escolhe se deseja entrar no grupo.';
  }
  const art=document.getElementById('jesusArt');
  function unavailable(){art.hidden=true;document.querySelector('.art-unavailable').hidden=false;}
  art.addEventListener('error',unavailable);
  if(art.complete&&art.naturalWidth===0)unavailable();
}

if(typeof document!=='undefined')installPrayerPage({document,navigator,location});

export function validatedWhatsAppGroupUrl(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const url=new URL(value.trim());
    if(url.protocol!=='https:'||url.hostname!=='chat.whatsapp.com'||url.username||url.password||url.port||!/^\/[a-zA-Z0-9_-]{10,128}\/?$/.test(url.pathname))return null;
    url.hash='';return url.href;
  }catch{return null;}
}
