import assert from 'node:assert/strict';
import test from 'node:test';
import {uniqueMusicQueue, loadMusicQueue, queueNeighbor, selectionHasEnded, youtubePlaybackError} from '../public/vitriny-music-queue.js';
import {controlledYoutubeUrl, createYouTubePlayer} from '../public/vitriny-youtube-player.js';
import {mountMediaPlayback} from '../public/vitriny-music-playback.js';
import {youtubeSource} from '../public/vitriny-music-core.js';

const song = (n, extra = {}) => ({slug:'song-'+n,title:'Seleção '+n,genre:'eletronica',genreLabel:'Eletrônica',kind:'video',url:'https://www.youtube.com/watch?v='+String(n).padStart(11,'0'),...extra});
const songs=[song(1),song(2),song(3)];
const list=song(9,{kind:'playlist',url:'https://www.youtube.com/playlist?list=PL1234567890abc'});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const waitEnd=()=>new Promise(resolve=>setTimeout(resolve,700));
const response=items=>({ok:true,json:async()=>({page:1,pages:1,items})});

function fixture({scope='music',fetchImpl=async()=>response(songs)}={}){
  const ids=Object.fromEntries(['musicQueueControls','continuousPlayback','previousSelection','nextSelection','queueStatus'].map(id=>[id,{hidden:true,checked:false,events:{},addEventListener(name,fn){this.events[name]=fn;}}]));
  const player={ownerDocument:{getElementById:id=>ids[id]}},status={textContent:''};
  let handlers,state=-1,current=null,playlist=[],playlistIndex=0,closes=0;
  const opened=[],selected=[];
  const instance={getPlayerState:()=>state,getPlaylist:()=>playlist,getPlaylistIndex:()=>playlistIndex,getVideoUrl:()=>current?.url};
  const mounted=mountMediaPlayback({scope,player,status,fetchImpl,onSelection:(item,options)=>selected.push({item,options}),createPlayer:(_element,options)=>{
    handlers=options;return {open(item,options){current=item;state=-1;opened.push({item,options});},close(){closes++;},getInstance:()=>instance};
  }});
  return {mounted,ids,status,opened,selected,get closes(){return closes;},event(value){state=value;handlers.onState(value,instance);},error:code=>handlers.onError(code),blocked:()=>handlers.onBlocked(),playlist:(items,index)=>{playlist=items;playlistIndex=index;},continuous(value){ids.continuousPlayback.checked=value;ids.continuousPlayback.events.change();}};
}

test('Queue keeps the selected genre, deduplicates source IDs and stops at a bounded size',()=>{
  const duplicate=song(1,{slug:'alias',kind:'live'}),other=song(4,{genre:'sertanejo'});
  const result=uniqueMusicQueue(songs[0],[duplicate,other,...Array.from({length:130},(_,i)=>song(i+2))]);
  assert.equal(result.length,96);assert.equal(result[0].slug,songs[0].slug);assert.ok(result.every(item=>item.genre==='eletronica'));
  assert.equal(queueNeighbor(result,result.at(-1),1),null);assert.equal(queueNeighbor(result,result[0],-1),null);
});

test('Queue reads at most four internal genre pages and ignores failed pages',async()=>{
  const urls=[];
  const result=await loadMusicQueue(songs[0],{fetchImpl:async url=>{urls.push(url);const page=Number(new URL(url,'https://vitrinecity.com').searchParams.get('p'));return {ok:page!==3,json:async()=>({page,pages:500,items:Array.from({length:24},(_,i)=>song(page*100+i))})};}});
  assert.equal(urls.length,4);assert.ok(urls.every(url=>url.startsWith('/api/media/music?genero=eletronica&')));assert.equal(result.length,73);
});

test('Only the last confirmed playlist track ends a selection; active lives do not',()=>{
  assert.equal(selectionHasEnded(list,{state:0,playlist:['a','b'],playlistIndex:0}),false);
  assert.equal(selectionHasEnded(list,{state:0,playlist:['a','b'],playlistIndex:1}),true);
  assert.equal(selectionHasEnded(list,{state:0,playlist:[],playlistIndex:0}),false);
  assert.equal(selectionHasEnded(song(1,{kind:'live'}),{state:1}),false);
  assert.equal(selectionHasEnded(song(1,{kind:'live'}),{state:0}),true);
});

test('Player URL keeps privacy embed, visible controls, no initial autoplay and explicit origin',()=>{
  const url=new URL(controlledYoutubeUrl(youtubeSource(list.url,list.kind),'https://vitrinecity.com'));
  assert.equal(url.hostname,'www.youtube-nocookie.com');assert.equal(url.searchParams.get('origin'),'https://vitrinecity.com');
  for(const [key,value]of Object.entries({autoplay:'0',enablejsapi:'1',playsinline:'1',controls:'1',loop:'0'}))assert.equal(url.searchParams.get(key),value);
});

