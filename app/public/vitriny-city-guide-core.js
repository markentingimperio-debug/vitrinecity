// A service directory, independent of the 3D renderer and of visitor identity.
// Public destinations keep their own access rules; this catalog grants no access.
export const CITY_GUIDE_GROUPS = Object.freeze([
  { id: 'comprar', label: 'Comprar' },
  { id: 'aprender', label: 'Aprender' },
  { id: 'diversao', label: 'Diversão e comunidade' },
  { id: 'meu-espaco', label: 'Meu espaço' },
  { id: 'negocios', label: 'Negócios e divulgação' },
  { id: 'ajuda', label: 'Ajuda' },
].map(Object.freeze));

export const CITY_GUIDE_ITEMS = Object.freeze([
  { id: 'pesquisar', title: 'Buscar na VitrineCity', description: 'Encontre produtos, lojas, assuntos, sites e vídeos.', group: 'comprar', keywords: ['pesquisa', 'busca', 'encontrar', 'preço', 'serviço'], href: '/pesquisar.html', landmark: 'Avenida de Compras', place: 'commerce' },
  { id: 'vitrines', title: 'Lojas e vitrines da cidade', description: 'Conheça as lojas, suas fachadas e os produtos em destaque.', group: 'comprar', keywords: ['lojas', 'Sertaneja', 'Agrotécnica', 'Beemi', 'moda', 'catálogo'], href: '/loja', action: 'openStorefronts', landmark: 'Avenida de Compras', place: 'commerce' },
  { id: 'loja-oficial', title: 'Loja Oficial VitrineCity', description: 'Veja o catálogo de produtos e as opções de entrega de cada loja.', group: 'comprar', keywords: ['comprar', 'marketplace', 'carrinho', 'transportadora', 'produtos'], href: '/loja', landmark: 'Avenida de Compras', place: 'commerce' },
  { id: 'descobrir', title: 'Descobrir novidades', description: 'Explore conteúdos, livros, cursos e produtos publicados.', group: 'comprar', keywords: ['ofertas', 'conteúdo', 'livros', 'artigos', 'novidades'], href: '/descobrir', landmark: 'Avenida de Compras', place: 'commerce' },
  { id: 'centros', title: 'Centros de compras', description: 'Explore as seleções de Mercado Livre, Shopee, Cakto, Kiwify e TikTok por departamento.', group: 'comprar', keywords: ['ofertas', 'afiliados', 'mercado livre', 'mercadolivre', 'shopee', 'cakto', 'kiwify', 'tiktok', 'shopping'], href: '/ofertas', action: 'openCenters', landmark: 'Avenida de Compras', place: 'commerce' },
  { id: 'entregas', title: 'VC Entregas', description: 'Consulte as lojas com entrega local e a disponibilidade na sua cidade.', group: 'comprar', keywords: ['delivery', 'entrega', 'restaurante', 'compras locais', 'motoboy'], href: '/entregas', action: 'openDeliveryBase', landmark: 'VC Entregas', place: 'delivery' },

  { id: 'cursos', title: 'Centro Educacional', description: 'Conheça os cursos digitais e escolha o que quer aprender.', group: 'aprender', keywords: ['curso', 'educação', 'aulas', 'capacitação', 'estudar', 'formação'], href: '/centro-educacional.html', landmark: 'Centro Educacional', place: 'education' },
  { id: 'meus-cursos', title: 'Continuar meus cursos', description: 'Abra suas aulas, materiais e o progresso dos cursos adquiridos.', group: 'aprender', keywords: ['aluno', 'matrícula', 'certificado', 'aulas', 'meus cursos'], href: '/meus-cursos.html', landmark: 'Centro Educacional', place: 'education' },
  { id: 'jardim', title: 'Comece seu jardim', description: 'Leia o guia gratuito de plantas em vasos.', group: 'aprender', keywords: ['plantas', 'horta', 'jardinagem', 'vasos', 'agro', 'guia gratuito'], href: '/guias/plantas-em-vasos.html', landmark: 'Agrotécnica' },
  { id: 'web-stories', title: 'Web Stories · Guias visuais', description: 'Explore histórias em páginas ilustradas, com artigos e fontes para continuar a leitura.', group: 'aprender', keywords: ['história', 'stories', 'artigos', 'conteúdos', 'leitura', 'guias'], href: '/stories', landmark: 'Centro Educacional', place: 'education' },
  { id: 'emissora', title: 'Emissora VitrineCity', description: 'Explore os conteúdos editoriais da cidade e escolha um assunto para acompanhar.', group: 'aprender', keywords: ['emissora', 'editorial', 'notícias', 'receitas', 'esportes', 'celebridades', 'conteúdo'], href: '/emissora', landmark: 'Emissora VitrineCity', place: 'emissora' },

  { id: 'jogos', title: 'Prédio de jogos', description: 'Escolha um jogo e conheça as opções disponíveis na plataforma.', group: 'diversao', keywords: ['jogar', 'games', 'arcade', 'diversão'], href: '/vitriny-games.html', action: 'openGames', landmark: 'Prédio de jogos', place: 'games' },
  { id: 'fazenda', title: 'Minha mini fazenda', description: 'Cuide das plantações e dos animais e acompanhe suas conquistas.', group: 'diversao', keywords: ['jogo', 'fazendinha', 'colheita', 'plantar', 'animais', 'recompensas'], href: '/vitriny-mini-fazenda.html', landmark: 'Prédio de jogos', place: 'games' },
  { id: 'musica', title: 'Pulse Arena · Música', description: 'Escolha um estilo e abra o player da seleção disponível.', group: 'diversao', keywords: ['músicas', 'musica', 'eletrônica', 'sertanejo', 'playlist', 'live', 'arena', 'rádio'], href: '/vitriny-music-arena.html', action: 'openMusic', landmark: 'Pulse Arena', place: 'music' },
  { id: 'cinema', title: 'Cinema VitrineCity', description: 'Explore os filmes, curtas e trailers selecionados por categoria.', group: 'diversao', keywords: ['filme', 'cinema', 'kids', 'aventura', 'ação', 'ficção', 'trailer'], href: '/vitriny-cinema.html', action: 'openCinema', landmark: 'Cinema VitrineCity', place: 'cinema' },
  { id: 'social', title: 'Vitriny Social', description: 'Descubra publicações e acompanhe pessoas e negócios.', group: 'diversao', keywords: ['rede social', 'feed', 'comunidade', 'perfil', 'publicações', 'amigos'], href: '/social', landmark: 'Praça de convivência', place: 'social' },
  { id: 'chat-cidade', title: 'Conversar na cidade', description: 'Abra as salas de conversa do multiverso.', group: 'diversao', keywords: ['chat', 'conversar', 'salas', 'grupos', 'comunidade'], action: 'openCityChat', landmark: 'Praça de convivência', place: 'social' },
  { id: 'mensagens', title: 'Minhas mensagens', description: 'Acesse suas conversas na Vitriny Social.', group: 'diversao', keywords: ['chat', 'mensagem', 'conversa', 'social'], href: '/chat-social.html', landmark: 'Praça de convivência', place: 'social' },

  { id: 'minha-conta', title: 'Minha conta', description: 'Gerencie seus dados, endereços e lojas favoritas.', group: 'meu-espaco', keywords: ['perfil', 'cadastro', 'cliente', 'endereço', 'favoritos', 'login'], href: '/minha-conta.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'pedidos', title: 'Meus pedidos', description: 'Acompanhe suas compras e os detalhes de cada pedido.', group: 'meu-espaco', keywords: ['compra', 'pedido', 'pagamento', 'entrega', 'acompanhar'], href: '/pedidos.html', landmark: 'Avenida de Compras', place: 'commerce' },
  { id: 'avatar', title: 'Meu avatar', description: 'Personalize sua presença na cidade e conheça a opção premium.', group: 'meu-espaco', keywords: ['personagem', 'aparência', 'roupa', 'premium', 'avatar'], href: '/central-creditos.html', action: 'openAvatar', landmark: 'Banco VitrineCity', place: 'credits' },
  { id: 'coins', title: 'Vitrine Coins e benefícios', description: 'Consulte suas recompensas e as opções de desconto em cursos e avatar.', group: 'meu-espaco', keywords: ['saldo', 'moeda', 'coin', 'recompensa', 'créditos', 'desconto', 'banco'], href: '/central-creditos.html', action: 'openCredits', landmark: 'Banco VitrineCity', place: 'credits' },
  { id: 'acessos', title: 'Entrar na minha área', description: 'Encontre o acesso de cliente, lojista, entregador ou afiliado.', group: 'meu-espaco', keywords: ['entrar', 'login', 'senha', 'conta', 'painel', 'lojista', 'acessos'], href: '/acessos.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'preferencias', title: 'Minhas comunicações', description: 'Escolha quais comunicações deseja receber da VitrineCity.', group: 'meu-espaco', keywords: ['preferências', 'notificação', 'email', 'e-mail', 'whatsapp', 'promoção', 'cancelar'], href: '/preferencias-comunicacao.html', landmark: 'Torre VitrineCity', place: 'headquarters' },

  { id: 'meu-predio', title: 'Quero meu prédio', description: 'Conheça as opções para apresentar seu negócio na cidade.', group: 'negocios', keywords: ['loja', 'vitrine', 'prédio', 'lote', 'fachada', 'empresa', 'vender'], href: '/comprar-lote.html', landmark: 'Prédios disponíveis', place: 'business' },
  { id: 'para-empresas', title: 'Planos para empresas', description: 'Confira o plano do prédio digital e os serviços de personalização.', group: 'negocios', keywords: ['plano', 'assinatura', 'preço', 'empresas', 'outdoor', 'fachada', 'publicar'], href: '/para-empresas.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'ads', title: 'VitrineCity Ads', description: 'Gerencie os créditos de anúncios e suas campanhas.', group: 'negocios', keywords: ['anunciar', 'publicidade', 'propaganda', 'outdoor', 'campanha', 'ads', 'carteira'], href: '/carteira.html', landmark: 'Banco VitrineCity', place: 'credits' },
  { id: 'afiliados', title: 'Programa de afiliados', description: 'Conheça o programa, seu cadastro e o painel de comissões.', group: 'negocios', keywords: ['afiliado', 'comissão', 'parceiro', 'indicar', 'divulgar'], href: '/afiliados.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'divulgacao', title: 'Minha vitrine para divulgar', description: 'Copie seu link pessoal e os links rastreáveis dos produtos disponíveis.', group: 'negocios', keywords: ['afiliado', 'parceiro', 'link', 'rastreável', 'compartilhar', 'divulgação', 'produtos'], href: '/painel-divulgacao.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'solucoes', title: 'Soluções para meu negócio', description: 'Conheça os serviços digitais oferecidos pela VitrineCity.', group: 'negocios', keywords: ['serviço', 'solução', 'marketing', 'site', 'vídeo', 'empresa'], href: '/solucoes.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'entregador', title: 'Área do entregador', description: 'Acesse o cadastro e as informações do entregador.', group: 'negocios', keywords: ['entrega', 'entregador', 'motoboy', 'corrida', 'logística'], href: '/entregador.html', landmark: 'VC Entregas', place: 'delivery' },

  { id: 'como-funciona', title: 'Como funciona', description: 'Entenda como explorar, comprar e participar da VitrineCity.', group: 'ajuda', keywords: ['ajuda', 'tutorial', 'começar', 'dúvida', 'navegar'], href: '/como-funciona.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'porque-vitrinecity', title: 'Por que ter a VitrineCity', description: 'Conheça a proposta da cidade digital para pessoas e empresas.', group: 'ajuda', keywords: ['por que', 'benefício', 'conhecer', 'empresa'], href: '/porque-vitrinecity.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'sobre', title: 'Sobre a VitrineCity', description: 'Conheça a plataforma e quem a opera.', group: 'ajuda', keywords: ['sobre', 'empresa', 'quem somos', 'institucional'], href: '/sobre.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'contato', title: 'Falar com a VitrineCity', description: 'Encontre os canais oficiais de contato e atendimento.', group: 'ajuda', keywords: ['contato', 'suporte', 'ajuda', 'whatsapp', 'email', 'e-mail', 'atendimento'], href: '/contato.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'jarvis', title: 'Perguntar ao Jarvis', description: 'Faça uma pesquisa e consulte respostas com fontes.', group: 'ajuda', keywords: ['jarvis', 'inteligência artificial', 'ia', 'pesquisar', 'pergunta', 'fontes'], href: '/jarvis-public.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'promocoes', title: 'Receber ofertas da cidade', description: 'Cadastre seu interesse e autorize o recebimento de promoções.', group: 'ajuda', keywords: ['oferta', 'promoção', 'cupom', 'novidade', 'newsletter', 'cadastro'], href: '/?inicio=1#cadastro', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'privacidade', title: 'Privacidade', description: 'Consulte como seus dados são tratados na plataforma.', group: 'ajuda', keywords: ['privacidade', 'dados pessoais', 'lgpd', 'política', 'consentimento'], href: '/privacy.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'termos-predio', title: 'Termos do prédio digital', description: 'Leia as condições de uso do espaço para sua empresa.', group: 'ajuda', keywords: ['termo', 'contrato', 'prédio', 'licença', 'condições', 'assinatura'], href: '/termos-predio-digital.html', landmark: 'Torre VitrineCity', place: 'headquarters' },
  { id: 'inicio', title: 'Página inicial', description: 'Volte à apresentação da cidade e aos acessos principais.', group: 'ajuda', keywords: ['início', 'home', 'voltar', 'apresentação'], href: '/?inicio=1', landmark: 'Entrada da cidade' },
].map(item => Object.freeze({ ...item, keywords: Object.freeze([...item.keywords]) })));

const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Every search token must match; the source array and objects stay unchanged. */
export function filterCityGuide(query, group = 'all', items = CITY_GUIDE_ITEMS) {
  if (!Array.isArray(items)) return [];
  if (group !== 'all' && !CITY_GUIDE_GROUPS.some(item => item.id === group)) return [];
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (!item || (group !== 'all' && item.group !== group)) return false;
    const keywords = Array.isArray(item.keywords) ? item.keywords.join(' ') : item.keywords;
    const searchable = normalize([item.title, item.description, keywords, item.landmark].filter(Boolean).join(' '));
    return tokens.every(token => searchable.includes(token));
  });
}
