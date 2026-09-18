#!/usr/bin/env python3
"""Host-specific LIA rollout. Default: read-only plan. No git pull, DB restore, or worker deployment.

Modes: plano, implantar, ativar-workers, desativar-workers, voltar, status.
A mutating mode requires --confirmar-troca. Workers need the EXISTING gateway token.
A failed health/configuration check triggers a best-effort code-only rollback.
No claim of a completed worker task is made by the gateway quotation probe.
"""
from __future__ import annotations
import argparse
from contextlib import closing
import copy
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HOST = 'srv1901029'
PROJECT = 'vitrinecity'
APP_ROOT = Path('/opt/vitrinecity')
ROOT = Path('/var/lib/vitrinecity-lia-deploy')
STAGED = Path('/var/backups/vitrinecity-lia-retest-bixywgeu')
DATA = Path('/var/lib/docker/volumes/vitrinecity_vitrinecity_data/_data')
REPO = 'markentingimperio-debug/vitrinecity'
PR = 210
ORIGINAL_IMAGE = 'sha256:70fba9043ed420c8d3eb0a3e2904aeccd2cb593db598c450e59345dd95f47628'
GATEWAY = 'https://lia.vitrinecity.com'
SENTINEL = 'LIA_ROLLOUT_V9'
BASE_COMPOSE = tuple(str(APP_ROOT / name) for name in (
    'docker-compose.yml', 'docker-compose.override.yml', 'docker-compose.lia-1d1958f.yml',
    'docker-compose.social-20260916.yml', 'docker-compose.social-profile-20260916.yml',
    'docker-compose.social-agent-20260916.yml'))
PAYLOAD = {'app/server.js': 'b1442820e73432fb35fcaca56e79d3935afeea29b45b22f11d2943d86a788f7d', 'app/vitriny-neural/chat-engine.js': '21ea860eb44f4bba2f6aa9399758407fb93e581c42c40d5b378d5a5ca79b4cb9', 'app/vitriny-neural/chat-api.js': 'c5dd647278e763db66f16529abf4235ae5d9ad9d68301bd0fdba3f65c05bc237', 'app/vitriny-neural/lia-chat-operations.js': 'f74d1190347d9cbffbf86870658dda08ff8da83afe368ef6c03bb6132154b07f', 'app/public/neural-workspace.js': '79b1e820bd5646a58f6d7d3a6c12b954305915407db618f5485aebdb6d52cc9f', 'app/public/neural-workspace.html': '84c39cf71a8d1a5c323588b1659dc4ba68cc2072fcfa4854bc02d2f0cc0b1251', 'app/public/neural-workspace.css': 'bbc9bc34cd3e2e062d627ba07f2ebeb77a2e15a953de46421337e1bedc4749d7'}
ORIGINAL = {'app/server.js': '10c359c8d3d98b5a2b746b65b7a279ec0582d7d4147ac1b7801a247d0dbccfa7', 'app/vitriny-neural/chat-engine.js': 'c60e7af4022f66b90f96a5ebff8812aa1a9f88ad88fcccdc728b5e9245799eb5', 'app/vitriny-neural/chat-api.js': 'f93f838bad8f08b5cb8270a8257d96fe2037d96040072acf3cd64cf4d67940c9', 'app/vitriny-neural/lia-chat-operations.js': None, 'app/public/neural-workspace.js': '2505e0a7c2b8866632e59ec1df287460cc4b518ff71a7ce90f4a772047b03461', 'app/public/neural-workspace.html': '4c0c4d678e7df08c9e8606b98f5ab0a3e95ea2f147a01967b78d49188a4f9f79', 'app/public/neural-workspace.css': '1d2540d804f9bec2cad04f5c20e76c48bf3ad263a1f26cc4131fe95fae009e3d'}
TEST_HASHES = {'app/scripts/test-vitriny-neural-chat.mjs': 'fddd99cedf1cc7f20df0fc446cd18e7580b6642de509a9271c3d6d1a49b2bebd', 'app/scripts/test-vitriny-neural-chat-api.mjs': '38e78697641d8a37146afb942ab9616c4e5eef9bd4a7d1301564c5d0d0566220', 'app/scripts/test-vitriny-neural-lia-chat-operations.mjs': 'c9d3bcc1c7e288f42783a370e8310b7725612e89d0f44341219088a45e0f5e03', 'app/scripts/test-lia-preserve-kling.mjs': 'efe7ec40a3977d7a097b2335d45a91b8613719abb2524e31b7aca908126558ea'}
GUARDS = ('app/package.json', 'app/package-lock.json', 'app/vitriny-neural/paid-chat-runtime.js',
          'app/vitriny-neural/coin-wallet-adapter.js', 'app/vitrine-coins-wallet.js')
REQUIRED_CI = ('Security audit', 'Vitriny Neural', 'Verify release', 'LIA Preserve Kling Validation',
               'LIA deploy package tests')
ALLOWED_ENV = {'LIA_CHAT_OPERATIONS_ENABLED', 'LIA_OPERATIONS_URL', 'LIA_OPERATIONS_TOKEN',
               'LIA_BROWSER_PRICE_MICRO_BRL', 'LIA_MEDIA_PRICE_MICRO_BRL'}
