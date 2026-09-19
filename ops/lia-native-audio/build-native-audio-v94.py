#!/usr/bin/env python3
"""Deterministic source builder. Writes ONLY a caller-supplied isolated tree.
Never imports the application, talks to Docker, changes production, or calls APIs.
"""
import hashlib
from pathlib import Path

MANIFEST = {
 'app/vitriny-neural/providers/kling-paid-video.js': ('4df3e6abe5a728dcf869caf7cb8a4089cf880e2294aa9370e5b503b3ff29b376','a8e06f85282e60871109dca0476f42e558eb5a93c4cfd946ed38447eeb996897'),
 'app/vitriny-neural/paid-chat-runtime.js': ('4c7a22ec6bcbb9a546525c5e7368698c1938ad0b504f166279acacef6d8de59c','c9d8a218cfc587e55f265275b14dd69cace471b5ef5cf1d3f03f0f3437ceb77a'),
 'app/vitriny-neural/chat-artifacts.js': ('bd64333c679ff6862b872ddff2108c28a8d801621c3b30d352e829c17e79cdb2','d74fef8be3295d5b42967f15369358e21a7e2c3727667f2f2ae8f27dcba769d2'),
 'app/vitriny-neural/video-audio-policy.js': (None,'64feddd729c59866cc9f4d0f2ebd9daa72cecdde14d9db853da02d50ba59848c'),
}
POLICY = r'''import {chatError} from './chat-attachments.js';

// Owner's API list-price snapshot: Kling 3.0, NOT Turbo/Omni; native audio
// without voice control, 720p: 0.9 units/s = USD 0.126/s. Not a BRL FX quote.
export const NATIVE_AUDIO_720=Object.freeze({model:'kling-3.0',resolution:'720p',
  usdPerSecond:'0.126',tariffVersion:'kling-3.0-native-audio-720p-20260919',
  effectiveAt:'2026-09-19T00:00:00.000Z'});
export function nativeAudioTariff(kling,now=Date.now()){
  const value=kling?.nativeAudio720;
  if(!value||value.enabled!==true||Object.keys(NATIVE_AUDIO_720).some(k=>value[k]!==NATIVE_AUDIO_720[k])||
     !Number.isSafeInteger(now)||now<Date.parse(NATIVE_AUDIO_720.effectiveAt))
    throw chatError('chat_media_settings_unavailable');
  return NATIVE_AUDIO_720;
}
export function videoAudioChoice(message){
  if(typeof message!=='string')throw chatError('chat_input_invalid');
  // Classification only. The original prompt is not modified.
  const t=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const off=/\b(?:sem\s+(?:audio|som)|mudo|silencioso|silent|no\s+audio)\b/.test(t);
  const on=/\b(?:com\s+(?:audio|som|voz)|audio\s+nativo|with\s+(?:audio|sound)|native\s+audio)\b/.test(t);
  if(off&&on)throw chatError('chat_media_settings_unavailable');
  if(off)return 'off';
  const content=t.replace(/\bsem\s+(?:fala|voz|narracao|musica)\b/g,'');
  return on||/\b(?:falando|dizendo|dialogo|dialogos|narrado|narracao|narrador|diga|diz|fale|falas|cantando|canta|musica|voz|efeitos\s+sonoros|som\s+(?:de|da|do)|barulho|speaking|says|dialogue|voiceover|sound\s+effects)\b/.test(content)?'native':'off';
}
'''
AUDIO_CHECK = r'''  if(requireAudio){
    const audio=result.streams?.filter(s=>s.codec_type==='audio');
    if(audio?.length!==1||!['aac','mp3','opus','vorbis','alac','flac'].includes(audio[0].codec_name)||
       !Number.isSafeInteger(audio[0].channels)||audio[0].channels<1||audio[0].channels>8||
       !(Number(audio[0].sample_rate)>0))fail('chat_video_audio_missing',502);
    // Bounded local decode. No URL, shell, network or regeneration; not speech recognition.
    const decoded=spawnSync('ffmpeg',['-v','error','-nostdin','-protocol_whitelist','file,pipe',
      '-f','mov','-i',file,'-map','0:a:0','-t','17','-ac','1','-ar','8000','-f','s16le','pipe:1'],
      {timeout:15000,maxBuffer:512*1024,windowsHide:true});
    if(decoded.status!==0||decoded.error||!Buffer.isBuffer(decoded.stdout)||decoded.stdout.length<2)
      fail('chat_video_audio_missing',502);
    let nonzero=false;
    for(let i=0;i+1<decoded.stdout.length;i+=2){if(Math.abs(decoded.stdout.readInt16LE(i))>1){nonzero=true;break;}}
    if(!nonzero)fail('chat_video_audio_missing',502);
    return {width,height,durationSeconds,audioVerified:true};
  }
'''
READY = r'''    if(input.requireAudio!==undefined&&typeof input.requireAudio!=='boolean')fail();
    if(input.requireAudio&&input.kind!=='video')fail();
    const claimed=claim.immediate(scope,input);
    if(claimed.state==='ready'){
      if(input.requireAudio){
        const stored=read(scope,claimed.id),bytes=fs.readFileSync(stored.path);
        if(createHash('sha256').update(bytes).digest('hex')!==claimed.digest)fail();
        if(inspectVideo(stored.path,bytes,{requireAudio:true}).audioVerified!==true)
          fail('chat_video_audio_missing',502);
      }
      return metadata(claimed);
    }'''
