#!/usr/bin/env python3
"""Deploy a reviewed two-file change on top of the EXACT running app image.
No git reset/pull, no .env mutation, no DB restoration, no paid API requests.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from patch import patch, MARKER, RELATIVE

HERE=Path(__file__).resolve().parent
VERSION='lia-kling-20260916-v1'

def run(args, cwd=None, timeout=180, input=None):
    try:
        p=subprocess.run(args,cwd=cwd,input=input,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Comando excedeu o limite; saida privada nao exibida.')
    if p.returncode:
        raise RuntimeError('Falhou: '+' '.join(map(str,args[:3]))+'. Saida omitida para proteger configuracoes privadas.')
    return p.stdout.strip()

def sha(data): return hashlib.sha256(data).hexdigest()

def inspect(cid): return json.loads(run(['docker','inspect',cid]))[0]

def atomic(dest,data,mode=0o644):
    dest=Path(dest)
    if dest.is_symlink(): raise RuntimeError('Destino e link simbolico; operacao bloqueada.')
    fd,name=tempfile.mkstemp(prefix='.lia-write-',dir=dest.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        os.chmod(name,mode);os.replace(name,dest)
    finally:
        if os.path.exists(name):os.unlink(name)

def compose_for(info,root):
    labels=info['Config'].get('Labels') or {}
    project=labels.get('com.docker.compose.project','')
    if not project or labels.get('com.docker.compose.service')!='app':
        raise RuntimeError('Container nao e o servico app de um projeto Compose.')
    if Path(labels.get('com.docker.compose.project.working_dir','')).resolve()!=root:
        raise RuntimeError('Diretorio Compose divergente.')
    files=labels.get('com.docker.compose.project.config_files','').split(',')
    if not files or any(not f or not Path(f).is_file() for f in files):
        raise RuntimeError('Arquivos Compose ativos nao foram encontrados.')
    cmd=['docker','compose','--project-directory',str(root),'-p',project]
    for f in files:cmd+=['-f',f]
    return cmd

def check_config(compose,info,root):
    current=run(compose+['config','--hash','app'],cwd=root).splitlines()
    values=[line.split()[-1] for line in current if line.strip()]
    old=(info['Config'].get('Labels') or {}).get('com.docker.compose.config-hash')
    if len(values)!=1 or values[0]!=old:
        raise RuntimeError('Compose/.env efetivos diferem do container ativo. Parei sem publicar outras mudancas.')

def data_mount(info):
    env=dict(e.split('=',1) for e in info['Config'].get('Env',[]) if '=' in e)
    target=env.get('DATA_DIR','/data')
    rows=[m for m in info.get('Mounts',[]) if m['Destination']==target and m.get('RW')]
    if len(rows)!=1 or rows[0]['Type'] not in ('volume','bind'):
        raise RuntimeError('Banco precisa estar em armazenamento persistente conhecido.')
    m=rows[0]
    return {'Type':m['Type'],'Source':m['Source'],'Destination':m['Destination']}

def node(cid,code,*args):
    return run(['docker','exec','-w','/app',cid,'node','--input-type=module','-e',code,*args])

def assert_idle(cid):
    code="""import DB from 'better-sqlite3';import path from 'node:path';
const db=new DB(path.join(process.env.DATA_DIR||'/data','vitrinecity.db'),{readonly:true,fileMustExist:true});
const has=t=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
let busy=0;
if(has('neural_chat_requests'))busy+=db.prepare("SELECT COUNT(*) n FROM neural_chat_requests WHERE status IN ('queued','running')").get().n;
if(has('neural_paid_chat_requests'))busy+=db.prepare("SELECT COUNT(*) n FROM neural_paid_chat_requests WHERE state NOT IN ('quoted','settled','released')").get().n;
console.log(busy);db.close();"""
    if node(cid,code)!='0':
        raise RuntimeError('Ha tarefas da LIA em andamento. Nenhuma foi cancelada. Publique depois que terminarem.')

def current_id(compose,root):
    ids=run(compose+['ps','-q','app'],cwd=root).splitlines()
    if len(ids)!=1:raise RuntimeError('Esperado exatamente um container app.')
    return ids[0]

def healthy(cid,expected_sha=None):
    code="""import fs from 'node:fs';import {createHash} from 'node:crypto';
