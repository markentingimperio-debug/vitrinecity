import { marketplaceSlug, publicStorePath } from './marketplace-public.js';
import { CITY_GUIDE_ITEMS } from './public/vitriny-city-guide-core.js';
import { AFFILIATE_CENTERS } from './public/vitriny-affiliate-centers-core.js';
import { affiliateArticles } from './affiliate-articles.js';
import { SPATIAL_CITIES } from './vitriny-spatial/city-registry.js';
import { DISTRICT_INTEGRATIONS } from './public/vitriny-district-integrations.js';
import { toCleanPublicHref } from './public/vitriny-public-routes.js';
import { acquisitionReport } from './organic-acquisition.js';
import { createHash } from 'node:crypto';

const TYPES = {products:['Produtos','/admin-vendas-afiliadas.html'],stores:['Lojas','/admin-lojas.html'],pages:['Páginas e conteúdos','/admin-conteudos.html'],buildings:['Prédios e destinos','/multiverso?city=vitrine-city'],networks:['Redes e conexões','/admin-chatbotx.html']};
const text = value => String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const integer = (value,min,max,fallback) => Number.isSafeInteger(Number(value)) ? Math.max(min,Math.min(max,Number(value))) : fallback;
// These are public collection/policy routes, not evidence that every contained
// offer, article or external player is available. Items keep their own gates.
const PUBLIC_HUBS = [
  ['/cidade','Cidade Premium'],['/cidade/bairro-premium','Bairro Premium'],['/cidade/praca-central','Praça Central'],['/cidade/avenida-premium','Avenida Premium'],
  ['/grupos-whatsapp.html','Grupos da VitrineCity'],['/conteudo','Conteúdos da VitrineCity'],['/noticias','Notícias'],['/esportes','Esportes'],['/receitas','Receitas'],
  ['/plantas-e-jardinagem','Plantas e jardinagem'],['/tecnologia','Tecnologia'],['/inteligencia-artificial','Inteligência artificial'],['/entretenimento','Entretenimento'],['/livros','Editora Digital'],
  ['/musicas','Catálogo da Pulse Arena'],['/cinema','Catálogo do Cinema VitrineCity'],['/servicos-digitais.html','Serviços digitais'],
  ['/termos-marketplace.html','Termos do marketplace'],['/politica-vendedor-marketplace.html','Política do vendedor'],['/politica-comprador-marketplace.html','Política do comprador'],
  ['/politica-devolucao-marketplace.html','Política de devolução'],['/politica-cancelamento-marketplace.html','Política de cancelamento'],['/politica-disputas-marketplace.html','Política de disputas'],['/politica-fiscal-marketplace.html','Política fiscal']
];

