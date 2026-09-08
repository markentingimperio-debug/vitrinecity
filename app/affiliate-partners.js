// Partner attribution on VitrineCity pages. External orders need provider reconciliation.
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (value,max) => typeof value==='string'?value.trim().slice(0,max):'';
export const partnerPagePath = code => '/parceiros/'+encodeURIComponent(code);
export const partnerSharePath = (code,slug) => '/indicar/'+encodeURIComponent(code)+'/'+encodeURIComponent(slug);
export const partnerProductPath = (code,slug) => '/ofertas/'+encodeURIComponent(slug)+'?parceiro='+encodeURIComponent(code);
export const partnerOutboundPath = (code,slug) => '/ir/'+encodeURIComponent(code)+'/'+encodeURIComponent(slug);

export function setupAffiliatePartners({app,db,requireUser,requireAdmin,siteUrl,document,platforms,validAffiliateUrl,publicDir}) {
  const origin=new URL(siteUrl).origin;
  app.get('/admin-parceiros.html',requireAdmin,(_req,res)=>res.sendFile(publicDir+'/admin-parceiros.html'));
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_partner_daily (
    affiliate_id INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    day TEXT NOT NULL, slug TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('showcase_view','product_view','outbound_click')),
    events INTEGER NOT NULL DEFAULT 0 CHECK(events>=0),
    PRIMARY KEY(affiliate_id,day,slug,kind));`);
  const find=code=>{
    if(typeof code!=='string'||!/^[a-z0-9]{1,40}$/i.test(code))return null;
    return db.prepare(`SELECT a.id,a.code,a.user_id FROM affiliates a JOIN users u ON u.id=a.user_id
      WHERE a.code=? AND a.status='active' AND u.account_status='active'`).get(code);
  };
  const available=p=>p&&p.status==='published'&&p.availability!=='unavailable'&&p.health!=='broken'&&validAffiliateUrl(p.affiliate_url,p.platform);
  const product=slug=>typeof slug==='string'&&/^[a-z0-9-]{1,100}$/.test(slug)?db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(slug):null;
  const windows=new Map();
  function record(req,affiliate,kind,slug='') {
    if(req.method!=='GET'||/bot|crawler|spider|facebookexternalhit|whatsapp|preview/i.test(req.get('user-agent')||'')||/prefetch|prerender/i.test(req.get('purpose')||req.get('sec-purpose')||''))return;
    if(req.user?.id===affiliate.user_id)return;
    const now=Date.now(),key=req.ip||'unknown',previous=windows.get(key);
    if(previous&&now-previous.time<60000&&previous.count>=30)return;
    if(windows.size>=10000){for(const [ip,value] of windows)if(now-value.time>=60000)windows.delete(ip);if(windows.size>=10000)return;}
    windows.set(key,previous&&now-previous.time<60000?{time:previous.time,count:previous.count+1}:{time:now,count:1});
    // Only daily counts are stored: no visitor IP, email, browsing history or cookies.
    db.prepare(`INSERT INTO affiliate_partner_daily(affiliate_id,day,slug,kind,events) VALUES(?,?,?,?,1)
      ON CONFLICT(affiliate_id,day,slug,kind) DO UPDATE SET events=events+1`).run(affiliate.id,new Date(now).toISOString().slice(0,10),slug,kind);
  }
  const since=()=>new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  function metrics(id) {
    const totals={showcaseViews:0,productViews:0,outboundClicks:0},keys={showcase_view:'showcaseViews',product_view:'productViews',outbound_click:'outboundClicks'};
    for(const row of db.prepare('SELECT kind,SUM(events) events FROM affiliate_partner_daily WHERE affiliate_id=? AND day>=? GROUP BY kind').all(id,since()))totals[keys[row.kind]]=row.events;
    return {...totals,days:30,since:since(),confirmedSales:null,commissionCents:null};
  }
  function catalog(options={}) {
    const platform=Object.hasOwn(platforms,options.plataforma)?options.plataforma:'',query=text(options.q,120),category=text(options.categoria,80);
    const values=[],terms=(query.match(/[\p{L}\p{N}]+/gu)||[]).slice(0,8);
    let where="p.status='published' AND p.availability!='unavailable' AND p.health!='broken'";
    if(platform){where+=' AND p.platform=?';values.push(platform);}
    if(category){where+=' AND p.category=?';values.push(category);}
    if(terms.length){where+=' AND p.rowid IN (SELECT rowid FROM affiliate_center_search WHERE affiliate_center_search MATCH ?)';values.push(terms.map(t=>`"${t}"*`).join(' AND '));}
    const total=db.prepare(`SELECT COUNT(*) total FROM affiliate_catalog p WHERE ${where}`).get(...values).total,pages=Math.max(1,Math.ceil(total/24)),page=Math.min(pages,Math.max(1,parseInt(String(options.p||'1'),10)||1));
    const items=db.prepare(`SELECT p.* FROM affiliate_catalog p WHERE ${where} ORDER BY p.title,p.slug LIMIT 24 OFFSET ?`).all(...values,(page-1)*24).filter(available);
    const categories=db.prepare("SELECT DISTINCT category FROM affiliate_catalog WHERE status='published' AND availability!='unavailable' AND health!='broken' ORDER BY category").all().map(r=>r.category);
    return {platform,query,category,total,page,pages,items,categories};
  }
  const item=(p,a)=>({slug:p.slug,title:p.title,category:p.category,platform:p.platform,platformName:platforms[p.platform],image:p.image,shareUrl:origin+partnerSharePath(a.code,p.slug),productUrl:origin+partnerProductPath(a.code,p.slug)});
  app.get('/api/affiliates/me/products',requireUser,(req,res)=>{
    const row=db.prepare("SELECT code FROM affiliates WHERE user_id=?").get(req.user.id),affiliate=find(row?.code);
    if(!affiliate)return res.status(403).json({error:'Ative seu cadastro de afiliado para acessar sua vitrine.'});
    const data=catalog(req.query),byProduct=db.prepare(`SELECT slug,SUM(CASE WHEN kind='product_view' THEN events ELSE 0 END) views,SUM(CASE WHEN kind='outbound_click' THEN events ELSE 0 END) clicks FROM affiliate_partner_daily WHERE affiliate_id=? AND day>=? GROUP BY slug`).all(affiliate.id,since()),counts=new Map(byProduct.map(p=>[p.slug,p]));
    return res.set('Cache-Control','no-store').json({...data,showcaseUrl:origin+partnerPagePath(affiliate.code),metrics:metrics(affiliate.id),items:data.items.map(p=>({...item(p,affiliate),views:counts.get(p.slug)?.views||0,clicks:counts.get(p.slug)?.clicks||0}))});
  });
  app.get('/api/admin/affiliate-partners',requireAdmin,(req,res)=>{
    const page=Math.max(1,Math.min(100000,parseInt(String(req.query.p||1),10)||1)),query=text(req.query.q,40),filter=query?' WHERE instr(lower(a.code),lower(?))>0':'',values=query?[query]:[];
    const total=db.prepare('SELECT COUNT(*) total FROM affiliates a'+filter).get(...values).total;
    const rows=db.prepare('SELECT a.id,a.code,a.status FROM affiliates a'+filter+' ORDER BY a.id DESC LIMIT 50 OFFSET ?').all(...values,(page-1)*50);
    return res.set('Cache-Control','no-store').json({page,total,pages:Math.max(1,Math.ceil(total/50)),items:rows.map(a=>({code:a.code,status:a.status,showcaseUrl:origin+partnerPagePath(a.code),metrics:metrics(a.id)}))});
  });
  app.get('/parceiros/:code',(req,res)=>{
    const affiliate=find(req.params.code);if(!affiliate)return res.status(404).type('html').send(document('Vitrine indisponível','<h1>Esta vitrine não está disponível.</h1><a href="/ofertas">Explorar produtos</a>',origin+'/ofertas'));
    const data=catalog(req.query),base=partnerPagePath(affiliate.code),pageUrl=p=>{const params=new URLSearchParams();if(data.platform)params.set('plataforma',data.platform);if(data.query)params.set('q',data.query);if(data.category)params.set('categoria',data.category);if(p>1)params.set('p',p);return base+(params.size?'?'+params:'');};
    record(req,affiliate,'showcase_view');
    const body=`<link rel="stylesheet" href="/affiliate-partners.css"><section class="partner-hero"><span class="eyebrow">VITRINE PESSOAL · ${esc(affiliate.code)}</span><h1>Boas descobertas.<br>Um link de cada vez.</h1><p>Explore a seleção compartilhada por este parceiro da VitrineCity.</p><p class="disclosure">Publicidade · Links de afiliado. A VitrineCity pode receber comissão pelas compras. A compra acontece na plataforma indicada.</p></section>
      <form class="partner-filters" method="get" action="${base}" role="search"><label>Buscar produto<input name="q" type="search" maxlength="120" value="${esc(data.query)}" placeholder="Produto, marca ou interesse"></label><label>Plataforma<select name="plataforma"><option value="">Todas as plataformas</option>${Object.entries(platforms).map(([id,name])=>`<option value="${id}" ${data.platform===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label>Categoria<select name="categoria"><option value="">Todas as categorias</option>${data.categories.map(c=>`<option ${data.category===c?'selected':''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label><button>Encontrar</button></form>
      <p>${data.total} produtos na seleção</p><div class="grid">${data.items.map(p=>`<article class="card"><a class="card-media" href="${partnerSharePath(affiliate.code,p.slug)}" aria-label="${esc(p.title)}">${p.image?`<img src="${esc(p.image)}" alt="" loading="lazy" width="360" height="240">`:'<span class="image-placeholder">Conheça o produto</span>'}</a><div><span class="eyebrow">${esc(platforms[p.platform])} · ${esc(p.category)}</span><h2><a href="${partnerSharePath(affiliate.code,p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.description.slice(0,150))}</p><a class="button" href="${partnerSharePath(affiliate.code,p.slug)}">Conhecer produto →</a></div></article>`).join('')||'<p>Nenhum produto encontrado. Experimente outra busca.</p>'}</div>
      <nav class="partner-pagination" aria-label="Páginas">${data.page>1?`<a href="${esc(pageUrl(data.page-1))}">← Anterior</a>`:'<span></span>'}<span>Página ${data.page} de ${data.pages}</span>${data.page<data.pages?`<a href="${esc(pageUrl(data.page+1))}">Próxima →</a>`:'<span></span>'}</nav>`;
    return res.set({'Cache-Control':'no-store','Referrer-Policy':'strict-origin-when-cross-origin','X-Robots-Tag':'noindex,follow'}).type('html').send(document('Vitrine de '+affiliate.code,body,origin+base));
  });
  app.get('/indicar/:code/:slug',(req,res)=>{
    const affiliate=find(req.params.code),p=product(req.params.slug);
    if(!affiliate||!available(p))return res.status(404).send('Indicação indisponível. Consulte a seleção em /ofertas.');
    return res.set('Cache-Control','no-store').redirect(302,partnerProductPath(affiliate.code,p.slug));
  });
  app.get('/ir/:code/:slug',(req,res)=>{
    const affiliate=find(req.params.code),p=product(req.params.slug);
    if(!affiliate||!available(p))return res.status(404).send('Oferta indisponível. Consulte a seleção em /ofertas.');
    record(req,affiliate,'outbound_click',p.slug);
    // Keep the provider's approved affiliate URL intact; no guessed Sub IDs or sale credits.
    return res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).redirect(302,p.affiliate_url);
  });
  return {find,record,metrics};
}
