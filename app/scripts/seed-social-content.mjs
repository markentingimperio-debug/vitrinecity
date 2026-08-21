import Database from 'better-sqlite3';
import { randomBytes, scryptSync } from 'node:crypto';

const db = new Database(process.env.DATA_DIR ? process.env.DATA_DIR + '/vitrinecity.db' : '/data/vitrinecity.db');
db.pragma('foreign_keys = ON');

const profiles = [
  ['VitrineCity Oficial','oficial@conteudo.vitrinecity.com','vitrinecity','Novidades e orientações oficiais da cidade digital.','Brasil','geral'],
  ['Vitriny Produtos','produtos@conteudo.vitrinecity.com','vitrinyprodutos','Produtos, novidades e negócios locais.','Brasil','produtos'],
  ['Vitriny Serviços','servicos@conteudo.vitrinecity.com','vitrinyservicos','Profissionais e serviços para sua cidade.','Brasil','servicos'],
  ['Vitriny Estudos','estudos@conteudo.vitrinecity.com','vitrinyestudos','Cursos, conhecimento e capacitação.','Brasil','estudos'],
  ['Vitriny Trabalho','trabalho@conteudo.vitrinecity.com','vitrinytrabalho','Vagas, talentos e oportunidades profissionais.','Brasil','trabalho'],
  ['Vitriny Ofertas','ofertas@conteudo.vitrinecity.com','vitrinyofertas','Ofertas oficiais e oportunidades locais.','Brasil','ofertas'],
  ['Vitrine Anápolis','anapolis@conteudo.vitrinecity.com','vitrineanapolis','Destaques da cidade de Anápolis.','Anápolis - GO','geral'],
  ['Vitrine Goiás','goias@conteudo.vitrinecity.com','vitrinegoias','Negócios, turismo e oportunidades de Goiás.','Goiás','geral'],
  ['Vitriny Empreende','empreende@conteudo.vitrinecity.com','vitrinyempreende','Conteúdo para empreendedores e lojistas.','Brasil','servicos'],
  ['Vitriny Comunidade','comunidade@conteudo.vitrinecity.com','vitrinycomunidade','Conexões, histórias e participação da comunidade.','Brasil','geral']
];

const posts = [
  ['vitrinecity','geral','Bem-vindo à VitrineCity: uma cidade digital para descobrir pessoas, negócios, serviços e oportunidades. #VitrineCity #CidadeDigital'],
  ['vitrinecity','geral','Crie seu perfil público, escolha sua cidade e comece a construir novas conexões. #Comunidade #VitrinySocial'],
  ['vitrinecity','geral','No feed Para Você, cada interação ajuda a inteligência da Vitriny a recomendar conteúdos melhores. #Tecnologia #VitrinyIntelligence'],
  ['vitrineprodutos','produtos','Lojistas podem apresentar seus produtos para clientes de todo o Brasil dentro da Vitriny. #Produtos #Marketplace'],
  ['vitrineprodutos','produtos','Fotos claras, descrição completa e preço correto aumentam a confiança de quem compra. #DicaDoLojista #Vendas'],
  ['vitrineprodutos','produtos','Comprar de negócios locais fortalece a economia da cidade e aproxima clientes e vendedores. #CompreLocal #Negócios'],
  ['vitrinyservicos','servicos','Encontre profissionais e serviços da sua cidade em um só lugar. #Serviços #Cidade'],
  ['vitrinyservicos','servicos','Prestador de serviço: mantenha seu perfil atualizado e mostre com clareza o que você faz. #Profissional #Oportunidade'],
  ['vitrinyservicos','servicos','Avalie necessidades, converse pelo chat e confirme todas as condições antes de contratar. #Segurança #Serviços'],
  ['vitrinyestudos','estudos','Conhecimento abre portas. Descubra cursos e conteúdos para desenvolver novas habilidades. #Estudos #Cursos'],
  ['vitrinyestudos','estudos','Aprender um pouco todos os dias produz grandes resultados ao longo do tempo. #Educação #Desenvolvimento'],
  ['vitrinyestudos','estudos','Empreendedores que estudam seus clientes tomam decisões melhores. #Empreendedorismo #Conhecimento'],
  ['vitrinytrabalho','trabalho','A Vitriny aproxima talentos e oportunidades profissionais da mesma região. #Trabalho #Vagas'],
  ['vitrinytrabalho','trabalho','Um perfil completo ajuda empresas e clientes a entenderem suas habilidades. #Carreira #Talentos'],
  ['vitrinytrabalho','trabalho','Divulgue oportunidades com informações claras sobre função, cidade e forma de contato. #Emprego #Oportunidade'],
  ['vitrinyofertas','ofertas','Acompanhe ofertas e novidades de lojas participantes da VitrineCity. #Ofertas #Economia'],
  ['vitrinyofertas','ofertas','Compare condições, confira a reputação da loja e compre com responsabilidade. #CompraSegura #Dicas'],
  ['vitrinyofertas','ofertas','Lojista: uma boa oferta combina preço, clareza e atendimento rápido. #Lojista #Vendas'],
  ['vitrineanapolis','geral','Anápolis ganha uma nova vitrine digital para conectar moradores, empresas e visitantes. #Anápolis #Goiás'],
  ['vitrineanapolis','servicos','Mostre seu negócio para quem busca produtos e serviços em Anápolis. #NegóciosLocais #Anápolis'],
  ['vitrineanapolis','trabalho','Profissionais de Anápolis podem usar o perfil social para apresentar habilidades e trabalhos. #TalentosDeAnápolis'],
  ['vitrinegoias','geral','Goiás tem cultura, turismo, produção e empreendedorismo para mostrar ao Brasil. #Goiás #Turismo'],
  ['vitrinegoias','produtos','Produtos feitos em Goiás encontram novas vitrines quando negócios locais entram no digital. #FeitoEmGoiás'],
  ['vitrinegoias','servicos','Cidades conectadas geram novas oportunidades para empresas e profissionais. #GoiásConectado'],
  ['vitrinyempreende','servicos','Comece com uma apresentação simples: quem você atende, qual problema resolve e como entrar em contato. #Empreender'],
  ['vitrinyempreende','produtos','Antes de anunciar, confira estoque, prazo, preço e qualidade das imagens. #Gestão #Ecommerce'],
  ['vitrinyempreende','estudos','Acompanhar cliques e conversões ajuda a investir melhor e reduzir desperdícios. #MarketingDigital #Métricas'],
  ['vitrinycomunidade','geral','A VitrineCity cresce com participação respeitosa, conteúdo útil e conexões verdadeiras. #Comunidade'],
  ['vitrinycomunidade','geral','Siga pessoas e negócios relevantes para personalizar sua experiência no feed. #Conexões #VitrinySocial'],
  ['vitrinycomunidade','geral','Denuncie conteúdos inadequados e ajude a manter a comunidade segura para todos. #SegurançaDigital']
];

