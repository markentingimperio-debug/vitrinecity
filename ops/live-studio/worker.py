"""Private file-queue controller. No HTTP listener and no public WebSocket port."""
import base64, hashlib, json, os, pathlib, re, time, uuid
from urllib.parse import urlparse
import websocket
from relay import Relay, INGEST, PLATFORMS

ROOT = pathlib.Path('/live-studio')
SCENE = 'VitrineCity'
SOURCE = 'Apresentacao revisada'

def read(name, fallback=None):
    try:
        return json.loads((ROOT / name).read_text())
    except (OSError, ValueError):
        return fallback

def write(name, value):
    temp = ROOT / (name + '.worker.tmp')
    temp.write_text(json.dumps(value))
    temp.chmod(0o600)
    temp.replace(ROOT / name)

class OBS:
    def __init__(self):
        self.ws = websocket.create_connection('ws://127.0.0.1:4455', timeout=5)
        hello = json.loads(self.ws.recv())['d']
        auth = hello['authentication']
        digest = lambda value: base64.b64encode(hashlib.sha256(value.encode()).digest()).decode()
        password = (ROOT / 'obs-password').read_text()
        self.ws.send(json.dumps({'op':1,'d':{'rpcVersion':1,'eventSubscriptions':0,'authentication':digest(digest(password+auth['salt'])+auth['challenge'])}}))
        if json.loads(self.ws.recv())['op'] != 2:
            raise RuntimeError('OBS authentication failed')

    def call(self, kind, **data):
        request_id = str(uuid.uuid4())
        self.ws.send(json.dumps({'op':6,'d':{'requestType':kind,'requestId':request_id,'requestData':data}}))
        while True:
            reply = json.loads(self.ws.recv())
            if reply['op'] == 7 and reply['d']['requestId'] == request_id:
                if not reply['d']['requestStatus']['result']:
                    raise RuntimeError('OBS request failed: '+kind)
                return reply['d'].get('responseData', {})

