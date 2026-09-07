function tableExists(db,name){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));}
function columns(db,name){if(!tableExists(db,name))return new Set();return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row=>row.name));}
function has(cols,...names){return names.every(name=>cols.has(name));}
function scalar(db,sql){const row=db.prepare(sql).get();const value=Number(row?.value??0);return Number.isFinite(value)?value:0;}

export function createShadowObserver({db,neural,now=Date.now,intervalMs=60000,logger=console}={}){
  if(!db?.prepare||!neural?.signal)throw new TypeError('Shadow observer requer SQLite e Vitriny Neural.');
  const interval=Math.max(10000,Math.min(15*60*1000,Number(intervalMs)||60000));
  const probes=[];
  const add=(metric,sql)=>probes.push({metric,sql});

  const views=columns(db,'social_post_views');
  if(views.size)add('social.views.total','SELECT COUNT(*) value FROM social_post_views');
  const likes=columns(db,'social_likes');
  if(likes.size)add('social.likes.total','SELECT COUNT(*) value FROM social_likes');
  const comments=columns(db,'social_comments');
  if(comments.size)add('social.comments.total',has(comments,'status')?"SELECT COUNT(*) value FROM social_comments WHERE status='published'":'SELECT COUNT(*) value FROM social_comments');
  const shares=columns(db,'social_shares');
  if(shares.size)add('social.shares.total','SELECT COUNT(*) value FROM social_shares');
  const saves=columns(db,'social_saves');
  if(saves.size)add('social.saves.total','SELECT COUNT(*) value FROM social_saves');
  const reports=columns(db,'social_reports');
  if(reports.size)add('social.reports.total',has(reports,'status')?"SELECT COUNT(*) value FROM social_reports WHERE status='open'":'SELECT COUNT(*) value FROM social_reports');
  const engagement=columns(db,'social_engagement_events');
  if(has(engagement,'impressions'))add('social.impressions.total','SELECT COALESCE(SUM(impressions),0) value FROM social_engagement_events');
  if(has(engagement,'watch_ms'))add('social.watch_ms.total','SELECT COALESCE(SUM(watch_ms),0) value FROM social_engagement_events');
  if(has(engagement,'completions'))add('social.completions.total','SELECT COALESCE(SUM(completions),0) value FROM social_engagement_events');

  let previous=null,timer=null,lastSampleAt=null;
  function read(){const snapshot={};for(const probe of probes){try{snapshot[probe.metric]=scalar(db,probe.sql);}catch(error){logger?.warn?.('[vitriny-neural] shadow probe failed',probe.metric,String(error?.message||error));}}return snapshot;}
  function sample(){
    const at=new Date(Number(now())).toISOString(),current=read(),deltas={};
    if(previous){
      for(const [metric,value] of Object.entries(current)){
        const before=Number(previous[metric]??value),delta=Math.max(0,value-before);deltas[metric.replace('.total','.delta')]=delta;
        neural.signal({metric:metric.replace('.total','.delta'),dimension:'platform',value:delta,confidence:1,windowStart:lastSampleAt||at,windowEnd:at,metadata:{aggregate:true,privacy:'no_raw_personal_data'}});
      }
      const impressions=deltas['social.impressions.delta']||deltas['social.views.delta']||0;
      const watch=deltas['social.watch_ms.delta']||0,completions=deltas['social.completions.delta']||0;
      if(impressions>0){
        neural.signal({metric:'social.avg_watch_ms',dimension:'platform',value:watch/impressions,confidence:1,windowStart:lastSampleAt||at,windowEnd:at,metadata:{aggregate:true}});
        neural.signal({metric:'social.completion_rate',dimension:'platform',value:Math.max(0,Math.min(1,completions/impressions)),confidence:1,windowStart:lastSampleAt||at,windowEnd:at,metadata:{aggregate:true}});
      }
    }
    previous=current;lastSampleAt=at;return{at,probeCount:probes.length,current,deltas};
  }
  function start(){if(timer)return false;sample();timer=setInterval(()=>{try{sample();}catch(error){logger?.warn?.('[vitriny-neural] shadow sample failed',String(error?.message||error));}},interval);timer.unref?.();return true;}
  function stop(){if(!timer)return false;clearInterval(timer);timer=null;return true;}
  function status(){return{running:Boolean(timer),intervalMs:interval,probeCount:probes.length,lastSampleAt,metrics:probes.map(x=>x.metric)};}
  return{sample,start,stop,status};
}
