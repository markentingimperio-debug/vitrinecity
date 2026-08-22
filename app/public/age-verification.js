(() => {
  const status = document.getElementById('age-status');
  const button = document.getElementById('age-start');
  const consent = document.getElementById('age-consent');
  const consentWrap = document.getElementById('age-consent-wrap');
  const message = document.getElementById('age-message');
  if (!status || !button || !consent || !message) return;

  const labels = {
    not_started: 'Sua maioridade ainda não foi verificada.',
    pending: 'Verificação em andamento.',
    verified: 'Maioridade verificada com segurança.',
    rejected: 'Não foi possível confirmar que você possui 18 anos ou mais.',
    manual_review: 'A verificação está em análise.',
    expired: 'Sua verificação expirou. Faça uma nova validação.'
  };

  async function refresh() {
    const response = await fetch('/api/identity/age-verification');
    if (response.status === 401) return;
    const data = await response.json();
    status.textContent = labels[data.status] || labels.not_started;
    const done = data.status === 'verified';
    button.hidden = done;
    consentWrap.hidden = done;
  }

  button.addEventListener('click', async () => {
    message.textContent = '';
    if (!consent.checked) {
      message.textContent = 'Confirme a autorização antes de continuar.';
      message.style.color = '#b42424';
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch('/api/identity/age-verification/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível iniciar a verificação.');
      location.href = data.verificationUrl;
    } catch (error) {
      message.textContent = error.message;
      message.style.color = '#b42424';
      button.disabled = false;
    }
  });

  refresh().catch(() => { status.textContent = 'Não foi possível consultar a verificação agora.'; });
})();
