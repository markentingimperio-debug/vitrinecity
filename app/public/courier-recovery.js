(() => {
  const params=new URLSearchParams(location.search),verify=params.get('verify'),token=verify||params.get('token');
  // Keep credentials only in this page's memory; never persist or send them as referrers.
  if(location.search)history.replaceState(null,'',location.pathname);
  const el=id=>document.getElementById(id),mode=token?(verify?'verify':'reset'):'request';
  for(const name of ['request','verify','reset'])el(`${name}Form`).hidden=name!==mode;
  el('title').textContent=mode==='verify'?'Confirmar meu e-mail':mode==='reset'?'Criar nova senha':'Recuperar minha senha';
  el('onboardingHelp').hidden=mode!=='request';
  for(const name of ['request','verify','reset'])el(`${name}Form`).addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
    if(name==='reset'&&values.password!==values.confirmation){el('message').textContent='As senhas precisam ser iguais.';return;}
    const button=event.submitter;button.disabled=true;el('message').textContent='Aguarde…';
    const url=name==='verify'?'/api/courier/account/email/confirm':`/api/courier/password-reset/${name==='reset'?'confirm':'request'}`;
    const body=name==='verify'?{token}:name==='reset'?{token,password:values.password}:{email:values.email};
    try{const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');
      form.reset();el('message').textContent=data.message;if(name!=='request')form.hidden=true;
    }catch(error){el('message').textContent=error.message;}finally{button.disabled=false;}
  });
})();
