(() => {
  const checks = [...document.querySelectorAll('#checklist input[type="checkbox"]')];
  for (const check of checks) check.addEventListener('change', () => {
    document.getElementById('checkProgress').textContent = `${checks.filter(item => item.checked).length} de ${checks.length} verificações concluídas.`;
  });
  document.getElementById('printGuide').addEventListener('click', () => window.print());
  document.getElementById('shareGuide').addEventListener('click', async () => {
    const status = document.getElementById('shareStatus');
    const url = new URL('/guias/plantas-em-vasos.html', location.origin);
    url.search = new URLSearchParams({ utm_source: 'compartilhamento', utm_medium: 'referral', utm_campaign: 'plantas_vasos', utm_content: 'leitor' }).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Plantas em vasos: checklist para começar', url: url.href });
        status.textContent = 'Opção de compartilhamento concluída.';
      } else {
        await navigator.clipboard.writeText(url.href);
        status.textContent = 'Link copiado. Você escolhe onde compartilhar.';
      }
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? 'Compartilhamento cancelado.' : `Copie este link: ${url.href}`;
    }
  });
})();
