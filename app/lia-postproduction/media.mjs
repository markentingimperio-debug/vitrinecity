/** Local post-production, fixed FFmpeg arguments and private paths only.
 * No shell, URLs, user filtergraphs, fonts or filenames are accepted as commands.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {requireValue,problem} from './providers.mjs';
export const hashBytes=data=>createHash('sha256').update(data).digest('hex');
const NAME=/^[a-z0-9][a-z0-9.-]{0,110}$/;
export function privateRoot(value) {
  requireValue(typeof value==='string'&&path.isAbsolute(value),'workspace_invalid');
  const root=path.resolve(value);let current=path.parse(root).root;
  for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);const stat=fs.lstatSync(current);
    requireValue(stat.isDirectory()&&!stat.isSymbolicLink(),'workspace_symlink_denied');
  }
  requireValue((fs.statSync(root).mode&0o077)===0,'workspace_must_be_private');return root;
}
export function readPrivate(root,name,limit=100_000_000) {
  requireValue(NAME.test(name),'media_name_invalid');privateRoot(root);
  const fd=fs.openSync(path.join(root,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const stat=fs.fstatSync(fd);requireValue(stat.isFile()&&stat.size>0&&stat.size<=limit,'media_file_invalid');return fs.readFileSync(fd);}
  finally{fs.closeSync(fd);}
}
export function writePrivate(root,name,data) {
  requireValue(NAME.test(name)&&Buffer.isBuffer(data)&&data.length>0,'media_write_invalid');privateRoot(root);
  const temp='tmp-'+randomUUID();const p=path.join(root,temp);fs.writeFileSync(p,data,{flag:'wx',mode:0o600});
  const fd=fs.openSync(p,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(p,path.join(root,name));}catch(error){
    if(error.code!=='EEXIST'||hashBytes(readPrivate(root,name))!==hashBytes(data))throw problem('media_existing_file_differs');
  }finally{fs.unlinkSync(p);}
  return {name,sha256:hashBytes(data),bytes:data.length};
}
export function stageOwnedFile({root,source,expectedSha256,targetRoot,targetName}) {
  requireValue(typeof source==='string'&&path.isAbsolute(source)&&/^[a-f0-9]{64}$/.test(expectedSha256),'source_invalid');
  const allowed=path.resolve(root),full=path.resolve(source);
  requireValue(full.startsWith(allowed+path.sep),'source_outside_root');
  // Validate every ancestor, not just the final pathname.
  let current=path.parse(full).root;
  for(const part of path.dirname(full).slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);const s=fs.lstatSync(current);requireValue(s.isDirectory()&&!s.isSymbolicLink(),'source_symlink_denied');
  }
  const fd=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  let data;try{const s=fs.fstatSync(fd);requireValue(s.isFile()&&s.size>=64&&s.size<20_000_000,'source_size_invalid');data=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
  requireValue(hashBytes(data)===expectedSha256,'source_changed');
  requireValue(data.toString('ascii',4,8)==='ftyp','source_not_mp4');
  return writePrivate(targetRoot,targetName,data);
}
export function runMediaCommand(program,args,{cwd,signal,timeoutMs=300000}={}) {
  requireValue(['ffmpeg','ffprobe'].includes(program)&&Array.isArray(args),'media_command_invalid');
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='',overflow=false,child,timer;
    const done=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(problem(error)):resolve(value);};
    const abort=()=>child?.kill('SIGKILL');
    if(signal?.aborted)return done('media_interrupted');
    child=spawn(program,args,{cwd,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'},shell:false});
    timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',b=>{stdout+=b;if(stdout.length>262144){overflow=true;abort();}});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16384);});
    child.once('error',()=>done('media_binary_unavailable'));
    child.once('close',code=>code===0&&!overflow?done(null,{stdout,stderr}):done(signal?.aborted?'media_interrupted':'media_processing_failed'));
  });
}
const common=['-hide_banner','-nostdin','-v','error','-xerror','-threads','1','-filter_threads','1','-filter_complex_threads','1'];
const input=(name,format)=>['-protocol_whitelist','file,pipe','-format_whitelist',format,'-f',format,'-i',name];
const fixedText=value=>String(value).replace(/[<>\\{}\r\n\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const stamp=ms=>{ms=Math.max(0,Math.round(ms));const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);return [h,m,s].map(v=>String(v).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');};
export function captionsFromAlignment(alignment,offsetMs=0) {
  const chars=alignment.characters,starts=alignment.character_start_times_seconds,ends=alignment.character_end_times_seconds;
  let text='',begin=0,last=0;const cues=[];
  for(let i=0;i<chars.length;i++){
    if(!text)begin=starts[i]*1000;
    text+=chars[i];last=ends[i]*1000;
    if((text.length>=38&&/\s/.test(chars[i]))||last-begin>=3000||i===chars.length-1){
      const safe=fixedText(text);if(safe&&last>begin)cues.push({text:safe,startMs:offsetMs+begin,endMs:offsetMs+last});text='';
    }
  }
  return cues;
}
export function makeSrt(cues) {
  return cues.map((cue,i)=>`${i+1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${fixedText(cue.text)}\n`).join('\n')+'\n';
}
export function createLocalEditor({dimensions={'9:16':[720,1280],'16:9':[1280,720],'1:1':[720,720]},runner=runMediaCommand}={}) {
  for(const aspect of ['9:16','16:9','1:1'])requireValue(Array.isArray(dimensions[aspect])&&dimensions[aspect].length===2&&dimensions[aspect].every(n=>Number.isSafeInteger(n)&&n>=64&&n<=1920&&n%2===0),'media_dimensions_invalid');
  function validFile(root,name){readPrivate(root,name);return name;}
  async function probe(root,name,format,signal) {
    validFile(root,name);
    const args=['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',format,'-f',format,'-show_entries','format=duration:stream=codec_type,codec_name,width,height,start_time,duration,r_frame_rate','-of','json',name];
    let metadata;try{metadata=JSON.parse((await runner('ffprobe',args,{cwd:root,signal,timeoutMs:30000})).stdout);}catch{throw problem('media_probe_failed');}
    const durationMs=Math.round(Number(metadata.format?.duration)*1000);
    requireValue(Number.isSafeInteger(durationMs)&&durationMs>0&&durationMs<=3700000,'media_duration_invalid');
    const video=metadata.streams?.filter(s=>s.codec_type==='video')||[],audio=metadata.streams?.filter(s=>s.codec_type==='audio')||[];
    return {durationMs,video,audio};
  }
  async function render(root,args,output,signal) {
    requireValue(NAME.test(output),'media_name_invalid');privateRoot(root);
    // Pure local operations may restart; only their temporary output is replaced.
    const temp='render-'+randomUUID()+'.'+output.split('.').at(-1);
    try{await runner('ffmpeg',[...common,...args,'-y',temp],{cwd:root,signal});const data=readPrivate(root,temp);return writePrivate(root,output,data);}
    finally{try{fs.unlinkSync(path.join(root,temp));}catch{}}
  }
  async function prepareScene(root,{source,voice,durationMs,aspectRatio,index},signal) {
    const video=await probe(root,source,'mov',signal),audio=await probe(root,voice,'mp3',signal),[w,h]=dimensions[aspectRatio]||[];
    requireValue(video.video.length===1&&audio.audio.length===1&&audio.video.length===0&&w,'media_stream_invalid');
    requireValue(video.durationMs>=durationMs-40,'scene_too_short');
    requireValue(audio.durationMs<=durationMs,'speech_revision_required');
    const seconds=String(durationMs/1000),silent=`s${index}-silent.mp4`,padded=`s${index}-padded.wav`;
    await render(root,[...input(source,'mov'),'-map','0:v:0','-an','-t',seconds,'-vf',`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,format=yuv420p`,'-c:v','libx264','-preset','veryfast','-crf','23','-map_metadata','-1','-movflags','+faststart'],silent,signal);
    await render(root,[...input(voice,'mp3'),'-map','0:a:0','-vn','-af',`loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=${seconds}`,'-t',seconds,'-ar','48000','-ac','1','-c:a','pcm_s16le','-map_metadata','-1'],padded,signal);
    const sv=await probe(root,silent,'mov',signal),sa=await probe(root,padded,'wav',signal);
    requireValue(Math.abs(sv.durationMs-durationMs)<=50&&Math.abs(sa.durationMs-durationMs)<=20,'sync_duration_mismatch');
    return {silent,padded,silentSha256:hashBytes(readPrivate(root,silent)),paddedSha256:hashBytes(readPrivate(root,padded)),audioDurationMs:audio.durationMs};
  }
  async function muxScene(root,{video,audio,durationMs,index},signal) {
    const meta=await probe(root,video,'mov',signal);requireValue(meta.video.length===1&&Math.abs(meta.durationMs-durationMs)<=120,'sync_video_duration_invalid');
    return render(root,[...input(video,'mov'),...input(audio,'wav'),'-map','0:v:0','-map','1:a:0','-t',String(durationMs/1000),'-c:v','copy','-c:a','aac','-b:a','160k','-map_metadata','-1','-movflags','+faststart'],`s${index}-edited.mp4`,signal);
  }
  async function assemble(root,{scenes,cues,captions,durationSeconds,aspectRatio},signal) {
    for(const name of scenes)validFile(root,name);
    writePrivate(root,'concat.txt',Buffer.from(scenes.map(name=>`file '${name}'`).join('\n')+'\n'));
    if(captions!=='none')writePrivate(root,'captions.srt',Buffer.from(makeSrt(cues),'utf8'));
    const args=['-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i','concat.txt','-map','0:v:0','-map','0:a:0','-t',String(durationSeconds)];
    if(captions!=='none')args.push('-vf',"subtitles=captions.srt:force_style='FontName=DejaVu Sans,FontSize=18,Outline=1,MarginV=60'",'-c:v','libx264','-preset','veryfast','-crf','23');
    else args.push('-c:v','copy');
    args.push('-c:a','aac','-b:a','160k','-map_metadata','-1','-movflags','+faststart');
    const result=await render(root,args,'final.mp4',signal);
    const metadata=await probe(root,'final.mp4','mov',signal),[width,height]=dimensions[aspectRatio];
    requireValue(metadata.video.length===1&&metadata.audio.length===1&&metadata.video[0].width===width&&metadata.video[0].height===height&&Math.abs(metadata.durationMs-durationSeconds*1000)<=120,'final_verification_failed');
    await runner('ffmpeg',[...common,...input('final.mp4','mov'),'-map','0:v:0','-map','0:a:0','-f','null','-'],{cwd:root,signal});
    const volume=await runner('ffmpeg',['-hide_banner','-nostdin',...input('final.mp4','mov'),'-vn','-af','volumedetect','-f','null','-'],{cwd:root,signal});
    const match=/max_volume:\s*(-?[\d.]+) dB/.exec(volume.stderr);requireValue(match&&Number(match[1])>-65,'final_audio_silent');
    return {...result,durationMs:metadata.durationMs,width,height,audioVerified:true,
      languageVerified:false,lipSyncQualityVerified:false,captions:captions!=='none'?'captions.srt':null};
  }
  return Object.freeze({probe,prepareScene,muxScene,assemble});
}