def prepare(obs, config):
    filename = config.get('media','')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+\.mp4',filename):
        raise ValueError('Vídeo inválido.')
    item = next((m for m in read('media.json',[]) if m['file']==filename),None)
    if not item or not (0 < float(item['duration']) <= 601) or config.get('repetitions') not in (0,1,2,3):
        raise ValueError('Duração ou repetições inválidas.')
    media = ROOT / 'media' / filename
    if not media.is_file() or media.is_symlink():
        raise ValueError('Arquivo de vídeo ausente.')
    scenes = obs.call('GetSceneList')['scenes']
    if not any(s['sceneName']==SCENE for s in scenes):
        obs.call('CreateScene',sceneName=SCENE)
    settings={'is_local_file':True,'local_file':str(media),'looping':True,'restart_on_activate':True,'close_when_inactive':False}
    inputs = obs.call('GetInputList')['inputs']
    if not any(i['inputName']==SOURCE for i in inputs):
        obs.call('CreateInput',sceneName=SCENE,inputName=SOURCE,inputKind='ffmpeg_source',inputSettings=settings,sceneItemEnabled=True)
    else:
        obs.call('SetInputSettings',inputName=SOURCE,inputSettings=settings,overlay=True)
    # Persistent, transparent label on every streamed or recorded frame.
    label='Apresentação gravada em repetição\nvitrinecity.com'
    name='Aviso de apresentacao gravada'
    text_settings={'text':label,'font':{'face':'DejaVu Sans','size':23,'flags':0},'color1':0xFFFFFFFF,'color2':0xFFFFFFFF,'outline':True}
    if not any(i['inputName']==name for i in inputs):
        result=obs.call('CreateInput',sceneName=SCENE,inputName=name,inputKind='text_ft2_source_v2',inputSettings=text_settings,sceneItemEnabled=True)
        obs.call('SetSceneItemTransform',sceneName=SCENE,sceneItemId=result['sceneItemId'],sceneItemTransform={'positionX':22.0,'positionY':1155.0})
    obs.call('SetCurrentProgramScene',sceneName=SCENE)
    obs.call('TriggerMediaInputAction',inputName=SOURCE,mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART')
    return float(item['duration']) * config['repetitions']

def validate_server(config):
    url = urlparse(config.get('server',''))
    platform = config.get('platform', 'instagram')
    domains = {'instagram': ('instagram.com','facebook.com','fbcdn.net'), 'youtube': ('youtube.com',), 'tiktok': ('tiktok.com','tiktokv.com')}.get(platform, ())
    hostname = url.hostname or ''
    official = any(hostname == domain or hostname.endswith('.'+domain) for domain in domains)
    protocol = url.scheme == 'rtmps' or (platform == 'tiktok' and url.scheme == 'rtmp')
    if not official or not protocol or url.username or url.password or url.fragment or url.port not in (None,1935 if url.scheme=='rtmp' else 443) or re.search(r'[\s\x00]',config.get('server','')):
        raise ValueError('Servidor oficial da rede selecionada inválido.')
    if not config.get('key') or len(config['key'])>2048 or any(c in config['key'] for c in '\r\n\0'):
        raise ValueError('Chave de transmissão ausente ou inválida.')

def continuous_session(session):
    return session.get('action') == 'start' and session.get('continuous') is True

def session_expired(session, now):
    if continuous_session(session):
        return False
    return not session.get('deadline') or now >= session['deadline']

def main():
    obs = None
    relay = Relay()
    # An interrupted command is never replayed after a process/container restart.
    interrupted = ROOT / 'executing-command.json'
    if interrupted.exists(): interrupted.rename(ROOT / 'last-command.json')
    last = 'Inicializando OBS. Nenhuma transmissão iniciada.'
    # Persist deadline before starting: a controller restart must never extend a live.
    session = read('session.json',{})
    while True:
        try:
            if obs is None:
                obs = OBS()
            stream = obs.call('GetStreamStatus')
            record = obs.call('GetRecordStatus')
            active = stream['outputActive'] or record['outputActive']
            networks = relay.snapshot()
            if session.get('relay') and not stream['outputActive'] and relay.active():
                relay.stop()
                session={};write('session.json',session)
                last='Entrada do OBS encerrada; saídas interrompidas sem reinício automático.'
            if stream['outputActive'] and session.get('relay') and not relay.active():
                obs.call('StopStream')
                last='Todas as saídas foram encerradas ou falharam. Nenhuma será reiniciada automaticamente.'
                session={};write('session.json',session)
                stream=obs.call('GetStreamStatus')
                active=stream['outputActive'] or record['outputActive']
            if active and session_expired(session, time.time()):
                relay.stop()
                if stream['outputActive']: obs.call('StopStream')
                if record['outputActive']: obs.call('StopRecord')
                obs.call('TriggerMediaInputAction',inputName=SOURCE,mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP')
                session={};write('session.json',session)
                last='Sessão encerrada automaticamente. Não haverá reinício automático.'
            pending = ROOT / 'command.json'
            if pending.exists():
                command = read('command.json',{})
                # Claim before side effects; stale or crashed commands are never replayed.
                pending.rename(ROOT / 'executing-command.json')
                try:
                    action=command.get('action')
                    if time.time()*1000-command.get('createdAt',0)>60000:
                        raise ValueError('Comando expirado; solicite novamente.')
                    if action=='stop':
                        relay.stop()
                        if stream['outputActive']: obs.call('StopStream')
                        if record['outputActive']: obs.call('StopRecord')
                        if active: obs.call('TriggerMediaInputAction',inputName=SOURCE,mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP')
                        session={};write('session.json',session)
                        last='Parada solicitada ao OBS.'
                    elif action=='stop-network':
                        platform=command.get('platform')
                        if platform not in PLATFORMS: raise ValueError('Rede inválida.')
                        relay.stop(platform)
                        if not relay.active() and session.get('relay'):
                            if stream['outputActive']: obs.call('StopStream')
                            session={};write('session.json',session)
                        last='Saída '+platform+' parada; confira o encerramento na rede.'
                    elif action in ('preview','start'):
                        if active: raise ValueError('Uma sessão já está ativa.')
                        config=read('config.json',{})
                        targets=config.get('targets',[config.get('platform','instagram')])
                        if action=='start':
                            if not isinstance(targets,list) or not 1<=len(targets)<=3 or len(set(targets))!=len(targets) or any(p not in PLATFORMS for p in targets):
                                raise ValueError('Selecione redes válidas.')
                            profiles=dict(config.get('profiles',{}))
                            profiles.setdefault(config.get('platform','instagram'),{'server':config.get('server',''),'key':config.get('key','')})
                            selected={p:profiles.get(p,{}) for p in targets}
                            for p,profile in selected.items(): validate_server({**profile,'platform':p})
                        duration=prepare(obs,config)
                        if action=='start':
                            relay.start(selected)
                            obs.call('SetStreamServiceSettings',streamServiceType='rtmp_custom',streamServiceSettings={'server':INGEST.rsplit('/',1)[0],'key':INGEST.rsplit('/',1)[1],'use_auth':False})
                        continuous=action=='start' and config.get('repetitions')==0
                        session={'deadline':None if continuous else time.time()+(15 if action=='preview' else min(duration,1800)), 'action':action, 'continuous':continuous, 'platform':config.get('platform','instagram'), 'targets':targets, 'relay':action=='start'}
                        write('session.json',session)
                        obs.call('StartRecord' if action=='preview' else 'StartStream')
                        # OBS may accept the request but fail asynchronously. Verify the output.
                        for attempt in range(10):
                            if obs.call('GetRecordStatus' if action=='preview' else 'GetStreamStatus')['outputActive']:
                                break
                            time.sleep(0.5)
                        else:
                            relay.stop()
                            session={};write('session.json',session)
                            raise ValueError('OBS recebeu o comando, mas não iniciou a saída. Verifique a configuração antes de tentar novamente.')
                        last='Teste local iniciado; sem publicação.' if action=='preview' else 'Distribuição iniciada. Acompanhe cada saída abaixo; publicação nas redes não verificada.'
                    else: raise ValueError('Ação não reconhecida.')
                except ValueError as error:
                    if command.get('action')=='start' and not stream['outputActive']:
                        relay.stop()
                    last=str(error)
                except Exception:
                    if command.get('action')=='start':
                        relay.stop()
                    last='Falha no comando OBS. Verifique mídia, configuração e conexão; não houve repetição automática.'
                finally:
                    (ROOT / 'executing-command.json').rename(ROOT / 'last-command.json')
            stream=obs.call('GetStreamStatus');record=obs.call('GetRecordStatus');stats=obs.call('GetStats')
            output_active=stream['outputActive'] or record['outputActive']
            continuous=output_active and continuous_session(session)
            remaining=None if continuous else max(0,round((session.get('deadline') or 0)-time.time())) if output_active else 0
            write('status.json',{'updatedAt':int(time.time()*1000),'version':obs.call('GetVersion')['obsVersion'],'streaming':stream['outputActive'],'recording':record['outputActive'],'platform':session.get('platform'),'networks':relay.snapshot(),'cpu':round(stats['cpuUsage'],1),'fps':round(stats['activeFps'],1),'droppedFrames':stream.get('outputSkippedFrames',0),'remaining':remaining,'continuous':continuous,'lastMessage':last})
        except Exception:
            relay.stop()
            if obs:
                try: obs.ws.close()
                except Exception: pass
            obs=None
            # Leave last heartbeat stale rather than reporting an unverified stopped state.
        time.sleep(2)

if __name__=='__main__':
    main()
