"""One local OBS ingest, independent remux-only outputs; never auto-restart a live."""
import subprocess
import threading
import time
from urllib.parse import urlsplit, urlunsplit

PLATFORMS = ('instagram', 'youtube', 'tiktok')
INGEST = 'rtmp://127.0.0.1:19350/live/source'
PORTS = dict(zip(PLATFORMS, (19401, 19402, 19403)))


def target_url(profile):
    # Preserve authentication parameters in the key without changing the host.
    server = urlsplit(profile['server'])
    key = profile['key']
    if server.query or server.fragment or key.startswith('/') or '#' in key:
        raise ValueError('Separe servidor e chave nos campos correspondentes.')
    result = urlunsplit((server.scheme, server.netloc, server.path.rstrip('/')+'/'+key, '', ''))
    if urlsplit(result).hostname != server.hostname:
        raise ValueError('Destino de transmissão inválido.')
    return result


def input_url(platform):
    return f'udp://127.0.0.1:{PORTS[platform]}?fifo_size=8192&overrun_nonfatal=1&timeout=20000000'


def output_args(platform, destination):
    args = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
            '-analyzeduration','1000000','-probesize','1000000','-i',input_url(platform),
            '-map','0:v:0','-map','0:a:0','-c','copy','-bsf:a','aac_adtstoasc',
            '-rw_timeout','15000000']
    if destination.startswith('rtmps:'):
        args += ['-tls_verify','1','-ca_file','/etc/ssl/certs/ca-certificates.crt']
    return args + ['-progress','pipe:1','-stats_period','1','-f','flv',destination]


def master_args(platforms):
    outputs = '|'.join(f'[f=mpegts]udp://127.0.0.1:{PORTS[p]}?pkt_size=1316' for p in platforms)
    return ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-listen','1',
            '-rw_timeout','15000000','-i',INGEST,'-map','0:v:0','-map','0:a:0',
            '-c','copy','-f','tee',outputs]


def terminate(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


class Relay:
    def __init__(self):
        self.master = None
        self.outputs = {}

    def start(self, profiles):
        if self.active():
            raise ValueError('Distribuição já ativa.')
        destinations = {p: target_url(profile) for p, profile in profiles.items()}
        if not destinations or any(p not in PLATFORMS for p in destinations):
            raise ValueError('Selecione redes válidas.')
        self.outputs = {}
        try:
            for platform,destination in destinations.items():
                process = subprocess.Popen(output_args(platform,destination), stdout=subprocess.PIPE,
                                           stderr=subprocess.DEVNULL, text=True)
                state = {'process':process, 'state':'connecting','started':time.monotonic(),
                         'lastProgress':0, 'seconds':0.0}
                self.outputs[platform] = state
                threading.Thread(target=self._progress,args=(state,),daemon=True).start()
            self.master = subprocess.Popen(master_args(list(destinations)), stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL)
            # Do not probe the RTMP port by connecting: that would consume its single listener.
            time.sleep(0.4)
            if self.master.poll() is not None:
                raise ValueError('Não foi possível preparar a distribuição local.')
        except Exception:
            self.stop()
            raise

    @staticmethod
    def _progress(state):
        try:
            for line in state['process'].stdout:
                if line.startswith('out_time_us='):
                    try:
                        seconds = int(line.partition('=')[2])/1000000
                    except ValueError:
                        continue
                    if seconds > state['seconds']:
                        state['seconds'] = seconds
                        state['lastProgress'] = time.monotonic()
        finally:
            state['process'].stdout.close()

    def active(self):
        return any(s['process'].poll() is None for s in self.outputs.values())

    def stop(self, platform=None):
        for p,state in self.outputs.items():
            if platform is None or p == platform:
                terminate(state['process'])
                state['state'] = 'stopped'
        if not self.active():
            terminate(self.master)

    def snapshot(self):
        now = time.monotonic()
        master_failed = self.master is not None and self.master.poll() is not None
        result = {}
        for platform,state in self.outputs.items():
            if state['state'] == 'stopped':
                status = 'stopped'
            elif state['process'].poll() is not None or master_failed:
                terminate(state['process'])
                status = 'failed'
            elif (state['lastProgress'] and now-state['lastProgress'] > 20) or (not state['lastProgress'] and now-state['started'] > 45):
                terminate(state['process'])
                status = 'failed'
            else:
                status = 'sending' if state['lastProgress'] else 'connecting'
            state['state'] = status
            result[platform] = {'state':status,'seconds':round(state['seconds'],1),
                                'publicationVerified':False}
        if self.outputs and not self.active():
            terminate(self.master)
        return result
