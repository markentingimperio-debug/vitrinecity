#!/usr/bin/env python3
"""Back up the inventoried app for recovery, with an explicit maintenance stop.

No deployment, Git change, environment change, database restore or worker activation.
Only /data is snapshotted; the three other mounts remain untouched and are NOT backed up.
Run with the SHA-256-verified prepare-chat-update-v2.py beside this file.
"""
from __future__ import annotations
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

HELPER_SHA256 = 'a260aff2815395dcebbd15c427acfefdcbe6fea7defb153eb5cc919d68d0889e'
RETEST = Path('/var/backups/vitrinecity-lia-retest-bixywgeu')
COMPOSE = tuple('/opt/vitrinecity/' + s for s in (
    'docker-compose.yml', 'docker-compose.override.yml', 'docker-compose.lia-1d1958f.yml',
    'docker-compose.social-20260916.yml', 'docker-compose.social-profile-20260916.yml',
    'docker-compose.social-agent-20260916.yml'))
CANDIDATE = {
 'app/server.js':'b1442820e73432fb35fcaca56e79d3935afeea29b45b22f11d2943d86a788f7d',
 'app/vitriny-neural/chat-engine.js':'21ea860eb44f4bba2f6aa9399758407fb93e581c42c40d5b378d5a5ca79b4cb9',
 'app/vitriny-neural/chat-api.js':'c5dd647278e763db66f16529abf4235ae5d9ad9d68301bd0fdba3f65c05bc237',
 'app/vitriny-neural/lia-chat-operations.js':'f74d1190347d9cbffbf86870658dda08ff8da83afe368ef6c03bb6132154b07f',
 'app/public/neural-workspace.js':'79b1e820bd5646a58f6d7d3a6c12b954305915407db618f5485aebdb6d52cc9f',
 'app/public/neural-workspace.html':'84c39cf71a8d1a5c323588b1659dc4ba68cc2072fcfa4854bc02d2f0cc0b1251',
 'app/public/neural-workspace.css':'bbc9bc34cd3e2e062d627ba07f2ebeb77a2e15a953de46421337e1bedc4749d7',
}
MOUNTS = {
 '/data':('volume','vitrinecity_vitrinecity_data',True),
 '/live-studio':('volume','vitrinecity_live_studio',True),
 '/var/lib/vitrinecity-kling':('volume','vitrinecity_kling_credentials',True),
 '/private-courses':('bind','/opt/vitrinecity/private-courses',False),
}

class Refused(RuntimeError):
    """Only fixed, non-sensitive diagnostic messages are public."""

def digest(data):
    return hashlib.sha256(data).hexdigest()

def hash_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()

def protected_dir(path):
    if not path.is_absolute():
        raise Refused('Caminho nao absoluto.')
    for p in [*reversed(path.parents), path]:
        s = p.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise Refused('Diretorio nao protegido; operacao interrompida.')

def read_file(path, limit=8*1024*1024, private=False):
    protected_dir(path.parent)
    fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_size>limit or s.st_mode & (0o077 if private else 0o022):
            raise Refused('Arquivo nao protegido, nao regular ou acima do limite.')
        data=f.read(limit+1)
    if len(data)>limit:
        raise Refused('Arquivo cresceu acima do limite.')
    return data

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())

def run(args, timeout=60, output=None):
    try:
        if output is None:
            p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,check=False)
        else:
            fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as f:
                p=subprocess.run(args,stdout=f,stderr=subprocess.PIPE,timeout=timeout,check=False)
                f.flush()
                os.fsync(f.fileno())
        if p.returncode != 0:
            raise Refused('Comando de backup falhou; detalhes privados nao exibidos.')
        return p.stdout if output is None else b''
    except (OSError,subprocess.TimeoutExpired):
        raise Refused('Comando indisponivel ou prazo excedido; detalhes privados omitidos.') from None

def inspect(cid):
    return json.loads(run(['docker','inspect',cid]))[0]

