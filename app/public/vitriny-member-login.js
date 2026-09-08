import {memberReturn} from './vitriny-membership-core.js';
const $=id=>document.getElementById(id),destination=memberReturn(new URLSearchParams(location.search).get('returnTo'));let busy=false;
function showForm(register){$('registerForm').hidden=!register;$('loginForm').hidden=register;$('registerTab').setAttribute('aria-selected',String(register));$('loginTab').setAttribute('aria-selected',String(!register));$('memberMessage').textContent='';}
$('loginTab').addEventListener('click',()=>showForm(false));$('registerTab').addEventListener('click',()=>showForm(true));
async function submit(event,registration){event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form),body={email:data.get('email'),password:data.get('password')};
  if(registration){Object.assign(body,{name:data.get('name'),whatsapp:data.get('whatsapp'),adultConfirmed:data.get('adult')==='on',termsAccepted:data.get('terms')==='on',accountContext:'city',communications:{email:data.get('marketingEmail')==='on',whatsapp:data.get('marketingWhatsapp')==='on'}});if(body.communications.whatsapp&&String(body.whatsapp||'').replace(/\D/g,'').length<10){$('memberMessage').textContent='Informe um WhatsApp válido ou deixe esse canal desmarcado.';return;}}
  busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;$('memberMessage').textContent='Conectando sua conta…';
  try{const response=await fetch(`/api/auth/${registration?'register':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível entrar agora.');location.assign(destination);}catch(error){$('memberMessage').textContent=error.message||'Não foi possível conectar. Tente novamente.';}finally{busy=false;button.disabled=false;}
}
$('loginForm').addEventListener('submit',event=>submit(event,false));$('registerForm').addEventListener('submit',event=>submit(event,true));
