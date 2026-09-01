(() => {
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  async function render() {
    const response = await fetch('/api/admin/service-orders');
    if (!response.ok) return;
    const data = await response.json();
    const section = document.createElement('section');
    section.innerHTML = `<h2>Catálogo disponível para venda</h2><div class="vc-service-catalog">${(data.catalog || []).map(item => `<article><img src="${esc(item.imageUrl)}" alt="${esc(item.title)}"><div><span>ATIVO</span><h3>${esc(item.title)}</h3><strong>${money(item.amountCents)}</strong><p>${esc(item.description)}</p><a href="${esc(item.checkoutUrl)}" target="_blank" rel="noopener">Ver página de venda</a></div></article>`).join('')}</div>`;
    const style = document.createElement('style');
    style.textContent = '.vc-service-catalog{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin-bottom:28px}.vc-service-catalog article{overflow:hidden;background:#fff;border:1px solid #d8e6f7;border-radius:17px}.vc-service-catalog article>img{width:100%;aspect-ratio:16/8;object-fit:cover;background:#dceaff}.vc-service-catalog article>div{padding:18px}.vc-service-catalog span{color:#08794f;font-size:11px;font-weight:950}.vc-service-catalog h3{margin:8px 0}.vc-service-catalog strong{font-size:23px}.vc-service-catalog p{color:#607393;line-height:1.45}.vc-service-catalog a{color:#1768e6;font-weight:900}@media(max-width:800px){.vc-service-catalog{grid-template-columns:1fr}}';
    document.head.appendChild(style);
    document.querySelector('main')?.insertBefore(section, document.querySelector('.summary'));
  }
  render().catch(() => {});
})();
