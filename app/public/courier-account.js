(() => {
  const app=document.getElementById('app');
  if(!app)return;
  const section=document.createElement('section');section.className='card';section.id='courierAccount';
  section.innerHTML=`<details><summary><strong>Minha conta e segurança</strong></summary>
    <p id="courierRecoveryStatus" class="muted" role="status">Consultando o e-mail de recuperação…</p>
    <p class="muted">Confirme seu e-mail para recuperar a senha caso esqueça. A confirmação só é concluída pelo link enviado à sua caixa de entrada.</p>
    <form id="courierEmailForm" class="grid">
      <label>E-mail de recuperação<input name="email" type="email" maxlength="254" autocomplete="email" required></label>
      <label>Senha atual<input name="currentPassword" type="password" maxlength="200" autocomplete="current-password" required></label>
      <div class="wide"><button>Enviar confirmação de e-mail</button></div>
      <p id="courierEmailMessage" class="message wide" role="status"></p>
    </form>
    <h3>Criar uma nova senha</h3><form id="courierPasswordForm" class="grid">
      <label class="wide">Senha atual<input name="currentPassword" type="password" maxlength="200" autocomplete="current-password" required></label>
      <label>Nova senha<input name="password" type="password" minlength="10" maxlength="200" autocomplete="new-password" required></label>
      <label>Repita a nova senha<input name="confirmation" type="password" minlength="10" maxlength="200" autocomplete="new-password" required></label>
      <div class="wide"><button>Alterar senha</button></div>
      <p id="courierPasswordMessage" class="message wide" role="status"></p>
    </form></details>`;
  app.append(section);
  const el=id=>document.getElementById(id);
  async function request(url,body,method='POST'){
    const response=await fetch(url,{method,credentials:'same-origin',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;
  }
  async function refresh(){
    if(app.classList.contains('hidden'))return;
    try{const data=await request('/api/courier/account',null,'GET');
      el('courierRecoveryStatus').textContent=data.emailVerified?`E-mail confirmado: ${data.recoveryEmail}`:'Você ainda não tem um e-mail de recuperação confirmado.';
      if(!data.emailDeliveryConfigured)el('courierRecoveryStatus').textContent+=' O envio de e-mails está indisponível no momento.';
    }catch{el('courierRecoveryStatus').textContent='Não foi possível consultar sua conta. Entre novamente se sua sessão expirou.';}
  }
  new MutationObserver(refresh).observe(app,{attributes:true,attributeFilter:['class']});
  section.querySelector('details').addEventListener('toggle',event=>{if(event.target.open)refresh();});
  el('courierEmailForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;
    el('courierEmailMessage').textContent='Enviando confirmação…';
    try{const data=await request('/api/courier/account/email',Object.fromEntries(new FormData(form)));form.elements.currentPassword.value='';el('courierEmailMessage').textContent=data.message;}
    catch(error){el('courierEmailMessage').textContent=error.message;}finally{button.disabled=false;}
  });
  el('courierPasswordForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
    if(values.password!==values.confirmation){el('courierPasswordMessage').textContent='As novas senhas precisam ser iguais.';return;}
    const button=event.submitter;button.disabled=true;el('courierPasswordMessage').textContent='Alterando senha…';
    try{await request('/api/courier/account/password',{currentPassword:values.currentPassword,password:values.password},'PUT');form.reset();location.assign('/entregador.html?senha=alterada');}
    catch(error){el('courierPasswordMessage').textContent=error.message;}finally{button.disabled=false;}
  });
  if(new URLSearchParams(location.search).get('senha')==='alterada')el('loginMessage').textContent='Senha alterada. Entre com sua nova senha.';
  refresh();
})();
