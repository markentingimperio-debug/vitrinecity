import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {getDailyPrayer,validDay} from './prayer-daily.js';

const exec=promisify(execFile);
// Applies to new renders only. A dated ready.json remains immutable, including
// earlier 61-second editions and their publication receipts.
export const PRAYER_FORMATS=Object.freeze({short:30,tiktok:65});
export const mediaHash=value=>createHash('sha256').update(value).digest('hex');
const exists=async file=>fs.stat(file).then(()=>true,()=>false);
const writeJson=(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
const probe=async file=>JSON.parse((await exec('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{timeout:15000,maxBuffer:1024*1024})).stdout);
const normalized=value=>String(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function prayerVideoScript(day,format){
  const p=getDailyPrayer(day);
  if(!Object.hasOwn(PRAYER_FORMATS,format))throw Error('prayer_format_invalid');
  const sentences=p.paragraphs.join(' ').match(/[^.!?]+[.!?]+|[^.!?]+$/g).map(s=>s.trim()).filter(s=>s!=='Amém.');
  const title=`Oração de ${p.weekday}`;
  if(format==='tiktok'){const full=sentences.join(' ');return {day,format,title,edition:p.edition,theme:p.title,text:/amém[.!?]?$/i.test(full)?full:`${full} Amém.`};}
  // Keep complete sentences; never truncate a thought to fit a duration.
  const selected=[];let count=0;
  for(const sentence of sentences){const words=sentence.split(/\s+/).length;if(count+words>58&&count>=38)break;selected.push(sentence);count+=words;}
  return {day,format,title,edition:p.edition,theme:p.title,text:`${selected.join(' ')} Amém.`};
}

function assTime(t){const n=Math.max(0,Math.round(t*100));return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;}
const assText=s=>String(s).replace(/[{}\\]/g,'').replace(/\r?\n/g,'\\N');
function subtitles(script,words,factor,duration){
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Main,DejaVu Sans,38,&H00FFFFFF,&H00FFFFFF,&H00151009,&H90000000,-1,0,0,0,100,100,0,0,1,2,1,2,70,90,300,1\nStyle: Title,DejaVu Sans,34,&H00FFFFFF,&H00FFFFFF,&H00151009,&H90000000,-1,0,0,0,100,100,0,0,1,2,1,8,55,75,155,1\nStyle: Note,DejaVu Sans,20,&H00FFFFFF,&H00FFFFFF,&H00151009,&H90000000,0,0,0,0,100,100,0,0,1,1,1,2,55,75,220,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const line=(start,end,style,text)=>`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${assText(text)}\n`;
  let output=header+line(0,duration,'Title',script.title+'\n'+script.edition)+line(0,duration,'Note','Arte e voz criadas com IA');
  for(let i=0;i<words.length;){let chunk=[],length=0;while(i<words.length&&(length+String(words[i].word).length<62||!chunk.length)){chunk.push(words[i]);length+=String(words[i++].word).length+1;}
    const start=.8+chunk[0].start/factor,end=Math.min(duration-.3,.8+chunk.at(-1).end/factor+.10);
    output+=line(start,end,'Main',chunk.map(w=>w.word.trim()).join(' '));
  }
  return output;
}

export function validatePrayerMedia(info,duration){
  const v=info.streams?.find(s=>s.codec_type==='video'),a=info.streams?.find(s=>s.codec_type==='audio');
  return Boolean(v&&a&&v.width===720&&v.height===1280&&v.codec_name==='h264'&&v.pix_fmt==='yuv420p'&&a.codec_name==='aac'&&Math.abs(Number(info.format?.duration)-duration)<.10);
}

export async function generatePrayerMedia({day,format,dataDir,publicDir,apiKey=process.env.OPENAI_API_KEY,fetchImpl=fetch,canRun=()=>true}){
  if(!validDay(day)||!Object.hasOwn(PRAYER_FORMATS,format))throw Error('prayer_media_input_invalid');
  const directory=path.join(dataDir,'prayer-media',day,format),duration=PRAYER_FORMATS[format],script=prayerVideoScript(day,format);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const done=path.join(directory,'ready.json'),audioFile=path.join(directory,'voice.wav'),transcriptFile=path.join(directory,'transcript.json'),videoPath=path.join(directory,'video.mp4');
  const binding=mediaHash(JSON.stringify(script));
  if(await exists(done)){const result=JSON.parse(await fs.readFile(done,'utf8'));if(result.day!==day||result.format!==format||result.videoPath!==videoPath||result.binding!==mediaHash(JSON.stringify(result.script))||mediaHash(await fs.readFile(videoPath))!==result.sha256)throw Error('prayer_media_binding_changed');return result;}
  if(!apiKey)throw Error('prayer_voice_not_configured');
  if(!canRun())throw Error('prayer_paused');
  if(!await exists(audioFile)){
    // Durable intent prevents duplicate charges after an ambiguous API response.
    await writeJson(path.join(directory,'voice-intent.json'),{binding,script,createdAt:new Date().toISOString()});
    const r=await fetchImpl('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'cedar',input:script.text,instructions:'Fale em português brasileiro, com voz masculina acolhedora, clara e natural. Oração serena, com esperança. Ritmo regular e pausas breves. Não acrescente nenhuma palavra.',response_format:'wav'}),signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw Error('prayer_voice_http_'+r.status);
    const b=Buffer.from(await r.arrayBuffer());if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('prayer_voice_invalid');
    await fs.writeFile(audioFile,b,{mode:0o600,flag:'wx'});
  }
  const intent=JSON.parse(await fs.readFile(path.join(directory,'voice-intent.json'),'utf8'));
  if(intent.binding!==binding)throw Error('prayer_voice_binding_changed');
  if(!canRun())throw Error('prayer_paused');
  if(!await exists(transcriptFile)){
    await writeJson(path.join(directory,'transcript-intent.json'),{binding,createdAt:new Date().toISOString()});
    const form=new FormData();form.append('file',new Blob([await fs.readFile(audioFile)],{type:'audio/wav'}),'voice.wav');form.append('model','whisper-1');form.append('language','pt');form.append('response_format','verbose_json');form.append('timestamp_granularities[]','word');
    const r=await fetchImpl('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+apiKey},body:form,signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw Error('prayer_transcript_http_'+r.status);await writeJson(transcriptFile,await r.json());
  }
  const transcript=JSON.parse(await fs.readFile(transcriptFile,'utf8')),words=transcript.words;
  if(!Array.isArray(words)||!words.length||words.some(w=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.end<w.start))throw Error('prayer_transcript_invalid');
  const expected=normalized(script.text).split(' '),heard=new Set(normalized(transcript.text).split(' '));
  if(expected.filter(w=>heard.has(w)).length/expected.length<.94)throw Error('prayer_voice_review_required');
  const originalDuration=Number((await probe(audioFile)).format.duration),factor=originalDuration/(duration-1.6);
  if(!Number.isFinite(factor)||factor<.60||factor>1.55)throw Error('prayer_voice_pacing_review');
  const ass=path.join(directory,'captions.ass');await fs.writeFile(ass,subtitles(script,words,factor,duration));
  const background=path.join(publicDir,'assets/prayer/jesus-areia-v1.png'),temporary=path.join(directory,'rendering.mp4');
  if(!canRun())throw Error('prayer_paused');
  const filter=`[0:v]split[bg][fg];[bg]scale=900:1600:force_original_aspect_ratio=increase,crop=900:1600,zoompan=z='1+0.000045*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=30,boxblur=18:2,eq=brightness=-0.20[back];[fg]scale=720:-2[front];[back][front]overlay=0:260,drawbox=x=0:y=790:w=720:h=300:color=black@0.30:t=fill,ass=${ass},format=yuv420p[v];[1:a]atempo=${factor.toFixed(8)},adelay=800|800,apad[a]`;
  await exec('/usr/bin/ffmpeg',['-y','-hide_banner','-loglevel','error','-threads','2','-filter_complex_threads','1','-loop','1','-framerate','30','-i',background,'-i',audioFile,'-filter_complex',filter,'-map','[v]','-map','[a]','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','24','-threads','2','-c:a','aac','-b:a','128k','-ar','48000','-movflags','+faststart',temporary],{timeout:600000,maxBuffer:2*1024*1024});
  const info=await probe(temporary);if(!validatePrayerMedia(info,duration))throw Error('prayer_render_invalid');
  const bytes=await fs.readFile(temporary);if(bytes.length>15*1024*1024)throw Error('prayer_render_too_large');
  await fs.rename(temporary,videoPath);
  const caption=`🙏 ${script.title} · ${script.edition}\n${script.theme}\n\n${script.text}\n\nLeia a oração completa: https://vitrinecity.com/oracao-do-dia.html?dia=${day}#oracao\n\nRepresentação artística de Jesus. Imagem e narração criadas com inteligência artificial.\n#Oração #Fé #Esperança #Oracao${day.replaceAll('-','')}`;
  const result={day,format,durationSeconds:Number(info.format.duration),width:720,height:1280,bytes:bytes.length,sha256:mediaHash(bytes),binding,script,caption,videoPath,publicVideoUrl:`https://vitrinecity.com/prayer-media/${day}/${format}.mp4`,createdAt:new Date().toISOString()};
  await writeJson(done,result);return result;
}