EXPECTED_MOUNTS = {
    '/data': ('volume', 'vitrinecity_vitrinecity_data', str(DATA), True),
    '/live-studio': ('volume', 'vitrinecity_live_studio', '/var/lib/docker/volumes/vitrinecity_live_studio/_data', True),
    '/var/lib/vitrinecity-kling': ('volume', 'vitrinecity_kling_credentials', '/var/lib/docker/volumes/vitrinecity_kling_credentials/_data', True),
    '/private-courses': ('bind', None, '/opt/vitrinecity/private-courses', False),
}
SAFE_ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'HOME': '/root', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}

class Blocked(RuntimeError):
    """Only fixed public codes; never include command output or configuration values."""

def need(condition, code):
    if not condition:
        raise Blocked(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def controlled(path: Path, private=False):
    need(path.is_absolute(), 'CAMINHO_NAO_ABSOLUTO')
    for item in [*reversed(path.parents), path]:
        s = item.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, 'DIRETORIO_NAO_PROTEGIDO')
    if private:
        need(not path.stat().st_mode & 0o077, 'DIRETORIO_DEVE_SER_PRIVADO')

def private_read(path, limit=8*1024**2):
    path = Path(path)
    controlled(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o077 and s.st_size <= limit,
             'ARQUIVO_PRIVADO_INVALIDO')
        data = f.read(limit + 1)
        need(len(data) <= limit, 'ARQUIVO_MUITO_GRANDE')
        return data

def write_new(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    controlled(path.parent)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())

def atomic_json(path, obj):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8))
    write_new(temporary, json.dumps(obj, ensure_ascii=True, indent=2).encode())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def load(path):
    return json.loads(private_read(path))

def command(args, *, data=None, timeout=60, log=None, allow_failure=False):
    """No shell; no ambient Compose overrides or authentication/proxy environment."""
    output = None
    try:
        if log is not None:
            output = os.fdopen(os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600), 'ab')
        p = subprocess.run([str(x) for x in args], input=data, cwd=APP_ROOT, env=SAFE_ENV,
                           stdout=output if output else subprocess.PIPE,
                           stderr=output if output else subprocess.PIPE, timeout=timeout, check=False)
        if not allow_failure:
            need(p.returncode == 0, 'COMANDO_FALHOU_CONSULTE_LOG_PRIVADO')
        return p
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked('COMANDO_INDISPONIVEL_OU_TIMEOUT') from None
    finally:
        if output: output.close()

def inspect(cid):
    values = json.loads(command(['docker', 'inspect', '--type=container', cid]).stdout)
    need(len(values) == 1, 'CONTAINER_NAO_IDENTIFICADO')
    return values[0]

def app_optional():
    ids = command(['docker', 'ps', '-a', '--no-trunc', '--filter', 'label=com.docker.compose.project='+PROJECT,
                   '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}}']).stdout.decode().splitlines()
    need(len(ids) <= 1, 'ESPERADO_UM_UNICO_APP')
    if not ids: return None
    need(re.fullmatch('[0-9a-f]{64}', ids[0]) is not None, 'ID_DE_CONTAINER_INVALIDO')
    return inspect(ids[0])

def app():
    result=app_optional();need(result is not None,'APP_NAO_ENCONTRADO');return result

def mounts(info):
    return sorted(json.dumps(m, sort_keys=True, separators=(',', ':')) for m in info.get('Mounts', []))

def environment(info):
    rows = info.get('Config', {}).get('Env', [])
    values = dict(v.split('=', 1) for v in rows if '=' in v)
    need(len(values) == len(rows), 'AMBIENTE_DUPLICADO_OU_INVALIDO')
    return values

def healthy(info):
    s = info.get('State', {})
    return s.get('Running') is True and s.get('Health', {}).get('Status') == 'healthy' and not s.get('Paused') and not s.get('Restarting')

def topology(info):
    actual = {m['Destination']: (m.get('Type'), m.get('Name'), m.get('Source'), m.get('RW')) for m in info.get('Mounts', [])}
    need(actual == EXPECTED_MOUNTS and len(info['Mounts']) == len(EXPECTED_MOUNTS), 'MONTAGENS_DIFERENTES')
    need(info.get('Name') == '/'+PROJECT+'-app-1', 'NOME_DO_APP_DIFERENTE')
    need(urllib.parse.urlsplit(environment(info).get('SITE_URL','')).hostname in ('vitrinecity.com','www.vitrinecity.com'),
         'SITE_DO_APP_DIFERENTE')
    need(not info.get('State', {}).get('Paused') and not info.get('State', {}).get('Restarting'), 'APP_EM_ESTADO_INCOMPATIVEL')

def runtime_hashes(cid, paths):
    js = r'''import fs from 'node:fs'; import {createHash} from 'node:crypto';
const out={}; for(const p of JSON.parse(process.argv[1])){
 try{const f='/'+p,s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.size>8388608||!fs.realpathSync(f).startsWith('/app/'))throw Error();
 out[p]=createHash('sha256').update(fs.readFileSync(f)).digest('hex');}
 catch(e){if(e.code==='ENOENT')out[p]=null;else process.exit(3);}}
process.stdout.write(JSON.stringify(out));'''
    return json.loads(command(['docker','exec','-w','/app',cid,'node','--input-type=module','-e',js,json.dumps(list(paths))]).stdout)

def verify_payload(cid, expected):
    need(runtime_hashes(cid, expected) == expected, 'CODIGO_ATIVO_DIFERENTE')