def verify_retest(report):
    counts=report.get('testSummary',{}).get('counts',{})
    if (report.get('status')!='STAGED_NOT_DEPLOYED' or report.get('tests')!='passed' or
        report.get('productionChanged') is not False or report.get('deployed') is not False or
        report.get('candidateCodeUnchanged') is not True or report.get('activeCodeUnchanged') is not True or
        report.get('candidateHashes')!=CANDIDATE or report.get('directory')!=str(RETEST) or
        counts!={'tests':52,'pass':52,'fail':0,'cancelled':0,'skipped':0,'todo':0}):
        raise Refused('Relatorio de reteste diferente do aprovado; app nao sera parado.')

def verify_topology(info):
    if info.get('State',{}).get('Paused') or info.get('State',{}).get('Restarting') or info.get('State',{}).get('Health',{}).get('Status')!='healthy':
        raise Refused('App nao esta saudavel e ativo; backup interrompido.')
    labels=info['Config'].get('Labels') or {}
    if tuple(labels.get('com.docker.compose.project.config_files','').split(','))!=COMPOSE:
        raise Refused('Arquivos Compose mudaram; app nao sera parado.')
    actual={m['Destination']:(m['Type'],m.get('Name') if m['Type']=='volume' else m.get('Source'),m.get('RW')) for m in info.get('Mounts',[])}
    if actual!=MOUNTS or len(info.get('Mounts',[]))!=len(MOUNTS):
        raise Refused('Montagens mudaram; app nao sera parado.')
    if info['Config'].get('Image')!='vitrinecity-app:social-agent-20260916':
        raise Refused('Referencia da imagem mudou; app nao sera parado.')

def consumers():
    return run(['docker','ps','--no-trunc','--filter','volume=vitrinecity_vitrinecity_data','--format','{{.ID}}']).decode().splitlines()

def pending(dbpath):
    protected_dir(dbpath.parent)
    s=dbpath.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise Refused('Banco de origem nao regular.')
    # Re-open in SQLite read-only mode. No application module is imported.
    db=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True,timeout=3)
    try:
        total=0
        for table,query in (
          ('neural_chat_requests',"status IN ('awaiting_confirmation','queued','running','interrupted')"),
          ('neural_paid_chat_requests',"state NOT IN ('quoted','settled','released')"),
          ('lia_chat_operations',"status NOT IN ('completed','failed','cancelled','released')")):
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
                total+=db.execute('SELECT COUNT(*) FROM '+table+' WHERE '+query).fetchone()[0]
        return total
    finally:
        db.close()

def verify_tar_database(archive, directory):
    wanted={'vitrinecity.db','vitrinecity.db-wal','vitrinecity.db-shm','vitrinecity.db-journal'}
    found=set()
    with tarfile.open(archive,'r:') as tar:
        for entry in tar:
            name=entry.name
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                raise Refused('Caminho invalido no arquivo de backup.')
            normalized=name[2:] if name.startswith('./') else name
            if normalized not in wanted:
                continue
            if not entry.isfile() or normalized in found:
                raise Refused('Banco duplicado ou nao regular no backup.')
            found.add(normalized)
            source=tar.extractfile(entry)
            if source is None:
                raise Refused('Banco nao legivel no backup.')
            target=directory/normalized
            with source, target.open('xb') as out:
                target.chmod(0o600)
                shutil.copyfileobj(source,out,1024*1024)
    if 'vitrinecity.db' not in found:
        raise Refused('Banco ausente no backup.')
    db=sqlite3.connect(str(directory/'vitrinecity.db'))
    try:
        if db.execute('PRAGMA quick_check').fetchall()!=[('ok',)]:
            raise Refused('A copia extraida do banco nao passou na verificacao.')
    finally:
        db.close()
    return 'ok'