const r=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)});
if(!r.ok)process.exit(1);
if(process.argv[1]){const d=fs.readFileSync('/app/vitriny-neural/chat-engine.js');if(createHash('sha256').update(d).digest('hex')!==process.argv[1]||process.env.LIA_LOCAL_FIRST_ADMIN!=='1')process.exit(1);}
console.log('ok');"""
    return node(cid,code,expected_sha or '')=='ok'

def wait_health(compose,root,digest=None):
    for _ in range(30):
        try:
            cid=current_id(compose,root)
            if healthy(cid,digest):return cid
        except (RuntimeError,ValueError,KeyError):pass
        time.sleep(2)
    raise RuntimeError('Saude do aplicativo nao confirmada.')

def restore(folder):
    folder=Path(folder).resolve();m=json.loads((folder/'manifest.json').read_text());root=Path(m['root'])
    for f in m['files']:
        dest=root/f['path']
        if dest.is_symlink() or not dest.is_file() or sha(dest.read_bytes()) not in (f['before'],f['after']):
            raise RuntimeError('Arquivo alterado depois do instalador. Restauracao automatica bloqueada: '+f['path'])
    cid=current_id(m['compose'],root)
    check_config(m['compose'],inspect(cid),root)
    if data_mount(inspect(cid))!=m['dataMount']:raise RuntimeError('Volume divergente; restauracao bloqueada.')
    for f in m['files']:atomic(root/f['path'],(folder/'files'/f['path']).read_bytes(),f['mode'])
    run(['docker','tag',m['oldImage'],m['oldTag']])
    run(m['compose']+['up','-d','--no-deps','--no-build','--pull','never','app'],cwd=root)
    wait_health(m['compose'],root)
    print('APP ANTERIOR RESTAURADO. Banco de pedidos, memorias e volumes nao foram revertidos.')

def install(root,cid,check_only=False):
    root=root.resolve();info=inspect(cid);cid=info['Id']
    if not info['State'].get('Running'):raise RuntimeError('Aplicativo nao esta em execucao.')
    if any(m['Destination']=='/app' or m['Destination'].startswith('/app/') for m in info.get('Mounts',[])):
        raise RuntimeError('Codigo montado diretamente no app. Este instalador nao altera codigo em processo vivo.')
    origin=run(['git','remote','get-url','origin'],cwd=root).lower().rstrip('/')
    if not origin.endswith(('markentingimperio-debug/vitrinecity','markentingimperio-debug/vitrinecity.git')):
        raise RuntimeError('Repositorio diferente da Vitrine City.')
    engine=root/RELATIVE;dockerfile=root/'app/Dockerfile'
    if not engine.is_file() or not dockerfile.is_file() or engine.is_symlink() or dockerfile.is_symlink():
        raise RuntimeError('Arquivos esperados ausentes ou links simbolicos.')
    if MARKER in engine.read_text():
        if healthy(cid,sha(engine.read_bytes())):
            print('ESTA ATUALIZACAO JA ESTA PUBLICADA. Nenhuma nova mudanca.');return
        raise RuntimeError('Patch no disco mas nao confirmado no app. Nao sobrescrevi.')
    if (root/'app/vitriny-neural/lia-connected.mjs').exists():
        raise RuntimeError('Instalador anterior detectado. Use o rollback daquela versao antes deste pacote.')
    compose=compose_for(info,root);check_config(compose,info,root);mount=data_mount(info)
    patched=patch(engine.read_bytes())
    relevant=[RELATIVE,'app/vitriny-neural/service.js','app/vitriny-neural/paid-chat-runtime.js',
              'app/vitriny-neural/providers/kling-paid-video.js','app/vitriny-neural/providers/kling-paid-image.js']
    expected={p:sha((root/p).read_bytes()) for p in relevant}
    code="""import fs from 'node:fs';import {createHash} from 'node:crypto';const expected=JSON.parse(process.argv[1]);for(const [p,h]of Object.entries(expected)){if(createHash('sha256').update(fs.readFileSync('/'+p)).digest('hex')!==h)process.exit(2);}console.log('ok');"""
    node(cid,code,json.dumps(expected))
    env=dict(x.split('=',1) for x in info['Config'].get('Env',[]) if '=' in x)
    if env.get('LIA_LOCAL_FIRST_ADMIN') not in (None,'1'):
        raise RuntimeError('LIA_LOCAL_FIRST_ADMIN ja tem uma escolha diferente. Configuracao preservada.')
    if not env.get('KLING_API_KEY') or not (env.get('DEEPSEEK_API_KEY') or env.get('OPENAI_API_KEY')):
        raise RuntimeError('Chaves Kling/texto nao encontradas no ambiente ativo. Nenhuma chave foi mostrada ou criada.')
    if env.get('VITRINY_NEURAL_PAID_ENABLED')!='true':raise RuntimeError('Chat pago nao esta habilitado; preservado sem ativacao automatica.')
    d=dockerfile.read_bytes();s=d.decode('utf-8')
    if len(re.findall(r'^FROM\s',s,re.M|re.I))!=1 or 'LIA_LOCAL_FIRST_ADMIN' in s:
        raise RuntimeError('Dockerfile diferente do contrato esperado; nenhuma alteracao.')
    patched_d=d+b'\n# LIA Preserve Kling: administrative local-first opt-in\nENV LIA_LOCAL_FIRST_ADMIN=1\n'
    if shutil.disk_usage(root).free<1024**3:raise RuntimeError('Menos de 1 GB livre; backup e publicacao bloqueados.')
    assert_idle(cid)
    with tempfile.TemporaryDirectory(prefix='lia-reviewed-') as tmp:
        tmp=Path(tmp);(tmp/'chat-engine.js').write_bytes(patched)
        for p in [tmp/'chat-engine.js']:p.chmod(0o644)
        tmp.chmod(0o755)
        print('Executando testes isolados na imagem atual, sem APIs pagas...')
        report=run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL',
          '--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=128m',
          '-v',str(tmp/'chat-engine.js')+':/app/vitriny-neural/chat-engine.js:ro',
          '-v',str(HERE/'test.mjs')+':/app/scripts/test-lia-preserve-kling.mjs:ro',
          '--entrypoint','node',info['Image'],'--test','/app/scripts/test-lia-preserve-kling.mjs'],timeout=180)
        print('Testes do roteamento: APROVADOS.')
        if check_only:print('VERIFICACAO CONCLUIDA. Nada publicado.');return
        stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S')
        folder=Path('/var/backups')/('vitrinecity-lia-kling-'+stamp);folder.mkdir(parents=True,mode=0o700)
        print('Backup: '+str(folder))
        old_tag=info['Config']['Image']
        if old_tag.startswith('sha256:') or '@sha256:' in old_tag:raise RuntimeError('Imagem sem tag substituivel; parei sem publicar.')
        base_tag='vitrinecity-lia-before:'+stamp;new_tag='vitrinecity-lia-reviewed:'+stamp
        run(['docker','tag',info['Image'],base_tag])
        (tmp/'Dockerfile').write_text('FROM '+base_tag+'\nCOPY chat-engine.js /app/vitriny-neural/chat-engine.js\nENV LIA_LOCAL_FIRST_ADMIN=1\nLABEL org.vitrinecity.lia-patch="'+VERSION+'"\n')
        run(['docker','build','--network=none','--pull=false','-t',new_tag,str(tmp)],timeout=300)
        new_image=inspect(new_tag)['Id']
        for dest in [engine,dockerfile]:
            saved=folder/'files'/dest.relative_to(root);saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,saved)
        for name in ['install.py','patch.py','test.mjs']:shutil.copy2(HERE/name,folder/name)
        (folder/'test-result.txt').write_text(report)
        snapshot_name='.lia-backup-'+stamp+'.sqlite'
        backup_code="""import DB from 'better-sqlite3';import path from 'node:path';import fs from 'node:fs';const dir=process.env.DATA_DIR||'/data';const db=new DB(path.join(dir,'vitrinecity.db'),{readonly:true,fileMustExist:true});const output=path.join(dir,process.argv[1]);await db.backup(output);fs.chmodSync(output,0o600);db.close();console.log(output);"""
        remote=node(cid,backup_code,snapshot_name)
        run(['docker','cp',cid+':'+remote,str(folder/'database.sqlite')],timeout=300);os.chmod(folder/'database.sqlite',0o600)
        node(cid,"import fs from 'node:fs';fs.unlinkSync(process.argv[1]);",remote)
        manifest={'root':str(root),'compose':compose,'oldImage':info['Image'],'oldTag':old_tag,'newImage':new_image,'dataMount':mount,
          'files':[{'path':RELATIVE,'before':sha(engine.read_bytes()),'after':sha(patched),'mode':engine.stat().st_mode&0o777},
                   {'path':'app/Dockerfile','before':sha(d),'after':sha(patched_d),'mode':dockerfile.stat().st_mode&0o777}]}
        (folder/'manifest.json').write_text(json.dumps(manifest,indent=2))
        assert_idle(cid);check_config(compose,info,root)
        if current_id(compose,root)!=cid:raise RuntimeError('Container mudou durante a verificacao. Nada publicado.')
        if sha(engine.read_bytes())!=manifest['files'][0]['before'] or sha(dockerfile.read_bytes())!=manifest['files'][1]['before']:
            raise RuntimeError('Codigo mudou durante a verificacao. Nada publicado.')
        try:
            atomic(engine,patched,manifest['files'][0]['mode']);atomic(dockerfile,patched_d,manifest['files'][1]['mode'])
            run(['docker','tag',new_image,old_tag])
            print('Publicando somente o app; .env, Kling e volumes mantidos...')
            run(compose+['up','-d','--no-deps','--no-build','--pull','never','app'],cwd=root)
            live=wait_health(compose,root,sha(patched));live_info=inspect(live)
            if live_info['Image']!=new_image or data_mount(live_info)!=mount:
                raise RuntimeError('Imagem/volume final nao correspondem ao esperado.')
        except BaseException:
            print('Validacao falhou. Tentando restaurar o aplicativo anterior, SEM reverter o banco...')
            try:restore(folder)
            except Exception:print('Restauracao requer conferencia. Comando: python3 '+str(folder/'install.py')+' --rollback '+str(folder))
            raise
        print('\nPUBLICADO: LIA com chat existente e Kling preservado.')
        print('Modelo local qualificado primeiro no chat ADMIN; API existente somente apos confirmar orcamento.')
        print('Nenhum teste pago foi feito. Saldo, permissao da API e geracao real nao foram validados.')
        print('Rollback: python3 '+str(folder/'install.py')+' --rollback '+str(folder))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--project');ap.add_argument('--container');ap.add_argument('--check-only',action='store_true');ap.add_argument('--rollback');a=ap.parse_args()
    if os.geteuid()!=0:raise RuntimeError('Execute no terminal da VPS como root (ou com sudo).')
    os.umask(0o077)
    with open('/var/lock/vitrinecity-lia-publish.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Outra publicacao LIA esta em andamento.')
        if a.rollback:return restore(a.rollback)
        if not a.project or not a.container:raise RuntimeError('Use o comando de publicacao com projeto/container detectados.')
        install(Path(a.project),a.container,a.check_only)
if __name__=='__main__':
    try:main()
    except Exception as exc:print('PARADO: '+str(exc),file=sys.stderr);sys.exit(1)