def pending():
    controlled(DATA)
    p = DATA/'vitrinecity.db'
    need(stat.S_ISREG(p.lstat().st_mode), 'BANCO_NAO_REGULAR')
    with closing(sqlite3.connect(p.as_uri()+'?mode=ro', uri=True, timeout=3)) as db:
        total = 0
        for table, sql in (
            ('neural_chat_requests', "status IN ('awaiting_confirmation','queued','running','interrupted')"),
            ('neural_paid_chat_requests', "state NOT IN ('quoted','settled','released')"),
            ('lia_chat_operations', "status NOT IN ('completed','failed','cancelled','released')"),
            ('neural_durable_jobs', "status IN ('queued','leased','dispatched','unknown')")):
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                total += db.execute('SELECT COUNT(*) FROM '+table+' WHERE '+sql).fetchone()[0]
    return total

def consumers():
    return command(['docker','ps','--no-trunc','--filter','volume=vitrinecity_vitrinecity_data','--format','{{.ID}}']).stdout.decode().splitlines()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise Blocked('REDIRECIONAMENTO_RECUSADO')

def public_json(url):
    need(urllib.parse.urlsplit(url).hostname in ('api.github.com','sonarcloud.io'), 'ORIGEM_NAO_PERMITIDA')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, headers={'User-Agent':'LIA-Release-9','Accept':'application/json'}), timeout=25) as r:
            data = r.read(4*1024**2+1)
        need(len(data) <= 4*1024**2, 'RESPOSTA_DE_REVISAO_MUITO_GRANDE')
        return json.loads(data)
    except (OSError, ValueError, urllib.error.URLError):
        raise Blocked('REVISAO_PUBLICA_INDISPONIVEL_NAO_HOUVE_IMPLANTACAO') from None

def validate_gate(revision, pr, runs, sonar_prs, gate):
    need(re.fullmatch('[0-9a-f]{40}', revision or '') is not None, 'REVISAO_COMPLETA_OBRIGATORIA')
    need(pr.get('head', {}).get('sha') == revision, 'REVISAO_NAO_E_A_ATUAL_DO_PR')
    selected = {}
    for r in sorted(runs.get('workflow_runs', []), key=lambda x:x.get('id', 0), reverse=True):
        if r.get('head_sha') == revision and r.get('event') == 'pull_request':
            selected.setdefault(r.get('name'), r)
    need(all(selected.get(n, {}).get('conclusion') == 'success' and selected[n].get('status') == 'completed'
             for n in REQUIRED_CI), 'TESTES_CI_PENDENTES_OU_REPROVADOS')
    rows = [p for p in sonar_prs.get('pullRequests',[]) if str(p.get('key')) == str(PR)]
    need(len(rows) == 1 and rows[0].get('commit',{}).get('sha') == revision, 'SONAR_AINDA_NAO_ANALISOU_ESTA_REVISAO')
    need(rows[0].get('status',{}).get('qualityGateStatus') == 'OK' and gate.get('projectStatus',{}).get('status') == 'OK',
         'SONAR_NAO_APROVOU_A_REVISAO')
    return {'revision':revision,'requiredWorkflowsPassed':True,'sonarSameRevisionApproved':True}

def quality(revision):
    need(re.fullmatch('[0-9a-f]{40}', revision or '') is not None, 'INFORME_REVISAO_COMPLETA')
    base = 'https://api.github.com/repos/'+REPO
    project = 'markentingimperio-debug_vitrinecity'
    return validate_gate(revision, public_json(base+'/pulls/210'),
        public_json(base+'/actions/runs?event=pull_request&head_sha='+revision+'&per_page=100'),
        public_json('https://sonarcloud.io/api/project_pull_requests/list?project='+project),
        public_json('https://sonarcloud.io/api/qualitygates/project_status?projectKey='+project+'&pullRequest=210'))

def verify_retest():
    r=load(STAGED/'retest-report.json')
    need(r.get('status')=='STAGED_NOT_DEPLOYED' and r.get('candidateHashes')==PAYLOAD and r.get('tests')=='passed' and
         r.get('deployed') is False and r.get('candidateCodeUnchanged') is True and r.get('activeCodeUnchanged') is True and
         r.get('testSummary',{}).get('counts')=={'tests':52,'pass':52,'fail':0,'cancelled':0,'skipped':0,'todo':0}, 'RETESTE_NAO_CONFIRMADO')
    for p,h in {**PAYLOAD, **TEST_HASHES}.items():
        need(sha(private_read(STAGED/'candidate'/p))==h, 'CANDIDATA_OU_TESTES_ALTERADOS')
    return r

def file_hash(path, deadline=None):
    controlled(path.parent)
    fd=os.open(path, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    h=hashlib.sha256()
    with os.fdopen(fd,'rb') as f:
        a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode) and a.st_uid==0 and not a.st_mode & 0o077,'BACKUP_NAO_PRIVADO')
        while chunk:=f.read(1024**2):
            need(deadline is None or time.monotonic()<deadline, 'VERIFICACAO_BACKUP_TIMEOUT')
            h.update(chunk)
        b=os.fstat(f.fileno());need((a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_size,b.st_mtime_ns,b.st_ctime_ns),'BACKUP_MUDOU_DURANTE_LEITURA')
    return h.hexdigest()

