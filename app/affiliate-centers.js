import {AFFILIATE_CENTERS,affiliateCenter} from './public/vitriny-affiliate-centers-core.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function setupAffiliateCenters({app,db,document,card,siteUrl}){
  db.exec(`CREATE INDEX IF NOT EXISTS affiliate_center_published ON affiliate_catalog(status,platform,category,title);
    CREATE VIRTUAL TABLE IF NOT EXISTS affiliate_center_search USING fts5(title,description,keywords,category,content='affiliate_catalog',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS affiliate_center_insert AFTER INSERT ON affiliate_catalog BEGIN INSERT INTO affiliate_center_search(rowid,title,description,keywords,category) VALUES(new.rowid,new.title,new.description,new.keywords,new.category); END;
    CREATE TRIGGER IF NOT EXISTS affiliate_center_delete AFTER DELETE ON affiliate_catalog BEGIN INSERT INTO affiliate_center_search(affiliate_center_search,rowid,title,description,keywords,category) VALUES('delete',old.rowid,old.title,old.description,old.keywords,old.category); END;
    CREATE TRIGGER IF NOT EXISTS affiliate_center_update AFTER UPDATE OF title,description,keywords,category ON affiliate_catalog BEGIN INSERT INTO affiliate_center_search(affiliate_center_search,rowid,title,description,keywords,category) VALUES('delete',old.rowid,old.title,old.description,old.keywords,old.category); INSERT INTO affiliate_center_search(rowid,title,description,keywords,category) VALUES(new.rowid,new.title,new.description,new.keywords,new.category); END;`);
  if(!db.prepare('SELECT 1 FROM affiliate_catalog_migrations WHERE id=?').get('centers-search-v1'))db.transaction(()=>{db.exec("INSERT INTO affiliate_center_search(affiliate_center_search) VALUES('rebuild')");db.prepare('INSERT INTO affiliate_catalog_migrations VALUES(?)').run('centers-search-v1');})();
  const departments=platform=>db.prepare("SELECT category name,COUNT(*) total FROM affiliate_catalog WHERE status='published' AND platform=? GROUP BY category ORDER BY category COLLATE NOCASE").all(platform);
  function catalog(platform,options={}){
    const center=affiliateCenter(platform);if(!center)return null;
    const query=text(options.q,120),department=text(options.departamento,80),terms=(query.match(/[\p{L}\p{N}]+/gu)||[]).slice(0,8),values=[platform];
    let where="p.status='published' AND p.platform=?";
    if(department){where+=' AND p.category=?';values.push(department);}
    if(terms.length){where+=' AND p.rowid IN (SELECT rowid FROM affiliate_center_search WHERE affiliate_center_search MATCH ?)';values.push(terms.map(term=>`"${term}"*`).join(' AND '));}
    const total=db.prepare(`SELECT COUNT(*) total FROM affiliate_catalog p WHERE ${where}`).get(...values).total,pageSize=24,pages=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.min(pages,Math.max(1,Number.parseInt(String(options.p||'1'),10)||1));
    const items=db.prepare(`SELECT p.* FROM affiliate_catalog p WHERE ${where} ORDER BY p.title COLLATE NOCASE,p.slug LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize);
    return {center,query,department,total,page,pages,pageSize,items,departments:departments(platform)};
  }
  const url=(id,{query='',department='',page=1}={})=>{const queryString=new URLSearchParams();if(department)queryString.set('departamento',department);if(query)queryString.set('q',query);if(page>1)queryString.set('p',page);return `/centros/${id}${queryString.size?'?'+queryString:''}`;};
  app.get('/api/affiliate-centers',(_req,res)=>res.set('Cache-Control','public,max-age=60').json({centers:AFFILIATE_CENTERS.map(center=>{const categories=departments(center.id);return {...center,total:categories.reduce((sum,item)=>sum+item.total,0),departments:categories};})}));
  app.get('/api/affiliate-centers/:platform/products',(req,res)=>{
    const data=catalog(req.params.platform,req.query);if(!data)return res.status(404).json({error:'Centro não encontrado.'});
    return res.set('Cache-Control','public,max-age=60').json({...data,items:data.items.map(p=>({slug:p.slug,title:p.title,description:p.description,category:p.category,image:p.image,platform:p.platform,href:'/ofertas/'+p.slug,available:p.availability!=='unavailable'&&p.health!=='broken'}))});
  });
  app.get('/centros/:platform',(req,res)=>{
    const data=catalog(req.params.platform,req.query);if(!data)return res.status(404).type('html').send(document('Centro não encontrado','<h1>Centro não encontrado</h1><a href="/ofertas">Conhecer produtos</a>',siteUrl+'/ofertas'));
    const {center,query,department,items,total,page,pages}=data;
    const body=`<link rel="stylesheet" href="/affiliate-centers.css"><div class="center-experience" style="--center-accent:${center.color};--brand-background:${center.brandBackground}">
      <nav class="center-breadcrumb" aria-label="Caminho"><a href="/vitriny-multiverse-explore.html?city=vitrine-city">← Voltar à cidade</a><span>VITRINECITY · CENTROS DE COMPRAS</span></nav>
      <section class="center-hero"><div><p class="center-eyebrow">UMA SELEÇÃO. MUITAS POSSIBILIDADES.</p><h1>${escape(center.title)}</h1><p>${escape(center.description)}</p><a class="center-primary" href="#departamentos">Explorar departamentos <span>↘</span></a></div><div class="center-emblem"><img src="${center.logo}" alt="Logo ${escape(center.name)}" width="396" height="120"><i>SELEÇÃO AFILIADA · VITRINECITY</i></div></section>
      <p class="center-disclosure">Seleção independente da VitrineCity com links de afiliado. Podemos receber comissão pelas compras. As marcas identificam as plataformas de destino.</p>
      <nav class="center-platforms" aria-label="Centros de compras">${AFFILIATE_CENTERS.map(c=>`<a href="${c.href}" ${c.id===center.id?'aria-current="page"':''}>${escape(c.title)} <span>↗</span></a>`).join('')}</nav>
      <section id="departamentos" class="center-departments"><div class="center-section-heading"><span>01 / ENCONTRE SEU DEPARTAMENTO</span><h2>O que combina com você?</h2></div><nav aria-label="Departamentos de ${escape(center.title)}">${data.departments.map((d,i)=>`<a href="${escape(url(center.id,{department:d.name}))}" ${d.name===department?'aria-current="page"':''}><small>${String(i+1).padStart(2,'0')} / DEPARTAMENTO</small><strong>${escape(d.name)}</strong><span>${d.total} ${d.total===1?'produto':'produtos'} <b>↗</b></span></a>`).join('')||'<p class="center-empty">Estamos preparando a seleção deste centro. Os departamentos aparecem aqui conforme os produtos são publicados.</p>'}</nav></section>
      <section id="produtos"><div class="center-section-heading"><span>02 / SUA PRÓXIMA DESCOBERTA</span><h2>${escape(department||'Explore a seleção')}</h2></div><form class="center-search" method="get" action="${center.href}" role="search"><label>Buscar neste centro<input type="search" name="q" value="${escape(query)}" placeholder="Produto, marca ou interesse" maxlength="120"></label><label>Departamento<select name="departamento"><option value="">Todos os departamentos</option>${data.departments.map(d=>`<option ${d.name===department?'selected':''} value="${escape(d.name)}">${escape(d.name)}</option>`).join('')}</select></label><button type="submit">Encontrar →</button></form>
      <div class="results-heading"><p>${total} ${total===1?'produto encontrado':'produtos encontrados'}</p>${query||department?`<a href="${center.href}">Limpar filtros</a>`:''}</div><div class="grid">${items.map(card).join('')||'<div class="center-empty"><h3>Novas descobertas estão a caminho.</h3><p>Confira os outros departamentos ou visite outro centro de compras.</p></div>'}</div>
      ${pages>1?`<nav class="center-pagination" aria-label="Páginas de produtos">${page>1?`<a href="${escape(url(center.id,{query,department,page:page-1}))}#produtos">← Anterior</a>`:'<span></span>'}<span>Página ${page} de ${pages}</span>${page<pages?`<a href="${escape(url(center.id,{query,department,page:page+1}))}#produtos">Próxima →</a>`:'<span></span>'}</nav>`:''}</section>
      <section class="center-closing"><h2>Conheça antes de escolher.</h2><p>Cada produto tem sua própria página com apresentação e detalhes. Confira preço, disponibilidade e condições na plataforma de compra.</p></section></div>`;
    const html=document(`${center.title}${department?' · '+department:''}`,body,new URL(url(center.id,{department,page}),siteUrl).href,'',center.description);
    return res.type('html').set('Cache-Control','public,max-age=60').send(query?html.replace('</head>','<meta name="robots" content="noindex,follow"></head>'):html);
  });
  return {catalog,paths:AFFILIATE_CENTERS.map(center=>center.href)};
}
