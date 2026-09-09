import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {rasterSize} from './web-story-assets.js';
import {publicCopyHasLinks,removePublicLinks} from './public/social-public-copy.js';

const API='/api/admin/facebook-photo-publications';
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceHash=a=>hash(JSON.stringify([a.title,a.summary,a.body,a.image_url,a.updated_at,...(a.commercial?[a.facts,a.sourcePath]:[])]));
const plain=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const fail=(code,status=409)=>Object.assign(new Error(code),{code,status,publicationSafe:true});
const SAFE_CODES=new Set(['meta_app_not_configured','invalid_page','page_not_authorized','page_token_unavailable','meta_publish_unknown','meta_inspection_unavailable','meta_token_expired','meta_permission_denied','meta_publish_rejected','page_token_identity_mismatch','page_credential_changed','publication_cancelled_before_send','receipt_incomplete','receipt_does_not_match','invalid_public_caption','invalid_approved_image']);
const safeCode=error=>SAFE_CODES.has(error?.code)?error.code:'publication_not_confirmed';

export function createApprovedFacebookPosterReader({dataDir}){
  return async image=>{
    if(!/^\/story-assets\/[a-f0-9]{32}\.jpg$/.test(image||''))throw fail('approved_poster_required',400);
    const directory=await fs.realpath(path.join(dataDir,'web-stories'));
    const file=await fs.realpath(path.join(directory,path.basename(image)));
    if(path.dirname(file)!==directory)throw fail('approved_poster_required',400);
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>8*1024*1024)throw fail('invalid_approved_image',400);
    const bytes=await fs.readFile(file),size=rasterSize(bytes);
    if(size.type!=='jpeg'||size.width<640||size.height<640||size.width*size.height>40000000)throw fail('invalid_approved_image',400);
    return {bytes,sha256:hash(bytes),width:size.width,height:size.height};
  };
}

