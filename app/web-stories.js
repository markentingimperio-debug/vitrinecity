import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import express from 'express';
import {createStoryAssets,normalizeStoryImagePath} from './web-story-assets.js';
import {renderWebStory,renderStoryDirectory,storyPageVisibleText,escapeStory as esc} from './web-story-render.js';
import {createWebStorySources} from './web-story-sources.js';
import {storySourceCta} from './web-story-cta.js';
import {storyEditorialPortal} from './web-story-categories.js';
import {createWebStoryPromotions} from './web-story-promotions.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hashArticle=a=>createHash('sha256').update(JSON.stringify([a.title,a.summary,a.body,a.image_url,a.updated_at,...(a.commercial?[a.facts,a.sourcePath]:[]),...(a.reuseBinding?[a.reuseBinding]:[])])).digest('hex');
const companionHash=a=>createHash('sha256').update(JSON.stringify([a.title,a.summary,a.body,a.image_url,a.sources_json])).digest('hex');
const text=(value,max,label,minimum=1)=>{
  if(typeof value!=='string'||value.trim().length<minimum||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw fail(`${label}: informe de ${minimum} a ${max} caracteres.`);
  return value.trim();
};
const button=(value,fallback,label)=>{const chosen=value??fallback;return chosen===false||chosen===''?'':text(chosen,30,label);};
const storyButtons=(source,previous={})=>({cta:button(previous.cta,storySourceCta(source),'Texto do botão'),homeCta:button(previous.homeCta,'','Convite final')});
const storySources=source=>Array.isArray(source.sources)?source.sources.slice(0,5).map(s=>({title:String(s.title||'Fonte').slice(0,120),url:String(s.url||''),...(s.checkedAt?{checkedAt:s.checkedAt}:{})})):[];
export function splitStoryText(body,max=130) {
  max=Math.min(max,Math.max(25,Math.ceil(String(body||'').trim().length/9)));
  const words=String(body||'').trim().split(/\s+/),pages=[];
  let current='';
  for(const word of words){if(word.length>max)throw fail('O artigo contém um trecho sem espaços longo demais. Revise o texto de origem.');if(current.length+word.length+1>max){pages.push(current);current='';}current+=(current?' ':'')+word;}
  if(current)pages.push(current);
  if(pages.length<9||pages.length>39)throw fail('Use conteúdo completo para pelo menos 10 páginas, contando a capa. Divida textos muito longos em guias completos antes de criar a história.');
  return pages;
}

export function setupWebStories({app,db,requireAdmin,sameOriginOnly,siteUrl,publicDir,dataDir,assets=createStoryAssets({publicDir,dataDir,siteUrl}),sourceCatalog=createWebStorySources({db}),generateStory=null,canRun=()=>true,automaticSourceAllowed=()=>true}) {
  const origin=new URL(siteUrl).origin,creating=new Set();
  const promotionCatalog=createWebStoryPromotions({sourceCatalog,assets,origin});
  const rendered=async(story,item,options={})=>renderWebStory(story,{origin,slug:item.slug,...options,promotions:await promotionCatalog.select(story,{slug:item.slug,sourceKey:item.article_id,fingerprint:options.preview?item.source_hash:item.published_source_hash})});
  db.exec(`CREATE TABLE IF NOT EXISTS editorial_web_stories(
    id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,article_id TEXT NOT NULL UNIQUE,
    source_hash TEXT NOT NULL,draft_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
    previewed_revision INTEGER NOT NULL DEFAULT 0,published_json TEXT,published_at TEXT,published_revision INTEGER,
    updated_at TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL DEFAULT '',reviewed_by TEXT NOT NULL DEFAULT '',published_updated_at TEXT);
    CREATE TABLE IF NOT EXISTS editorial_web_story_events(id INTEGER PRIMARY KEY,story_id TEXT NOT NULL,event TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_web_stories_published ON editorial_web_stories(published_at);`);
  if(!db.prepare('PRAGMA table_info(editorial_web_stories)').all().some(c=>c.name==='published_source_hash')) {
    db.exec('ALTER TABLE editorial_web_stories ADD COLUMN published_source_hash TEXT');
    db.exec('UPDATE editorial_web_stories SET published_source_hash=source_hash WHERE published_json IS NOT NULL');
  }
  const article=id=>sourceCatalog.get(id);
  const row=id=>db.prepare('SELECT * FROM editorial_web_stories WHERE id=?').get(id);
  const actor=req=>String(req.user?.id||req.user?.email||'admin').slice(0,160);
  const event=(req,item,kind)=>db.prepare('INSERT INTO editorial_web_story_events(story_id,event,revision,actor,created_at) VALUES(?,?,?,?,?)').run(item.id,kind,item.revision,actor(req),new Date().toISOString());
  const dto=item=>({...item,draft:JSON.parse(item.draft_json),draft_json:undefined,published_json:undefined,url:'/stories/'+item.slug,sourceAvailable:!!article(item.article_id)});
  const get=id=>{const item=row(id);if(!item)throw fail('História não encontrada.',404);return item;};
  const current=(item,revision)=>{if(!Number.isInteger(revision)||item.revision!==revision)throw fail('Esta história mudou em outra aba. Reabra antes de continuar.',409);};
  function currentSource(item){const source=article(item.article_id);if(!source)throw fail('O conteúdo de origem precisa estar publicado e disponível.',409);if(hashArticle(source)!==item.source_hash)throw fail('O conteúdo de origem mudou. Recrie o rascunho a partir da versão atual e revise novamente.',409);return source;}
  const route=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){res.status(error.status||400).json({error:error.status?error.message:'Não foi possível concluir. Confira as imagens locais e tente novamente.'});}};
  const imageCache=new Map();
  async function imageLibrary(query='',articleId='',page=1) {
    const preferred=article(articleId),rows=db.prepare("SELECT title,image_url,portal FROM editorial_articles WHERE status='published' ORDER BY published_at DESC LIMIT 300").all();
    const candidates=[...(preferred?[{url:preferred.image_url,title:preferred.title,category:'Deste artigo'}]:[]),...rows.map(a=>({url:a.image_url,title:a.title,category:a.portal.replace(/-/g,' ')})),...await assets.library()];
    const normalized=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),terms=normalized(query).split(/\s+/).filter(Boolean).slice(0,6),deduped=new Map();
    for(const candidate of candidates){try{const url=normalizeStoryImagePath(candidate.url,origin);if(!/^\/(assets|uploads\/(generated-videos|store-assets))\//.test(url))continue;const previous=deduped.get(url);if(previous){previous.search+=' '+candidate.title+' '+candidate.category;continue;}deduped.set(url,{...candidate,url,search:candidate.title+' '+candidate.category,generic:url==='/assets/vitriny-city-master.jpg'});}catch{}}
    const filtered=[...deduped.values()].filter(item=>terms.every(term=>normalized(item.search).includes(term))),pages=Math.max(1,Math.ceil(filtered.length/18)),currentPage=Math.max(1,Math.min(pages,page)),items=[];
    for(const candidate of filtered.slice((currentPage-1)*18,currentPage*18)) {
      try{let cached=imageCache.get(candidate.url);if(!cached||Date.now()-cached.at>120000){const asset=await assets.image(candidate.url);cached={at:Date.now(),width:asset.width,height:asset.height};if(imageCache.size>=500)imageCache.clear();imageCache.set(candidate.url,cached);}items.push({url:candidate.url,title:candidate.generic?'Capa genérica da cidade':candidate.title,alt:candidate.generic?'Vista da VitrineCity':candidate.title.slice(0,150),category:candidate.category,generic:candidate.generic,width:cached.width,height:cached.height});}catch{}
    }
    return {items,page:currentPage,pages};
  }
  async function template(source,previous={}) {
    if(source.body.trim().length<400)throw fail('O artigo deve conter pelo menos 400 caracteres de conteúdo completo.');
    const chunks=splitStoryText(source.body),image=await assets.image(source.image_url),logo=await assets.image('/assets/pwa-icon-192.png',{logo:true});
    const poster=await assets.poster(image),title=source.title.trim().slice(0,90),description=(source.summary||source.title).trim().slice(0,160);
    return {title,description,category:source.portal.replace(/-/g,' ').slice(0,26),logo:logo.url,poster,sourcePath:source.sourcePath||'/artigo/'+encodeURIComponent(source.slug),sourceKind:source.kind||'article',commercial:!!source.commercial,sources:storySources(source),...storyButtons(source,previous),...(source.reuseBinding?{reuseBinding:source.reuseBinding,reuseContentHash:source.facts?.reuseContentHash}:{}),pages:[description.slice(0,130),...chunks].map(content=>({text:content,image:image.url,width:image.width,height:image.height,alt:source.title.slice(0,150)}))};
  }
  async function validateDraft(input,original) {
    const draft={...original,title:text(input.title,90,'Título'),description:text(input.description,160,'Descrição',30),cta:button(input.cta,original.cta??storySourceCta(original),'Texto do botão'),homeCta:button(input.homeCta,original.homeCta??'','Convite final')};
    if(!Array.isArray(input.pages)||input.pages.length<10||input.pages.length>40)throw fail('A história deve ter entre 10 e 40 páginas, com conteúdo completo.');
    const unique=new Map();draft.pages=[];
    for(const p of input.pages){const copy=text(p.text,130,'Texto de cada página'),alt=text(p.alt,150,'Descrição da imagem');if(!unique.has(p.image))unique.set(p.image,await assets.image(p.image,{catalog:p.imageCredit==='Foto do catálogo'}));const asset=unique.get(p.image);draft.pages.push({text:copy,alt,image:asset.url,width:asset.width,height:asset.height,...(['Ilustração IA','Foto do catálogo','Imagem do artigo'].includes(p.imageCredit)?{imageCredit:p.imageCredit}:{}),...(p.layout==='editorial'?{layout:'editorial'}:{})});}
    if(draft.pages.slice(1).map(p=>p.text).join(' ').length<400)throw fail('Inclua o conteúdo completo da história: pelo menos 400 caracteres além da capa.');
    await assets.image(draft.logo,{logo:true});
    // A fresh, immutable portrait poster always represents the first page's actual image.
    draft.poster=await assets.poster(unique.get(draft.pages[0].image));
    return draft;
  }
  const isVisible=item=>{const source=article(item.article_id);if(!source||(source.commercial||source.reuseBinding)&&hashArticle(source)!==item.published_source_hash)return false;const snapshot=JSON.parse(item.published_json);return !snapshot.companionHash||!!db.prepare("SELECT 1 FROM editorial_articles WHERE id=? AND status='published'").get('story-companion:'+item.article_id);};
  const published=()=>db.prepare("SELECT * FROM editorial_web_stories WHERE published_json IS NOT NULL ORDER BY published_at DESC,id LIMIT 10000").all().filter(isVisible);
  const visible=item=>{const draft=JSON.parse(item.published_json);return {...draft,slug:item.slug,modifiedAt:item.published_updated_at};};

  // Automatic publication is explicitly configured by the administrator. Its
  // transaction cannot survive a pause, changed source or concurrent manual edit.
  // A curator may supply complete copy even when the public catalog blurb is
  // short. This path never calls AI, approves, previews or publishes anything.
  async function createManualDraft(input,{actor:author='editorial-maintenance',isCurrent=()=>true}={}) {
    if(isCurrent()!==true)throw fail('A preparação desta história foi pausada ou mudou.',409);
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Informe a fonte e o rascunho editorial.');
    const key=text(input.sourceKey??input.articleId,300,'Fonte');
    if(input.sourceKey!==undefined&&input.articleId!==undefined&&input.sourceKey!==input.articleId)throw fail('As referências da fonte precisam ser iguais.');
    const editor=text(author,160,'Responsável');
    if(!input.draft||typeof input.draft!=='object'||Array.isArray(input.draft))throw fail('Informe um rascunho editorial completo.');
    const ensureSpace=()=>{
      if(db.prepare('SELECT 1 FROM editorial_web_stories WHERE article_id=?').get(key))throw fail('Esta fonte já possui uma história. Abra a edição existente; ela foi preservada.',409);
      if(db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n>=10000)throw fail('O estúdio atingiu o limite de 10 mil histórias.',409);
    };
    ensureSpace();if(creating.size)throw fail('Aguarde a criação de rascunho em andamento.',409);
    const source=article(key);
    if(!source||source.kind==='trend'||source.researchOnly)throw fail('A fonte precisa estar publicada e disponível na plataforma.',409);
    const sourcePath=source.sourcePath||(typeof source.slug==='string'?'/artigo/'+encodeURIComponent(source.slug):'');
    if(!sourcePath.startsWith('/')||sourcePath.startsWith('//')||/[\\\u0000-\u0020]/.test(sourcePath)||/^\/(?:api|admin)(?:[\/-]|$)/.test(sourcePath))throw fail('A fonte não possui um destino público válido.');
    const fingerprint=hashArticle(source),sourceState=JSON.stringify([fingerprint,sourcePath,source.kind,source.portal,source.commercial,storySources(source)]);
    const unchanged=()=>{const fresh=article(key);return fresh&&!fresh.researchOnly&&JSON.stringify([hashArticle(fresh),fresh.sourcePath||(typeof fresh.slug==='string'?'/artigo/'+encodeURIComponent(fresh.slug):''),fresh.kind,fresh.portal,fresh.commercial,storySources(fresh)])===sourceState;};
    creating.add(key);
    try{
      const original={title:source.title,description:source.summary,category:String(source.portal||'VitrineCity').replace(/-/g,' ').slice(0,26),logo:'/assets/pwa-icon-192.png',sourcePath,sourceKind:source.kind||'article',commercial:!!source.commercial,sources:storySources(source),...storyButtons(source),affiliateDisclosure:source.kind==='affiliate'?'Link de afiliado: podemos receber comissão.':'',generation:'manual',editorialMethod:'manual_curation',aiGenerated:false,...(source.reuseBinding?{reuseBinding:source.reuseBinding,reuseContentHash:source.facts?.reuseContentHash}:{})};
      const draft=await validateDraft(input.draft,original);
      if(draft.pages.some((_,index)=>[...storyPageVisibleText(draft,index)].length>180))throw fail('Há texto demais em uma página. Ajuste o rascunho antes de salvar.');
      const now=new Date().toISOString(),item={id:randomUUID(),slug:(source.slug||'historia').slice(0,90)+'-'+createHash('sha256').update(key).digest('hex').slice(0,8),article_id:key,source_hash:fingerprint,draft_json:JSON.stringify(draft),created_at:now,updated_at:now,created_by:editor};
      db.transaction(()=>{
        ensureSpace();if(isCurrent()!==true||!unchanged())throw fail('A fonte mudou ou a preparação foi pausada. Revise antes de criar o rascunho.',409);
        db.prepare('INSERT INTO editorial_web_stories(id,slug,article_id,source_hash,draft_json,created_at,updated_at,created_by) VALUES(@id,@slug,@article_id,@source_hash,@draft_json,@created_at,@updated_at,@created_by)').run(item);
        db.prepare("INSERT INTO editorial_web_story_events(story_id,event,revision,actor,created_at) VALUES(?,'manual_draft_created',1,?,?)").run(item.id,editor,now);
      }).immediate();
      return dto(row(item.id));
    }finally{creating.delete(key);}
  }
  function canGenerateAutomatically(sourceKey) {
    const source=article(sourceKey);
    if(!source||automaticSourceAllowed(source)!==true)return false;
    const existing=db.prepare('SELECT id FROM editorial_web_stories WHERE article_id=?').get(sourceKey);
    if(!existing)return true;
    const last=db.prepare('SELECT event FROM editorial_web_story_events WHERE story_id=? ORDER BY id DESC LIMIT 1').get(existing.id)?.event;
    return ['published_automatic','generated_automatic'].includes(last);
  }
  async function generateAndPublish(source,{signal,isCurrent=()=>true}={}) {
    if(typeof generateStory!=='function')throw fail('A geração pela IA gestora ainda não está configurada.',503);
    const key=source.key||source.id,initial=article(key);
    if(!initial)throw fail('O conteúdo de origem não está mais disponível.',409);
    if(automaticSourceAllowed(initial)!==true)throw fail('Esta origem foi excluída da produção automática. Escolha um conteúdo editorial próprio.',409);
    const fingerprint=hashArticle(initial),existing=db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(key);
    if(existing){
      const last=db.prepare('SELECT event FROM editorial_web_story_events WHERE story_id=? ORDER BY id DESC LIMIT 1').get(existing.id)?.event;
      if(!['published_automatic','generated_automatic'].includes(last))return {storyId:existing.id,status:'review',summary:'Já existe uma edição manual desta história. Ela foi preservada.'};
      if(existing.published_json&&existing.published_source_hash===fingerprint)return {storyId:existing.id,status:'published',summary:'A história atual já está publicada.'};
    } else if(db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n>=10000)throw fail('O estúdio atingiu o limite de 10 mil histórias.',409);
    const eligible=()=>{const current=article(key);return canRun()&&!signal?.aborted&&isCurrent()&&current&&automaticSourceAllowed(current)===true&&hashArticle(current)===fingerprint;};
    if(!eligible())throw fail('Rodada pausada ou conteúdo atualizado.',409);
    const previous=existing?JSON.parse(existing.draft_json):{};
    const result=await generateStory(initial,{signal,isCurrent:eligible,buttons:storyButtons(initial,previous)});
    const publicationAllowed=()=>eligible()&&(typeof result?.publicationAllowed!=='function'||result.publicationAllowed()===true);
    if(!publicationAllowed())throw fail('Rodada pausada ou conteúdo atualizado. Nenhuma publicação foi feita.',409);
    if(!result?.draft)return {storyId:existing?.id||null,status:result?.failureStatus==='failed'?'failed':'review',summary:String(result?.notes||'Faltam informações verificadas para criar uma história completa.').slice(0,500),diagnostics:result?.diagnostics};
    const companionId=initial.kind==='trend'?'story-companion:'+key:null;
    const previousCompanion=companionId?db.prepare('SELECT * FROM editorial_articles WHERE id=?').get(companionId):null;
    const companionSlug=companionId?(previousCompanion?.slug||result.draft.title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)+'-'+createHash('sha256').update(key).digest('hex').slice(0,8)):null;
    const sourcePath=companionId?'/artigo/'+companionSlug:initial.sourcePath||'/artigo/'+encodeURIComponent(initial.slug);
    if(!sourcePath.startsWith('/')||sourcePath.startsWith('//')||/[\\\u0000-\u0020]/.test(sourcePath))throw fail('O destino da história não é uma página válida da plataforma.');
    const logo=await assets.image('/assets/pwa-icon-192.png',{logo:true});
    const original={title:initial.title,description:initial.summary,category:String(initial.portal||'VitrineCity').replace(/-/g,' ').slice(0,26),logo:logo.url,sourcePath,sourceKind:initial.kind||'article',commercial:!!initial.commercial,...storyButtons(initial,previous),generation:'gestora',affiliateDisclosure:initial.kind==='affiliate'?'Link de afiliado: podemos receber comissão.':'',sources:storySources(initial),...(initial.reuseBinding?{reuseBinding:initial.reuseBinding,reuseContentHash:initial.facts?.reuseContentHash}:{})};
    if(result.method==='local_editorial'){original.generation='editorial-local';original.aiGenerated=false;original.editorialMethod='source_preserved';}
    const draft=await validateDraft({...result.draft,...(Object.hasOwn(previous,'cta')?{cta:previous.cta}:{}),...(Object.hasOwn(previous,'homeCta')?{homeCta:previous.homeCta}:{})},original);
    const companion=companionId?{portal:storyEditorialPortal(initial),title:draft.title,summary:draft.description,body:text(result.draft.articleBody,3000,'Artigo relacionado',900),image_url:draft.pages[0].image,sources_json:JSON.stringify(draft.sources)}:null;
    if(companion){draft.companionHash=companionHash(companion);draft.companionPortal=companion.portal;}
    if(draft.pages.some((_,i)=>[...storyPageVisibleText(draft,i)].length>180))throw fail('A IA produziu texto demais em uma página. A história ficou sem publicação.');
    const approved=result.approved===true,now=new Date().toISOString(),req={user:{id:'web-story-automation'}};
    let saved;
    db.transaction(()=>{
      if(!publicationAllowed())throw fail('A automação foi pausada ou o conteúdo mudou antes da publicação.',409);
      const latest=db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(key);
      if(existing){const lastEvent=db.prepare('SELECT event FROM editorial_web_story_events WHERE story_id=? ORDER BY id DESC LIMIT 1').get(existing.id)?.event;if(!latest||latest.revision!==existing.revision||!['generated_automatic','published_automatic'].includes(lastEvent))throw fail('A história foi editada em outra sessão. A edição foi preservada.',409);}
      else if(latest)throw fail('Uma história foi criada em outra sessão. Ela foi preservada.',409);
      if(companion){
        const currentCompanion=db.prepare('SELECT * FROM editorial_articles WHERE id=?').get(companionId);
        const previousSnapshot=existing?.published_json?JSON.parse(existing.published_json):{},expected=previousSnapshot.companionHash;
        // Legacy snapshots have no portal proof: never silently recategorize an
        // existing article. New snapshots bind category changes as well as text.
        const expectedPortal=previousSnapshot.companionPortal||companion.portal;
        if(currentCompanion&&(!expected||companionHash(currentCompanion)!==expected||currentCompanion.portal!==expectedPortal||currentCompanion.status!=='published'))throw fail('O artigo relacionado recebeu uma edição manual. Ela foi preservada.',409);
        if(approved)db.prepare(`INSERT INTO editorial_articles(id,slug,portal,title,summary,body,image_url,sources_json,status,published_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'published',?,?) ON CONFLICT(id) DO UPDATE SET portal=excluded.portal,title=excluded.title,summary=excluded.summary,body=excluded.body,image_url=excluded.image_url,sources_json=excluded.sources_json,updated_at=excluded.updated_at`)
          .run(companionId,companionSlug,companion.portal,companion.title,companion.summary,companion.body,companion.image_url,companion.sources_json,now,now);
      }
      const id=existing?.id||randomUUID(),slug=existing?.slug||(initial.slug||'historia').slice(0,90)+'-'+createHash('sha256').update(key).digest('hex').slice(0,8),json=JSON.stringify(draft),revision=(existing?.revision||0)+1;
      if(existing)db.prepare('UPDATE editorial_web_stories SET source_hash=?,draft_json=?,revision=?,previewed_revision=0,updated_at=? WHERE id=?').run(fingerprint,json,revision,now,id);
      else db.prepare('INSERT INTO editorial_web_stories(id,slug,article_id,source_hash,draft_json,revision,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(id,slug,key,fingerprint,json,revision,now,now,'web-story-automation');
      event(req,{id,revision},'generated_automatic');
      if(approved){db.prepare('UPDATE editorial_web_stories SET published_json=?,published_at=COALESCE(published_at,?),published_updated_at=?,published_revision=?,reviewed_by=?,published_source_hash=? WHERE id=?').run(json,now,now,revision,result.method==='local_editorial'?'source-editorial-check':'gestora-editorial-check',fingerprint,id);event(req,{id,revision},'published_automatic');}
      saved={storyId:id,status:approved?'published':'review',summary:String(result.notes||(approved?'História criada e publicada.':'História criada para revisão.')).slice(0,500),diagnostics:result.diagnostics};
    }).immediate();
    return saved;
  }

  app.get(['/admin-web-stories','/admin-web-stories.html'],requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').sendFile(path.join(publicDir,'admin-web-stories.html')));
  app.get('/admin-web-stories/preview/:id',requireAdmin,route(async(req,res)=>{
    const item=get(req.params.id);current(item,Number(req.query.revision));currentSource(item);
    if(item.previewed_revision!==item.revision)throw fail('Abra a prévia pelo editor primeiro.',409);
    res.locals.vcAmpStory=true;
    const html=await rendered(JSON.parse(item.draft_json),item,{preview:true});current(get(item.id),item.revision);currentSource(item);
    res.set('X-Robots-Tag','noindex,nofollow').type('html').send(html);
  }));
  app.get('/api/admin/web-stories/sources',requireAdmin,route((req,res)=>{
    const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,80):'';
    const group=typeof req.query.group==='string'?req.query.group:'all',offset=Math.max(0,parseInt(req.query.offset,10)||0);
    const exact=req.query.sourceKey;if(exact!==undefined&&(typeof exact!=='string'||!exact||exact.length>300))throw fail('Fonte inválida.');
    const selected=exact!==undefined?[article(exact)].filter(Boolean):sourceCatalog.list({q,group,limit:50,offset});
    const items=selected.map(source=>({id:source.key||source.id,title:source.title,slug:source.slug,portal:source.portal,kind:source.kind,image_url:source.image_url,updated_at:source.updated_at,sourceUrl:source.sourcePath,story_id:db.prepare('SELECT id FROM editorial_web_stories WHERE article_id=?').get(source.key||source.id)?.id}));
    res.json({items,generator:'editorial-template',supportedSources:['article','product','service','course','affiliate','trend'],nextOffset:exact===undefined&&items.length===50?offset+50:null});
  }));
  app.get('/api/admin/web-stories/images',requireAdmin,route(async(req,res)=>res.json(await imageLibrary(typeof req.query.q==='string'?req.query.q.trim().slice(0,80):'',typeof req.query.articleId==='string'?req.query.articleId.slice(0,300):'',Math.max(1,parseInt(req.query.p,10)||1)))));
  app.get('/api/admin/web-stories',requireAdmin,route((_req,res)=>res.json({items:db.prepare('SELECT * FROM editorial_web_stories ORDER BY updated_at DESC LIMIT 200').all().map(dto)})));
  app.get('/api/admin/web-stories/:id',requireAdmin,route((req,res)=>res.json(dto(get(req.params.id)))));
  app.post('/api/admin/web-stories/manual-draft',requireAdmin,sameOriginOnly,route(async(req,res)=>res.status(201).json(await createManualDraft(req.body,{actor:actor(req)}))));
  app.post('/api/admin/web-stories',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const id=text(req.body?.articleId,300,'Artigo'),existing=db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(id);
    if(existing)return res.json(dto(existing));
    if(creating.size||db.prepare('SELECT COUNT(*) n FROM editorial_web_stories').get().n>=10000)throw fail('Aguarde a criação atual ou use uma das histórias existentes (limite de 10 mil).',409);
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
    const draft=await template(source,JSON.parse(item.draft_json));
    db.transaction(()=>{current(get(item.id),item.revision);if(!article(item.article_id)||hashArticle(article(item.article_id))!==hashArticle(source))throw fail('O artigo mudou durante a criação.',409);db.prepare('UPDATE editorial_web_stories SET draft_json=?,source_hash=?,revision=revision+1,previewed_revision=0,updated_at=? WHERE id=?').run(JSON.stringify(draft),hashArticle(source),new Date().toISOString(),item.id);event(req,{...item,revision:item.revision+1},'regenerated');})();
    res.json(dto(row(item.id)));
  }));
  app.post('/api/admin/web-stories/:id/preview',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);currentSource(item);
    const draft=await validateDraft(JSON.parse(item.draft_json),JSON.parse(item.draft_json));
    current(get(item.id),item.revision);currentSource(item);
    const html=await rendered(draft,item,{preview:true});current(get(item.id),item.revision);currentSource(item);
    db.prepare('UPDATE editorial_web_stories SET previewed_revision=? WHERE id=?').run(item.revision,item.id);
    res.json({revision:item.revision,html,url:'/admin-web-stories/preview/'+item.id+'?revision='+item.revision});
  }));
  app.post('/api/admin/web-stories/:id/publish',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    if(!canRun())throw fail('As publicações estão pausadas na Central do dia.',409);
    const item=get(req.params.id);current(item,req.body?.revision);currentSource(item);
    if(item.previewed_revision!==item.revision)throw fail('Abra a prévia da versão salva antes de publicar.',409);
    if(req.body?.reviewed!==true||req.body?.rightsConfirmed!==true)throw fail('Confirme a revisão da história completa e os direitos das imagens antes de publicar.');
    const draft=await validateDraft(JSON.parse(item.draft_json),JSON.parse(item.draft_json)),now=new Date().toISOString();
    db.transaction(()=>{if(!canRun())throw fail('As publicações estão pausadas na Central do dia.',409);current(get(item.id),item.revision);currentSource(item);const json=JSON.stringify(draft),modified=item.published_json===json?item.published_updated_at:now;db.prepare('UPDATE editorial_web_stories SET published_json=?,published_at=COALESCE(published_at,?),published_updated_at=?,published_revision=?,reviewed_by=?,published_source_hash=? WHERE id=?').run(json,now,modified,item.revision,actor(req),item.source_hash,item.id);event(req,item,'published');})();
    res.json(dto(row(item.id)));
  }));
  app.post('/api/admin/web-stories/:id/unpublish',requireAdmin,sameOriginOnly,route((req,res)=>{
    const item=get(req.params.id);current(item,req.body?.revision);
    db.transaction(()=>{db.prepare('UPDATE editorial_web_stories SET published_json=NULL,published_at=NULL,published_updated_at=NULL,published_revision=NULL,revision=revision+1,previewed_revision=0 WHERE id=?').run(item.id);event(req,{...item,revision:item.revision+1},'unpublished');})();
    res.json(dto(row(item.id)));
  }));

  app.use('/story-assets',express.static(assets.outputDir,{maxAge:'30d',immutable:true,fallthrough:false,index:false,dotfiles:'deny'}));
  app.get('/stories',(req,res)=>{const rows=published(),pages=Math.max(1,Math.ceil(rows.length/24)),page=Math.max(1,Math.min(pages,parseInt(req.query.page??req.query.p,10)||1));res.type('html').set('Cache-Control','public,max-age=60').send(renderStoryDirectory(rows.slice((page-1)*24,page*24).map(visible),origin,{page,pages}));});
  app.get('/stories/:slug/fontes',(req,res)=>{
    const item=db.prepare('SELECT * FROM editorial_web_stories WHERE slug=? AND published_json IS NOT NULL').get(req.params.slug);
    if(!item||!isVisible(item))return res.status(404).type('text').send('História não disponível.');
    const draft=JSON.parse(item.published_json),links=(draft.sources||[]).flatMap(source=>{
      try{const url=new URL(source.url,origin);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return [];return [{...source,url:url.href}];}catch{return [];}
    });
    res.type('html').set('Cache-Control','public,max-age=60').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fontes · ${esc(draft.title)} | VitrineCity</title><meta name="robots" content="noindex,follow"><link rel="stylesheet" href="/vitriny-web-stories.css"></head><body><header><a href="/">VITRINECITY</a><a href="/stories/${esc(item.slug)}">Voltar à história</a></header><main><h1>Conteúdo e fontes</h1><h2>${esc(draft.title)}</h2><p>A história apresenta uma síntese. Consulte os materiais de origem para conhecer o contexto.</p><ul>${links.map(source=>`<li><a href="${esc(source.url)}" rel="noopener noreferrer">${esc(source.title||'Fonte consultada')}</a>${source.checkedAt?` · Consultada em ${esc(new Date(source.checkedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}))}`:''}</li>`).join('')}</ul>${draft.affiliateDisclosure?`<p>${esc(draft.affiliateDisclosure)}</p>`:''}<p><a href="${esc(draft.sourcePath)}">Abrir a página na VitrineCity</a></p><p><a href="/">Explorar a VitrineCity →</a></p></main></body></html>`);
  });
  app.get('/stories/:slug',async(req,res)=>{
    const item=db.prepare('SELECT * FROM editorial_web_stories WHERE slug=? AND published_json IS NOT NULL').get(req.params.slug);
    if(!item||!isVisible(item))return res.status(404).set('Cache-Control','no-store').type('text').send('Esta história não está disponível. Explore /stories.');
    res.locals.vcAmpStory=true;
    // The AMP document must remain embeddable by the official AMP/Google story viewer.
    res.removeHeader('X-Frame-Options');
    const policy=String(res.getHeader('Content-Security-Policy')||'').split(';').map(directive=>directive.trim())
      .filter(directive=>directive&&!/^frame-ancestors(?:\s|$)/i.test(directive)).join('; ');
    if(policy)res.set('Content-Security-Policy',policy);else res.removeHeader('Content-Security-Policy');
    const html=await rendered(JSON.parse(item.published_json),item,{publishedAt:item.published_at,modifiedAt:item.published_updated_at});
    const fresh=db.prepare('SELECT * FROM editorial_web_stories WHERE id=? AND published_json IS NOT NULL').get(item.id);
    if(!fresh||!isVisible(fresh)||fresh.published_json!==item.published_json)return res.status(404).set('Cache-Control','no-store').type('text').send('Esta história foi atualizada. Abra novamente.');
    return res.type('html').set('Cache-Control','public,max-age=60').send(html);
  });
  app.get('/sitemap-stories.xml',(_req,res)=>res.type('application/xml').set('Cache-Control','public,max-age=60').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${published().map(item=>`<url><loc>${esc(origin+'/stories/'+item.slug)}</loc><lastmod>${esc(item.published_updated_at)}</lastmod></url>`).join('')}</urlset>`));
  app.get('/sitemap-index.xml',(_req,res)=>res.type('application/xml').set('Cache-Control','public,max-age=300').send(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${esc(origin)}/sitemap.xml</loc></sitemap><sitemap><loc>${esc(origin)}/sitemap-stories.xml</loc></sitemap></sitemapindex>`));
  function recoveryForSource(key){
    const source=article(key),item=db.prepare('SELECT * FROM editorial_web_stories WHERE article_id=?').get(key);
    const currentPublished=!!(source&&item?.published_json&&item.published_source_hash===hashArticle(source)&&isVisible(item));
    return {sourceKey:key,title:source?.title||null,sourceAvailable:!!source,storyId:item?.id||null,sourceUrl:source?.sourcePath||null,editorUrl:source?'/admin-web-stories.html?'+(item?'story='+encodeURIComponent(item.id):'source='+encodeURIComponent(key)):null,action:source?'open_editor':'source_unavailable',published:currentPublished,publishedUrl:currentPublished?'/stories/'+item.slug:null,publishedRevision:currentPublished?item.published_revision:null};
  }
  function publicationCounts(){
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}),today=day.format(new Date()),items=published();
    return {date:today,timeZone:'America/Sao_Paulo',total:items.length,today:items.filter(item=>day.format(new Date(item.published_at))===today).length};
  }
  return {sitemapPaths:()=>['/stories',...published().map(item=>'/stories/'+item.slug)],generateAndPublish,createManualDraft,canGenerateAutomatically,recoveryForSource,publicationCounts};
}