function disabledPasswordHash() {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(randomBytes(48), salt, 64).toString('hex')}`;
}

const insertUser = db.prepare(`INSERT INTO users (name,email,password_hash,adult_confirmed)
  VALUES (?,?,?,1) ON CONFLICT(email) DO NOTHING`);
const findUser = db.prepare('SELECT id FROM users WHERE email=?');
const upsertProfile = db.prepare(`INSERT INTO social_profiles (user_id,handle,bio,city,avatar_url)
  VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET handle=excluded.handle,bio=excluded.bio,
  city=excluded.city,avatar_url=excluded.avatar_url,updated_at=CURRENT_TIMESTAMP`);
const insertPost = db.prepare(`INSERT OR IGNORE INTO social_posts
  (id,user_id,video_uid,caption,category,city,status,moderation_status,moderation_reason,
   media_type,image_url,seo_title,seo_description,seo_keywords,created_at,updated_at)
  VALUES (?,?,?,?,?,?,'ready','approved','Conteúdo institucional oficial','image',?,?,?,?,?,?)`);

const byHandle = new Map();
db.transaction(() => {
  for (const [name,email,handle,bio,city,category] of profiles) {
    insertUser.run(name,email,disabledPasswordHash());
    const user = findUser.get(email);
    upsertProfile.run(user.id,handle,bio,city,`/assets/social-seed/${category}.svg`);
    byHandle.set(handle,{id:user.id,city});
  }
  posts.forEach(([handle,category,caption],index) => {
    const author=byHandle.get(handle);
    const id=`official-seed-${String(index+1).padStart(3,'0')}`;
    const createdAt=new Date(Date.now()-(posts.length-index)*3600000).toISOString().replace('T',' ').slice(0,19);
    insertPost.run(id,author.id,`image:${id}`,caption,category,author.city,
      `/assets/social-seed/${category}.svg`,
      caption.replace(/#\S+/g,'').trim().slice(0,70),
      caption.replace(/#\S+/g,'').trim().slice(0,155),
      [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m=>m[1]).join(','),
      createdAt,createdAt);
  });
})();

const result={
  officialProfiles:db.prepare("SELECT COUNT(*) total FROM users WHERE email LIKE '%@conteudo.vitrinecity.com'").get().total,
  officialPosts:db.prepare("SELECT COUNT(*) total FROM social_posts WHERE id LIKE 'official-seed-%' AND status='ready'").get().total
};
console.log('Conteúdo social oficial preparado:',result);
