import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import express from 'express';
import {createStoryAssets} from './web-story-assets.js';
import {renderWebStory,renderStoryDirectory,escapeStory as esc} from './web-story-render.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hashArticle=a=>createHash('sha256').update(JSON.stringify([a.title,a.summary,a.body,a.image_url,a.updated_at])).digest('hex');
const text=(value,max,label,minimum=1)=>{
  if(typeof value!=='string'||value.trim().length<minimum||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw fail(`${label}: informe de ${minimum} a ${max} caracteres.`);
  return value.trim();
};
export function splitStoryText(body,max=130) {
  const words=String(body||'').trim().split(/\s+/),pages=[];
  let current='';
  for(const word of words){if(word.length>max)throw fail('O artigo contém um trecho sem espaços longo demais. Revise o texto de origem.');if(current.length+word.length+1>max){pages.push(current);current='';}current+=(current?' ':'')+word;}
  if(current)pages.push(current);
  if(pages.length<3||pages.length>39)throw fail('Use um artigo completo que caiba entre 3 e 39 páginas de texto curto. Divida artigos muito longos em guias completos antes de criar a história.');
  return pages;
}

export function setupWebStories({app,db,requireAdmin,sameOriginOnly,siteUrl,publicDir,dataDir,assets=createStoryAssets({publicDir,dataDir})}) {
  const origin=new URL(siteUrl).origin,creating=new Set();
  db.exec(`CREATE TABLE IF NOT EXISTS editorial_web_stories(
    id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,article_id TEXT NOT NULL UNIQUE,
    source_hash TEXT NOT NULL,draft_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
    previewed_revision INTEGER NOT NULL DEFAULT 0,published_json TEXT,published_at TEXT,published_revision INTEGER,
    updated_at TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL DEFAULT '',reviewed_by TEXT NOT NULL DEFAULT '',published_updated_at TEXT);
    CREATE TABLE IF NOT EXISTS editorial_web_story_events(id INTEGER PRIMARY KEY,story_id TEXT NOT NULL,event TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_web_stories_published ON editorial_web_stories(published_at);`);
  const article=id=>db.prepare("SELECT * FROM editorial_articles WHERE id=? AND status='published'").get(id);
  const row=id=>db.prepare('SELECT * FROM editorial_web_stories WHERE id=?').get(id);
  const actor=req=>String(req.user?.id||req.user?.email||'admin').slice(0,160);
  const event=(req,item,kind)=>db.prepare('INSERT INTO editorial_web_story_events(story_id,event,revision,actor,created_at) VALUES(?,?,?,?,?)').run(item.id,kind,item.revision,actor(req),new Date().toISOString());
  const dto=item=>({...item,draft:JSON.parse(item.draft_json),draft_json:undefined,published_json:undefined,url:'/stories/'+item.slug,sourceAvailable:!!article(item.article_id)});
  const get=id=>{const item=row(id);if(!item)throw fail('História não encontrada.',404);return item;};
  const current=(item,revision)=>{if(!Number.isInteger(revision)||item.revision!==revision)throw fail('Esta história mudou em outra aba. Reabra antes de continuar.',409);};
  function currentSource(item){const source=article(item.article_id);if(!source)throw fail('O artigo de origem precisa estar publicado.',409);if(hashArticle(source)!==item.source_hash)throw fail('O artigo de origem mudou. Recrie o rascunho a partir da versão atual e revise novamente.',409);return source;}
  const route=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){res.status(error.status||400).json({error:error.status?error.message:'Não foi possível concluir. Confira as imagens locais e tente novamente.'});}};
  async function template(source) {
    if(source.body.trim().length<400)throw fail('O artigo deve conter pelo menos 400 caracteres de conteúdo completo.');
    const chunks=splitStoryText(source.body),image=await assets.image(source.image_url),logo=await assets.image('/assets/pwa-icon-192.png',{logo:true});
    const poster=await assets.poster(image),title=source.title.trim().slice(0,90),description=(source.summary||source.title).trim().slice(0,160);
    return {title,description,category:source.portal.replace(/-/g,' ').slice(0,26),logo:logo.url,poster,sourcePath:'/artigo/'+encodeURIComponent(source.slug),cta:'Artigo e fontes',pages:[description.slice(0,130),...chunks].map(content=>({text:content,image:image.url,width:image.width,height:image.height,alt:source.title.slice(0,150)}))};
  }
  async function validateDraft(input,original) {
    const draft={...original,title:text(input.title,90,'Título'),description:text(input.description,160,'Descrição',30),cta:input.cta===false||input.cta===''?'':text(input.cta||'Artigo e fontes',30,'Texto do botão')};
    if(!Array.isArray(input.pages)||input.pages.length<4||input.pages.length>40)throw fail('A história deve ter entre 4 e 40 páginas, com conteúdo completo.');
    const unique=new Map();draft.pages=[];
    for(const p of input.pages){const copy=text(p.text,130,'Texto de cada página'),alt=text(p.alt,150,'Descrição da imagem');if(!unique.has(p.image))unique.set(p.image,await assets.image(p.image));const asset=unique.get(p.image);draft.pages.push({text:copy,alt,image:asset.url,width:asset.width,height:asset.height});}
    if(draft.pages.slice(1).map(p=>p.text).join(' ').length<400)throw fail('Inclua o conteúdo completo da história: pelo menos 400 caracteres além da capa.');
    await assets.image(draft.logo,{logo:true});
    // A fresh, immutable portrait poster always represents the first page's actual image.
    draft.poster=await assets.poster(unique.get(draft.pages[0].image));
    return draft;
  }
  const published=()=>db.prepare("SELECT w.* FROM editorial_web_stories w JOIN editorial_articles a ON a.id=w.article_id WHERE w.published_json IS NOT NULL AND a.status='published' ORDER BY w.published_at DESC LIMIT 200").all();
  const visible=item=>{const draft=JSON.parse(item.published_json);return {...draft,slug:item.slug,modifiedAt:item.published_updated_at};};

  app.get(['/admin-web-stories','/admin-web-stories.html'],requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').sendFile(path.join(publicDir,'admin-web-stories.html')));
  app.get('/admin-web-stories/preview/:id',requireAdmin,route((req,res)=>{
    const item=get(req.params.id);current(item,Number(req.query.revision));currentSource(item);
    if(item.previewed_revision!==item.revision)throw fail('Abra a prévia pelo editor primeiro.',409);
    res.locals.vcAmpStory=true;
    res.set('X-Robots-Tag','noindex,nofollow').type('html').send(renderWebStory(JSON.parse(item.draft_json),{origin,slug:item.slug,preview:true}));
  }));
  app.get('/api/admin/web-stories/sources',requireAdmin,route((req,res)=>{
    const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,80):'';
    const items=db.prepare("SELECT a.id,a.title,a.slug,a.portal,a.image_url,a.updated_at,w.id story_id FROM editorial_articles a LEFT JOIN editorial_web_stories w ON w.article_id=a.id WHERE a.status='published' AND instr(lower(a.title),lower(?))>0 ORDER BY a.published_at DESC LIMIT 50").all(q);
    res.json({items,generator:'editorial-template',supportedSources:['article']});
  }));
  app.get('/api/admin/web-stories',requireAdmin,route((_req,res)=>res.json({items:db.prepare('SELECT * FROM editorial_web_stories ORDER BY updated_at DESC LIMIT 200').all().map(dto)})));
  app.get('/api/admin/web-stories/:id',requireAdmin,route((req,res)=>res.json(dto(get(req.params.id)))));
  app.post('/api/admin/web-stories',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const id=text(req.body?.articleId,150,'Artigo'),existing=db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(id);
    if(existing)return res.json(dto(existing));
    if(creating.size||db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n>=200)throw fail('Aguarde a criação atual ou use uma das histórias existentes (limite de 200).',409);
    const source=article(id);if(!source)throw fail('Escolha um artigo publicado.',404);
    creating.add(id);
    try{
      const draft=await template(source),fresh=article(id);if(!fresh||hashArticle(fresh)!==hashArticle(source))throw fail('O artigo mudou durante a criação. Tente novamente.',409);
      const now=new Date().toISOString(),item={id:randomUUID(),slug:source.slug.slice(0,90)+'-'+createHash('sha256').update(id).digest('hex').slice(0,8),article_id:id,source_hash:hashArticle(source),draft_json:JSON.stringify(draft),updated_at:now,created_at:now,created_by:actor(req)};
      db.transaction(()=>{db.prepare('INSERT INTO editorial_web_stories(id,slug,article_id,source_hash,draft_json,updated_at,created_at,created_by) VALUES(@id,@slug,@article_id,@source_hash,@draft_json,@updated_at,@created_at,@created_by)').run(item);event(req,{...item,revision:1},'created');})();
      res.status(201).json(dto(row(item.id)));
    }finally{creating.delete(id);}
  }));
  app.put('/api/admin/web-stories/:id',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);currentSource(item);
    const draft=await validateDraft(req.body.draft,JSON.parse(item.draft_json));
    db.transaction(()=>{current(get(item.id),item.revision);currentSource(item);db.prepare('UPDATE editorial_web_stories SET draft_json=?,revision=revision+1,previewed_revision=0,updated_at=? WHERE id=?').run(JSON.stringify(draft),new Date().toISOString(),item.id);event(req,{...item,revision:item.revision+1},'saved');})();
    res.json(dto(row(item.id)));
  }));
  app.post('/api/admin/web-stories/:id/regenerate',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);if(req.body?.confirmed!==true)throw fail('Confirme a substituição do rascunho. A versão pública permanece disponível.');
    const source=article(item.article_id);if(!source)throw fail('O artigo de origem precisa estar publicado.',409);
    const draft=await template(source);
    db.transaction(()=>{current(get(item.id),item.revision);if(!article(item.article_id)||hashArticle(article(item.article_id))!==hashArticle(source))throw fail('O artigo mudou durante a criação.',409);db.prepare('UPDATE editorial_web_stories SET draft_json=?,source_hash=?,revision=revision+1,previewed_revision=0,updated_at=? WHERE id=?').run(JSON.stringify(draft),hashArticle(source),new Date().toISOString(),item.id);event(req,{...item,revision:item.revision+1},'regenerated');})();
    res.json(dto(row(item.id)));
  }));
  app.post('/api/admin/web-stories/:id/preview',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);currentSource(item);
    const draft=await validateDraft(JSON.parse(item.draft_json),JSON.parse(item.draft_json));
    current(get(item.id),item.revision);currentSource(item);
    const html=renderWebStory(draft,{origin,slug:item.slug,preview:true});
    db.prepare('UPDATE editorial_web_stories SET previewed_revision=? WHERE id=?').run(item.revision,item.id);
    res.json({revision:item.revision,html,url:'/admin-web-stories/preview/'+item.id+'?revision='+item.revision});
  }));
  app.post('/api/admin/web-stories/:id/publish',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);currentSource(item);
    if(item.previewed_revision!==item.revision)throw fail('Abra a prévia da versão salva antes de publicar.',409);
    if(req.body?.reviewed!==true||req.body?.rightsConfirmed!==true)throw fail('Confirme a revisão da história completa e os direitos das imagens antes de publicar.');
    const draft=await validateDraft(JSON.parse(item.draft_json),JSON.parse(item.draft_json)),now=new Date().toISOString();
    db.transaction(()=>{current(get(item.id),item.revision);currentSource(item);const json=JSON.stringify(draft),modified=item.published_json===json?item.published_updated_at:now;db.prepare('UPDATE editorial_web_stories SET published_json=?,published_at=COALESCE(published_at,?),published_updated_at=?,published_revision=?,reviewed_by=? WHERE id=?').run(json,now,modified,item.revision,actor(req),item.id);event(req,item,'published');})();
    res.json(dto(row(item.id)));
  }));
  app.post('/api/admin/web-stories/:id/unpublish',requireAdmin,sameOriginOnly,route((req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);
    db.transaction(()=>{db.prepare('UPDATE editorial_web_stories SET published_json=NULL,published_at=NULL,published_updated_at=NULL,published_revision=NULL,revision=revision+1,previewed_revision=0 WHERE id=?').run(item.id);event(req,{...item,revision:item.revision+1},'unpublished');})();
    res.json(dto(row(item.id)));
  }));

  app.use('/story-assets',express.static(assets.outputDir,{maxAge:'30d',immutable:true,fallthrough:false,index:false,dotfiles:'deny'}));
  app.get('/stories',(_req,res)=>res.type('html').set('Cache-Control','public,max-age=60').send(renderStoryDirectory(published().map(visible),origin)));
  app.get('/stories/:slug',(req,res)=>{
    const item=published().find(story=>story.slug===req.params.slug);
    if(!item)return res.status(404).set('Cache-Control','no-store').type('text').send('Esta história não está disponível. Explore /stories.');
    res.locals.vcAmpStory=true;
    // The AMP document must remain embeddable by the official AMP/Google story viewer.
    res.removeHeader('X-Frame-Options');
    const policy=String(res.getHeader('Content-Security-Policy')||'').split(';').map(directive=>directive.trim())
      .filter(directive=>directive&&!/^frame-ancestors(?:\s|$)/i.test(directive)).join('; ');
    if(policy)res.set('Content-Security-Policy',policy);else res.removeHeader('Content-Security-Policy');
    return res.type('html').set('Cache-Control','public,max-age=60').send(renderWebStory(JSON.parse(item.published_json),{origin,slug:item.slug,publishedAt:item.published_at,modifiedAt:item.published_updated_at}));
  });
  app.get('/sitemap-stories.xml',(_req,res)=>res.type('application/xml').set('Cache-Control','public,max-age=60').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${published().map(item=>`<url><loc>${esc(origin+'/stories/'+item.slug)}</loc><lastmod>${esc(item.published_updated_at)}</lastmod></url>`).join('')}</urlset>`));
  app.get('/sitemap-index.xml',(_req,res)=>res.type('application/xml').set('Cache-Control','public,max-age=300').send(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${esc(origin)}/sitemap.xml</loc></sitemap><sitemap><loc>${esc(origin)}/sitemap-stories.xml</loc></sitemap></sitemapindex>`));
  return {sitemapPaths:()=>['/stories',...published().map(item=>'/stories/'+item.slug)]};
}
