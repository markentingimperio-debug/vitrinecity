import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceHash=a=>hash(JSON.stringify([a.title,a.summary,a.body,a.image_url,a.updated_at,...(a.commercial?[a.facts,a.sourcePath]:[])]));
const plain=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const brazilDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);

/** Only approved, still-current stories become internal posts. No external API calls. */
export function createEcosystemInternalSocial({db,siteUrl,sourceCatalog,getPolicy,moderationReason=()=>'',isPublisherAllowed=()=>false,now=()=>new Date()}) {
  const origin=new URL(siteUrl).origin;
  db.exec(`CREATE TABLE IF NOT EXISTS ecosystem_distribution_outbox(
    id TEXT PRIMARY KEY,source_key TEXT NOT NULL,source_hash TEXT NOT NULL,story_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'vitriny_social',publisher_user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','held','published')),reason TEXT NOT NULL DEFAULT '',
    publication_id TEXT,day TEXT NOT NULL,policy_revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(source_key,source_hash,channel,publisher_user_id));
    CREATE INDEX IF NOT EXISTS ecosystem_distribution_day ON ecosystem_distribution_outbox(day,status);`);
  function allowed(policy,isCurrent) {return !!policy?.enabled&&!policy.paused&&!!policy.internalSocialEnabled&&Number.isSafeInteger(policy.publisherUserId)&&policy.publisherUserId>0&&isPublisherAllowed(policy.publisherUserId)===true&&isCurrent()===true;}
  function prepare(story) {
    let draft;try{draft=JSON.parse(story.published_json);}catch{return {reason:'invalid_published_story'};}
    const source=sourceCatalog.get(story.article_id);
    if(!source)return {reason:'source_unavailable'};
    if(sourceHash(source)!==story.published_source_hash)return {reason:'source_changed'};
    if(draft.companionHash&&!db.prepare("SELECT 1 FROM editorial_articles WHERE id=? AND status='published'").get('story-companion:'+story.article_id))return {reason:'companion_unpublished'};
    if(!/^[a-z0-9][a-z0-9-]{0,199}$/.test(story.slug))return {reason:'invalid_story_destination'};
    const image=typeof draft.poster==='string'?draft.poster:draft.poster?.url;
    if(!/^\/story-assets\/[a-f0-9]{32}\.jpg$/.test(image||''))return {reason:'approved_poster_required'};
    const title=plain(draft.title||source.title),description=plain(draft.description||source.summary);
    const caption=title+(description?'\n\n'+description:'')+'\n\nVeja a história completa e os detalhes na VitrineCity.';
    if(!title||caption.length>500)return {reason:'caption_needs_review'};
    if(moderationReason(caption))return {reason:'caption_moderation'};
    const url=new URL('/stories/'+story.slug,origin);url.searchParams.set('utm_source','vitriny_social');url.searchParams.set('utm_medium','organic_social');url.searchParams.set('utm_campaign','historias_da_cidade');
    return {image,caption,url:url.pathname+url.search,category:source.commercial?'ofertas':'geral'};
  }
  function snapshot() {
    const day=brazilDay(new Date(now())),totals=db.prepare('SELECT status,COUNT(*) count FROM ecosystem_distribution_outbox GROUP BY status').all();
    const recent=db.prepare('SELECT id,source_key sourceKey,story_id storyId,status,reason,publication_id publicationId,updated_at updatedAt FROM ecosystem_distribution_outbox ORDER BY updated_at DESC,id DESC LIMIT 30').all();
    return {day,totals,recent};
  }
  async function run({isCurrent=()=>true}={}) {
    const policy=getPolicy();
    if(!allowed(policy,isCurrent))return {status:'paused',published:0,held:0,items:[]};
    const nowDate=new Date(now()),stamp=nowDate.toISOString(),day=brazilDay(nowDate);
    const dailyLimit=Math.max(1,Math.min(24,Number(policy.dailyLimit)||1));
    const current=()=>{const live=getPolicy();return live.revision===policy.revision&&live.publisherUserId===policy.publisherUserId&&allowed(live,isCurrent);};
    let published=0,held=0;const items=[];
    // Exclude confirmed publications before bounding discovery, so older stories
    // progress too. Unattempted items precede holds; retries never starve the queue.
    const stories=db.prepare(`SELECT s.id,s.article_id,s.slug,s.published_json,s.published_source_hash FROM editorial_web_stories s
      LEFT JOIN ecosystem_distribution_outbox o ON o.source_key=s.article_id AND o.source_hash=s.published_source_hash AND o.channel='vitriny_social' AND o.publisher_user_id=?
      WHERE s.published_json IS NOT NULL AND s.published_json!='' AND (o.status IS NULL OR o.status!='published')
      ORDER BY COALESCE(o.updated_at,''),s.published_at DESC,s.id DESC LIMIT 200`).all(policy.publisherUserId);
    for(const discovered of stories) {
      if(!current())break;
      const result=db.transaction(()=>{
        if(!current())return null;
        const story=db.prepare('SELECT id,article_id,slug,published_json,published_source_hash FROM editorial_web_stories WHERE id=?').get(discovered.id);
        if(!story?.published_json||story.published_json!==discovered.published_json||story.published_source_hash!==discovered.published_source_hash||story.article_id!==discovered.article_id||story.slug!==discovered.slug)return null;
        const sent=db.prepare("SELECT COUNT(*) n FROM ecosystem_distribution_outbox WHERE day=? AND status='published'").get(day).n;
        if(sent>=dailyLimit)return {limit:true};
        const id=hash([story.article_id,story.published_source_hash,'vitriny_social',policy.publisherUserId].join('|'));
        const existing=db.prepare('SELECT status FROM ecosystem_distribution_outbox WHERE id=?').get(id);
        if(existing?.status==='published')return null;
        const prepared=prepare(story);
        db.prepare(`INSERT OR IGNORE INTO ecosystem_distribution_outbox(id,source_key,source_hash,story_id,publisher_user_id,status,day,policy_revision,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?,?,?)`).run(id,story.article_id,story.published_source_hash||'',story.id,policy.publisherUserId,day,policy.revision,stamp,stamp);
        if(prepared.reason) {db.prepare("UPDATE ecosystem_distribution_outbox SET status='held',reason=?,updated_at=? WHERE id=?").run(prepared.reason,stamp,id);return {id,status:'held',reason:prepared.reason};}
        if(!current())return null;
        const postId=randomUUID();
        db.prepare(`INSERT INTO social_posts(id,user_id,video_uid,media_type,image_url,caption,category,cta_label,cta_url,status,moderation_status,moderated_by,moderated_at) VALUES (?,?,?,'image',?,?,?,?,?,'ready','approved',?,?)`).run(postId,policy.publisherUserId,'ecosystem:'+id,prepared.image,prepared.caption,prepared.category,'Ver história',prepared.url,policy.publisherUserId,stamp);
        db.prepare("UPDATE ecosystem_distribution_outbox SET status='published',reason='',publication_id=?,day=?,policy_revision=?,updated_at=? WHERE id=?").run(postId,day,policy.revision,stamp,id);
        return {id,status:'published',publicationId:postId,url:'/social?post='+encodeURIComponent(postId)};
      }).immediate();
      if(result?.limit)break;
      if(result){items.push(result);if(result.status==='published')published++;else held++;}
    }
    return {status:published?'published':held?'review':current()?'idle':'paused',published,held,items};
  }
  return {run,snapshot};
}