test('The first selection is manual, and continuous playback requires an explicit toggle',async()=>{
  const f=fixture();f.mounted.open(songs[0]);await tick();assert.equal(f.opened[0].options.autoplay,false);assert.equal(f.ids.continuousPlayback.checked,false);
  f.event(1);f.event(0);await waitEnd();assert.equal(f.opened.length,1);f.mounted.close();
});

test('Explicit continuous mode advances once and waits for the new source to actually play',async()=>{
  const f=fixture();f.mounted.open(songs[0]);await tick();f.continuous(true);f.event(1);f.event(0);await waitEnd();
  assert.equal(f.opened.length,2);assert.equal(f.opened[1].item.slug,songs[1].slug);assert.equal(f.opened[1].options.autoplay,true);
  f.event(0);await waitEnd();assert.equal(f.opened.length,2);f.mounted.close();
});

test('Intermediate playlist endings stay in YouTube; only the final track advances the city queue',async()=>{
  const f=fixture({fetchImpl:async()=>response([list,...songs])});f.mounted.open(list);await tick();f.continuous(true);
  f.playlist(['a','b'],0);f.event(1);f.event(0);await waitEnd();assert.equal(f.opened.length,1);
  f.playlist(['a','b'],1);f.event(1);f.event(0);await waitEnd();assert.equal(f.opened.length,2);f.mounted.close();
});

test('Errors and blocked autoplay never trigger automatic retry loops',async()=>{
  const f=fixture();f.mounted.open(songs[0]);await tick();f.continuous(true);f.event(1);f.error(150);f.event(0);await waitEnd();
  assert.equal(f.opened.length,1);assert.match(f.status.textContent,/não permite/);
  f.ids.nextSelection.events.click();assert.equal(f.opened.length,2);f.blocked();f.event(0);await waitEnd();assert.equal(f.opened.length,2);assert.match(f.status.textContent,/toque/);f.mounted.close();
});

test('Turning the toggle off or closing cancels a pending automatic transition',async()=>{
  const f=fixture();f.mounted.open(songs[0]);await tick();f.continuous(true);f.event(1);f.event(0);f.continuous(false);await waitEnd();assert.equal(f.opened.length,1);
  f.continuous(true);f.event(0);f.mounted.close();await waitEnd();assert.equal(f.opened.length,1);assert.equal(f.ids.musicQueueControls.hidden,true);assert.equal(f.closes,1);
});

test('Cinema remains manual, with no music queue requests or automatic selection',async()=>{
  let requests=0;const f=fixture({scope:'cinema',fetchImpl:async()=>{requests++;return response(songs);}});
  f.mounted.open(songs[0]);f.continuous(true);f.event(1);f.event(0);await waitEnd();assert.equal(requests,0);assert.equal(f.opened.length,1);assert.equal(f.opened[0].options.autoplay,false);f.mounted.close();
});

test('Closing while a genre queue is loading aborts it and late data cannot resume playback',async()=>{
  let resolve,signal;const f=fixture({fetchImpl:(_url,options)=>{signal=options.signal;return new Promise(done=>resolve=done);}});
  f.mounted.open(songs[0]);f.mounted.close();assert.equal(signal.aborted,true);resolve(response(songs));await tick();assert.equal(f.ids.musicQueueControls.hidden,true);assert.equal(f.opened.length,1);
});

test('Closing an iframe before the official API arrives never creates an orphan player',async()=>{
  let resolve,created=0,loads=0;
  const document={createElement:()=>({isConnected:true,remove(){this.isConnected=false;}})},container={ownerDocument:document,replaceChildren(){}};
  const control=createYouTubePlayer(container,{origin:'https://vitrinecity.com',apiLoader:()=>{loads++;return new Promise(done=>resolve=done);}});
  assert.equal(loads,0);const opening=control.open(songs[0]);assert.equal(loads,1);control.close();resolve({Player:class{constructor(){created++;}}});await opening;assert.equal(created,0);
});

test('Official error codes explain availability and browser identity without bypassing restrictions',()=>{
  assert.match(youtubePlaybackError(153),/identificar/);assert.match(youtubePlaybackError(100),/privado/);assert.match(youtubePlaybackError(101),/não permite/);assert.match(youtubePlaybackError(5),/Não foi possível/);
});

