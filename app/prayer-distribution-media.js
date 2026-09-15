import path from 'node:path';

const MAIN=new Set(['facebook','instagram','youtube','vitrine_social']);
const SHORT=new Set(['facebook-stories','instagram-stories','whatsapp']);
const legacyDays=new Set(['2026-09-12','2026-09-13']);
const fail=()=>{throw Object.assign(Error('prayer_distribution_source_invalid'),{code:'prayer_distribution_source_invalid'});};
export function prayerChannelFormat(channel){if(MAIN.has(channel))return 'tiktok';if(SHORT.has(channel))return 'short';fail();}

// Infer the format from both canonical source locations; do not add fields to old journal bindings.
export function prayerManifestFormat(manifest,day=String(manifest?.campaign||'').slice(7),dataDir){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||manifest?.campaign!=='oracao-'+day)fail();
  let url;try{url=new URL(manifest.publicVideoUrl);}catch{fail();}
  if(url.protocol!=='https:'||!['vitrinecity.com','www.vitrinecity.com'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash)fail();
  const format=['short','tiktok'].find(value=>url.pathname===`/prayer-media/${day}/${value}.mp4`);
  if(!format||!path.isAbsolute(manifest.videoPath||''))fail();
  const suffix=path.join('prayer-media',day,format,'video.mp4');
  if(dataDir?manifest.videoPath!==path.resolve(dataDir,suffix):!manifest.videoPath.endsWith(path.sep+suffix))fail();
  return format;
}

export function prayerDurationAllowed(manifest,duration,channel){
  if(!Number.isFinite(duration))return false;
  if(!MAIN.has(channel)&&!SHORT.has(channel))return false;
  let format;try{format=prayerManifestFormat(manifest);}catch{return false;}
  if(format==='short')return duration>=4&&duration<=60;
  if(!MAIN.has(channel))return false;
  return Math.abs(duration-65)<=0.15||(legacyDays.has(manifest.campaign.slice(7))&&Math.abs(duration-61)<=0.15);
}