def find_backup():
    paths=list(Path('/var/backups').glob('vitrinecity-lia-online-*/online-backup-report.json'))
    paths.sort(key=lambda p:p.lstat().st_mtime_ns, reverse=True)
    for p in paths:
        try:
            r=load(p);d=r.get('data',{});b=d.get('database',{})
            if (r.get('status')=='ONLINE_BACKUP_COMPONENTS_VERIFIED' and r.get('directory')==str(p.parent) and
                r.get('sameStartTime') is True and r.get('settingsUnchanged') is True and
                d.get('allRegularFilesVerified') is True and d.get('sourceFilesStableAcrossChecks') is True and
                d.get('fileFailures')==0 and d.get('specialEntriesNotCopied')==0 and b.get('integrityCheck')=='ok'):
                return p.parent,r
        except (OSError,ValueError,Blocked):
            continue
    raise Blocked('BACKUP_ONLINE_VALIDADO_NAO_ENCONTRADO')

def verify_backup(directory, report):
    manifest=load(directory/'manifest.private.json')
    files=manifest.get('copiedFiles',{})
    need(len(files)==report['data']['regularFilesVerified'] and not manifest.get('failedFiles'), 'MANIFESTO_DO_BACKUP_INCONSISTENTE')
    deadline=time.monotonic()+1200
    for relative,info in files.items():
        parts=Path(relative).parts
        need(parts and not Path(relative).is_absolute() and '..' not in parts, 'CAMINHO_DO_BACKUP_INVALIDO')
        need(file_hash(directory/'data'/relative,deadline)==info['sha256'],'ARQUIVO_DO_BACKUP_NAO_CONFERE')
    need(file_hash(directory/'data/vitrinecity.db',deadline)==report['data']['database']['sha256'],'BANCO_DO_BACKUP_NAO_CONFERE')
    return {'directory':str(directory),'regularFilesVerified':len(files),'sqliteBackupHashVerified':True,
            'jointPointInTimeSnapshot':False,'offHostBackup':False}

def obtain_token(info, token_file=None):
    if token_file:
        token=private_read(Path(token_file),8192).decode().strip()
    else:
        token=environment(info).get('LIA_OPERATIONS_TOKEN','')
        if not token:
            with open('/dev/tty','w') as tty:
                token=getpass.getpass('Token EXISTENTE do Operations Gateway (entrada oculta): ',stream=tty).strip()
    need(re.fullmatch(r'[A-Za-z0-9._~+/=\-]{32,4096}',token or '') is not None,'TOKEN_OPERACIONAL_INVALIDO')
    need(token not in {v for k,v in environment(info).items() if re.search(r'(API_KEY|SECRET|PASSWORD)$',k)},'NAO_USE_CHAVE_DE_PROVEDOR_COMO_TOKEN')
    return token

GATEWAY_JS = r'''import fs from 'node:fs';
try {
 const {token}=JSON.parse(fs.readFileSync(0,'utf8'));
 const url='https://lia.vitrinecity.com/v1/operations/quote';
 const body=JSON.stringify({instruction:'Abra https://vitrinecity.com e tire uma captura'});
 const call=auth=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body,redirect:'error',signal:AbortSignal.timeout(15000)});
 const denied=await call(false);await denied.body?.cancel();if(![401,403].includes(denied.status))throw Error('gateway_requires_authentication');
 const r=await call(true);const reader=r.body.getReader();let chunks=[],size=0;
 while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>32768){await reader.cancel();throw Error('gateway_response_limit');}chunks.push(Buffer.from(x.value));}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!r.ok||data.ok!==true||data.kind!=='browser'||data.supported!==true)throw Error('gateway_quote_not_confirmed');
 console.log(JSON.stringify({gatewayAuthenticated:true,browserQuoteSupported:true,paidTaskExecuted:false,workerEndToEndVerified:false}));
} catch {console.log(JSON.stringify({gatewayAuthenticated:false}));process.exitCode=2;}'''

def gateway_probe(cid,token):
    p=command(['docker','exec','-i','-w','/app',cid,'node','--import','/app/security-fetch-guard.js','--input-type=module','-e',GATEWAY_JS],
              data=json.dumps({'token':token}).encode(),timeout=40,allow_failure=True)
    need(p.returncode==0,'GATEWAY_NAO_VALIDADO_APP_NAO_SERA_TROCADO')
    result=json.loads(p.stdout);need(result.get('gatewayAuthenticated') is True,'GATEWAY_NAO_AUTENTICADO')
    return result

def escape_values(value):
    if isinstance(value,str):return value.replace('$','$$')
    if isinstance(value,list):return [escape_values(v) for v in value]
    if isinstance(value,dict):return {k:escape_values(v) for k,v in value.items()}
    return value

def compose(paths):
    c=['docker','compose','--project-directory',str(APP_ROOT),'-p',PROJECT]
    for p in paths:c.extend(['-f',str(p)])
    return c

def render(paths):
    return json.loads(command(compose(paths)+['config','--format','json']).stdout)

def runtime_environment_from_render(document):
    """Compose config serializes literal dollars as $$; decode only its environment values."""
    values = document['services']['app']['environment']
    need(isinstance(values, dict) and all(isinstance(v, str) for v in values.values()),
         'AMBIENTE_COMPOSE_NAO_RESOLVIDO')
    need(all(re.search(r'(?<!\$)(?:\$\$)*\$(?!\$)', v) is None for v in values.values()),
         'SERIALIZACAO_COMPOSE_DESCONHECIDA')
    return {k:v.replace('$$', '$') for k,v in values.items()}

def current_paths(info):
    label=info['Config'].get('Labels',{}).get('com.docker.compose.project.config_files','')
    paths=tuple(label.split(','))
    need(paths and all(Path(p).is_absolute() for p in paths),'COMPOSE_NAO_IDENTIFICADO')
    for p in paths:controlled(Path(p).parent)
    return paths

