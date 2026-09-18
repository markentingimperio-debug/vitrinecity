(()=>{
'use strict';
const $=id=>document.getElementById(id),base='/api/lia/operations';
let quote=null,key='',busy=false;
function money(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2});}
function error(msg){$('error').textContent=msg;$('error').hidden=false;}
function clear(){ $('error').hidden=true;$('error').textContent=''; }
async function api(path,method='GET',body,headers={}){
  const response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(method==='GET'?{}:{'content-type':'application/json'}),...headers},...(body!==undefined?{body:body instanceof Blob?body:JSON.stringify(body)}:{})});
  let data={};try{data=await response.json();}catch{}
  if(response.status===401){$('login-card').hidden=false;throw Error('Entre na sua conta para usar a LIA.');}
  if(!response.ok)throw Error(data.error||`Falha HTTP ${response.status}`);
  return data;
}
async function status(){
  try{const data=await api('/status');$('balance').textContent=money(data.balanceCoins);$('browser-price').textContent=money(data.prices?.browserCoins)+' moeda(s)';$('media-price').textContent=money(data.prices?.mediaCoins)+' moeda(s)';if(!data.enabled)error('A LIA operacional ainda não está habilitada.');}
  catch(e){error(e.message);}
}
async function doQuote(event){
  event.preventDefault();if(busy)return;clear();quote=null;$('confirm').hidden=true;
  const instruction=$('instruction').value.trim();if(instruction.length<3)return;
  busy=true;$('quote').disabled=true;
  try{
    const data=await api('/quote','POST',{instruction});quote=data.item;key=crypto.randomUUID();
    $('quote-card').hidden=false;
    $('quote-title').textContent=quote.supported?`${quote.kind==='browser'?'Navegação':'Edição de mídia'} · ${money(quote.priceCoins)} Vitrine Coins`:'Comando ainda não suportado';
    $('quote-text').textContent=quote.supported?(quote.needsUpload?'A tarefa precisa do arquivo anexado. A cobrança só ocorre após sua confirmação.':'A cobrança só ocorre após sua confirmação.'):'Tente separar navegação e edição em duas tarefas.';
    $('confirm').hidden=!quote.supported;
  }catch(e){error(e.message);}finally{busy=false;$('quote').disabled=false;}
}
async function upload(file){
  const response=await fetch(base+'/upload',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':file.type},body:file});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw Error(data.error||'Falha ao enviar arquivo.');
  return data.upload?.id||'';
}
async function run(){
  if(!quote||busy)return;clear();busy=true;$('confirm').disabled=true;$('confirm').textContent='Executando…';
  try{
    let uploadId='';const file=$('file').files?.[0];
    if(quote.needsUpload){if(!file)throw Error('Anexe a foto, vídeo ou áudio para esta tarefa.');uploadId=await upload(file);}
    const instruction=$('instruction').value.trim();
    const data=await api('/run','POST',{instruction,idempotencyKey:key,confirmCharge:true,...(uploadId?{uploadId}:{})},{'x-lia-operations-request':'1'});
    const item=data.item;$('result-card').hidden=false;$('result-title').textContent=item.status==='completed'?'Tarefa concluída':'Tarefa '+item.status;
    $('result').textContent=item.result?.result||item.result?.resultData?.summary||item.error||'Concluído.';
    const target=$('artifacts');target.replaceChildren();
    for(const a of item.result?.artifacts||[]){const link=document.createElement('a');link.className='button';link.textContent='Baixar '+String(a.path||'arquivo').split('/').pop();link.href=base+'/artifact?operation='+encodeURIComponent(item.id)+'&path='+encodeURIComponent(a.path);target.append(link);}
    $('balance').textContent=money(data.balanceCoins);quote=null;$('confirm').hidden=true;$('file').value='';
  }catch(e){error(e.message);await status();}finally{busy=false;$('confirm').disabled=false;$('confirm').textContent='Confirmar e executar';}
}
$('command-form').addEventListener('submit',doQuote);$('confirm').addEventListener('click',run);status();
})();