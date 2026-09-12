"""Private file-queue controller. No HTTP listener and no public WebSocket port."""
import base64, hashlib, json, math, os, pathlib, re, subprocess, time, uuid
from urllib.parse import urlparse
from relay import Relay, INGEST, PLATFORMS

ROOT = pathlib.Path('/live-studio')
SCENE = 'VitrineCity'
SOURCE = 'Apresentacao revisada'
ANSWER_SOURCE = 'Resposta da Lia'
ANSWER_LABEL = 'Identificacao da Lia'
BASE_LABEL = 'Aviso de apresentacao gravada'

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
        import websocket
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


def probe_answer(media):
    result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
                             '-show_format', '-show_streams', '-of', 'json', str(media)],
                            capture_output=True, text=True, check=True, timeout=10)
    return json.loads(result.stdout)


class AnswerPlayback:
    """One reviewed local answer. A claimed command is never replayed after restart."""
    ACTIVE_STATES = ('claimed', 'playing')

    def __init__(self, root=ROOT, now=time.time, probe=probe_answer):
        self.root, self.now, self.probe = pathlib.Path(root), now, probe
        saved, active = self._read('answer-state.json'), self._read('answer-active.json')
        self.state = active if active and active.get('commandId') != saved.get('commandId') else saved or active or {}

    def _read(self, name):
        try:
            value = json.loads((self.root / name).read_text())
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self):
        temp = self.root / ('answer-state.' + uuid.uuid4().hex + '.tmp')
        try:
            with temp.open('x') as output:
                temp.chmod(0o600)
                json.dump(self.state, output)
                output.flush()
                os.fsync(output.fileno())
            temp.replace(self.root / 'answer-state.json')
        finally:
            temp.unlink(missing_ok=True)

    def _exclusive(self, path, value):
        with path.open('x') as output:
            path.chmod(0o600)
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())

    def _release(self):
        lock = self._read('answer-active.json')
        if lock.get('commandId') == self.state.get('commandId'):
            (self.root / 'answer-active.json').unlink(missing_ok=True)

    def snapshot(self):
        return {key: self.state.get(key) for key in
                ('answerId', 'commandId', 'state', 'sha256', 'startedAt', 'finishedAt', 'cleanupPending')
                if self.state.get(key) is not None}

    def busy(self):
        return (self.state.get('state') in self.ACTIVE_STATES or self.state.get('cleanupPending') is True
                or (self.root / 'answer-active.json').exists())

    def validate(self, command):
        answer_id, filename, digest = (command.get(k) for k in ('answerId', 'file', 'sha256'))
        duration = command.get('duration')
        if (not isinstance(answer_id, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}', answer_id)
                or not isinstance(filename, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.mp4', filename)
                or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)
                or type(duration) not in (int, float) or not math.isfinite(duration) or not 0 < duration <= 60):
            raise ValueError('Resposta da Lia inválida.')
        directory = self.root / 'lia-answers'
        manifest_path, media = directory / (answer_id + '.json'), directory / filename
        if (directory.is_symlink() or not directory.is_dir() or manifest_path.is_symlink()
                or media.is_symlink() or not manifest_path.is_file() or not media.is_file()
                or manifest_path.stat().st_size > 16384):
            raise ValueError('Resposta da Lia ausente ou não revisada.')
        try:
            manifest = json.loads(manifest_path.read_text())
            stat = media.stat()
            size = stat.st_size
            if (not isinstance(manifest, dict) or any(manifest.get(k) != command.get(k)
                                                     for k in ('answerId', 'file', 'sha256', 'duration'))
                    or manifest.get('width') != 720 or manifest.get('height') != 1280
                    or type(manifest.get('bytes')) is not int or manifest['bytes'] != size
                    or not 0 < size <= 30 * 1024 * 1024):
                raise ValueError('Metadados da resposta da Lia divergentes.')
            hasher = hashlib.sha256()
            with media.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    hasher.update(chunk)
            if hasher.hexdigest() != digest:
                raise ValueError('Arquivo da resposta da Lia foi alterado.')
            info = self.probe(media)
            after = media.stat()
            if (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError('Arquivo da resposta da Lia foi alterado.')
            if not isinstance(info, dict) or not isinstance(info.get('format'), dict) or not isinstance(info.get('streams'), list) or any(not isinstance(s, dict) for s in info['streams']):
                raise ValueError('Não foi possível validar a resposta da Lia.')
            streams = info['streams']
            videos = [s for s in streams if s.get('codec_type') == 'video']
            audios = [s for s in streams if s.get('codec_type') == 'audio']
            measured = float(info.get('format', {}).get('duration', 0))
            if (len(videos) != 1 or len(audios) != 1 or videos[0].get('codec_name') != 'h264'
                    or videos[0].get('width') != 720 or videos[0].get('height') != 1280
                    or audios[0].get('codec_name') != 'aac' or not math.isfinite(measured)
                    or not 0 < measured <= 60 or abs(measured - duration) > .25):
                raise ValueError('A resposta precisa de vídeo vertical H.264 e áudio AAC, com até 60 segundos.')
        except (OSError, TypeError, KeyError, subprocess.SubprocessError, ValueError) as error:
            if isinstance(error, ValueError) and str(error).startswith(('Metadados', 'Arquivo', 'A resposta')):
                raise
            raise ValueError('Não foi possível validar a resposta da Lia.') from error
        return media

    @staticmethod
    def _outputs(obs):
        return (obs.call('GetStreamStatus')['outputActive'], obs.call('GetRecordStatus')['outputActive'])

    @staticmethod
    def _input_exists(obs, name):
        return any(item['inputName'] == name for item in obs.call('GetInputList')['inputs'])

    def _stop_input(self, obs):
        errors, items = [], []
        try:
            if self._input_exists(obs, ANSWER_SOURCE):
                # Muting and stopping are independent attempts, so one failure cannot skip both.
                try:
                    obs.call('SetInputMute', inputName=ANSWER_SOURCE, inputMuted=True)
                except Exception as error:
                    errors.append(error)
                try:
                    obs.call('TriggerMediaInputAction', inputName=ANSWER_SOURCE,
                             mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP')
                    stopped = obs.call('GetMediaInputStatus', inputName=ANSWER_SOURCE).get('mediaState')
                    if stopped not in ('OBS_MEDIA_STATE_STOPPED', 'OBS_MEDIA_STATE_ENDED', 'OBS_MEDIA_STATE_ERROR', 'OBS_MEDIA_STATE_NONE'):
                        raise RuntimeError('Resposta ainda não parou.')
                except Exception as error:
                    errors.append(error)
        except Exception as error:
            errors.append(error)
        try:
            scenes = obs.call('GetSceneList')['scenes']
            if any(s['sceneName'] == SCENE for s in scenes):
                items = obs.call('GetSceneItemList', sceneName=SCENE)['sceneItems']
        except Exception as error:
            errors.append(error)
        for item in items:
            if item.get('sourceName') in (ANSWER_SOURCE, ANSWER_LABEL):
                try:
                    obs.call('SetSceneItemEnabled', sceneName=SCENE, sceneItemId=item['sceneItemId'], sceneItemEnabled=False)
                except Exception as error:
                    errors.append(error)
        if errors:
            raise RuntimeError('Não foi possível confirmar a retirada da resposta.') from errors[0]

    def finish(self, obs, session, state='finished', resume=True):
        if self.state.get('state') not in self.ACTIVE_STATES and not self.state.get('cleanupPending') and not (self.root / 'answer-active.json').exists():
            return False
        self.state.update(cleanupPending=True, cleanupResume=resume)
        self._save()  # Preserve an explicit stop across a crash during cleanup.
        errors = []
        def attempt(callback):
            try:
                return callback()
            except Exception as error:
                errors.append(error)
                return None
        attempt(lambda: self._stop_input(obs))
        outputs = attempt(lambda: self._outputs(obs))
        streaming, recording = outputs if outputs is not None else (None, None)
        preview = self.state.get('mode') == 'preview-answer'
        if preview and recording and self.state.get('recordIntent'):
            attempt(lambda: obs.call('StopRecord'))
            status = attempt(lambda: obs.call('GetRecordStatus'))
            recording = status['outputActive'] if status is not None else None
            if recording is not False:
                errors.append(RuntimeError('Gravação local ainda não parou.'))
        if self.state.get('baseLabelId') is not None:
            attempt(lambda: obs.call('SetSceneItemEnabled', sceneName=SCENE, sceneItemId=self.state['baseLabelId'],
                                    sceneItemEnabled=self.state.get('baseLabelEnabled', False)))
        # A pause, original deadline or stopped output must never be undone by an answer.
        can_resume = (preview and streaming is False and recording is False) or (not preview and (streaming or recording) and not session_expired(session, self.now()))
        if resume and not errors and can_resume and self.state.get('resumeBase') and self.state.get('basePauseIntent'):
            def restore_base():
                if self._input_exists(obs, SOURCE):
                    obs.call('TriggerMediaInputAction', inputName=SOURCE,
                             mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY')
            attempt(restore_base)
        if not errors and self.state.get('baseMuteIntent'):
            attempt(lambda: obs.call('SetInputMute', inputName=SOURCE, inputMuted=self.state.get('baseMuted', False)))
        if preview and self.state.get('sceneChanged') and self.state.get('previousScene') and self.state['previousScene'] != SCENE:
            attempt(lambda: obs.call('SetCurrentProgramScene', sceneName=self.state['previousScene']))
        # Failed cleanup retains its exclusive lock; later ticks only retry cleanup, never playback.
        self.state.update(state='failed' if errors else state, cleanupPending=bool(errors),
                          cleanupResume=resume, finishedAt=None if errors else int(self.now() * 1000))
        self._save()
        if not errors:
            self._release()
        return preview and not errors

    def recover(self, obs, session):
        # Recovery only removes the old overlay; never calls RESTART, StartRecord or StartStream.
        active = self._read('answer-active.json')
        if active and active.get('commandId') == self.state.get('commandId'):
            claims = self.root / 'answer-command-claims'
            claims.mkdir(exist_ok=True)
            try:
                self._exclusive(claims / (active['commandId'] + '.json'), active)
            except FileExistsError:
                pass
            if self.state.get('state') in ('finished', 'interrupted', 'failed') and not self.state.get('cleanupPending'):
                self._release()  # Cleanup had already been confirmed before the crash.
                return False
        if self.state.get('state') in self.ACTIVE_STATES or self.state.get('cleanupPending') or (self.root / 'answer-active.json').exists():
            return self.finish(obs, session, state='failed' if self.state.get('cleanupPending') else 'interrupted',
                               resume=self.state.get('cleanupResume', True))
        return False

    def start(self, obs, command, session):
        mode, command_id = command.get('action'), command.get('id')
        created_at = command.get('createdAt')
        if (mode not in ('play-answer', 'preview-answer') or not isinstance(command_id, str)
                or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}', command_id)
                or type(created_at) not in (int, float) or not math.isfinite(created_at)
                or not -5000 <= self.now() * 1000 - created_at <= 60000):
            raise ValueError('Comando da resposta inválido.')
        if self.busy():
            raise ValueError('Uma resposta da Lia já está em andamento.')
        media = self.validate(command)
        streaming, recording = self._outputs(obs)
        if mode == 'play-answer' and (not (streaming or recording) or session_expired(session, self.now())):
            raise ValueError('Inicie primeiro um teste ou use uma transmissão já ativa.')
        if mode == 'preview-answer' and (streaming or recording):
            raise ValueError('Pare a sessão atual antes do teste local da resposta.')
        previous = obs.call('GetCurrentProgramScene').get('currentProgramSceneName')
        if mode == 'play-answer' and previous != SCENE:
            raise ValueError('A cena do estúdio não está ativa.')
        initial = {key: command[key] for key in ('answerId', 'file', 'sha256', 'duration')}
        initial.update(commandId=command_id, mode=mode, state='claimed', previousScene=previous,
                       startedAt=int(self.now() * 1000), deadline=self.now() + min(60, command['duration'] + 2),
                       resumeBase=False)
        claims = self.root / 'answer-command-claims'
        claims.mkdir(exist_ok=True)
        try:
            self._exclusive(self.root / 'answer-active.json', initial)
        except FileExistsError:
            raise ValueError('Uma resposta da Lia já está em andamento.')
        try:
            self._exclusive(claims / (command_id + '.json'), initial)
        except FileExistsError:
            (self.root / 'answer-active.json').unlink(missing_ok=True)
            raise ValueError('Este comando da Lia já foi recebido; não será repetido.')
        self.state = initial
        self._save()
        try:
            scenes = obs.call('GetSceneList')['scenes']
            if not any(scene['sceneName'] == SCENE for scene in scenes):
                obs.call('CreateScene', sceneName=SCENE)
            items = obs.call('GetSceneItemList', sceneName=SCENE)['sceneItems']
            if self._input_exists(obs, SOURCE):
                self.state['resumeBase'] = obs.call('GetMediaInputStatus', inputName=SOURCE).get('mediaState') == 'OBS_MEDIA_STATE_PLAYING'
                self.state['baseMuted'] = obs.call('GetInputMute', inputName=SOURCE)['inputMuted']
            base_label = next((item for item in items if item.get('sourceName') == BASE_LABEL), None)
            if base_label:
                self.state.update(baseLabelId=base_label['sceneItemId'], baseLabelEnabled=base_label.get('sceneItemEnabled', False))
            self._save()  # Persist restoration details before pausing or hiding anything.
            settings = {'is_local_file': True, 'local_file': str(media), 'looping': False,
                        'restart_on_activate': False, 'close_when_inactive': False, 'clear_on_media_end': False}
            inputs = obs.call('GetInputList')['inputs']
            if not any(item['inputName'] == ANSWER_SOURCE for item in inputs):
                obs.call('CreateInput', sceneName=SCENE, inputName=ANSWER_SOURCE, inputKind='ffmpeg_source',
                         inputSettings=settings, sceneItemEnabled=False)
            else:
                obs.call('SetInputMute', inputName=ANSWER_SOURCE, inputMuted=True)
                obs.call('SetInputSettings', inputName=ANSWER_SOURCE, inputSettings=settings, overlay=True)
            obs.call('SetInputMute', inputName=ANSWER_SOURCE, inputMuted=True)
            label_settings = {'text': 'Lia · assistente com IA\nRetrato estático com voz sintetizada',
                              'font': {'face': 'DejaVu Sans', 'size': 23, 'flags': 0},
                              'color1': 0xFFFFFFFF, 'color2': 0xFFFFFFFF, 'outline': True}
            if not any(item['inputName'] == ANSWER_LABEL for item in inputs):
                obs.call('CreateInput', sceneName=SCENE, inputName=ANSWER_LABEL, inputKind='text_ft2_source_v2',
                         inputSettings=label_settings, sceneItemEnabled=False)
            else:
                obs.call('SetInputSettings', inputName=ANSWER_LABEL, inputSettings=label_settings, overlay=True)
            # Recheck the original session immediately before exposing answer audio/video.
            streaming, recording = self._outputs(obs)
            if mode == 'play-answer' and (not (streaming or recording) or session_expired(session, self.now())):
                raise ValueError('A sessão terminou antes da resposta da Lia.')
            if mode == 'preview-answer' and (streaming or recording):
                raise ValueError('Outra sessão começou antes do teste local.')
            if self.state.get('resumeBase'):
                self.state.update(basePauseIntent=True, baseMuteIntent=True)
                self._save()
                obs.call('SetInputMute', inputName=SOURCE, inputMuted=True)
                obs.call('TriggerMediaInputAction', inputName=SOURCE, mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE')
            if base_label:
                obs.call('SetSceneItemEnabled', sceneName=SCENE, sceneItemId=base_label['sceneItemId'], sceneItemEnabled=False)
            items = obs.call('GetSceneItemList', sceneName=SCENE)['sceneItems']
            for name, y in ((ANSWER_SOURCE, 0.0), (ANSWER_LABEL, 1155.0)):
                item = next(item for item in items if item.get('sourceName') == name)
                obs.call('SetSceneItemTransform', sceneName=SCENE, sceneItemId=item['sceneItemId'],
                         sceneItemTransform={'positionX': 0.0 if name == ANSWER_SOURCE else 22.0, 'positionY': y})
                obs.call('SetSceneItemIndex', sceneName=SCENE, sceneItemId=item['sceneItemId'], sceneItemIndex=len(items) - 1)
                obs.call('SetSceneItemEnabled', sceneName=SCENE, sceneItemId=item['sceneItemId'], sceneItemEnabled=True)
            if mode == 'preview-answer':
                self.state.update(sceneChanged=True, recordIntent=True)
                self._save()
                obs.call('SetCurrentProgramScene', sceneName=SCENE)
                obs.call('StartRecord')
                if not obs.call('GetRecordStatus')['outputActive']:
                    raise ValueError('OBS não confirmou o teste local da resposta.')
            self.state.update(startedAt=int(self.now() * 1000), deadline=self.now() + min(60, command['duration'] + 2))
            self._save()
            obs.call('TriggerMediaInputAction', inputName=ANSWER_SOURCE, mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART')
            obs.call('SetInputMute', inputName=ANSWER_SOURCE, inputMuted=False)
            self.tick(obs, session)
            return self.snapshot()
        except Exception:
            self.finish(obs, session, state='failed')
            raise

    def tick(self, obs, session):
        if self.state.get('cleanupPending'):
            return self.finish(obs, session, state='failed', resume=self.state.get('cleanupResume', False))
        if self.state.get('state') not in self.ACTIVE_STATES:
            return False
        streaming, recording = self._outputs(obs)
        if not (streaming or recording) or (self.state.get('mode') != 'preview-answer' and session_expired(session, self.now())):
            return self.finish(obs, session, state='interrupted', resume=False)
        status = obs.call('GetMediaInputStatus', inputName=ANSWER_SOURCE).get('mediaState')
        if status == 'OBS_MEDIA_STATE_ENDED':
            return self.finish(obs, session)
        if status in ('OBS_MEDIA_STATE_ERROR', 'OBS_MEDIA_STATE_STOPPED') or self.now() >= self.state.get('deadline', 0):
            return self.finish(obs, session, state='failed')
        if status == 'OBS_MEDIA_STATE_PLAYING' and self.state['state'] != 'playing':
            self.state['state'] = 'playing'
            self._save()
        return False

def main():
    obs = None
    relay = Relay()
    answers = AnswerPlayback()
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
                if answers.recover(obs, session):
                    session={};write('session.json',session)
            if answers.tick(obs, session):
                session={};write('session.json',session)
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
                answers.finish(obs, session, state='interrupted', resume=False)
                relay.stop()
                if obs.call('GetStreamStatus')['outputActive']: obs.call('StopStream')
                if obs.call('GetRecordStatus')['outputActive']: obs.call('StopRecord')
                if answers._input_exists(obs, SOURCE):
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
                        answers.finish(obs, session, state='interrupted', resume=False)
                        relay.stop()
                        if obs.call('GetStreamStatus')['outputActive']: obs.call('StopStream')
                        if obs.call('GetRecordStatus')['outputActive']: obs.call('StopRecord')
                        if active and answers._input_exists(obs, SOURCE):
                            obs.call('TriggerMediaInputAction',inputName=SOURCE,mediaAction='OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP')
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
                    elif action in ('play-answer', 'preview-answer'):
                        answers.start(obs, command, session)
                        if action == 'preview-answer':
                            session={'deadline':answers.state['deadline'], 'action':action, 'continuous':False, 'relay':False}
                            write('session.json',session)
                        last='Resposta da Lia em teste local; sem transmissão.' if action=='preview-answer' else 'Resposta da Lia recebida pelo OBS; acompanhe seu estado abaixo.'
                    elif action in ('preview','start'):
                        if answers.busy():
                            raise ValueError('Aguarde a retirada confirmada da resposta da Lia antes de iniciar outra sessão.')
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
            write('status.json',{'updatedAt':int(time.time()*1000),'version':obs.call('GetVersion')['obsVersion'],'streaming':stream['outputActive'],'recording':record['outputActive'],'platform':session.get('platform'),'networks':relay.snapshot(),'cpu':round(stats['cpuUsage'],1),'fps':round(stats['activeFps'],1),'droppedFrames':stream.get('outputSkippedFrames',0),'remaining':remaining,'continuous':continuous,'lastMessage':last,'answer':answers.snapshot()})
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