def snapshot_settings(paths):
    out={}
    for p in (*paths,str(APP_ROOT/'.env')):
        p=Path(p);controlled(p.parent)
        need(stat.S_ISREG(p.lstat().st_mode) and p.stat().st_uid==0 and not p.stat().st_mode&0o022,'CONFIGURACAO_NAO_PROTEGIDA')
        data=p.read_bytes();need(len(data)<=8*1024**2,'CONFIGURACAO_MUITO_GRANDE')
        out[str(p)]=sha(data)
    return out

def intended_env(info,enabled,token=None):
    env=environment(info).copy()
    env['LIA_CHAT_OPERATIONS_ENABLED']='true' if enabled else 'false'
    if enabled:
        need(bool(token),'TOKEN_AUSENTE')
        env.update({'LIA_OPERATIONS_URL':GATEWAY,'LIA_OPERATIONS_TOKEN':token,
                    'LIA_BROWSER_PRICE_MICRO_BRL':'104167','LIA_MEDIA_PRICE_MICRO_BRL':'520833'})
    need({k:v for k,v in env.items() if k not in ALLOWED_ENV}=={k:v for k,v in environment(info).items() if k not in ALLOWED_ENV},'CONFIGURACAO_FORA_DO_ESCOPO')
    return env

def frozen_files(work,info,old_image_ref,new_ref,env):
    original=render(current_paths(info))
    need(original.get('name')==PROJECT and 'app' in original.get('services',{}),'COMPOSE_DIVERGENTE')
    appdef=original['services']['app']
    need(not appdef.get('pre_start') and not appdef.get('post_start') and not appdef.get('pre_stop'),'HOOKS_DE_CICLO_DE_VIDA_EXIGEM_REVISAO')
    base=copy.deepcopy(original);new=copy.deepcopy(original)
    base['services']['app']['image']=old_image_ref
    base['services']['app']['environment']=escape_values(environment(info))
    new['services']['app']['image']=new_ref
    new['services']['app']['environment']=escape_values(env)
    for filename,document in (('before.private.json',base),('after.private.json',new)):
        path=work/filename
        # The original render is already escaped for reuse. Escape only replacement env values.
        write_new(path,json.dumps(document,ensure_ascii=True,indent=2).encode())
        checked=render([path])
        need(checked['services']['app']['environment']==document['services']['app']['environment'],'EXPANSAO_DE_CONFIGURACAO_DIVERGENTE')
        expected_env = environment(info) if filename=='before.private.json' else env
        need(runtime_environment_from_render(checked)==expected_env,'AMBIENTE_CONGELADO_DIVERGENTE')
        need(checked.get('volumes')==original.get('volumes') and checked.get('networks')==original.get('networks'),'REDE_OU_VOLUMES_DIVERGENTES')
    return base,new

def candidate_image(work,info):
    differences=command(['docker','diff',info['Id']]).stdout.decode().splitlines()
    need(not any(line[2:]=='/app' or line[2:].startswith('/app/') for line in differences),
         'IMAGEM_BASE_TEM_MODIFICACOES_NAO_VERSIONADAS_NO_CONTAINER')
    base='vitrinecity-lia:base-'+work.name
    tag='vitrinecity-lia:candidate-'+work.name
    command(['docker','image','tag',info['Image'],base])
    context=work/'context';context.mkdir(mode=0o700)
    for p,h in PAYLOAD.items():
        b=private_read(STAGED/'candidate'/p);need(sha(b)==h,'CANDIDATA_MUDOU');write_new(context/p,b)
    dockerfile='FROM '+base+'\n'+''.join('COPY '+p+' /'+p+'\n' for p in PAYLOAD)
    dockerfile+='LABEL org.vitrinecity.lia.release="'+SENTINEL+'"\n'
    write_new(context/'Dockerfile',dockerfile.encode())
    command(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600,log=work/'build.private.log')
    image=json.loads(command(['docker','image','inspect',tag]).stdout)[0]
    need(image['Id']!=info['Image'],'IMAGEM_CANDIDATA_IGUAL_A_ANTERIOR')
    return tag,image['Id']

def parse_tap(text):
    counts={}
    for k in ('tests','pass','fail','cancelled','skipped','todo'):
        matches=re.findall(r'^# '+k+r' (\d+)\s*$',text,re.M);counts[k]=int(matches[-1]) if matches else None
    return counts

def test_image(work,tag):
    name='lia-v9-tests-'+work.name
    cmd=['docker','run','--rm','--name',name,'--pull','never','--network','none','--read-only',
         '--no-healthcheck','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','0.5',
         '--memory','512m','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,nodev,size=192m',
         '--tmpfs','/data:rw,nosuid,nodev,size=32m','--workdir','/app']
    for p,h in TEST_HASHES.items():
        need(sha(private_read(STAGED/'candidate'/p))==h,'TESTE_MUDOU')
        cmd+=['--mount',f'type=bind,source={STAGED/"candidate"/p},target=/{p},readonly']
    cmd+=['--entrypoint','/usr/bin/env',tag,'-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','TMPDIR=/tmp',
          'DATA_DIR=/tmp/lia-test-data','node','--test','--test-reporter=tap',*('/'+p for p in TEST_HASHES)]
    try:
        p=command(cmd,timeout=300,log=work/'tests.private.log',allow_failure=True)
        counts=parse_tap(private_read(work/'tests.private.log').decode('utf-8','replace'))
        need(p.returncode==0 and counts=={'tests':52,'pass':52,'fail':0,'cancelled':0,'skipped':0,'todo':0},'TESTES_DA_IMAGEM_NAO_PASSARAM')
        return counts
    finally:
        try:command(['docker','rm','-f',name],timeout=20,allow_failure=True)
        except Blocked:pass

