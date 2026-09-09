import { marketplaceSlug, publicStorePath } from './marketplace-public.js';
import { CITY_GUIDE_ITEMS } from './public/vitriny-city-guide-core.js';
import { AFFILIATE_CENTERS } from './public/vitriny-affiliate-centers-core.js';
import { acquisitionReport } from './organic-acquisition.js';
import { createHash } from 'node:crypto';

const TYPES = {products:['Produtos','/admin-vendas-afiliadas.html'],stores:['Lojas','/admin-lojas.html'],pages:['Páginas e conteúdos','/admin-conteudos.html'],buildings:['Prédios e destinos','/multiverso?city=vitrine-city'],networks:['Redes e conexões','/admin-chatbotx.html']};
const text = value => String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const integer = (value,min,max,fallback) => Number.isSafeInteger(Number(value)) ? Math.max(min,Math.min(max,Number(value))) : fallback;

/** Admin-only registry: credentials and personal contact details never enter the DTO. */
export function createEcosystemCatalog({db,siteUrl,sourceCatalog,now=()=>new Date()}) {
  const origin = new URL(siteUrl).origin;
  db.function('ecosystem_fold',{deterministic:true},fold);
  const cols = table => new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name));
  const exists = table => cols(table).size>0;
  const field = (table,name,alias='') => cols(table).has(name) ? `${alias}"${name}"` : "''";
  function safeUrl(value,{internal=false}={}) { if(typeof value!=='string'||!value.trim())return '';try {const u=new URL(value,origin);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!internal||u.origin===origin)?(u.origin===origin?u.pathname+u.search+u.hash:u.href):'';}catch{return '';}}
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
    const adminUrl=row.adminUrl||(row.type==='product'||row.type==='store'?'/admin-lojas.html':row.type==='affiliate'?'/admin-vendas-afiliadas.html?plataforma='+encodeURIComponent(row.extra||'mercadolivre'):row.type==='story'?'/admin-web-stories?story='+encodeURIComponent(row.rawId):row.type==='course'?'/admin-cursos.html':TYPES[kind][1]);
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
      add('affiliate_catalog',`SELECT 'affiliate:'||slug id,slug rawId,'affiliate' type,'Produto afiliado' typeLabel,title,description summary,image,CASE WHEN status='published' AND availability='available' AND health='reachable' THEN 'published' ELSE 'pending' END status,'/ofertas/'||slug url,'affiliate:'||slug sourceKey,platform extra FROM affiliate_catalog`);
    }
    if(kind==='stores'||kind==='buildings') add('store_profiles',`SELECT 'store:'||order_reference id,order_reference rawId,'store' type,'Prédio de loja' typeLabel,business_name title,${field('store_profiles','description')} summary,${field('store_profiles','facade_url')} image,CASE WHEN review_status='published' THEN 'published' ELSE 'pending' END status,'' url,'' sourceKey,${field('store_profiles','city')} extra FROM store_profiles`);
    if(kind==='pages') {
      add('editorial_articles',`SELECT 'article:'||id id,id rawId,'article' type,'Artigo' typeLabel,title,summary,image_url image,status,'/artigo/'||slug url,'' sourceKey,portal extra FROM editorial_articles`);
      add('editorial_web_stories',`SELECT 'story:'||id id,id rawId,'story' type,'Web Story' typeLabel,slug title,'' summary,'' image,CASE WHEN published_json IS NOT NULL AND published_json!='' THEN 'published' ELSE 'pending' END status,'/stories/'||slug url,article_id sourceKey,'' extra FROM editorial_web_stories`);
      add('managed_courses',`SELECT 'course:'||slug id,slug rawId,'course' type,'Curso' typeLabel,title,description summary,cover_url image,CASE WHEN status='active' THEN 'published' ELSE 'pending' END status,'/centro-educacional#'||slug url,'course:'||slug sourceKey,'' extra FROM managed_courses`);
    }
    return result;
  }
  function staticItems(kind) {
    if(kind==='pages')return CITY_GUIDE_ITEMS.map(i=>({id:'page:'+i.id,title:i.title,summary:i.description,status:'published',url:i.href,meta:[i.landmark].filter(Boolean),kind,image:'',adminUrl:TYPES.pages[1]}));
    if(kind==='buildings') {
      const seen=new Set();
      const landmarks=CITY_GUIDE_ITEMS.filter(i=>i.place&&!seen.has(i.place)&&seen.add(i.place)).map(i=>({id:'place:'+i.place,title:i.landmark,summary:i.description,url:i.href,meta:['Destino no guia da cidade'],kind,image:'',status:'published',adminUrl:TYPES.buildings[1]}));
      return [...landmarks,...AFFILIATE_CENTERS.map(i=>({id:'center:'+i.id,title:i.title,summary:i.description,url:i.href,image:i.logo,meta:['Centro de compras afiliadas'],kind,status:'published',adminUrl:'/admin-afiliados.html'}))];
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
    const inventory=Object.entries(TYPES).map(([kind,[label,adminUrl]])=>{const sql=queries(kind).join(' UNION ALL '),staticCount=staticItems(kind).length;const aggregate=sql?db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) published FROM (${sql})`).get():{total:0,published:0};return {kind,label,total:aggregate.total+staticCount,published:['pages','networks'].includes(kind)?null:Number(aggregate.published||0)+staticCount,pending:['pages','networks'].includes(kind)?null:aggregate.total-Number(aggregate.published||0),available:true,adminUrl};});
    return {inventory,connections:connections(),metrics:metrics([7,30].includes(Number(days))?Number(days):7)};
  }
  return {snapshot,list};
}