/** Admin-only registry: credentials and personal contact details never enter the DTO. */
export function createEcosystemCatalog({db,siteUrl,sourceCatalog,services=()=>[],now=()=>new Date()}) {
  const origin = new URL(siteUrl).origin;
  db.function('ecosystem_fold',{deterministic:true},fold);
  const cols = table => new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name));
  const exists = table => cols(table).size>0;
  const field = (table,name,alias='') => cols(table).has(name) ? `${alias}"${name}"` : "''";
  function safeUrl(value,{internal=false}={}) { if(typeof value!=='string'||!value.trim())return '';try {const u=new URL(value,origin);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!internal||u.origin===origin)?(u.origin===origin?u.pathname+u.search+u.hash:u.href):'';}catch{return '';}}
  function routeKey(value) {
    const safe=safeUrl(value,{internal:true});if(!safe)return '';
    const u=new URL(toCleanPublicHref(safe),origin);
    u.pathname=({'/loja.html':'/loja','/social.html':'/social','/entregas.html':'/entregas'})[u.pathname]||u.pathname;
    for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();return u.pathname+u.search+u.hash;
  }
  function uniqueDestinations(items) {
    const found=new Map();
    for(const item of items){const key=routeKey(item.url)||item.id,previous=found.get(key);if(previous){previous.meta=[...new Set([...previous.meta,item.title,...item.meta])];continue;}found.set(key,{...item,meta:[...item.meta]});}
    return [...found.values()];
  }
  function item(row,kind) {
    let published=row.status==='published',status=row.status;
    const source=published&&row.sourceKey?sourceCatalog?.get(row.sourceKey):null;
    if(published&&row.sourceKey&&!source)published=false;
    if(published&&row.type==='story') {
      const story=db.prepare('SELECT article_id,published_json,published_source_hash FROM editorial_web_stories WHERE id=?').get(row.rawId);
      try {const draft=JSON.parse(story?.published_json);const currentHash=source&&createHash('sha256').update(JSON.stringify([source.title,source.summary,source.body,source.image_url,source.updated_at,...(source.commercial?[source.facts,source.sourcePath]:[])])).digest('hex');if(!source||(source.commercial&&currentHash!==story.published_source_hash)||(draft.companionHash&&!db.prepare("SELECT 1 FROM editorial_articles WHERE id=? AND status='published'").get('story-companion:'+story.article_id)))published=false;}catch{published=false;}
    }
    if(status==='published'&&!published)status='pending';
    let url=row.url||source?.sourcePath||'';
    if(row.type==='product')url=published?`/produto/${row.rawId}/${marketplaceSlug(row.title,'produto')}`:'';
    if(row.type==='store')url=published?publicStorePath({order_reference:row.rawId,business_name:row.title}):'';
    const adminUrl=row.adminUrl||(row.type==='product'||row.type==='store'?'/admin-lojas.html':row.type==='affiliate'?'/admin-vendas-afiliadas.html?plataforma='+encodeURIComponent(row.extra||'mercadolivre'):row.type==='story'?'/admin-web-stories?story='+encodeURIComponent(row.rawId):row.type==='course'?'/admin-cursos.html':row.type==='book'?'/admin-editora.html':row.type==='media'?'/admin-midia.html':TYPES[kind][1]);
    return {id:row.id,kind,title:text(row.title),summary:text(row.summary).slice(0,500),status,image:safeUrl(row.image||''),url:published?safeUrl(url,{internal:true}):'',adminUrl,meta:[row.typeLabel,row.extra].filter(Boolean).map(text)};
  }
  // SQL pagination keeps a growing product catalog out of process memory.
  function queries(kind) {
    const result=[];
    const add=(table,sql)=>{if(exists(table))result.push(sql);};
    if(kind==='products') {
      if(exists('store_products')&&exists('store_profiles')) {
        const available=cols('store_products').has('available')?' AND p.available=1':'';
        const stock=cols('store_products').has('stock_quantity')?' AND p.stock_quantity>0':'';
        add('store_products',`SELECT 'product:'||p.id id,p.id rawId,'product' type,'Produto da loja' typeLabel,p.name title,${field('store_products','description','p.')} summary,${field('store_products','image_url','p.')} image,CASE WHEN p.active=1 AND p.marketplace_enabled=1 AND p.price_cents>0${available}${stock} AND s.review_status='published' THEN 'published' ELSE 'pending' END status,'' url,'' sourceKey,s.business_name extra FROM store_products p LEFT JOIN store_profiles s ON s.order_reference=p.store_reference`);
      }
      // The public landing page remains published even while its outbound offer
      // needs review. AI generation eligibility is a separate, stricter catalog.
      add('affiliate_catalog',`SELECT 'affiliate:'||slug id,slug rawId,'affiliate' type,CASE WHEN availability='unavailable' OR health='broken' THEN 'Produto afiliado · Oferta em revisão' ELSE 'Produto afiliado · Condições na página' END typeLabel,title,description summary,image,CASE WHEN status='published' THEN 'published' ELSE 'pending' END status,'/ofertas/'||slug url,'' sourceKey,platform extra FROM affiliate_catalog`);
    }
    if(kind==='stores'||kind==='buildings') add('store_profiles',`SELECT 'store:'||order_reference id,order_reference rawId,'store' type,'Prédio de loja' typeLabel,business_name title,${field('store_profiles','description')} summary,${field('store_profiles','facade_url')} image,CASE WHEN review_status='published' THEN 'published' ELSE 'pending' END status,'' url,'' sourceKey,${field('store_profiles','city')} extra FROM store_profiles`);
    if(kind==='pages') {
      add('editorial_articles',`SELECT 'article:'||id id,id rawId,'article' type,'Artigo' typeLabel,title,summary,image_url image,status,'/artigo/'||slug url,'' sourceKey,portal extra FROM editorial_articles`);
      add('editorial_web_stories',`SELECT 'story:'||id id,id rawId,'story' type,'Web Story' typeLabel,slug title,'' summary,'' image,CASE WHEN published_json IS NOT NULL AND published_json!='' THEN 'published' ELSE 'pending' END status,'/stories/'||slug url,article_id sourceKey,'' extra FROM editorial_web_stories`);
      add('managed_courses',`SELECT 'course:'||slug id,slug rawId,'course' type,'Curso' typeLabel,title,description summary,cover_url image,CASE WHEN status='active' THEN 'published' ELSE 'pending' END status,'/centro-educacional#'||slug url,'course:'||slug sourceKey,'' extra FROM managed_courses`);
      if(['slug','title','status'].every(name=>cols('digital_books').has(name)))add('digital_books',`SELECT 'book:'||slug id,slug rawId,'book' type,'Livro digital' typeLabel,title,${field('digital_books','summary')} summary,${field('digital_books','cover_url')} image,status,'/livro/'||slug url,'' sourceKey,${field('digital_books','category')} extra FROM digital_books`);
      if(['scope','slug','title','status'].every(name=>cols('vitriny_media_catalog').has(name)))add('vitriny_media_catalog',`SELECT 'media:'||scope||':'||slug id,slug rawId,'media' type,CASE WHEN scope='music' THEN 'Seleção musical' ELSE 'Sessão de cinema' END typeLabel,title,${field('vitriny_media_catalog','description')} summary,'' image,status,CASE WHEN scope='music' THEN '/musicas/' ELSE '/cinema/' END||slug url,'' sourceKey,${field('vitriny_media_catalog','genre')} extra FROM vitriny_media_catalog WHERE scope IN ('music','cinema')`);
    }
    return result;
  }
  function staticItems(kind) {
    const cities=()=>SPATIAL_CITIES.map(city=>({id:'city:'+city.id,title:city.name,summary:city.identity?.tagline||'',url:'/multiverso?city='+encodeURIComponent(city.id),status:city.status==='active'?'published':'preview',kind,image:'',adminUrl:TYPES.buildings[1],meta:[city.status==='active'?'Cidade ativa':'Prévia procedural; comércio local não ativo',city.identity?.landmark?.label].filter(Boolean)}));
    const districts=()=>SPATIAL_CITIES.filter(city=>city.status==='active').flatMap(city=>city.districts.flatMap(district=>{const entry=DISTRICT_INTEGRATIONS.find(item=>item.id===district.id&&item.enabled);return entry?[{id:'district:'+city.id+':'+district.id,title:entry.label,summary:entry.description,url:entry.href,status:'published',kind,image:'',adminUrl:TYPES.buildings[1],meta:['Distrito de '+city.name]}]:[];}));
    if(kind==='pages') {
      const guide=CITY_GUIDE_ITEMS.map(i=>({id:'page:'+i.id,title:i.title,summary:i.description,status:'published',url:i.href||'',meta:[i.landmark].filter(Boolean),kind,image:'',adminUrl:TYPES.pages[1]}));
      const hubs=PUBLIC_HUBS.map(([url,title])=>({id:'hub:'+url,title,summary:'Página pública da VitrineCity.',url,status:'published',meta:['Página pública'],kind,image:'',adminUrl:TYPES.pages[1]}));
      const articles=affiliateArticles.map(i=>({id:'guide:'+i.url,title:i.title,summary:i.description,url:i.url,status:'published',kind,image:'',meta:['Guia com indicações afiliadas'],adminUrl:'/admin-vendas-afiliadas.html'}));
      const centers=AFFILIATE_CENTERS.map(i=>({id:'center:'+i.id,title:i.title,summary:i.description,url:i.href,status:'published',kind,image:i.logo,meta:['Centro de compras afiliadas'],adminUrl:'/admin-afiliados.html'}));
      const supplied=services(),serviceRows=Array.isArray(supplied)?supplied:[];
      const offers=serviceRows.filter(i=>i&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(i.slug)&&text(i.title)).map(i=>{const available=![i.active,i.available,i.ready,i.published].some(value=>[false,0,'0','false'].includes(value))&&(!i.status||['active','published'].includes(i.status));return {id:'service:'+i.slug,title:text(i.title),summary:text(i.description),url:available?'/servicos-digitais.html?servico='+encodeURIComponent(i.slug):'',status:available?'published':'pending',kind,image:safeUrl(i.imageUrl||i.image_url||''),meta:['Serviço digital'],adminUrl:'/admin-servicos.html'};});
      return uniqueDestinations([...guide,...hubs,...articles,...centers,...offers,...cities(),...districts()]);
    }
    if(kind==='buildings') {
      const seen=new Set();
      const landmarks=CITY_GUIDE_ITEMS.filter(i=>i.place&&!seen.has(i.place)&&seen.add(i.place)).map(i=>({id:'place:'+i.place,title:i.landmark,summary:i.description,url:i.href,meta:['Destino no guia da cidade'],kind,image:'',status:'published',adminUrl:TYPES.buildings[1]}));
      return uniqueDestinations([...landmarks,...AFFILIATE_CENTERS.map(i=>({id:'center:'+i.id,title:i.title,summary:i.description,url:i.href,image:i.logo,meta:['Centro de compras afiliadas'],kind,status:'published',adminUrl:'/admin-afiliados.html'})),...cities(),...districts()]);
    }
    if(kind==='networks')return connections().map(c=>({id:c.id,title:c.label,summary:c.reason,status:c.status,kind,image:'',url:'',adminUrl:c.adminUrl,meta:[`${c.connectedCount} conexão(ões) cadastrada(s)`,c.canPublish?'Publicação interna disponível':'Publicação externa ainda não confirmada']}));
    return [];
  }
  function list({kind='products',q='',offset=0,limit=30}={}) {
    if(!Object.hasOwn(TYPES,kind))throw new Error('Tipo de catálogo inválido.');
    const skip=integer(offset,0,10000000,0),take=integer(limit,1,100,30),query=fold(text(q).slice(0,160));
    const statics=staticItems(kind).filter(i=>fold(`${i.title} ${i.summary} ${i.meta.join(' ')}`).includes(query));
    const sql=queries(kind).join(' UNION ALL '),needle=`%${query.replace(/[\\%_]/g,'\\$&')}%`;
    const filter=" WHERE ecosystem_fold(title||' '||COALESCE(summary,'')||' '||COALESCE(extra,'')) LIKE ? ESCAPE '\\'";
    const totalSql=sql?db.prepare(`SELECT COUNT(*) n FROM (${sql})${filter}`).get(needle).n:0;
    const rows=sql&&skip<totalSql?db.prepare(`SELECT * FROM (${sql})${filter} ORDER BY title,id LIMIT ? OFFSET ?`).all(needle,take,skip):[];
    const items=rows.map(row=>item(row,kind));
    if(items.length<take)items.push(...statics.slice(Math.max(0,skip-totalSql),Math.max(0,skip-totalSql)+take-items.length));
    const total=totalSql+statics.length;
    return {kind,items,offset:skip,limit:take,total,nextOffset:skip+items.length<total?skip+items.length:null};
  }
  function connections() {
    const accounts=exists('social_accounts')?db.prepare("SELECT id,page_id,page_name,instagram_id,instagram_username,updated_at FROM social_accounts WHERE status='connected' ORDER BY updated_at DESC,id DESC").all():[];
    const pages=[...new Map(accounts.slice().reverse().map(a=>[a.page_id,a])).values()].map(a=>({id:String(a.id),name:text(a.page_name)}));
    const instagram=[...new Map(accounts.filter(a=>a.instagram_id).slice().reverse().map(a=>[a.instagram_id,{id:String(a.id),name:text(a.instagram_username||a.page_name)}])).values()];
    const saved=exists('social_provider_credentials')?new Set(db.prepare('SELECT provider FROM social_provider_credentials').all().map(a=>a.provider)):new Set();
    const tik=exists('tiktok_oauth_account')?db.prepare('SELECT status,expires_at,refresh_expires_at FROM tiktok_oauth_account WHERE id=1').get():null;
    const timestamp=new Date(now()).getTime();
    const expiryMs=value=>Number(value)>1e12?Number(value):Number(value)*1000;
    const whatsapp=exists('whatsapp_qr_schedules')?db.prepare("SELECT status,COUNT(*) n FROM whatsapp_qr_schedules GROUP BY status").all():[];
    const whatsappAccepted=Number(whatsapp.find(row=>row.status==='sent')?.n||0),whatsappPending=Number(whatsapp.find(row=>row.status==='pending')?.n||0);
    const external=(id,label,rows,reason,adminUrl='/admin-chatbotx.html')=>({id,label,accounts:rows,connectedCount:rows.length,status:rows.length?'partial':'missing',canPublish:false,reason,adminUrl});
    const result=[
      {id:'vitriny_social',label:'Vitriny Social',accounts:[],connectedCount:1,status:'connected',canPublish:true,reason:'Publicação de conteúdo próprio aprovado; ativação e identidade na política da central.',adminUrl:'/social'},
      external('facebook','Facebook',pages,'Páginas cadastradas. Permissões e acesso público da Meta precisam de verificação para cada função.'),
      external('instagram','Instagram',instagram,'Perfis identificados. Publicar e responder mensagens exigem permissões próprias da Meta.'),
      external('youtube','YouTube',saved.has('youtube')?[{id:'youtube',name:'Credencial cadastrada'}]:[],'Credencial de consulta não comprova autorização ou integração de envio de vídeos.','/admin-metricas-externas.html'),
      external('tiktok','TikTok',tik?[{id:'tiktok',name:'Conta cadastrada'}]:[],tik?(expiryMs(tik.expires_at)<=timestamp?'Acesso expirado; renovar a conexão antes de validar publicação.':'Conta cadastrada; envio de vídeos ainda precisa de validação.'):'Conectar uma conta e validar a permissão de publicação.','/admin-tiktok.html'),
      external('kwai','Kwai',saved.has('kwai')?[{id:'kwai',name:'Credencial cadastrada'}]:[],'A disponibilidade de publicação automática depende de integração oficial.','/admin-metricas-externas.html'),
      external('whatsapp','WhatsApp',whatsapp.length?[{id:'whatsapp-queue',name:'Campanhas existentes'}]:[],whatsapp.length?`${whatsappAccepted} envios aceitos pelo serviço e ${whatsappPending} pendentes na fila existente. Isso não comprova entrega, leitura ou conexão online neste momento.`:'Consulte a conexão e as campanhas no painel do chatbot.','/admin-chatbotx.html'),
      external('google','Google / Search Console',exists('google_search_oauth')&&db.prepare('SELECT COUNT(*) n FROM google_search_oauth').get().n?[{id:'google',name:'Autorização cadastrada'}]:[],'Sitemaps e páginas publicadas podem ser descobertos. Indexação e posição não são garantidas.','/admin-google-search.html')
    ];
    return result;
  }
  function metrics(days) {
    const items=[],stamp=new Date(now());
    const add=(id,label,value,note,unit='count')=>items.push({id,label,value,unit,available:value!==null,confirmed:value!==null,note});
    try {const report=acquisitionReport(db,days,stamp);add('sessions','Sessões registradas',report.summary.sessions,'Medição com consentimento; não equivale a pessoas únicas. Testes sintéticos de SEO não entram neste contador.'+(report.truncated?' Amostra limitada a 10 mil sessões.':''));add('engaged','Sessões com ação',report.summary.engagedSessions,'Cliques registrados em chamadas de conteúdo.');add('signups','Sessões com cadastro',report.summary.signupSessions,'Cadastros confirmados vinculados a sessões com consentimento.');}catch{add('sessions','Sessões registradas',null,'Medição ainda indisponível.');add('signups','Sessões com cadastro',null,'Medição ainda indisponível.');}
    if(exists('marketplace_orders')) {const since=new Date(stamp.getTime()-days*86400000).toISOString();const end=stamp.toISOString();const row=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(total_cents),0) cents FROM marketplace_orders WHERE payment_status='approved' AND datetime(updated_at)>=datetime(?) AND datetime(updated_at)<=datetime(?)").get(since,end);add('paid_orders','Pedidos com pagamento aprovado',row.n,'Pedidos da plataforma atualizados no período; origem orgânica não comprovada.');add('paid_value','Valor dos pedidos aprovados',row.cents,'Valor bruto dos pedidos, não lucro nem comissão.', 'BRL_cents');}else add('paid_orders','Pedidos com pagamento aprovado',null,'Pedidos não disponíveis.');
    add('affiliate_commissions','Comissões externas confirmadas',null,'Cliques em afiliados não comprovam vendas ou comissões recebidas.');
    return {periodDays:days,items,updatedAt:stamp.toISOString()};
  }
  function snapshot({days=7}={}) {
    const inventory=Object.entries(TYPES).map(([kind,[label,adminUrl]])=>{const sql=queries(kind).join(' UNION ALL '),statics=staticItems(kind),staticCount=statics.length,staticPublished=statics.filter(i=>i.status==='published').length;const aggregate=sql?db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) published FROM (${sql})`).get():{total:0,published:0};return {kind,label,total:aggregate.total+staticCount,published:['pages','networks'].includes(kind)?null:Number(aggregate.published||0)+staticPublished,pending:['pages','networks'].includes(kind)?null:aggregate.total-Number(aggregate.published||0)+staticCount-staticPublished,available:true,adminUrl};});
    return {inventory,connections:connections(),metrics:metrics([7,30].includes(Number(days))?Number(days):7)};
  }
  return {snapshot,list};
}
