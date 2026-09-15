// Optional, unserved template; no production route or session is enabled.
const $=id=>document.getElementById(id),API='/api/admin/live-avatar';
let state=null,busy=false;
const labels={verified:'Conferido',not_verified:'Ainda não conferido',not_configured:'Falta configurar',disabled:'Desativado neste ambiente',verification_due:'Precisa de nova conferência',unauthorized:'Acesso não autorizado pelo provedor',not_found:'Identificador não encontrado',unavailable:'Provedor indisponível; tente verificar mais tarde',invalid_response:'Resposta do provedor precisa de conferência',expired:'Avatar expirado',preparing:'Avatar em preparação',failed:'A preparação do avatar falhou',variables_required:'O contexto exige dados adicionais',encryption_unavailable:'A proteção da chave precisa ser conferida'};
function controls(){$('save').disabled=busy||!state?.enabled;$('verify').disabled=busy||!state?.configured||state?.checking;$('refresh').disabled=busy;}
function render(data){state=data;$('status').textContent=data.detail;$('api-key').value='';$('key-note').textContent=data.hasApiKey?'Uma chave já está salva. Deixe o campo vazio para preservá-la.':'A chave fica protegida no servidor e não será exibida novamente.';
  $('avatar-id').value=data.avatarId||'';$('context-id').value=data.contextId||'';$('voice-id').value=data.voiceId||'';
  const rows=[['API LiveAvatar',data.apiConnection],['Avatar da Lia',data.checks?.avatar?.state],['Contexto de atendimento',data.checks?.context?.state],['Voz',data.checks?.voice?.state]];
  const steps=rows.map(([name,status])=>{const item=document.createElement('li');item.textContent=name+': '+(labels[status]||'Ainda não conferido');return item;});
  if(data.checks?.voice?.state==='verified'&&!data.checks.voice.portugueseConfirmed){const item=document.createElement('li');item.textContent='Português brasileiro: a voz precisa de confirmação.';steps.push(item);}
  if(typeof data.checks?.api?.creditsRemaining==='string'){const item=document.createElement('li');item.textContent='Créditos informados na última consulta: '+data.checks.api.creditsRemaining;steps.push(item);}
  for(const text of ['Transmissão e áudio no site: ainda não testados.','Atendimento ao vivo para visitantes: desativado.']){const item=document.createElement('li');item.textContent=text;steps.push(item);}
  $('steps').replaceChildren(...steps);$('checked-at').textContent=data.verifiedAt?'Última consulta: '+new Date(data.verifiedAt).toLocaleString('pt-BR')+'.':'Nenhuma consulta à API foi realizada por esta configuração.';controls();
}
async function request(route,body){const response=await fetch(API+route,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(70000),...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'Entre na administração para continuar.');return data;}
async function action(work,success=''){if(busy)return;busy=true;controls();try{render(await work());$('error').textContent=success;}catch(error){$('error').textContent=error.message||'Não foi possível concluir esta etapa.';}finally{$('api-key').value='';busy=false;controls();}}
$('refresh').addEventListener('click',()=>action(()=>request('/status')));
$('settings-form').addEventListener('submit',event=>{event.preventDefault();if(busy||!state)return;const body={revision:state.revision,apiKey:$('api-key').value,avatarId:$('avatar-id').value.trim(),contextId:$('context-id').value.trim(),voiceId:$('voice-id').value.trim()};void action(()=>request('/settings',body),'Dados salvos. Use a verificação para conferir a conexão.');});
$('verify').addEventListener('click',()=>{if(!state?.configured)return;void action(()=>request('/verify',{}),'Conferência concluída. Veja o resultado de cada etapa acima.');});
void action(()=>request('/status'));