def verify_image_archive(path, image):
    with tarfile.open(path,'r:') as tar:
        stream=tar.extractfile('manifest.json')
        if stream is None:
            raise Refused('Manifesto de imagem ausente.')
        with stream:
            entries=json.loads(stream.read(1024*1024))
        if len(entries)!=1:
            raise Refused('O backup deve conter uma unica imagem.')
        config=entries[0]['Config']
        if PurePosixPath(config).is_absolute() or '..' in PurePosixPath(config).parts:
            raise Refused('Caminho de imagem invalido.')
        stream=tar.extractfile(config)
        if stream is None:
            raise Refused('Configuracao de imagem ausente.')
        with stream:
            data=stream.read(16*1024*1024+1)
        if len(data)>16*1024*1024 or 'sha256:'+digest(data)!=image:
            raise Refused('Imagem salva diferente da imagem ativa.')

def canonical_mounts(mounts):
    return sorted(json.dumps(m, sort_keys=True) for m in mounts)

def resume(cid, image, mounts):
    state=inspect(cid)
    if state.get('Image')!=image or canonical_mounts(state.get('Mounts',[]))!=canonical_mounts(mounts):
        raise Refused('O container mudou; retomada automatica recusada.')
    for _ in range(60):
        current=inspect(cid)
        if current.get('Image')!=image or canonical_mounts(current.get('Mounts',[]))!=canonical_mounts(mounts):
            raise Refused('O container mudou durante a retomada.')
        if not current.get('State',{}).get('Running'):
            run(['docker','start',cid])
            time.sleep(2)
            continue
        if current.get('Image')==image and canonical_mounts(current.get('Mounts',[]))==canonical_mounts(mounts) and current.get('State',{}).get('Running') and current.get('State',{}).get('Health',{}).get('Status')=='healthy':
            return
        time.sleep(2)
    raise Refused('Retomada nao confirmada pelo healthcheck. Verifique o app na VPS.')

def cold_copy(cid, image, mounts, action):
    # finally also handles Ctrl+C and errors during docker stop or during tar.
    try:
        run(['docker','stop','--time','45',cid],timeout=90)
        stopped=inspect(cid)
        if stopped.get('State',{}).get('Running') or stopped.get('State',{}).get('ExitCode')==137:
            raise Refused('Parada normal nao confirmada; copia interrompida.')
        if consumers():
            raise Refused('Outro consumidor apareceu no volume; copia interrompida.')
        action()
    finally:
        resume(cid,image,mounts)

