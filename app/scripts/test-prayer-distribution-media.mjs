import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {prayerChannelFormat,prayerManifestFormat,prayerDurationAllowed} from '../prayer-distribution-media.js';
import {validateVideo} from '../prayer-meta-adapter.js';

const root=path.resolve('fixture-data');
const manifest=(day='2026-09-14',format='tiktok')=>({campaign:'oracao-'+day,videoPath:path.join(root,'prayer-media',day,format,'video.mp4'),publicVideoUrl:`https://vitrinecity.com/prayer-media/${day}/${format}.mp4`});
function mp4(){return Buffer.concat(['ftyp','moov','mdat'].map(atom=>{const b=Buffer.alloc(16);b.writeUInt32BE(16);b.write(atom,4);return b;}));}
const probe=duration=>({format:{duration},streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:720,height:1280,avg_frame_rate:'30/1'},{codec_type:'audio',codec_name:'aac',sample_rate:48000,channels:2}]});

test('new Reel, YouTube and Vitrine Social publications select master; Stories and WhatsApp select short',()=>{
 for(const channel of ['facebook','instagram','youtube','vitrine_social'])assert.equal(prayerChannelFormat(channel),'tiktok');
 for(const channel of ['facebook-stories','instagram-stories','whatsapp'])assert.equal(prayerChannelFormat(channel),'short');
 assert.throws(()=>prayerChannelFormat('unknown'));
});
test('format requires matching dated canonical local and public sources',()=>{
 const m=manifest();assert.equal(prayerManifestFormat(m,'2026-09-14',root),'tiktok');
 for(const bad of [{...m,campaign:'oracao-2026-09-15'},{...m,videoPath:path.join(root,'elsewhere','video.mp4')},{...m,publicVideoUrl:m.publicVideoUrl.replace('tiktok','short')},{...m,publicVideoUrl:m.publicVideoUrl+'?token=secret'},{...m,publicVideoUrl:m.publicVideoUrl.replace('vitrinecity.com','evil.test')}])assert.throws(()=>prayerManifestFormat(bad,'2026-09-14',root));
});
test('65s acceptance is an explicit dated prayer opt-in and does not widen the generic video validator',()=>{
 const m=manifest();assert.throws(()=>validateVideo(mp4(),probe(65)),/video_specs_invalid/);
 for(const channel of ['facebook','instagram','youtube','vitrine_social'])assert.equal(validateVideo(mp4(),probe(65),{channel,manifest:m}).durationSeconds,65);
 for(const channel of ['facebook-stories','instagram-stories','whatsapp'])assert.throws(()=>validateVideo(mp4(),probe(65),{channel,manifest:m}),/video_specs_invalid/);
 for(const duration of [60,61,66,90])assert.equal(prayerDurationAllowed(m,duration,'facebook'),false);
 assert.equal(prayerDurationAllowed(m,65.05,'facebook'),true);
 assert.equal(prayerDurationAllowed(m,65.2,'facebook'),false);
 assert.equal(prayerDurationAllowed({...m,videoPath:path.resolve('unrelated.mp4')},65,'facebook'),false);
 assert.equal(validateVideo(mp4(),probe(30)).durationSeconds,30);
});
test('unchanged 61s legacy masters are accepted only for the two ready editions; old short receipt remains valid',()=>{
 for(const day of ['2026-09-12','2026-09-13'])assert.equal(prayerDurationAllowed(manifest(day),61,'youtube'),true);
 assert.equal(prayerDurationAllowed(manifest('2026-09-14'),61,'youtube'),false);
 assert.equal(prayerDurationAllowed(manifest('2026-09-12','short'),30,'youtube'),true);
 assert.equal(prayerDurationAllowed(manifest('2026-09-12','short'),65,'youtube'),false);
});
