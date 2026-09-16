import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const LIVE_LIA_PORTRAIT='/assets/lia/lia-abacus-v1-original.png';
export const LIVE_LIA_PORTRAIT_SHA256='6c4fa137cef11bdb1ad9a5e0602fa92d1a3935d75bcecc22d8902a210c747aa2';
export const LIVE_LIA_MEDIA_VERSION='lia-portrait-narration-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/,ORIGIN='https://vitrinecity.com',MAX_AUDIO=25*1024*1024,MAX_VIDEO=30*1024*1024;
const AFFILIATE_NOTICE='Link de afiliado · podemos receber comissão';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,status=409)=>Object.assign(Error(code),{code,status});
const assert=(condition,code,status)=>{if(!condition)throw fail(code,status);};
const exists=file=>fs.existsSync(file);
const checkedText=(value,max)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&!/[<>\x00-\x08\x0b-\x1f\x7f]/.test(value);
const realExecute=promisify(execFile);
const synchronize=folder=>{try{const fd=fs.openSync(folder,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch{/* Windows cannot fsync a directory; files are always fsynced. */}};
function exclusive(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}synchronize(path.dirname(file));}
const writeJson=(file,value)=>exclusive(file,JSON.stringify(value,null,2)+'\n');
function readFile(file,max){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=max,'live_lia_file_invalid');return fs.readFileSync(file);}
const readJson=file=>{try{return JSON.parse(readFile(file,64*1024).toString('utf8'));}catch{throw fail('live_lia_receipt_invalid');}};
function directory(base,child){const target=path.join(base,child);fs.mkdirSync(target,{recursive:true,mode:0o700});assert(fs.realpathSync(target)===target,'live_lia_path_invalid');return target;}
function workerReadable(file){
  // The existing OBS worker runs as uid/gid 10001. Only final deliverables and
  // their parent are shared; private speech/intent files remain mode 0600/0700.
  if(process.getuid?.()===0){fs.chownSync(file,10001,10001);fs.chmodSync(file,fs.statSync(file).isDirectory()?0o750:0o640);}
}
function offerValue(offer){
  if(offer===null||offer===undefined)return null;
  assert(offer&&typeof offer==='object'&&!Array.isArray(offer)&&checkedText(offer.id,160)&&checkedText(offer.title,160)&&typeof offer.url==='string'&&offer.url.length<=220,'live_lia_offer_invalid',400);
  let url;try{url=new URL(offer.url,ORIGIN);}catch{throw fail('live_lia_offer_invalid',400);}
  assert(url.origin===ORIGIN&&!url.username&&!url.password&&!url.hash&&!/[\\%\s]/.test(offer.url),'live_lia_offer_invalid',400);
  const ordinary=/^\/(?:produto\/\d+\/[a-z0-9-]+|ofertas\/[a-z0-9-]+|cursos\/[a-z0-9-]+|loja\/[a-zA-Z0-9_-]+\/[a-z0-9-]+)$/.test(url.pathname)&&!url.search;
  const service=url.pathname==='/servicos-digitais.html'&&[...url.searchParams].length===1&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.searchParams.get('servico')||'');
  assert(ordinary||service,'live_lia_offer_invalid',400);
  const kind=typeof offer.kind==='string'?offer.kind.slice(0,40):'';
  return {id:offer.id,title:offer.title,url:url.pathname+url.search,kind,disclosure:kind==='affiliate'?AFFILIATE_NOTICE:''};
}
function modelOptions(env){
  const model=String(env.LIVE_LIA_TTS_MODEL||'gpt-4o-mini-tts'),voice=String(env.LIVE_LIA_TTS_VOICE||'coral');
  return {model,voice,valid:['gpt-4o-mini-tts','gpt-4o-mini-tts-2025-12-15'].includes(model)&&['coral','marin','sage','shimmer'].includes(voice)};
}
export function resolveLiveLiaMediaConfig(env={}){
  const options=modelOptions(env);return {provider:'openai',configured:options.valid&&Boolean(String(env.OPENAI_API_KEY||'').trim()),model:options.model,voice:options.voice,maxCharacters:600,maxDurationSeconds:60,paid:true,costUsd:null,costStatus:'not_reported_by_speech_response',portrait:LIVE_LIA_PORTRAIT,representation:'Retrato ilustrativo com narração'};
}
function assTime(seconds){const n=Math.round(seconds*100);return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;}
const assText=value=>String(value).replace(/[{}\\]/g,' ').replace(/\r?\n/g,' ');
function wrap(value,size){const words=String(value).split(/\s+/),lines=[];let line='';for(let word of words){while(word.length>size){if(line){lines.push(line);line='';}lines.push(word.slice(0,size));word=word.slice(size);}if(line&&line.length+word.length+1>size){lines.push(line);line='';}if(word)line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;}
export function liveLiaOverlay({text,offer,duration}){
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 2\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n`;
  const style=(name,size,alignment,margin,bold)=>`Style: ${name},DejaVu Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00231C07,&H00231C07,${bold?-1:0},0,0,0,100,100,0,0,1,1,0,${alignment},45,45,${margin},1\n`;
  const line=(start,end,style,value)=>`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${value}\n`;
  let result=header+style('Brand',28,8,25,true)+style('Credit',20,8,70,false)+style('Copy',32,2,300,false)+style('Offer',27,2,180,true)+style('Disclosure',18,2,122,false)+style('Link',20,2,30,false)+'[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n';
  result+=line(0,duration,'Brand','Lia · assistente com IA')+line(0,duration,'Credit','Retrato ilustrativo com narração');
  result+=line(0,duration,'Offer',wrap(assText(offer?.title||'Conte com a VitrineCity'),38).join('\\N'));
  if(offer?.kind==='affiliate')result+=line(0,duration,'Disclosure',AFFILIATE_NOTICE);
  result+=line(0,duration,'Link',wrap(assText('vitrinecity.com'+(offer?.url||'')),52).join('\\N'));
  // Approximate captions use approved text only, never another paid transcription.
  const chunks=wrap(assText(text),94),weight=chunks.reduce((n,s)=>n+s.length,0);let position=0;
  for(const chunk of chunks){const end=position+duration*chunk.length/weight;result+=line(position,end,'Copy',wrap(chunk,36).join('\\N'));position=end;}
  return result;
}
async function bodyBytes(response){
  assert(Number(response.headers?.get('content-length')||0)<=MAX_AUDIO,'live_lia_voice_invalid',502);
  assert(response.body?.getReader,'live_lia_voice_invalid',502);const reader=response.body.getReader(),chunks=[];let total=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;assert(total<=MAX_AUDIO,'live_lia_voice_invalid',502);chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks);assert(bytes.length>=44&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','live_lia_voice_invalid',502);return bytes;
}

/** Only an approved explicit administrative action may call prepare. The caller
 * must combine exact approval/source revision and global pause in canRun, and
 * reserveDailyOperation must be synchronous and durable per answer UUID. */
export function createLiveLiaMedia({env=process.env,liveStudioDir=env.LIVE_STUDIO_DIR,publicDir,reserveDailyOperation,fetchImpl=fetch,execute=realExecute,ffmpegPath='ffmpeg',ffprobePath='ffprobe',now=()=>new Date()}={}){
  const options=modelOptions(env),configuredPaths=path.isAbsolute(liveStudioDir||'')&&path.isAbsolute(publicDir||''),config=Object.freeze({...resolveLiveLiaMediaConfig(env),configured:resolveLiveLiaMediaConfig(env).configured&&configuredPaths&&typeof reserveDailyOperation==='function'});
  const paths=(id,create=false)=>{
    assert(UUID.test(id),'live_lia_id_invalid',400);assert(configuredPaths,'live_lia_not_configured',503);
    if(create&&!exists(liveStudioDir)){fs.mkdirSync(liveStudioDir,{recursive:true,mode:0o750});workerReadable(liveStudioDir);}
    if(!exists(liveStudioDir))return null;
    const base=fs.realpathSync(liveStudioDir),answers=create?directory(base,'lia-answers'):path.join(base,'lia-answers');
    if(!exists(answers))return null;assert(fs.realpathSync(answers)===answers,'live_lia_path_invalid');
    if(create)workerReadable(answers);
    const intents=create?directory(answers,'intents'):path.join(answers,'intents'),job=create?directory(intents,id):path.join(intents,id);
    if(exists(intents))assert(fs.realpathSync(intents)===intents,'live_lia_path_invalid');if(exists(job))assert(fs.realpathSync(job)===job,'live_lia_path_invalid');
    return {answers,job,intent:path.join(job,'intent.json'),audio:path.join(job,'voice.wav'),voice:path.join(job,'voice.json'),lock:path.join(job,'render.lock'),manifest:path.join(answers,id+'.json'),video:path.join(answers,id+'.mp4')};
  };
  function ready(id,p){
    if(!p||!exists(p.manifest))return null;const m=readJson(p.manifest);
    assert(m.answerId===id&&m.file===id+'.mp4'&&m.width===720&&m.height===1280&&Number.isFinite(m.duration)&&m.duration>0&&m.duration<=60&&SHA.test(m.sha256||'')&&SHA.test(m.binding||'')&&m.version===LIVE_LIA_MEDIA_VERSION,'live_lia_receipt_invalid');
    const bytes=readFile(p.video,MAX_VIDEO);assert(bytes.length===m.bytes&&hash(bytes)===m.sha256,'live_lia_file_changed');return m;
  }
  function status(id){
    const p=paths(id);if(!p)return {state:'not_prepared'};
    try{const m=ready(id,p);if(m)return {state:'ready',...m,previewUrl:'/api/admin/live-studio/lia/answers/'+id+'/media'};
      if(exists(p.intent)){const i=readJson(p.intent);assert(i.answerId===id&&SHA.test(i.binding||''),'live_lia_receipt_invalid');
        if(exists(p.voice)){const voice=readJson(p.voice),audio=readFile(p.audio,MAX_AUDIO);assert(voice.answerId===id&&voice.binding===i.binding&&voice.bytes===audio.length&&voice.sha256===hash(audio),'live_lia_voice_changed');}
        return {state:exists(p.voice)?'voice_received':'voice_unconfirmed',answerId:id,binding:i.binding,costUsd:null};}
      return {state:'not_prepared'};
    }catch{return {state:'review_required',answerId:id,costUsd:null};}
  }
  async function probe(file){const result=await execute(ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});try{return JSON.parse(result.stdout);}catch{throw fail('live_lia_probe_invalid');}}
  async function prepare({id,text,offer=null,canRun}={}){
    assert(UUID.test(id),'live_lia_id_invalid',400);assert(checkedText(text,600),'live_lia_text_invalid',400);offer=offerValue(offer);
    assert(typeof canRun==='function'&&canRun()===true,'live_lia_preparation_paused');assert(options.valid&&configuredPaths,'live_lia_not_configured',503);
    const image=path.join(publicDir,...LIVE_LIA_PORTRAIT.split('/').filter(Boolean)),imageBytes=readFile(image,8*1024*1024);
    assert(fs.realpathSync(image)===path.join(fs.realpathSync(publicDir),'assets','lia','lia-abacus-v1-original.png')&&hash(imageBytes)===LIVE_LIA_PORTRAIT_SHA256,'live_lia_portrait_changed');
    const textHash=hash(text),binding=hash(JSON.stringify({version:LIVE_LIA_MEDIA_VERSION,textHash,offer,model:options.model,voice:options.voice,portrait:LIVE_LIA_PORTRAIT_SHA256}));
    const stillCurrent=()=>canRun()===true&&hash(readFile(image,8*1024*1024))===LIVE_LIA_PORTRAIT_SHA256;
    const result=(m)=>({file:m.file,duration:m.duration,sha256:m.sha256,bytes:m.bytes,previewUrl:'/api/admin/live-studio/lia/answers/'+id+'/media'});
    let p=paths(id),m=ready(id,p);
    if(m){assert(m.binding===binding,'live_lia_binding_changed');assert(stillCurrent(),'live_lia_preparation_paused');return result(m);}
    // One preparation across every answer and process. A crash retains this
    // lock for operator review; it is never stolen based on elapsed time.
    p=paths(id,true);const preparationId=randomUUID(),preparationLock=path.join(p.answers,'preparation.lock');
    try{writeJson(preparationLock,{id:preparationId,answerId:id,createdAt:now().toISOString()});}catch(error){if(error.code==='EEXIST')throw fail('live_lia_preparation_busy');throw error;}
    try{
    let intent=p&&exists(p.intent)?readJson(p.intent):null;
    if(intent)assert(intent.answerId===id&&intent.binding===binding,'live_lia_binding_changed');
    if(!intent){
      assert(config.configured,'live_lia_not_configured',503);assert(stillCurrent(),'live_lia_preparation_paused');p=paths(id,true);
      assert(!exists(p.video)&&!exists(p.manifest)&&!exists(p.voice)&&!exists(p.audio),'live_lia_existing_artifact');
      intent={answerId:id,binding,textHash,model:options.model,voice:options.voice,version:LIVE_LIA_MEDIA_VERSION,portraitSha256:LIVE_LIA_PORTRAIT_SHA256,createdAt:now().toISOString(),costUsd:null};
      try{writeJson(p.intent,intent);}catch(error){if(error.code==='EEXIST')throw fail('live_lia_already_preparing');throw error;}
      // No await between the durable intent, quota and final synchronous guard
      // and this one POST. Any missing/ambiguous result permanently keeps intent.
      assert(reserveDailyOperation({id,textHash,model:options.model,voice:options.voice})?.allowed===true,'live_lia_daily_limit',429);
      assert(stillCurrent(),'live_lia_preparation_paused');
      try{
        const response=await fetchImpl('https://api.openai.com/v1/audio/speech',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+String(env.OPENAI_API_KEY||'').trim(),'Content-Type':'application/json'},body:JSON.stringify({model:options.model,voice:options.voice,input:text,response_format:'wav',instructions:'Fale somente o texto fornecido, em português brasileiro, com voz feminina acolhedora, clara e natural. Use ritmo tranquilo, regular e pausas breves. Não acrescente palavras, preços ou promessas.'}),signal:AbortSignal.timeout(120000)});
        assert(response.ok,'live_lia_voice_unconfirmed',502);const bytes=await bodyBytes(response);exclusive(p.audio,bytes);
        writeJson(p.voice,{answerId:id,binding,sha256:hash(bytes),bytes:bytes.length,receivedAt:now().toISOString(),provider:'openai',costUsd:null});
      }catch{throw fail('live_lia_voice_unconfirmed',502);}
    }
    assert(exists(p.voice),'live_lia_voice_unconfirmed');const voice=readJson(p.voice),audio=readFile(p.audio,MAX_AUDIO);
    assert(voice.answerId===id&&voice.binding===binding&&voice.bytes===audio.length&&voice.sha256===hash(audio),'live_lia_voice_changed');
    assert(stillCurrent(),'live_lia_preparation_paused');
    const lockId=randomUUID();try{writeJson(p.lock,{id:lockId,binding,createdAt:now().toISOString()});}catch(error){if(error.code==='EEXIST')throw fail('live_lia_render_needs_review');throw error;}
    const temporary=path.join(p.job,'render-'+lockId+'.mp4');
    try{
      assert(!exists(p.video),'live_lia_existing_artifact');
      const audioInfo=await probe(p.audio),audioStream=audioInfo.streams?.find(s=>s.codec_type==='audio'),duration=Number(audioInfo.format?.duration);
      assert(audioStream&&String(audioStream.codec_name).startsWith('pcm_')&&Number.isFinite(duration)&&duration>0&&duration<=60&&[1,2].includes(audioStream.channels)&&Number(audioStream.sample_rate)>=16000&&Number(audioStream.sample_rate)<=96000,'live_lia_audio_needs_review');
      assert(stillCurrent(),'live_lia_preparation_paused');
      const overlay=path.join(p.job,'overlay-'+lockId+'.ass');exclusive(overlay,liveLiaOverlay({text,offer,duration}));
      const filter=`scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,drawbox=x=0:y=0:w=iw:h=108:color=0x071c23@0.95:t=fill,drawbox=x=0:y=860:w=iw:h=420:color=0x071c23@0.95:t=fill,ass=overlay-${lockId}.ass`;
      await execute(ffmpegPath,['-nostdin','-n','-hide_banner','-loglevel','error','-threads','2','-filter_threads','1','-protocol_whitelist','file,pipe','-loop','1','-framerate','30','-i',image,'-protocol_whitelist','file,pipe','-i',p.audio,'-vf',filter,'-map','0:v:0','-map','1:a:0','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-ar','48000','-movflags','+faststart',temporary],{cwd:p.job,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
      const info=await probe(temporary),video=info.streams?.find(s=>s.codec_type==='video'),track=info.streams?.find(s=>s.codec_type==='audio'),measured=Number(info.format?.duration),bytes=readFile(temporary,MAX_VIDEO);
      assert(video?.codec_name==='h264'&&video.width===720&&video.height===1280&&track?.codec_name==='aac'&&Number.isFinite(measured)&&measured>0&&measured<=60&&Math.abs(measured-duration)<=.35,'live_lia_render_invalid');
      // Retain the received/rendered artifact even after a pause. Only the caller
      // may authorize playback; no task state, OBS command or approval is changed.
      const manifest={answerId:id,file:id+'.mp4',sha256:hash(bytes),bytes:bytes.length,duration:measured,width:720,height:1280,binding,version:LIVE_LIA_MEDIA_VERSION,portraitSha256:LIVE_LIA_PORTRAIT_SHA256,createdAt:now().toISOString(),costUsd:null,disclosure:offer?.disclosure||''};
      const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.linkSync(temporary,p.video);workerReadable(p.video);synchronize(p.answers);writeJson(p.manifest,manifest);workerReadable(p.manifest);m=manifest;
      assert(stillCurrent(),'live_lia_preparation_paused');return result(m);
    }catch(error){
      if(String(error.code||'').startsWith('live_lia_'))throw error;
      throw fail('live_lia_render_failed',502);
    }finally{
      // Remove only this operation's lock and scratch output. Voice/intent/final
      // artifacts are retained for idempotence, including every failure path.
      if(exists(temporary))fs.unlinkSync(temporary);
      try{if(readJson(p.lock).id===lockId)fs.unlinkSync(p.lock);}catch{}
    }
    }finally{try{if(readJson(preparationLock).id===preparationId)fs.unlinkSync(preparationLock);}catch{}}
  }
  return {config,prepare,status};
}
