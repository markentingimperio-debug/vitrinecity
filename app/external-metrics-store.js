import {safeYouTubeChannelId} from './external-social-metrics.js';

export const ACTIVE_EXTERNAL_METRICS_SQL="(provider<>'youtube' OR (channel_id<>'' AND channel_id=?))";
const PROVIDERS=new Set(['instagram','facebook','tiktok','youtube','google','kwai']);
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160);

/** Additive scoping only: existing rows stay unassigned until an official
 * collection confirms their owner. Manual imports cannot replace scoped data. */
export function createExternalMetricsStore({db,getYouTubeChannelId,categories=new Set(['geral'])}){
  for(const table of ['social_external_insights','social_external_sync_runs'])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name==='channel_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''`);
  if(!db.prepare('PRAGMA table_info(social_external_sync_runs)').all().some(x=>x.name==='channel_title'))db.exec("ALTER TABLE social_external_sync_runs ADD COLUMN channel_title TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS idx_external_insights_channel ON social_external_insights(provider,channel_id); CREATE INDEX IF NOT EXISTS idx_external_runs_channel ON social_external_sync_runs(provider,channel_id,id DESC)');
  const activeChannelId=()=>safeYouTubeChannelId(getYouTubeChannelId());
  const upsert=db.prepare(`INSERT INTO social_external_insights
    (provider,content_key,category,views,watch_ms,completions,likes,comments,shares,clicks,conversions,measured_at,channel_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,content_key) DO UPDATE SET
    category=excluded.category,views=excluded.views,watch_ms=excluded.watch_ms,completions=excluded.completions,
    likes=excluded.likes,comments=excluded.comments,shares=excluded.shares,clicks=excluded.clicks,
    conversions=excluded.conversions,measured_at=excluded.measured_at,channel_id=excluded.channel_id,updated_at=CURRENT_TIMESTAMP
    WHERE excluded.provider<>'youtube' OR social_external_insights.channel_id='' OR
      (excluded.channel_id<>'' AND excluded.channel_id=social_external_insights.channel_id)`);
  function persist(provider,items,{channelId=''}={}){
    if(!PROVIDERS.has(provider))throw Error('unsupported_metrics_provider');
    if(provider==='youtube'&&channelId&&!safeYouTubeChannelId(channelId))throw Error('youtube_invalid_channel');
    const scope=provider==='youtube'?channelId:'',number=value=>Math.max(0,Math.min(1e12,Math.round(Number(value)||0)));
    let imported=0;
    db.transaction(()=>{for(const item of items.slice(0,500)){
      const key=String(item?.contentKey||'').trim().slice(0,180);if(!key)continue;
      const category=categories.has(String(item?.category||''))?String(item.category):'geral';
      const measuredAt=/^\d{4}-\d{2}-\d{2}/.test(String(item?.measuredAt||''))?String(item.measuredAt).slice(0,30):new Date().toISOString();
      imported+=upsert.run(provider,key,category,number(item.views),number(item.watchMs),number(item.completions),number(item.likes),number(item.comments),number(item.shares),number(item.clicks),number(item.conversions),measuredAt,scope).changes;
    }}).immediate();
    return imported;
  }
  function youtubeScope(){
    const channelId=activeChannelId(),lastSync=channelId?db.prepare(`SELECT id,status,imported_count importedCount,started_at startedAt,finished_at finishedAt
      FROM social_external_sync_runs WHERE provider='youtube' AND channel_id=? ORDER BY id DESC LIMIT 1`).get(channelId):null;
    const title=channelId?db.prepare("SELECT channel_title FROM social_external_sync_runs WHERE provider='youtube' AND channel_id=? AND status='completed' ORDER BY id DESC LIMIT 1").get(channelId):null;
    const history=db.prepare(`SELECT COALESCE(SUM(channel_id=''),0) unscopedContents,
      COALESCE(SUM(channel_id<>'' AND channel_id<>?),0) otherChannelContents FROM social_external_insights WHERE provider='youtube'`).get(channelId);
    return {scoped:true,channelId:channelId||null,channelTitle:plain(title?.channel_title)||null,lastSync:lastSync||null,history};
  }
  return {persist,activeChannelId,youtubeScope};
}

/** One collection per captured channel. A config change during the requests
 * cannot import the previous channel as the newly selected account. */
export function createYouTubeMetricsSync({db,store,getConfig,fetchInsights}){
  let pending=null;
  return async function sync(triggerType='admin'){
    const config=getConfig(),channelId=safeYouTubeChannelId(config.channelId);
    if(!config.configured||!channelId)throw Error('youtube_not_configured');
    if(pending){if(pending.channelId!==channelId)throw Error('youtube_channel_sync_in_progress');return pending.promise;}
    const runId=db.prepare("INSERT INTO social_external_sync_runs(provider,trigger_type,status,channel_id) VALUES ('youtube',?,'running',?)").run(String(triggerType).slice(0,30),channelId).lastInsertRowid;
    const state={channelId,promise:null};pending=state;
    state.promise=Promise.resolve().then(async()=>{
      try{
        const result=await fetchInsights(config);
        if(result?.channelId!==channelId)throw Error('youtube_channel_mismatch');
        if(store.activeChannelId()!==channelId)throw Error('youtube_channel_changed');
        const imported=db.transaction(()=>{
          if(store.activeChannelId()!==channelId)throw Error('youtube_channel_changed');
          const count=store.persist('youtube',result.items,{channelId});
          db.prepare("UPDATE social_external_sync_runs SET status='completed',imported_count=?,channel_title=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").run(count,plain(result.channelTitle),runId);
          return count;
        }).immediate();
        return {ok:true,provider:'youtube',channelId,channelTitle:plain(result.channelTitle),imported,measuredAt:result.measuredAt};
      }catch(error){
        const code=/^youtube_[a-z0-9_]{1,65}$/.test(String(error?.message||''))?error.message:'youtube_sync_failed';
        db.prepare("UPDATE social_external_sync_runs SET status='failed',error_code=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").run(code,runId);
        throw Error(code);
      }finally{if(pending===state)pending=null;}
    });
    return state.promise;
  };
}