/** Explicit admin publication only. No scheduled worker or automatic fan-out. */
export function registerFacebookPhotoPublisher({app,db,requireAdmin,sameOriginOnly,sourceCatalog,metaAdapter,readPoster,accountAllowed=()=>false,canRun=()=>false,moderationReason=()=>'',siteUrl,now=Date.now}){
  const securePublicSite=new URL(siteUrl).protocol==='https:';
  db.exec(`CREATE TABLE IF NOT EXISTS facebook_photo_publications(
    id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,
    page_id TEXT NOT NULL,account_id INTEGER NOT NULL,actor_id INTEGER NOT NULL,social_post_id TEXT NOT NULL,
    source_key TEXT NOT NULL,source_hash TEXT NOT NULL,content_hash TEXT NOT NULL,image_path TEXT NOT NULL,image_hash TEXT NOT NULL,
    caption TEXT NOT NULL,title TEXT NOT NULL,source_url TEXT NOT NULL,commercial INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('draft','submitting','confirming','published','failed','unknown','held')),
    readiness_json TEXT NOT NULL DEFAULT '{}',photo_id TEXT NOT NULL DEFAULT '',post_id TEXT NOT NULL DEFAULT '',publication_url TEXT NOT NULL DEFAULT '',
    error_code TEXT NOT NULL DEFAULT '',claim TEXT NOT NULL DEFAULT '',attempted_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS facebook_photo_bindings(
      page_id TEXT NOT NULL,source_key TEXT NOT NULL,source_hash TEXT NOT NULL,publication_id TEXT NOT NULL UNIQUE,
      PRIMARY KEY(page_id,source_key,source_hash));
    CREATE INDEX IF NOT EXISTS facebook_photo_status ON facebook_photo_publications(status,updated_at);`);
  const row=id=>db.prepare('SELECT * FROM facebook_photo_publications WHERE id=?').get(String(id));
  const account=id=>{const result=db.prepare("SELECT * FROM social_accounts WHERE id=? AND status='connected'").get(Number(id));if(!result||!/^[1-9]\d{0,39}$/.test(String(result.page_id))||accountAllowed(result)!==true)throw fail('page_not_authorized',403);return result;};
  function content(id){
    const post=db.prepare(`SELECT p.id,p.caption,p.image_url,p.status,p.moderation_status,o.source_key,o.source_hash,o.story_id,s.slug,s.published_json,s.published_source_hash
      FROM social_posts p JOIN ecosystem_distribution_outbox o ON o.publication_id=p.id AND o.status='published' AND o.channel='vitriny_social'
      JOIN editorial_web_stories s ON s.id=o.story_id WHERE p.id=? AND p.media_type='image'`).get(String(id));
    if(!post||post.status!=='ready'||post.moderation_status!=='approved'||!post.published_json||post.source_hash!==post.published_source_hash)throw fail('approved_content_unavailable');
    let draft;try{draft=JSON.parse(post.published_json);}catch{throw fail('approved_content_unavailable');}
    const source=sourceCatalog.get(post.source_key);
    if(!source||sourceHash(source)!==post.source_hash)throw fail('approved_source_changed');
    if(draft.companionHash&&!db.prepare("SELECT 1 FROM editorial_articles WHERE id=? AND status='published'").get('story-companion:'+post.source_key))throw fail('approved_content_unavailable');
    const image=typeof draft.poster==='string'?draft.poster:draft.poster?.url;
    if(image!==post.image_url||!/^\/story-assets\/[a-f0-9]{32}\.jpg$/.test(image||'')||!/^[a-z0-9][a-z0-9-]{0,199}$/.test(post.slug))throw fail('approved_poster_required');
    const title=plain(draft.title||source.title),suggested=removePublicLinks(plain(post.caption));
    return {...post,image,title,sourceUrl:'/stories/'+post.slug,commercial:!!source.commercial,
      suggestedCaption:(source.commercial?'Publicidade.\n\n':'')+suggested,
      contentHash:hash(JSON.stringify([post.id,post.source_key,post.source_hash,post.story_id,post.published_json,post.caption,post.image_url]))};
  }
  const readinessDto=value=>({ready:value?.ready===true,missing:Array.isArray(value?.missing)?value.missing.filter(x=>typeof x==='string'&&/^[a-z0-9_:]{1,100}$/.test(x)).slice(0,15):[],checkedAt:value?.checkedAt||null,note:value?.ready?'Identidade e permissões verificadas; a Meta confirma o resultado e a disponibilidade da publicação.':''});
  function dto(value){
    // Read-only status projection lets the panel reconcile a crashed attempt.
    if(['submitting','confirming'].includes(value.status)&&value.attempted_at<now()-120000)value={...value,status:'unknown',error_code:'stale_attempt_unknown'};
    let readiness;try{readiness=JSON.parse(value.readiness_json);}catch{readiness={};}
    return {id:value.id,previewHash:value.request_hash,status:value.status,accountId:value.account_id,pageId:value.page_id,
      pageName:plain(db.prepare('SELECT page_name FROM social_accounts WHERE id=?').get(value.account_id)?.page_name||value.page_id),socialPostId:value.social_post_id,
      source:{key:value.source_key,title:value.title,url:value.source_url,image:value.image_path,commercial:!!value.commercial},caption:value.caption,
      readiness:readinessDto(readiness),photoId:value.photo_id||null,postId:value.post_id||null,publicationUrl:value.publication_url||null,
      errorCode:value.error_code||null,createdAt:new Date(value.created_at).toISOString(),updatedAt:new Date(value.updated_at).toISOString()};
  }
  function recovery(){db.prepare("UPDATE facebook_photo_publications SET status='unknown',error_code='stale_attempt_unknown',updated_at=? WHERE status IN ('submitting','confirming') AND attempted_at<?").run(now(),now()-120000);}
  function current(job,claim){
    try{const latest=row(job.id),selected=account(job.account_id),fresh=content(job.social_post_id);return canRun()===true&&latest?.claim===claim&&latest.status==='submitting'&&selected.page_id===job.page_id&&fresh.contentHash===job.content_hash&&moderationReason(job.caption)==='';}catch{return false;}
  }
  function publicCaption(value,commercial){
    if(typeof value!=='string')throw fail('invalid_public_caption',400);
    const caption=value.normalize('NFKC').trim();
    if(caption.length<10||caption.length>1500||/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(caption)||publicCopyHasLinks(caption)||moderationReason(caption))throw fail('invalid_public_caption',400);
    if(commercial&&!/^Publicidade\b/i.test(caption))throw fail('commercial_disclosure_required',400);
    return caption;
  }
  function route(fn){return async(req,res)=>{res.set('Cache-Control','no-store');try{return await fn(req,res);}catch(error){return res.status(error.publicationSafe?error.status:503).json({error:error.publicationSafe?error.code:'publication_service_unavailable'});}};}
  app.get(API+'/catalog',requireAdmin,route(async(req,res)=>{
    const q=plain(req.query.q).toLocaleLowerCase('pt-BR').slice(0,160),items=[];
    const posts=db.prepare("SELECT publication_id FROM ecosystem_distribution_outbox WHERE status='published' AND channel='vitriny_social' ORDER BY updated_at DESC LIMIT 200").all();
    for(const post of posts){try{const value=content(post.publication_id);if(!q||(value.title+' '+value.caption).toLocaleLowerCase('pt-BR').includes(q))items.push({id:value.id,title:value.title,image:value.image,sourceUrl:value.sourceUrl,caption:value.suggestedCaption,commercial:value.commercial});}catch{/* Withdrawn/unapproved sources are not publishable. */}}
    const accounts=[],seen=new Set();for(const selected of db.prepare("SELECT * FROM social_accounts WHERE status='connected' ORDER BY updated_at DESC,id DESC").all())if(accountAllowed(selected)===true&&!seen.has(selected.page_id)&&/^[1-9]\d{0,39}$/.test(String(selected.page_id))){seen.add(selected.page_id);accounts.push({id:selected.id,pageId:selected.page_id,pageName:plain(selected.page_name)});}
    return res.json({items,accounts,paused:canRun()!==true,scope:'facebook_page_photo'});
  }));
  app.get(API,requireAdmin,route((_req,res)=>res.json({items:db.prepare('SELECT * FROM facebook_photo_publications ORDER BY created_at DESC,id DESC LIMIT 100').all().map(dto)})));
  app.post(API+'/preview',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const input=req.body||{},idempotencyKey=String(input.idempotencyKey||'');
    if(!/^[A-Za-z0-9._:-]{16,120}$/.test(idempotencyKey)||typeof input.socialPostId!=='string'||input.socialPostId.length>100||!Number.isSafeInteger(Number(input.accountId)))throw fail('invalid_preview',400);
    const source=content(input.socialPostId),selected=account(input.accountId),caption=publicCaption(input.caption??source.suggestedCaption,source.commercial);
    const asset=await readPoster(source.image),requestHash=hash(JSON.stringify([source.id,selected.id,selected.page_id,source.contentHash,asset.sha256,caption]));
    const existing=db.prepare('SELECT * FROM facebook_photo_publications WHERE idempotency_key=?').get(idempotencyKey);
    if(existing){
      if(existing.request_hash!==requestHash)throw fail('idempotency_conflict');
      if(existing.status==='draft'){
        const readiness=readinessDto(await metaAdapter.inspect({accountId:selected.id,pageId:selected.page_id}));
        if(content(source.id).contentHash!==source.contentHash||account(selected.id).page_id!==selected.page_id)throw fail('approved_source_changed');
        db.prepare("UPDATE facebook_photo_publications SET readiness_json=?,updated_at=? WHERE id=? AND status='draft'").run(JSON.stringify(readiness),now(),existing.id);
      }
      return res.json(dto(row(existing.id)));
    }
    const readiness=readinessDto(await metaAdapter.inspect({accountId:selected.id,pageId:selected.page_id}));
    // Recheck after asynchronous inspection; no draft based on withdrawn content.
    if(content(source.id).contentHash!==source.contentHash||account(selected.id).page_id!==selected.page_id)throw fail('approved_source_changed');
    const id=randomUUID(),stamp=now();
    db.prepare(`INSERT OR IGNORE INTO facebook_photo_publications(id,idempotency_key,request_hash,page_id,account_id,actor_id,social_post_id,source_key,source_hash,content_hash,image_path,image_hash,caption,title,source_url,commercial,status,readiness_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft',?,?,?)`).run(id,idempotencyKey,requestHash,String(selected.page_id),selected.id,Number(req.user.id),source.id,source.source_key,source.source_hash,source.contentHash,source.image,asset.sha256,caption,source.title,source.sourceUrl,source.commercial?1:0,JSON.stringify(readiness),stamp,stamp);
    const saved=db.prepare('SELECT * FROM facebook_photo_publications WHERE idempotency_key=?').get(idempotencyKey);
    if(saved.request_hash!==requestHash)throw fail('idempotency_conflict');return res.json(dto(saved));
  }));
  app.get(API+'/:id',requireAdmin,route((req,res)=>{const job=row(req.params.id);if(!job)throw fail('publication_not_found',404);return res.json(dto(job));}));
  app.post(API+'/:id/publish',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    recovery();const job=row(req.params.id);if(!job)throw fail('publication_not_found',404);
    if(req.body?.previewHash!==job.request_hash)throw fail('preview_confirmation_mismatch');
    if(job.status!=='draft')return res.status(['submitting','confirming'].includes(job.status)?202:200).json(dto(job));
    if(!securePublicSite)throw fail('public_site_https_required');
    if(canRun()!==true)throw fail('ecosystem_paused');
    const source=content(job.social_post_id),selected=account(job.account_id),asset=await readPoster(source.image);
    if(selected.page_id!==job.page_id||source.contentHash!==job.content_hash||asset.sha256!==job.image_hash)throw fail('approved_source_changed');
    publicCaption(job.caption,source.commercial);
    const checked=await metaAdapter.inspect({accountId:job.account_id,pageId:job.page_id}),readiness=readinessDto(checked);
    db.prepare('UPDATE facebook_photo_publications SET readiness_json=?,updated_at=? WHERE id=? AND status=\'draft\'').run(JSON.stringify(readiness),now(),job.id);
    if(!readiness.ready)return res.status(409).json(dto(row(job.id)));
    const claim=randomUUID();
    const claimed=db.transaction(()=>{
      if(row(job.id).status!=='draft')return false;
      if(canRun()!==true||content(job.social_post_id).contentHash!==job.content_hash||account(job.account_id).page_id!==job.page_id)throw fail('publication_changed_before_send');
      const previous=db.prepare('SELECT publication_id FROM facebook_photo_bindings WHERE page_id=? AND source_key=? AND source_hash=?').get(job.page_id,job.source_key,job.source_hash);
      if(previous&&previous.publication_id!==job.id)throw fail('content_already_attempted_on_page');
      db.prepare('INSERT OR IGNORE INTO facebook_photo_bindings(page_id,source_key,source_hash,publication_id) VALUES (?,?,?,?)').run(job.page_id,job.source_key,job.source_hash,job.id);
      return db.prepare("UPDATE facebook_photo_publications SET status='submitting',claim=?,attempted_at=?,updated_at=? WHERE id=? AND status='draft'").run(claim,now(),now(),job.id).changes===1;
    }).immediate();
    if(!claimed)return res.status(202).json(dto(row(job.id)));
    try{
      const receipt=await metaAdapter.send({accountId:job.account_id,pageId:job.page_id,credentialVersion:checked.credentialVersion,caption:job.caption,imageBytes:asset.bytes,imageSha256:asset.sha256,isCurrent:()=>current(job,claim)});
      const photoId=/^[1-9]\d{0,39}$/.test(String(receipt?.photoId||''))?String(receipt.photoId):'',postId=new RegExp('^'+job.page_id+'_[1-9][0-9]{0,39}$').test(String(receipt?.postId||''))?String(receipt.postId):'';
      db.prepare("UPDATE facebook_photo_publications SET status='confirming',photo_id=?,post_id=?,updated_at=? WHERE id=? AND claim=? AND status='submitting'").run(photoId,postId,now(),job.id,claim);
      if(!photoId||!postId)throw Object.assign(fail('receipt_incomplete'),{uncertain:true});
      const confirmed=await metaAdapter.confirm({accountId:job.account_id,pageId:job.page_id,photoId,postId,caption:job.caption});
      if(confirmed.published!==true)throw Object.assign(fail('publication_not_confirmed'),{uncertain:true});
      db.prepare("UPDATE facebook_photo_publications SET status='published',publication_url=?,error_code='',updated_at=? WHERE id=? AND claim=? AND status='confirming'").run(confirmed.url||'',now(),job.id,claim);
    }catch(error){
      const latest=row(job.id),notSent=error.notSubmitted===true&&latest.status==='submitting',definitive=error.definitive===true&&latest.status==='submitting',status=notSent?'held':definitive?'failed':'unknown';
      db.transaction(()=>{db.prepare("UPDATE facebook_photo_publications SET status=?,error_code=?,updated_at=? WHERE id=? AND claim=? AND status IN ('submitting','confirming')").run(status,safeCode(error),now(),job.id,claim);if(notSent||definitive)db.prepare('DELETE FROM facebook_photo_bindings WHERE publication_id=?').run(job.id);}).immediate();
    }
    return res.json(dto(row(job.id)));
  }));
  app.post(API+'/:id/reconcile',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    recovery();const job=row(req.params.id);if(!job)throw fail('publication_not_found',404);
    if(job.status==='published')return res.json(dto(job));
    if(job.status!=='unknown'||!job.photo_id||!job.post_id)throw fail('receipt_unavailable_for_reconciliation');
    account(job.account_id);
    try{const result=await metaAdapter.confirm({accountId:job.account_id,pageId:job.page_id,photoId:job.photo_id,postId:job.post_id,caption:job.caption});
      if(result.published===true)db.prepare("UPDATE facebook_photo_publications SET status='published',publication_url=?,error_code='',updated_at=? WHERE id=? AND status='unknown'").run(result.url||'',now(),job.id);
    }catch(error){db.prepare('UPDATE facebook_photo_publications SET error_code=?,updated_at=? WHERE id=?').run(safeCode(error),now(),job.id);}
    return res.json(dto(row(job.id)));
  }));
  return {api:API};
}
