// Editorial placements explicitly supplied by the platform owner.
// Match advertising intent; unrelated TikTok searches must keep their normal results.
export function searchPromotions(query) {
  const q = String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\btik\s+tok\b/g, 'tiktok');
  if (!/\btiktok\b/.test(q) || !/\b(ads|ad|anuncio\w*|anunciar|publicidade|campanha\w*|advertising|advertise|trafego pago|gerenciador de anuncios)\b/.test(q)) return [];
  return [
    { kind: 'affiliate', title: 'TikTok Ads — começar pelo link de afiliado da VitrineCity',
      url: 'https://getstartedtiktok.partnerlinks.io/gzte5cj93jzz',
      description: 'Indicação de afiliado: a VitrineCity pode receber comissão. Conheça o TikTok Ads Manager e confira as condições de cadastro e publicidade no destino. A veiculação de anúncios exige orçamento; resultados e eventuais créditos dependem das regras do TikTok.' },
    { kind: 'article', title: 'TikTok Ads: como começar a anunciar — guia da VitrineCity',
      url: '/artigos/tiktok-ads.html',
      description: 'TikTok Ads Manager é a plataforma de anúncios do TikTok. Para começar, defina o objetivo da campanha, orçamento, público e criativo, revise as configurações e acompanhe os resultados. Orçamentos podem ser diários ou para a duração da campanha. Leia o guia com fontes oficiais e indicação de afiliado identificada.' }
  ];
}
