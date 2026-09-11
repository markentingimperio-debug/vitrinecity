import {validDay,prayerDayInBrazil,PRAYER_COLLECTION_START,PRAYER_PREVIEW_DAYS,shiftPrayerDay} from './prayer-daily.js';

const normalize = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const weekdays=['domingo','segunda','terca','quarta','quinta','sexta','sabado'];

export function selectPrayerVideos(rows,day){
  const weekday=weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return rows.filter(row=>{
    if(row.status!=='ready'||row.media_type!=='video'||! /^[a-f0-9]{32}$/i.test(row.video_uid||''))return false;
    const caption=normalize(row.caption);
    if(!/(?:\borac(?:ao|oes)\b|#oracaododia\b|#oracao\d{8}\b)/.test(caption))return false;
    const dates=[...caption.matchAll(/#oracao(\d{4})(\d{2})(\d{2})\b/g)].map(m=>`${m[1]}-${m[2]}-${m[3]}`);
    if(dates.length)return dates.includes(day);
    const tagged=weekdays.filter(name=>new RegExp(`(?:#oracao${name}\\b|\\boracao (?:de |da )?${name}\\b)`).test(caption));
    return !tagged.length||tagged.includes(weekday);
  }).sort((a,b)=>Number(normalize(b.caption).includes(`#oracao${day.replaceAll('-','')}`))-Number(normalize(a.caption).includes(`#oracao${day.replaceAll('-','')}`))||String(b.created_at).localeCompare(String(a.created_at))).slice(0,6).map(row=>({
    id:row.id,caption:row.caption,author:row.handle||row.name||'Vitriny Social',
    url:`/social?post=${encodeURIComponent(row.id)}`,
    playerUrl:`https://iframe.videodelivery.net/${row.video_uid}?controls=true`,
  }));
}

export function createPrayerVideoHandler({db,currentUser=()=>null,now=()=>new Date()}){
  return (req,res,next)=>{
    try{
      const today=prayerDayInBrazil(now()),day=req.query?.dia===undefined?today:req.query.dia;
      res.set('Cache-Control','no-store');
      if(!validDay(day)||day<PRAYER_COLLECTION_START||day>shiftPrayerDay(today,PRAYER_PREVIEW_DAYS))return res.status(400).json({error:'Data indisponível.'});
      const viewer=currentUser(req)?.id||0;
      const rows=db.prepare(`SELECT p.id,p.caption,p.status,p.media_type,p.video_uid,p.created_at,sp.handle,u.name
        FROM social_posts p JOIN users u ON u.id=p.user_id LEFT JOIN social_profiles sp ON sp.user_id=p.user_id
        WHERE p.status='ready' AND p.media_type='video'
          AND (lower(p.caption) LIKE '%oraç%' OR lower(p.caption) LIKE '%orac%' OR p.caption LIKE '%ORAÇ%')
          AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
          AND NOT EXISTS(SELECT 1 FROM social_mutes m WHERE m.user_id=? AND m.muted_id=p.user_id)
        ORDER BY p.created_at DESC`).all(viewer,viewer,viewer);
      return res.json({day,videos:selectPrayerVideos(rows,day)});
    }catch(error){return next(error);}
  };
}
