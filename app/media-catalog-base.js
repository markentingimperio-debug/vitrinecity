import {randomUUID} from 'node:crypto';
import {youtubeSource,normalizeMusicText,musicGenres,musicKinds} from './public/vitriny-music-core.js';
import {musicSeeds} from './music-seeds.js';
import {cinemaSeeds} from './cinema-seeds.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const cinemaGenres={kids:'Infantil / família',aventura:'Aventura',acao:'Ação',ficcao:'Ficção científica',lancamentos:'Lançamentos · trailers'};
const formats={...musicKinds,curta:'Curta completo',filme:'Filme completo',trailer:'Trailer oficial'};
const configs={music:{name:'Pulse Arena',path:'/musicas',arena:'/vitriny-music-arena.html',genres:musicGenres,description:'Playlists de música eletrônica, sertanejo e outros estilos, DJ sets e rádios contínuas selecionadas para ouvir na Pulse Arena.',seeds:musicSeeds},cinema:{name:'Cinema VitrineCity',path:'/cinema',arena:'/vitriny-cinema.html',genres:cinemaGenres,description:'Conheça curtas completos e trailers oficiais por categoria: infantil, aventura, ação e ficção científica. Escolha uma sessão do Cinema VitrineCity.',seeds:cinemaSeeds}};
export function setupMediaCatalog({app,db,requireAdmin,sameOriginOnly,siteUrl,publicDir}){
  const origin=new URL(siteUrl).origin;
  db.exec(`CREATE TABLE IF NOT EXISTS vitriny_media_catalog(scope TEXT NOT NULL CHECK(scope IN ('music','cinema')),slug TEXT NOT NULL,title TEXT NOT NULL,genre TEXT NOT NULL,kind TEXT NOT NULL,format TEXT NOT NULL,url TEXT NOT NULL,artist TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('published','paused')),sort_order INTEGER NOT NULL DEFAULT 0,search_text TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(scope,slug)); CREATE INDEX IF NOT EXISTS idx_vitriny_media_public ON vitriny_media_catalog(scope,status,sort_order);`);
  const insert=db.prepare(`INSERT OR IGNORE INTO vitriny_media_catalog(scope,slug,title,genre,kind,format,url,artist,description,tags,status,sort_order,search_text) VALUES(@scope,@slug,@title,@genre,@kind,@format,@url,@artist,@description,@tags,@status,@sort_order,@search_text)`);
  for(const [scope,config] of Object.entries(configs))db.transaction(()=>config.seeds.forEach((seed,index)=>{
    const row={...seed,scope,format:seed.format||seed.kind,status:'published',sort_order:index};
    if(!youtubeSource(row.url,row.kind))throw Error('Invalid curated media source: '+row.slug);
    row.search_text=normalizeMusicText([row.title,row.artist,row.description,row.tags,config.genres[row.genre]].join(' '));insert.run(row);
  }))();
  const present=row=>({...row,label:formats[row.format]||formats[row.kind],genreLabel:configs[row.scope].genres[row.genre],pagePath:configs[row.scope].path+'/'+row.slug,arenaPath:configs[row.scope].arena+'?selecao='+row.slug,source:youtubeSource(row.url,row.kind)});
  const find=(scope,slug)=>typeof slug==='string'&&/^[a-z0-9-]{1,100}$/.test(slug)?db.prepare("SELECT * FROM vitriny_media_catalog WHERE scope=? AND slug=? AND status='published'").get(scope,slug):null;
  function catalog(scope,options={},admin=false){
    const config=configs[scope],query=clean(options.q,120),genre=Object.hasOwn(config.genres,options.genero)?options.genero:'',kind=Object.hasOwn(formats,options.tipo)?options.tipo:'';
    let where='scope=?'+(admin?'':" AND status='published'");const params=[scope];
    if(genre){where+=' AND genre=?';params.push(genre);}if(kind){where+=' AND format=?';params.push(kind);}
    for(const word of normalizeMusicText(query).split(/\s+/).filter(Boolean).slice(0,8)){where+=' AND instr(search_text,?)>0';params.push(word);}
    const total=db.prepare('SELECT COUNT(*) total FROM vitriny_media_catalog WHERE '+where).get(...params).total,pages=Math.max(1,Math.ceil(total/24)),page=Math.min(pages,Math.max(1,parseInt(String(options.p||1),10)||1));
    const items=db.prepare('SELECT * FROM vitriny_media_catalog WHERE '+where+' ORDER BY sort_order,slug LIMIT 24 OFFSET ?').all(...params,(page-1)*24).map(present);
    const genres=db.prepare("SELECT genre,COUNT(*) count FROM vitriny_media_catalog WHERE scope=? AND status='published' GROUP BY genre").all(scope).map(g=>({...g,label:config.genres[g.genre]}));
    return {scope,name:config.name,query,genre,kind,items,total,page,pages,genres,allGenres:config.genres,formats:scope==='music'?musicKinds:{curta:formats.curta,filme:formats.filme,trailer:formats.trailer,playlist:formats.playlist}};
  }
  function document({title,description,path,body,noindex=false,items=[]}){
    const canonical=origin+path,schema={'@context':'https://schema.org','@type':'CollectionPage',name:title,description,url:canonical,mainEntity:{'@type':'ItemList',itemListElement:items.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.title,url:origin+item.pagePath}))}};
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | VitrineCity</title><meta name="description" content="${esc(description)}"><meta name="robots" content="${noindex?'noindex,follow':'index,follow'}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="website"><link rel="stylesheet" href="/vitriny-media-catalog.css"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script></head><body><header><a href="/">VITRINECITY</a><nav><a href="/musicas">Música</a><a href="/cinema">Cinema</a><a href="/vitriny-multiverse-explore.html?city=vitrine-city">Multiverso</a></nav></header><main>${body}</main><footer>VitrineCity · Catálogo de fontes selecionadas. A reprodução ocorre nos players dos canais de origem.</footer></body></html>`;
  }
  const card=item=>`<article class="media-card"><div class="card-art ${item.scope==='cinema'?'cinema-art':''}" aria-hidden="true"><span>${esc(item.genreLabel)}</span><b>${item.scope==='cinema'?'▻':'♫'}</b></div><div class="card-copy"><small>${esc(item.label)} · ${esc(item.artist)}</small><h2><a href="${esc(item.pagePath)}">${esc(item.title)}</a></h2><p>${esc(item.description)}</p><a class="media-button" href="${esc(item.arenaPath)}">${item.scope==='cinema'?'Assistir à sessão':'Ouvir na arena'} →</a></div></article>`;
  for(const [scope,config] of Object.entries(configs)){
    app.get('/api/media/'+scope,(req,res)=>res.set('Cache-Control','public,max-age=60').json(catalog(scope,req.query)));
    app.get('/api/media/'+scope+'/:slug',(req,res)=>{const row=find(scope,req.params.slug);return row?res.json(present(row)):res.status(404).json({error:'Esta seleção não está disponível.'});});
    app.get(config.path,(req,res)=>{
      const data=catalog(scope,req.query),params=new URLSearchParams();if(data.query)params.set('q',data.query);if(data.genre)params.set('genero',data.genre);if(data.kind)params.set('tipo',data.kind);
      const pageUrl=p=>{const next=new URLSearchParams(params);if(p>1)next.set('p',p);return config.path+(next.size?'?'+next:'');};
      const body=`<section class="catalog-heading"><small>VITRINECITY · ${scope==='music'?'MÚSICA':'CINEMA'}</small><h1>${esc(config.name)}</h1><p>${esc(config.description)}</p><p>Explore as seleções. Entre na sua conta VitrineCity para abrir a ${scope==='music'?'arena':'sala de exibição'}.</p></section><form class="media-filters" method="get"><label>Título, artista ou palavra-chave<input type="search" name="q" maxlength="120" value="${esc(data.query)}" placeholder="O que você quer encontrar?"></label><label>Categoria<select name="genero"><option value="">Todas</option>${data.genres.map(g=>`<option value="${esc(g.genre)}"${g.genre===data.genre?' selected':''}>${esc(g.label)}</option>`).join('')}</select></label><button class="media-button">Buscar</button></form><p>${data.total} seleções disponíveis</p><section class="media-grid">${data.items.map(card).join('')||'<p>Nenhuma seleção encontrada. Tente outro título ou estilo.</p>'}</section><nav class="pagination" aria-label="Páginas">${data.page>1?`<a href="${esc(pageUrl(data.page-1))}">← Anterior</a>`:''}<span>Página ${data.page} de ${data.pages}</span>${data.page<data.pages?`<a href="${esc(pageUrl(data.page+1))}">Próxima →</a>`:''}</nav>`;
      res.type('html').send(document({title:config.name+' · '+(scope==='music'?'playlists e rádios':'curtas e trailers'),description:config.description,path:pageUrl(data.page),body,noindex:!!(data.query||data.genre||data.kind),items:data.items}));
    });
    app.get(config.path+'/:slug',(req,res)=>{
      const row=find(scope,req.params.slug);if(!row)return res.status(404).type('html').send(document({title:'Seleção indisponível',description:'Esta seleção não está disponível.',path:config.path,body:`<h1>Seleção indisponível</h1><a href="${config.path}">Voltar ao catálogo</a>`,noindex:true}));
      const item=present(row),related=db.prepare("SELECT * FROM vitriny_media_catalog WHERE scope=? AND status='published' AND slug!=? ORDER BY (genre=?) DESC,sort_order LIMIT 3").all(scope,item.slug,item.genre).map(present);
      const body=`<a class="back-link" href="${config.path}">← ${esc(config.name)}</a><section class="catalog-heading"><small>${esc(item.genreLabel)} · ${esc(item.label)}</small><h1>${esc(item.title)}</h1><p>${esc(item.description)}</p><p>Fonte: ${esc(item.artist)} · YouTube</p>${scope==='cinema'?'<p>O formato aparece acima: trailers apresentam o filme; curtas e filmes completos indicam a obra disponibilizada pelo canal.</p>':''}<a class="media-button" href="${esc(item.arenaPath)}">${scope==='music'?'Ouvir dentro da VitrineCity':'Entrar na sala e assistir'} →</a><p class="subtle">Acesso com sua conta VitrineCity. O canal pode alterar a seleção ou a disponibilidade de exibição.</p></section><section><h2>Mais para explorar</h2><div class="media-grid">${related.map(card).join('')}</div></section>`;
      res.type('html').send(document({title:item.title+' · '+item.label,description:item.description,path:item.pagePath,body,items:[item]}));
    });
  }
  app.get('/admin-midia.html',requireAdmin,(_req,res)=>res.sendFile(publicDir+'/admin-midia.html'));
  app.get('/api/admin/media/:scope',requireAdmin,(req,res)=>Object.hasOwn(configs,req.params.scope)?res.set('Cache-Control','no-store').json(catalog(req.params.scope,req.query,true)):res.sendStatus(404));
  app.put('/api/admin/media/:scope/:slug',requireAdmin,sameOriginOnly,(req,res)=>{
    const {scope}=req.params,config=configs[scope];if(!Object.hasOwn(configs,scope))return res.sendStatus(404);
    const b=req.body||{},slug=req.params.slug==='new'?randomUUID():req.params.slug;
    if(!/^[a-z0-9-]{1,100}$/.test(slug))return res.status(400).json({error:'Identificador inválido.'});
    const format=clean(b.format,20),kind=format==='playlist'?'playlist':format==='live'?'live':'video',source=youtubeSource(b.url,kind);
    const row={scope,slug,title:clean(b.title,150),genre:clean(b.genre,30),kind,format,url:source?.url||'',artist:clean(b.artist,100),description:clean(b.description,800),tags:clean(b.tags,300),status:b.status==='published'?'published':'paused',sort_order:Math.max(0,Math.min(10000,parseInt(b.sort_order,10)||0))};
    const validFormats=scope==='music'?['playlist','video','live']:['curta','filme','trailer','playlist'];
    if(!source||!row.title||!row.artist||row.description.length<30||!Object.hasOwn(config.genres,row.genre)||!validFormats.includes(format))return res.status(400).json({error:'Informe título, fonte, categoria, formato, descrição (30 caracteres) e um link direto válido do YouTube.'});
    const exists=db.prepare('SELECT slug FROM vitriny_media_catalog WHERE scope=? AND slug=?').get(scope,slug);
    if(!exists&&db.prepare('SELECT COUNT(*) n FROM vitriny_media_catalog WHERE scope=?').get(scope).n>=2000)return res.status(409).json({error:'Limite de 2.000 seleções por catálogo atingido.'});
    row.search_text=normalizeMusicText([row.title,row.artist,row.description,row.tags,config.genres[row.genre]].join(' '));
    db.prepare(`INSERT INTO vitriny_media_catalog(scope,slug,title,genre,kind,format,url,artist,description,tags,status,sort_order,search_text) VALUES(@scope,@slug,@title,@genre,@kind,@format,@url,@artist,@description,@tags,@status,@sort_order,@search_text) ON CONFLICT(scope,slug) DO UPDATE SET title=excluded.title,genre=excluded.genre,kind=excluded.kind,format=excluded.format,url=excluded.url,artist=excluded.artist,description=excluded.description,tags=excluded.tags,status=excluded.status,sort_order=excluded.sort_order,search_text=excluded.search_text,updated_at=CURRENT_TIMESTAMP`).run(row);
    return res.json({ok:true,slug});
  });
  return {sitemapPaths:()=>Object.values(configs).map(c=>c.path).concat(db.prepare("SELECT scope,slug FROM vitriny_media_catalog WHERE status='published' ORDER BY scope,slug").all().map(row=>configs[row.scope].path+'/'+row.slug))};
}