def main():
    os.umask(0o077)
    if sys.argv[1:]!=['--backup-with-app-stop']:
        raise Refused('Use --backup-with-app-stop para autorizar a parada e retomada do app durante o backup.')
    if os.geteuid()!=0 or socket.gethostname().split('.')[0]!='srv1901029':
        raise Refused('Execute somente como root na VPS principal srv1901029.')
    # A root-controlled parent prevents another user from precreating the lock.
    protected_dir(Path('/var/backups'))
    lock=os.open('/var/backups/.vitrinecity-lia-recovery.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    if not stat.S_ISREG(os.fstat(lock).st_mode) or os.fstat(lock).st_uid!=0 or os.fstat(lock).st_mode & 0o077:
        raise Refused('Trava de manutencao invalida.')
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        raise Refused('Outra copia de recuperacao esta em andamento.') from None
    helper=Path(__file__).resolve().with_name('prepare-chat-update-v2.py')
    if helper.is_symlink() or digest(helper.read_bytes())!=HELPER_SHA256:
        raise Refused('Preparador auxiliar diferente da revisao SHA-256.')
    spec=importlib.util.spec_from_file_location('stage',helper)
    stage=importlib.util.module_from_spec(spec); spec.loader.exec_module(stage)
    report=json.loads(read_file(RETEST/'retest-report.json',private=True))
    verify_retest(report)
    info,env,mount=stage.target_info(); verify_topology(info)
    if report.get('source')!=stage.SOURCE or report.get('activeImage')!=stage.IMAGE:
        raise Refused('Imagem ou fonte diferente do reteste.')
    if str(env.get('LIA_CHAT_OPERATIONS_ENABLED','')).lower() in ('1','true','yes','on'):
        raise Refused('Workers foram ativados; procedimento requer nova revisao.')
    active=stage.runtime_files(info['Id'])
    if any(stage.digest(active.get(p))!=h for p,h in stage.EXPECTED.items()):
        raise Refused('Codigo ativo mudou; app nao sera parado.')
    for p,h in CANDIDATE.items():
        if digest(read_file(RETEST/'candidate'/p,private=True))!=h:
            raise Refused('Codigo candidato mudou; app nao sera parado.')
    if consumers()!=[info['Id']]:
        raise Refused('Ha outro consumidor do volume; app nao sera parado.')
    source=Path(mount['Source']); protected_dir(source)
    if source!=Path('/var/lib/docker/volumes/vitrinecity_vitrinecity_data/_data'):
        raise Refused('Origem do volume diferente da revisada.')
    protected_dir(Path('/var/backups'))
    if pending(source/'vitrinecity.db'):
        raise Refused('Ha geracoes/cobrancas pendentes; app nao sera parado.')
    image=info['Image']
    size=int(run(['du','-sx','--apparent-size','--block-size=1','--',str(source)],timeout=120).split()[0])
    image_size=int(run(['docker','image','inspect','--format','{{.Size}}',image]).strip())
    if shutil.disk_usage('/var/backups').free<2*size+2*image_size+2*1024**3:
        raise Refused('Espaco livre insuficiente com a margem de seguranca.')
    work=Path(tempfile.mkdtemp(prefix='vitrinecity-lia-recovery-',dir='/var/backups'))
    print('Backup privado: '+str(work),flush=True)
    print('Retomada de emergencia, somente se necessario: docker start vitrinecity-app-1',flush=True)
    result={'schema':5,'directory':str(work),'deployed':False,'productionCodeChanged':False,
            'maintenanceStopRequested':False,'appHealthyAfterBackup':False,
            'backupScope':['data volume including SQLite/WAL and attachments','active image','Compose and environment','inventoried runtime files and Git diff'],
            'excludedMounts':['/live-studio','/var/lib/vitrinecity-kling','/private-courses'],
            'offHostBackup':False,'fullVpsSnapshot':False,'publishApproved':False,
            'source':stage.SOURCE,'activeImage':image,'status':'BACKUP_NOT_VERIFIED'}
    try:
        write(work/'container-inspect.private.json',json.dumps(info).encode())
        saved={}
        for i,p in enumerate((*COMPOSE,'/opt/vitrinecity/.env','/opt/vitrinecity/app/Dockerfile')):
            content=read_file(Path(p)); name='config-'+str(i)+'.private'
            write(work/name,content); saved[p]={'backup':name,'sha256':digest(content)}
        write(work/'config-map.private.json',json.dumps(saved,indent=2).encode())
        for p,content in active.items():
            if content is not None:
                write(work/'active'/p,content)
        git=['git','-c','safe.directory=/opt/vitrinecity','-C','/opt/vitrinecity']
        if run(git+['rev-parse','HEAD']).decode().strip()!=stage.BASE:
            raise Refused('Checkout mudou; copia interrompida.')
        write(work/'checkout.patch.private',run(git+['diff','--binary','HEAD','--','app','ops']))
        print('Salvando a imagem atual, ainda sem parar o app.',flush=True)
        run(['docker','image','save',image],timeout=300,output=work/'image.tar')
        verify_image_archive(work/'image.tar',image)
        fresh,_,_=stage.target_info()
        if fresh['Id']!=info['Id'] or stage.runtime_files(info['Id'])!=active or consumers()!=[info['Id']] or pending(source/'vitrinecity.db'):
            raise Refused('Estado mudou antes da manutencao; app nao sera parado.')
        if any(digest(read_file(Path(p)))!=v['sha256'] for p,v in saved.items()):
            raise Refused('Configuracao mudou; app nao sera parado.')
        def snapshot():
            if pending(source/'vitrinecity.db'):
                raise Refused('Pedido entrou antes da parada; copia cancelada e app retomado.')
            run(['tar','--create','--file',str(work/'data.tar'),'--numeric-owner','--acls','--xattrs',
                 '--sparse','--one-file-system','--directory',str(source),'.'],timeout=600)
        print('Parando somente o app para copiar /data. O mesmo container sera retomado.',flush=True)
        result['maintenanceStopRequested']=True
        cold_copy(info['Id'],image,info['Mounts'],snapshot)
        result['appHealthyAfterBackup']=True
        print('App retomado e saudavel. Verificando a copia, sem restaurar producao.',flush=True)
        with tempfile.TemporaryDirectory(prefix='restore-check-',dir=work) as temp:
            result['sqliteRestoreCheck']=verify_tar_database(work/'data.tar',Path(temp))
        if stage.runtime_files(info['Id'])!=active:
            raise Refused('Arquivos ativos diferem apos a retomada; exige revisao.')
        result['archives']={name:{'bytes':(work/name).stat().st_size,'sha256':hash_file(work/name)} for name in ('image.tar','data.tar')}
        write(work/'SHA256SUMS', ''.join(v['sha256']+'  '+k+'\n' for k,v in result['archives'].items()).encode())
        write(work/'rollback-image-only.private.json',json.dumps({'services':{'app':{'image':image}}},indent=2).encode())
        write(work/'RECOVERY.md',(
            '# Recuperacao do aplicativo — nao executada\n\n'
            'Este pacote nao e snapshot da VPS. Nao contem os tres volumes adicionais listados no relatorio.\n'
            'O app foi parado para copiar /data e retomado na mesma imagem.\n'
            'Antes de qualquer retorno: conferir SHA256SUMS, relatorio, configuracoes e montagens atuais.\n'
            'Retorno de codigo: carregar image.tar somente se a imagem antiga estiver ausente; usar os seis\n'
            'arquivos Compose originais (ordem em config-map.private.json) e o override de imagem deste pacote,\n'
            'mantendo /opt/vitrinecity como project-directory e vitrinecity como projeto. Recriar SOMENTE app,\n'
            'com --no-deps --no-build --pull never. Isso exige revisao das configuracoes vigentes; nao foi executado.\n'
            'NAO restaurar data.tar ou database.sqlite automaticamente: perderia pedidos e cobrancas posteriores.\n'
            'A verificacao SQLite extraiu apenas o banco e journals para pasta temporaria privada, nao /data.\n'
            'Validacao de restauracao completa em outro host e copia criptografada fora desta VPS continuam pendentes.\n'
            'NAO compartilhar estes arquivos: contem credenciais e dados de clientes.\n').encode())
        result['status']='BACKUP_VERIFIED_NOT_DEPLOYED'
    except BaseException as e:
        result['status']='BACKUP_FAILED_NOT_DEPLOYED'
        result['error']=str(e) if isinstance(e,Refused) else 'Backup interrompido; detalhes privados omitidos.'
        try:
            check=inspect(info['Id'])
            result['appHealthyAfterBackup']=check.get('State',{}).get('Running') is True and check.get('State',{}).get('Health',{}).get('Status')=='healthy'
        except Exception:
            pass
    write(work/'backup-report.json',json.dumps(result,ensure_ascii=False,indent=2).encode())
    print('=== RELATORIO LIA: BACKUP DE RECUPERACAO, SEM DEPLOY ===')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result['status']=='BACKUP_VERIFIED_NOT_DEPLOYED' else 2

def terminate(_signum,_frame):
    raise Refused('Execucao interrompida por sinal; retomada sera tentada se o app foi parado.')

if __name__=='__main__':
    signal.signal(signal.SIGTERM,terminate)
    try:
        sys.exit(main())
    except BaseException as error:
        if isinstance(error,SystemExit):
            raise
        print('PARADO: '+(str(error) if isinstance(error,Refused) else 'Verificacao incompleta; detalhes privados omitidos.'),file=sys.stderr)
        sys.exit(1)
