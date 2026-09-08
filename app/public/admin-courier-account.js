(() => {
  const list=document.getElementById('couriers');if(!list)return;
  const status=document.createElement('p');status.setAttribute('role','status');status.className='muted';list.after(status);
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-remove-courier]');if(!button)return;
    if(!confirm('Excluir este entregador do operacional? Ele ficará bloqueado e sem acesso. O histórico e os registros financeiros serão preservados. Corridas e valores pendentes impedem a exclusão.'))return;
    const reason=prompt('Informe o motivo da exclusão do operacional (de 5 a 500 caracteres):');if(reason===null)return;
    if(reason.trim().length<5||reason.trim().length>500){status.textContent='Informe um motivo de 5 a 500 caracteres.';return;}
    button.disabled=true;status.textContent='Verificando corridas e valores pendentes…';
    try{const response=await api(`/api/admin/local-delivery/couriers/${encodeURIComponent(button.dataset.removeCourier)}`,{
      method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({reason:reason.trim()})
    });status.textContent=response.message;await load();}
    catch(error){status.textContent=error.message;button.disabled=false;}
  });
})();