def digest(data): return hashlib.sha256(data).hexdigest()
def once(text, old, new, count=1):
    if text.count(old)!=count: raise ValueError('PATCH_ANCHOR_MISMATCH')
    return text.replace(old,new,count)
def patch(name, source):
    before,after=MANIFEST[name]
    if (None if source is None else digest(source))!=before:raise ValueError('SOURCE_HASH_MISMATCH')
    if source is None:out=POLICY
    else:
        out=source.decode('utf8')
        if name.endswith('/kling-paid-video.js'):
            out=once(out,"'externalTaskId','referenceImageBase64'];","'externalTaskId','referenceImageBase64','audio'];")
            anchor="  integer(durationSeconds,3,15,'kling_input_invalid');\n"
            out=once(out,anchor,anchor+"  const audio=input.audio===undefined?'off':input.audio;\n  if(!['off','native'].includes(audio))fail('kling_input_invalid');\n")
            out=once(out,"audio:'off',multi_shot:false","audio,multi_shot:false",2)
            out=once(out,'ID and fixed audio/multi-shot/watermark settings.','ID and selected audio plus fixed multi-shot/watermark settings.')
        elif name.endswith('/paid-chat-runtime.js'):
            anchor="import {enrichPaidChatInput} from './paid-platform-context.js';\n"
            out=once(out,anchor,anchor+"import {videoAudioChoice, nativeAudioTariff} from './video-audio-policy.js';\n")
            anchor="      decimal(kind==='image'?cfg.kling.imageUsdEach:cfg.kling.videoUsdPerSecond);return true;"
            out=once(out,anchor,"      decimal(kind==='image'?cfg.kling.imageUsdEach:cfg.kling.videoUsdPerSecond);\n      if(kind==='video'&&quote?.audio==='native')nativeAudioTariff(cfg.kling,now());\n      return true;")
            out=once(out,r"(?:com audio|com som|com voz|narrado|narracao|4k|1080p)",r"(?:4k|1080p)")
            anchor="      input={prompt:message,aspectRatio:"
            out=once(out,anchor,"      const audio=kind==='video'?videoAudioChoice(message):'off';\n      const audioTariff=audio==='native'?nativeAudioTariff(cfg.kling,now()):null;\n"+anchor)
            anchor="      requestHash=kind==='video'?hashKlingPaidVideoRequest(input):hashKlingPaidImageRequest(input);q.requestHash=requestHash;"
            out=once(out,anchor,"      // Silent legacy bodies remain identical. Audio is bound to the paid body hash.\n      if(audio==='native'){input.audio='native';q.audio='native';}\n"+anchor)
            out=once(out,'product(cfg.kling.videoUsdPerSecond,String(input.durationSeconds))','product(audioTariff?.usdPerSecond||cfg.kling.videoUsdPerSecond,String(input.durationSeconds))')
            anchor="      q.maximumMicro=Math.max(1,mediaPrice(q));q.summary="
            out=once(out,anchor,"      if(audioTariff){q.tariffVersion=audioTariff.tariffVersion;q.effectiveAt=audioTariff.effectiveAt;}\n"+anchor)
            out=once(out,"em 720p, sem áudio${referenceImage?","em 720p, ${audio==='native'?'com áudio nativo (fala em português não validada)':'sem áudio'}${referenceImage?")
            out=once(out,"let answer=r.kind==='chat'?shortText(result.text,65536):null,delivery=false;","let answer=r.kind==='chat'?shortText(result.text,65536):null,delivery=false,audioFailure=false;")
            out=once(out,"url:result.output.url});delivery=true;}catch{}}","url:result.output.url,...(q.audio==='native'?{requireAudio:true}:{})});delivery=true;}catch(error){audioFailure=error?.code==='chat_video_audio_missing';}}")
            anchor="    if(financialState==='held')text+="
            out=once(out,anchor,"    if(successful&&q.audio==='native')text+=' Faixa de áudio presente e decodificada; idioma e conteúdo da fala ainda precisam ser conferidos.';\n    if(audioFailure)text='O arquivo do provedor não passou na verificação de áudio: faixa ausente, silenciosa ou não decodificável. A entrega foi bloqueada; não haverá outra geração automática. O comprovante e o consumo do provedor foram preservados para conferência.';\n"+anchor)
        elif name.endswith('/chat-artifacts.js'):
            out=once(out,'export function inspectChatVideo(file,data){','export function inspectChatVideo(file,data,{requireAudio=false}={}){')
            anchor='  return {width,height,durationSeconds};'
            out=once(out,anchor,AUDIO_CHECK+anchor)
            out=once(out,"    const claimed=claim.immediate(scope,input);if(claimed.state==='ready')return metadata(claimed);",READY)
            out=once(out,'inspectVideo(filename,data),digest=', 'inspectVideo(filename,data,{requireAudio:input.requireAudio===true}),digest=')
            anchor="      checkOwner(scope,input.requestId);\n"
            out=once(out,anchor,"      if(input.requireAudio&&dimensions.audioVerified!==true)fail('chat_video_audio_missing',502);\n"+anchor)
            anchor='''    }catch{db.prepare("UPDATE neural_chat_artifacts SET state='unavailable' WHERE id=? AND scope=? AND state='ingesting'").run(claimed.id,scope);fail('chat_artifact_unavailable',503);}'''
            out=once(out,anchor,'''    }catch(error){db.prepare("UPDATE neural_chat_artifacts SET state='unavailable' WHERE id=? AND scope=? AND state='ingesting'").run(claimed.id,scope);
      if(error?.code==='chat_video_audio_missing')fail('chat_video_audio_missing',502);
      fail('chat_artifact_unavailable',503);}''')
    result=out.encode('utf8')
    if digest(result)!=after:raise ValueError('RESULT_HASH_MISMATCH')
    return result

def build_tree(source, target):
    source=Path(source).resolve();target=Path(target).resolve()
    if source==target or target in source.parents:raise ValueError('ISOLATED_TARGET_REQUIRED')
    values={}
    for name in MANIFEST:
        p=source/name
        values[name]=patch(name,p.read_bytes() if p.exists() else None)
    for name,value in values.items():
        p=target/name;p.parent.mkdir(parents=True,exist_ok=True)
        with p.open('xb') as f:f.write(value)
    return values
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('target');a=parser.parse_args()
    build_tree(a.source,a.target)
    print('ISOLATED_AUDIO_PAYLOAD_PREPARED_NOT_DEPLOYED')