def syntax_image(work,tag):
    js = r"""import {spawnSync} from 'node:child_process';
for(const p of JSON.parse(process.argv[1])){const r=spawnSync(process.execPath,['--check','/'+p],{stdio:'pipe',env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});if(r.status!==0)process.exit(2);}"""
    files=[p for p in PAYLOAD if p.endswith('.js')]
    command(['docker','run','--rm','--pull','never','--network','none','--read-only','--no-healthcheck',
             '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--pids-limit','64',
             '--entrypoint','node',tag,'--input-type=module','-e',js,json.dumps(files)],timeout=90,log=work/'syntax.private.log')

def api_probe(cid):
    js=r"""try{const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error();
const origin='http://127.0.0.1:'+port;const health=await fetch(origin+'/api/health',{redirect:'error',signal:AbortSignal.timeout(5000)});
if(!health.ok)throw Error();await health.body?.cancel();
const auth=await fetch(origin+'/api/neural/chat/operations/status',{redirect:'error',signal:AbortSignal.timeout(5000)});
if(![401,403].includes(auth.status)||(auth.headers.get('content-type')||'').indexOf('application/json')<0)throw Error();await auth.body?.cancel();
process.stdout.write('ok');}catch{process.exitCode=2;}"""
    p=command(['docker','exec','-w','/app',cid,'node','--input-type=module','-e',js],timeout=20,allow_failure=True)
    need(p.returncode==0 and p.stdout==b'ok','API_OU_AUTENTICACAO_NAO_CONFIRMADA')

def sqlite_snapshot(path):
    write_new(path,b'')
    deadline=time.monotonic()+120
    def progress(*_):need(time.monotonic()<deadline,'BACKUP_SQLITE_TIMEOUT')
    with closing(sqlite3.connect((DATA/'vitrinecity.db').as_uri()+'?mode=ro',uri=True,timeout=3)) as source:
        with closing(sqlite3.connect(str(path))) as dest:
            source.backup(dest,pages=256,progress=progress,sleep=0.05)
            need(dest.execute('PRAGMA quick_check').fetchall()==[('ok',)],'BACKUP_SQLITE_NAO_PASSOU')
    return {'integrityCheck':'ok','sha256':file_hash(path),'bytes':path.stat().st_size}

def runtime_equivalent(old,new,wanted_env):
    need(mounts(new)==mounts(old),'MONTAGENS_MUDARAM')
    need(environment(new)==wanted_env,'AMBIENTE_MUDOU_FORA_DO_PREVISTO')
    for key in ('Cmd','Entrypoint','WorkingDir','User','ExposedPorts','Healthcheck','StopSignal'):
        need(new.get('Config',{}).get(key)==old.get('Config',{}).get(key),'CONFIGURACAO_DO_PROCESSO_MUDOU')
    for key in ('Privileged','ReadonlyRootfs','RestartPolicy','PortBindings','CapAdd','CapDrop','SecurityOpt',
                'Devices','DeviceRequests','Runtime','PidMode','IpcMode','Memory','NanoCpus','PidsLimit','ExtraHosts'):
        need(new.get('HostConfig',{}).get(key)==old.get('HostConfig',{}).get(key),'CONFIGURACAO_DO_HOST_MUDOU')
    need(set(new.get('NetworkSettings',{}).get('Networks',{}))==set(old.get('NetworkSettings',{}).get('Networks',{})),'REDES_MUDARAM')

def wait_health(expected,old,env,timeout=150):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        info=app();topology(info)
        need(info['Image']==expected,'IMAGEM_ATIVA_INESPERADA')
        runtime_equivalent(old,info,env)
        if healthy(info):return info
        time.sleep(2)
    raise Blocked('HEALTHCHECK_NAO_CONFIRMADO')

def original_resume(old,timeout=150):
    info=inspect(old['Id'])
    need(info['Image']==old['Image'] and mounts(info)==mounts(old) and environment(info)==environment(old),'ORIGINAL_MUDOU_NAO_INICIADO')
    if not info['State'].get('Running'):command(['docker','start',old['Id']])
    return wait_health(old['Image'],old,environment(old),timeout)

def image_id(reference):
    values=json.loads(command(['docker','image','inspect',reference]).stdout)
    need(len(values)==1 and re.fullmatch(r'sha256:[0-9a-f]{64}',values[0].get('Id','')) is not None,'IMAGEM_LOCAL_NAO_IDENTIFICADA')
    return values[0]['Id']

def compose_up(path,work,expected):
    reference=render([path])['services']['app']['image']
    need(image_id(reference)==expected,'REFERENCIA_LOCAL_DA_IMAGEM_MUDOU')
    command(compose([path])+['up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','150','app'],
            timeout=240,log=work/'compose.private.log')

