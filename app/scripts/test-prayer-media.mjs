import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPrayerVideos,createPrayerVideoHandler} from '../prayer-videos.js';
import {validPrayerPlayer,installPrayerAudio} from '../public/oracao-do-dia-media.js';
const base={id:'public',status:'ready',media_type:'video',video_uid:'a'.repeat(32),caption:'Uma oração por paz. #Oração',created_at:'2026-09-10'};

test('social selection excludes drafts, removed and unrelated media and honors date/weekday tags',()=>{
 const rows=[base,{...base,id:'draft',status:'pending_review'},{...base,id:'removed',status:'removed'},{...base,id:'image',media_type:'image'},{...base,id:'bad',video_uid:'javascript:bad'},{...base,id:'product',caption:'Melhore a decoração'},{...base,id:'friday',caption:'Oração de sexta-feira'},{...base,id:'saturday',caption:'Oração de sábado'},{...base,id:'dated',caption:'#oracao20260912'},{...base,id:'other-date',caption:'#oracao20260913'}];
 assert.deepEqual(selectPrayerVideos(rows,'2026-09-12').map(v=>v.id),['dated','public','saturday']);
 assert.deepEqual(selectPrayerVideos(rows,'2026-09-11').map(v=>v.id),['public','friday']);
 assert.match(selectPrayerVideos(rows,'2026-09-12')[0].playerUrl,/autoplay=false&muted=false&controls=true/);
});

test('video URLs only permit the expected Stream player',()=>{
 assert.ok(validPrayerPlayer('https://iframe.videodelivery.net/'+'b'.repeat(32)));
 for(const value of ['javascript:alert(1)','https://iframe.videodelivery.net.evil.test/'+'b'.repeat(32),'https://user@iframe.videodelivery.net/'+'b'.repeat(32),'http://iframe.videodelivery.net/'+'b'.repeat(32)])assert.equal(validPrayerPlayer(value),null);
});

test('endpoint rejects invalid dates before reading posts and passes viewer restrictions',()=>{
 let args;const db={prepare(sql){assert.match(sql,/p.status='ready'/);assert.match(sql,/social_blocks/);assert.match(sql,/social_mutes/);return {all(...values){args=values;return [base];}};}};
 const handler=createPrayerVideoHandler({db,currentUser:()=>({id:7}),now:()=>new Date('2026-09-11T12:00:00Z')});
 const result={};const res={set(){return this;},status(n){result.status=n;return this;},json(data){result.body=data;return this;}};
 handler({query:{dia:'2026-02-30'}},res,error=>{throw error;});assert.equal(result.status,400);assert.equal(args,undefined);
 handler({query:{dia:'2026-09-12'}},res,error=>{throw error;});assert.deepEqual(args,[7,7,7]);assert.equal(result.body.videos.length,1);
});

test('audio only starts on a user action, supports pause/stop, and cancels on navigation',()=>{
 const nodes=new Map(['listenPrayer','pausePrayer','stopPrayer','audioStatus','prayerTitle'].map(id=>[id,{textContent:id==='prayerTitle'?'Paz':'',hidden:true,events:{},addEventListener(name,fn){this.events[name]=fn;}}]));
 const document={getElementById:id=>nodes.get(id),querySelectorAll:()=>[{textContent:'Senhor, recebe este dia. Amém.'}]};
 const spoken=[],calls=[],events={};
 const window={SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{cancel(){calls.push('cancel');},speak(u){spoken.push(u);},pause(){calls.push('pause');},resume(){calls.push('resume');},getVoices(){return [{lang:'pt-BR'}];}},addEventListener(name,fn){events[name]=fn;}};
 installPrayerAudio({document,window});assert.equal(spoken.length,0);assert.equal(nodes.get('listenPrayer').hidden,false);
 nodes.get('listenPrayer').events.click();assert.equal(spoken.length,1);assert.equal(spoken[0].lang,'pt-BR');
 nodes.get('pausePrayer').events.click();assert.ok(calls.includes('pause'));nodes.get('pausePrayer').events.click();assert.ok(calls.includes('resume'));
 nodes.get('stopPrayer').events.click();const count=spoken.length;spoken[0].onend();assert.equal(spoken.length,count);
 events.pagehide();assert.equal(calls.at(-1),'cancel');
});