test('Only a confirmed video player is reused; playlist transitions isolate events and preserve observed audio',async()=>{
  let instance,created=0,destroyed=0;const calls=[];
  const document={createElement:()=>({isConnected:true,remove(){this.isConnected=false;}})},container={ownerDocument:document,replaceChildren(){}};
  class Player {
    constructor(frame,{events}){created++;instance=this;this.events=events;this.url=frame.src;this.volume=100;this.muted=false;}
    playVideo(){calls.push('play');} cueVideoById(data){this.url='https://www.youtube.com/watch?v='+data.videoId;calls.push(['cueVideo',data]);} loadVideoById(data){this.url='https://www.youtube.com/watch?v='+data.videoId;calls.push(['loadVideo',data]);}
    getVideoUrl(){return this.url;} getVolume(){return this.volume;} isMuted(){return this.muted;}
    setVolume(value){this.volume=value;} mute(){this.muted=true;} unMute(){this.muted=false;} destroy(){destroyed++;}
  }
  const control=createYouTubePlayer(container,{origin:'https://vitrinecity.com',apiLoader:async()=>({Player})});
  await control.open(songs[0]);instance.events.onReady({target:instance});assert.deepEqual(calls,[]);
  await control.open(songs[1],{autoplay:true});assert.equal(calls[0][0],'loadVideo');
  await control.open(songs[2]);assert.equal(calls[1][0],'cueVideo');assert.equal(created,1);
  instance.volume=42;instance.muted=true;
  await control.open(list);instance.events.onReady({target:instance});assert.equal(created,2);assert.equal(destroyed,1);
  assert.equal(instance.volume,42);assert.equal(instance.muted,true);assert.equal(calls.length,2,'Manual playlist selection remains paused');
  instance.volume=0;instance.muted=false;
  await control.open(list,{autoplay:true});instance.events.onReady({target:instance});assert.equal(created,3);assert.equal(calls.at(-1),'play');
  assert.equal(instance.volume,0);assert.equal(instance.muted,false,'An observed unmuted setting is preserved without inventing volume');
  await control.open(songs[0]);instance.events.onReady({target:instance});assert.equal(created,4,'Leaving a playlist also gets a fresh instance');
  instance.url='https://www.youtube.com/watch?v=unexpected1';
  await control.open(songs[1]);instance.events.onReady({target:instance});assert.equal(created,5,'An unconfirmed native video cannot be reused');
  control.close();assert.equal(destroyed,5);assert.equal(control.getInstance(),null);
});

test('Late events from an old playlist cannot skip the new selection or undo pause, error, off or close',async()=>{
  const second={...list,slug:'playlist-b',title:'Playlist B',url:'https://www.youtube.com/playlist?list=PL1234567890bbb'};
  const ids=Object.fromEntries(['musicQueueControls','continuousPlayback','previousSelection','nextSelection','queueStatus'].map(id=>[id,{checked:false,events:{},addEventListener(name,fn){this.events[name]=fn;}}]));
  const document={getElementById:id=>ids[id],createElement:()=>({isConnected:true,remove(){this.isConnected=false;}})};
  const player={ownerDocument:document,replaceChildren(){}},status={textContent:''},instances=[],selections=[];
  class Player {
    constructor(frame,{events}){this.events=events;this.url=frame.src;this.state=-1;instances.push(this);}
    ready(){this.events.onReady({target:this});}
    emit(state){this.state=state;this.events.onStateChange({data:state,target:this});}
    getVideoUrl(){return this.url;} getPlayerState(){return this.state;} getPlaylist(){return ['finalTrack1'];} getPlaylistIndex(){return 0;}
    destroy(){this.destroyed=true;} playVideo(){this.autoplay=true;}
    // Retain the old native state while a hypothetical cue command is pending.
    cuePlaylist(){} loadPlaylist(){}
  }
  const mounted=mountMediaPlayback({player,status,onSelection:item=>selections.push(item.slug),fetchImpl:async()=>response([list,second]),createPlayer:(element,options)=>createYouTubePlayer(element,{...options,origin:'https://vitrinecity.com',apiLoader:async()=>({Player})})});
  mounted.open(list);await tick();const old=instances[0];old.ready();ids.continuousPlayback.checked=true;ids.continuousPlayback.events.change();old.emit(1);
  mounted.open(second);await tick();const current=instances.at(-1);current.ready();
  old.ready();old.emit(1);old.emit(0);
  await waitEnd();assert.deepEqual(selections,[list.slug,second.slug]);assert.equal(instances.length,2);assert.equal(old.destroyed,true);
  old.events.onError({data:150,target:old});old.events.onAutoplayBlocked({target:old});
  assert.equal(current.autoplay,undefined,'Old READY cannot autoplay the manually selected playlist');assert.doesNotMatch(status.textContent,/não permite|pediu um toque/);
  current.emit(1);current.emit(0);current.emit(2);await waitEnd();assert.equal(selections.length,2,'Pause cancels a pending final-track transition');
  current.emit(1);current.emit(0);current.events.onError({data:150,target:current});await waitEnd();assert.equal(selections.length,2,'Error cancels a pending transition');
  current.emit(1);current.emit(0);ids.continuousPlayback.checked=false;ids.continuousPlayback.events.change();await waitEnd();assert.equal(selections.length,2,'Off cancels a pending transition');
  ids.continuousPlayback.checked=true;ids.continuousPlayback.events.change();current.emit(1);current.emit(0);mounted.close();current.ready();current.emit(1);current.emit(0);await waitEnd();
  assert.equal(selections.length,2);assert.equal(ids.musicQueueControls.hidden,true);assert.equal(current.destroyed,true);
});