def rollback_work(work,state):
    for name,expected in state['frozenHashes'].items():need(sha(private_read(work/name))==expected,'ARQUIVO_DE_ROLLBACK_MUDOU')
    old=load(work/'before-inspect.private.json')
    current=app_optional()
    if current is not None:
        topology(current)
        need(current['Image'] in (state['oldImage'],state['newImage']), 'ROLLBACK_RECUSADO_IMAGEM_NAO_PERTENCE_A_ESTA_VERSAO')
        need(mounts(current)==mounts(old),'ROLLBACK_RECUSADO_MONTAGENS_DIVERGENTES')
        if current['Id']==old['Id']:
            return original_resume(old)
        acceptable=[]
        if current['Image']==state['newImage']:acceptable.append(runtime_environment_from_render(render([work/'after.private.json'])))
        if current['Image']==state['oldImage']:acceptable.append(environment(old))
        need(environment(current) in acceptable,'ROLLBACK_RECUSADO_CONFIGURACAO_MUDOU')
        if current['Image']==old['Image'] and environment(current)==environment(old) and healthy(current):
            runtime_equivalent(old,current,environment(old));return current
    need(pending()==0,'ROLLBACK_BLOQUEADO_HA_OPERACOES_PENDENTES')
    compose_up(work/'before.private.json',work,state['oldImage'])
    return wait_health(old['Image'],old,environment(old))

