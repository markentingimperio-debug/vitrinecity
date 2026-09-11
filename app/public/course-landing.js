(() => {
  const form = document.querySelector('form[data-course-checkout]');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[role="status"]');
    if (button.disabled) return;
    const original = button.textContent;
    button.disabled = true; button.textContent = 'Abrindo pagamento…'; status.textContent = '';
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(form.dataset.courseCheckout)}/checkout`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({termsAccepted:true})
      });
      const data = await response.json();
      if (response.status === 401) {
        status.textContent = 'Entre ou crie sua conta. Você voltará a este curso para continuar a compra. ';
        const link = document.createElement('a'); link.href = '/entrar.html?returnTo=' + encodeURIComponent(location.pathname + '#inscricao'); link.textContent = 'Entrar ou criar conta e continuar';
        status.appendChild(link); return;
      }
      if (!response.ok || !data.checkoutUrl) throw new Error(data.error || 'Não foi possível iniciar o pagamento.');
      document.dispatchEvent(new CustomEvent('vc:course-checkout', {detail:{slug:form.dataset.courseCheckout,amount:Number(form.dataset.coursePrice)}}));
      location.assign(data.checkoutUrl);
    } catch (error) { status.textContent = error.message || 'Não foi possível iniciar o pagamento. Tente novamente.'; }
    finally { button.disabled = false; button.textContent = original; }
  });
})();