def interrupted(_signum,_frame):
    raise Blocked('INTERRUPCAO_SOLICITADA')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modo',choices=('plano','implantar','ativar-workers','desativar-workers','voltar','status'),nargs='?',default='plano')
    parser.add_argument('--revision',default='')
    parser.add_argument('--confirmar-troca',action='store_true')
    parser.add_argument('--ativar-workers',action='store_true')
    parser.add_argument('--token-file')
    parser.add_argument('--estado',help='Diretorio de uma implantacao para voltar; omitido usa a ultima.')
    args=parser.parse_args()
    need(os.geteuid()==0 and socket.gethostname().split('.')[0]==HOST,'EXECUTE_COMO_ROOT_NA_VPS_PRINCIPAL')
    os.umask(0o077)
    info=app_optional() if args.modo=='voltar' else app()
    if info is not None:topology(info)
    if args.modo=='status':
        print(json.dumps({'running':bool(info['State'].get('Running')),'healthy':healthy(info),
                          'image':info['Image'],'operationsEnabled':environment(info).get('LIA_CHAT_OPERATIONS_ENABLED')=='true',
                          'endToEndTaskVerified':False},indent=2));return 0
    if args.modo=='plano':
        verify_retest();directory,report=find_backup()
        q=quality(args.revision)
        print(json.dumps({'modo':'PLANO_SEM_IMPLANTACAO','backupDirectory':str(directory),'candidateHashes':PAYLOAD,
                          'quality':q,'running':healthy(info),'deployed':False},indent=2));return 0
    need(args.confirmar_troca,'CONFIRME_A_TROCA_COM_confirmar_troca')
    controlled(ROOT.parent)
    ROOT.mkdir(mode=0o700,exist_ok=True);controlled(ROOT,private=True)
    lock=os.open(ROOT/'deployment.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    ls=os.fstat(lock);need(stat.S_ISREG(ls.st_mode) and ls.st_uid==0 and not ls.st_mode&0o077,'TRAVA_INVALIDA')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise Blocked('OUTRA_IMPLANTACAO_EM_ANDAMENTO') from None
    if args.modo=='voltar':
        ref=Path(args.estado) if args.estado else Path(load(ROOT/'latest.private.json')['directory'])
        need(ref.parent==ROOT,'ESTADO_FORA_DO_DIRETORIO_DE_IMPLANTACAO');controlled(ref,private=True)
        state=load(ref/'state.private.json');rollback_work(ref,state)
        state['phase']='ROLLED_BACK';atomic_json(ref/'state.private.json',state)
        atomic_json(ROOT/'latest.private.json',{'directory':str(ref),'image':state['oldImage']})
        print('ROLLBACK_CONCLUIDO: somente codigo/configuracao; banco nao restaurado.');return 0
    need(healthy(info),'APP_NAO_SAUDAVEL_ANTES_DA_TROCA')
    q=quality(args.revision)
    verify_retest()
    if args.modo=='implantar':
        paths_now=current_paths(info)
        allowed_base=paths_now==BASE_COMPOSE
        if not allowed_base and (ROOT/'latest.private.json').exists():
            latest=load(ROOT/'latest.private.json');previous=Path(latest['directory'])
            allowed_base=previous.parent==ROOT and paths_now==(str(previous/'before.private.json'),) and latest.get('image')==ORIGINAL_IMAGE
        need(info['Image']==ORIGINAL_IMAGE and allowed_base,'IMPLANTACAO_BASE_DIVERGENTE')
        verify_payload(info['Id'],ORIGINAL)
    else:
        verify_payload(info['Id'],PAYLOAD)
        need((ROOT/'latest.private.json').exists(),'ATIVACAO_REQUER_IMPLANTACAO_GERENCIADA')
        latest=load(ROOT/'latest.private.json');need(info['Image']==latest.get('image'),'IMAGEM_DIFERENTE_DA_ULTIMA_IMPLANTACAO')
    need(consumers()==[info['Id']] and pending()==0,'HA_OPERACOES_OU_OUTROS_CONSUMIDORES')
    enabled=args.modo=='ativar-workers' or (args.modo=='implantar' and args.ativar_workers)
    token=obtain_token(info,args.token_file) if enabled else None
    gateway=gateway_probe(info['Id'],token) if enabled else {'gatewayAuthenticated':False,'workersRequested':False}
    backup_dir,backup_report=find_backup()
    print('Validando o backup existente; nenhuma nova copia de anexos e nenhuma parada.',flush=True)
    backup=verify_backup(backup_dir,backup_report)
    paths=current_paths(info);settings=snapshot_settings(paths)
    work=ROOT/('release-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+secrets.token_hex(4))
    work.mkdir(mode=0o700)
    write_new(work/'deploy-lia-v9.py',Path(__file__).read_bytes())
    write_new(work/'before-inspect.private.json',json.dumps(info).encode())
    old_ref='vitrinecity-lia:rollback-'+work.name
    command(['docker','image','tag',info['Image'],old_ref])
    if args.modo=='implantar':
        print('Construindo a imagem sobre a versao atual e testando sem credenciais ou dados de producao.',flush=True)
        tag,new_image=candidate_image(work,info);syntax_image(work,tag);tests=test_image(work,tag)
    else:tag=old_ref;new_image=info['Image'];tests={'reusedTestedApplication':True}
    env=intended_env(info,enabled,token)
    frozen_files(work,info,old_ref,tag,env)
    state={'frozenHashes':{name:sha(private_read(work/name)) for name in ('before.private.json','after.private.json')},'directory':str(work),'oldImage':info['Image'],'newImage':new_image,'phase':'PREPARED',
           'revision':args.revision,'settings':settings,'gateway':gateway,'backup':backup,'tests':tests,
           'operationsEnabled':enabled,'endToEndTaskVerified':False,'databaseRestored':False}
    atomic_json(work/'state.private.json',state)
    rollback_command=f'python3 {work}/deploy-lia-v9.py voltar --confirmar-troca --estado {work}'
    write_new(work/'rollback.sh',('#!/bin/sh\nset -eu\nexec '+rollback_command+'\n').encode())
    print('Retorno de codigo, caso necessario: '+rollback_command,flush=True)
    try:
        fresh=app();need(fresh['Id']==info['Id'] and healthy(fresh),'APP_MUDOU_ANTES_DA_TROCA')
        need(snapshot_settings(paths)==settings and consumers()==[info['Id']] and pending()==0,'ESTADO_MUDOU_ANTES_DA_TROCA')
        verify_payload(info['Id'],ORIGINAL if args.modo=='implantar' else PAYLOAD)
        for p in GUARDS:
            need(runtime_hashes(info['Id'],[p])[p]==sha(private_read(STAGED/'candidate'/p)),'DEPENDENCIA_ATIVA_DIVERGENTE')
        quality(args.revision)
        state['phase']='STOP_REQUESTED';atomic_json(work/'state.private.json',state)
        print('Iniciando troca do app. O site/chat pode ficar temporariamente indisponivel.',flush=True)
        command(['docker','stop','--time','60',info['Id']],timeout=90,log=work/'stop.private.log')
        stopped=inspect(info['Id'])
        need(not stopped['State'].get('Running') and stopped['State'].get('ExitCode')!=137,'PARADA_NORMAL_NAO_CONFIRMADA')
        need(not consumers() and pending()==0,'PEDIDO_ENTROU_DURANTE_A_TROCA')
        state['freshSqliteBackup']=sqlite_snapshot(work/'before-database.sqlite')
        state['phase']='RECREATE_REQUESTED';atomic_json(work/'state.private.json',state)
        compose_up(work/'after.private.json',work,new_image)
        active=wait_health(new_image,info,env)
        verify_payload(active['Id'],PAYLOAD)
        api_probe(active['Id'])
        if enabled:state['gateway']=gateway_probe(active['Id'],token)
        need(snapshot_settings(paths)==settings,'CONFIGURACAO_ORIGINAL_MUDOU')
        state['phase']='DEPLOYED';state['container']=active['Id'];atomic_json(work/'state.private.json',state)
        atomic_json(ROOT/'latest.private.json',{'directory':str(work),'image':new_image})
        print('=== RELATORIO LIA: IMPLANTACAO ===')
        print(json.dumps({'status':'DEPLOYED_WORKERS_ENABLED_E2E_PENDING' if enabled else 'DEPLOYED_WORKERS_DISABLED',
              'deployed':True,'appHealthy':True,'sameDataMounts':True,'databaseRestored':False,
              'operationsEnabled':enabled,'gatewayAuthenticated':bool(state['gateway'].get('gatewayAuthenticated')),
              'endToEndTaskVerified':False,'rollbackCommand':rollback_command,'directory':str(work)},indent=2))
        return 0
    except BaseException as error:
        state['failure']=str(error) if isinstance(error,Blocked) else 'FALHA_NAO_DETALHADA_PARA_PROTEGER_CREDENCIAIS'
        changed=state['phase'] in ('STOP_REQUESTED','RECREATE_REQUESTED')
        if changed:
            try:
                rollback_work(work,state);state['phase']='ROLLED_BACK_AFTER_FAILURE'
            except BaseException as rollback_error:
                state['phase']='RECOVERY_REQUIRED'
                state['rollbackError']=str(rollback_error) if isinstance(rollback_error,Blocked) else 'RETORNO_NAO_CONFIRMADO'
        atomic_json(work/'state.private.json',state)
        print(json.dumps({'status':state['phase'],'error':state['failure'],'databaseRestored':False,
                          'rollbackCommand':rollback_command,'directory':str(work)},indent=2))
        return 2

if __name__=='__main__':
    for signum in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(signum,interrupted)
    try:sys.exit(main())
    except (Exception,KeyboardInterrupt) as e:
        print('PARADO: '+(str(e) if isinstance(e,Blocked) else 'VERIFICACAO_INCOMPLETA_DADOS_PRIVADOS_OMITIDOS'),file=sys.stderr)
        sys.exit(1)
