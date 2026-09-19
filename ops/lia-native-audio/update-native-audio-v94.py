#!/usr/bin/env python3
"""LIA native-audio release. Plan is read-only; apply needs explicit consent.
No provider calls, forced-stop exception, secret prompts, git pull, or DB restore.
Updates only four pinned application files and the nativeAudio720 config member.
"""
from __future__ import annotations
import argparse, copy, fcntl, hashlib, json, os, re, secrets, signal, socket, stat, sys, time, types
from pathlib import Path

HOST='srv1901029'
SEED=Path('/var/lib/vitrinecity-lia-deploy/release-20260919T124012Z-673482fd')
ROUTE_SEED=Path('/var/lib/vitrinecity-lia-deploy/release-20260919T133801Z-7be67bbb')
HELPER_HASH='27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44'
ENGINE='app/vitriny-neural/chat-engine.js'
ENGINE_HASH='9e1307f3b134e6de70cd652c3c8567da551bbb8665769c013b0898e88ab50426'
CONFIG_KEY='VITRINY_NEURAL_PAID_CONFIG_JSON'
KIND='LIA_NATIVE_AUDIO_V94'
PR=211
WORKFLOW='LIA native audio validation'
TARIFF={'enabled':True,'model':'kling-3.0','resolution':'720p','usdPerSecond':'0.126',
        'tariffVersion':'kling-3.0-native-audio-720p-20260919','effectiveAt':'2026-09-19T00:00:00.000Z'}
BUNDLE_HASHES = {'build-native-audio-v94.py': '67dbc90dea123481244a798f714a0cea587401a6e30acadb00f41cc05ad4796e', 'test-native-audio.mjs': '9ef8320a0687e0a16048a82c8643a396bc442946deb8171fe6f77fc74d942d69', 'test-native-audio-flow.mjs': 'ab29bd8b954b455f8fb51c40c8cd57498ecd76d3268d31167e2590b471938d3a'}

class Refused(RuntimeError):pass
def need(value, code):
    if not value:raise Refused(code)
def sha(value):return hashlib.sha256(value).hexdigest()
def module_bytes(name,data,path):
    m=types.ModuleType(name);m.__file__=str(path)
    exec(compile(data,str(path),'exec'),m.__dict__);return m

def load_helper():
    p=SEED/'deploy-lia-v9.py'
    for directory in [*reversed(p.parent.parents),p.parent]:
        s=directory.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'AUXILIAR_DIRETORIO_INVALIDO')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o077 and s.st_size<100000,'AUXILIAR_PRIVADO_INVALIDO')
        data=f.read(100001)
    need(sha(data)==HELPER_HASH,'AUXILIAR_DE_RECUPERACAO_DIFERENTE')
    m=module_bytes('lia_verified_recovery',data,p)
    m.PR=PR
    m.REQUIRED_CI=(*m.REQUIRED_CI,'LIA image routing hotfix tests',WORKFLOW)
    return m

def load_bundle(m):
    root=Path(__file__).resolve().parent
    files={}
    for name,expected in BUNDLE_HASHES.items():
        data=m.private_read(root/name,limit=100000)
        need(sha(data)==expected,'PACOTE_DE_AUDIO_DIVERGENTE');files[name]=data
    need(len(files)==3,'PACOTE_INCOMPLETO')
    builder=module_bytes('lia_audio_builder',files['build-native-audio-v94.py'],root/'build-native-audio-v94.py')
    return builder,files

def quality(m,revision):
    need(re.fullmatch('[a-f0-9]{40}',revision or '') is not None,'REVISAO_COMPLETA_OBRIGATORIA')
    base='https://api.github.com/repos/'+m.REPO
    pr=m.public_json(base+'/pulls/'+str(PR))
    need(pr.get('head',{}).get('repo',{}).get('full_name')==m.REPO and
         pr.get('head',{}).get('ref')=='feat/lia-native-audio-20260919' and
         pr.get('base',{}).get('ref')=='feat/lia-prod-chat-delete-20260918','BASE_OU_BRANCH_NAO_REVISADA')
    project='markentingimperio-debug_vitrinecity'
    return m.validate_gate(revision,pr,
        m.public_json(base+'/actions/runs?event=pull_request&head_sha='+revision+'&per_page=100'),
        m.public_json('https://sonarcloud.io/api/project_pull_requests/list?project='+project),
        m.public_json('https://sonarcloud.io/api/qualitygates/project_status?projectKey='+project+'&pullRequest='+str(PR)))

def expected_files(m,builder,audio=False):
    return {**m.PAYLOAD,ENGINE:ENGINE_HASH,
            **{p:v[1 if audio else 0] for p,v in builder.MANIFEST.items()}}

def configuration(env):
    need(isinstance(env.get(CONFIG_KEY),str),'CONFIGURACAO_PAGA_AUSENTE')
    try:cfg=json.loads(env[CONFIG_KEY])
    except Exception:raise Refused('CONFIGURACAO_PAGA_INVALIDA') from None
    need(isinstance(cfg,dict) and cfg.get('enabled') is True and isinstance(cfg.get('kling'),dict), 'KLING_NAO_CONFIGURADO')
    return cfg

def wanted_environment(env):
    cfg=configuration(env)
    current=cfg['kling'].get('nativeAudio720')
    need(current is None or current==TARIFF,'TARIFA_DE_AUDIO_EXISTENTE_DIFERENTE')
    new=copy.deepcopy(cfg);new['kling']['nativeAudio720']=copy.deepcopy(TARIFF)
    wanted=env.copy();wanted[CONFIG_KEY]=json.dumps(new,ensure_ascii=True,separators=(',',':'))
    need({k:v for k,v in wanted.items() if k!=CONFIG_KEY}=={k:v for k,v in env.items() if k!=CONFIG_KEY},'OUTRA_VARIAVEL_ALTERADA')
    check=copy.deepcopy(new)
    if 'nativeAudio720' in cfg['kling']:check['kling']['nativeAudio720']=cfg['kling']['nativeAudio720']
    else:check['kling'].pop('nativeAudio720')
    need(check==cfg,'CONFIGURACAO_FORA_DO_ESCOPO')
    return wanted

def inspect_ready(m,builder):
    info=m.app();m.topology(info)
    need(m.healthy(info) and info.get('HostConfig',{}).get('Init') is True,'APP_OU_INIT_NAO_SAUDAVEL')
    env=m.environment(info)
    need(env.get('LIA_CHAT_OPERATIONS_ENABLED')=='true','WORKERS_DEVEM_PERMANECER_HABILITADOS')
    latest=m.load(m.ROOT/'latest.private.json')
    need(latest.get('image')==info['Image'],'IMAGEM_NAO_E_A_ULTIMA_GERENCIADA')
    actual=m.runtime_hashes(info['Id'],expected_files(m,builder))
    already=actual==expected_files(m,builder,True)
    if already:
        need(configuration(env)['kling'].get('nativeAudio720')==TARIFF,'AUDIO_INSTALADO_MAS_CONFIGURACAO_DIVERGENTE')
        return info,True
    need(actual==expected_files(m,builder),'CODIGO_ATIVO_DIFERENTE_DA_BASE')
    seed=m.load(ROUTE_SEED/'state.private.json')
    need(seed.get('phase')=='DEPLOYED' and seed.get('newImage')==info['Image'],'BASE_DE_ROTEAMENTO_DIVERGENTE')
    need(sha(m.private_read(ROUTE_SEED/'after.private.json'))==seed.get('frozenHashes',{}).get('after.private.json'),'CONFIGURACAO_DA_BASE_ALTERADA')
    wanted=m.runtime_environment_from_render(m.render([ROUTE_SEED/'after.private.json']))
    need(env==wanted,'AMBIENTE_MUDOU_DESDE_A_IMPLANTACAO')
    m.runtime_equivalent(m.load(ROUTE_SEED/'before-inspect.private.json'),info,wanted)
    paths=m.current_paths(info)
    need(len(paths)==1 and Path(paths[0]).parent.parent==m.ROOT,'COMPOSE_NAO_GERENCIADO')
    wanted_environment(env)
    return info,False

def guards(m,info):
    need(m.consumers()==[info['Id']] and m.pending()==0,'HA_PEDIDOS_PENDENTES_OU_OUTRO_CONSUMIDOR')
    m.verify_retest()
    expected={p:sha(m.private_read(m.STAGED/'candidate'/p)) for p in m.GUARDS if not p.endswith('/paid-chat-runtime.js')}
    need(m.runtime_hashes(info['Id'],expected)==expected,'DEPENDENCIAS_OU_CARTEIRA_DIVERGENTES')

def build_image(m,builder,info,work):
    changes=m.command(['docker','diff',info['Id']]).stdout.decode().splitlines()
    need(not any(x[2:]=='/app' or x[2:].startswith('/app/') for x in changes),'CODIGO_LOCAL_NAO_VERSIONADO')
    sources={}
    for path,(before,_) in builder.MANIFEST.items():
        sources[path]=None if before is None else m.command(['docker','exec',info['Id'],'node','-e',
           "process.stdout.write(require('fs').readFileSync(process.argv[1]))",'/'+path]).stdout
    payload={p:builder.patch(p,sources[p]) for p in sources}
    context=work/'context';context.mkdir(mode=0o700)
    for p,data in payload.items():m.write_new(context/p,data)
    base='vitrinecity-lia:audio-base-'+work.name;tag='vitrinecity-lia:audio-native-'+work.name
    m.command(['docker','image','tag',info['Image'],base])
    m.write_new(context/'Dockerfile',('FROM '+base+'\n'+''.join('COPY '+p+' /'+p+'\n' for p in payload)).encode())
    m.command(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600,log=work/'build.private.log')
    image=m.image_id(tag);need(image!=info['Image'],'NOVA_IMAGEM_NAO_CONFIRMADA')
    return base,tag,image

def native_tests(m,image,files,work):
    name='lia-audio-tests-'+work.name
    cmd=['docker','run','--init','--rm','--name',name,'--pull','never','--network','none','--read-only',
         '--no-healthcheck','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1',
         '--pids-limit','128','--tmpfs','/tmp:rw,nosuid,nodev,size=192m','--tmpfs','/data:rw,nosuid,nodev,size=32m','-w','/app']
    tests=[]
    for filename,data in files.items():
        if not filename.endswith('.mjs'):continue
        p=work/'audio-tests'/filename;m.write_new(p,data)
        cmd+=['--mount',f'type=bind,source={p},target=/app/scripts/{filename},readonly'];tests.append('/app/scripts/'+filename)
    cmd+=['--entrypoint','/usr/bin/env',image,'-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','TMPDIR=/tmp',
          'REQUIRE_BETTER_SQLITE3=1','node','--test','--test-reporter=tap',*tests]
    try:
        result=m.command(cmd,timeout=300,log=work/'audio-tests.private.log',allow_failure=True)
        counts=m.parse_tap(m.private_read(work/'audio-tests.private.log').decode('utf8','replace'))
        need(result.returncode==0 and counts=={'tests':33,'pass':33,'fail':0,'cancelled':0,'skipped':0,'todo':0},'TESTES_DE_AUDIO_FALHARAM')
        return counts
    finally:
        try:m.command(['docker','rm','-f',name],timeout=20,allow_failure=True)
        except m.Blocked:pass

def update(m,builder,files,info,revision):
    quality(m,revision);guards(m,info)
    backup_dir,report=m.find_backup()
    print('Verificando o backup existente; nenhuma geracao paga sera executada.',flush=True)
    backup=m.verify_backup(backup_dir,report)
    paths=m.current_paths(info);settings=m.snapshot_settings(paths)
    work=m.ROOT/('release-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+secrets.token_hex(4));work.mkdir(mode=0o700)
    m.write_new(work/'update-native-audio-v94.py',Path(__file__).read_bytes())
    m.write_new(work/'before-inspect.private.json',json.dumps(info).encode())
    print('Construindo e testando imagem com audio: sem credenciais, rede ou dados de producao.',flush=True)
    base,tag,new_image=build_image(m,builder,info,work)
    m.syntax_image(work,tag)
    regression=m.test_image(work,tag)
    tests=native_tests(m,tag,files,work)
    env=wanted_environment(m.environment(info))
    before,after=m.frozen_files(work,info,base,tag,env)
    check=copy.deepcopy(after);check['services']['app']['image']=before['services']['app']['image'];check['services']['app']['environment']=before['services']['app']['environment']
    need(check==before,'CONFIGURACAO_FORA_DE_IMAGEM_E_AMBIENTE')
    latest_before=m.load(m.ROOT/'latest.private.json')
    state={'kind':KIND,'directory':str(work),'phase':'PREPARED','oldImage':info['Image'],'newImage':new_image,
      'frozenHashes':{n:sha(m.private_read(work/n)) for n in ('before.private.json','after.private.json')},
      'revision':revision,'settings':settings,'backup':backup,'tests':{'regression':regression,'nativeAudio':tests},
      'latestBefore':latest_before,'databaseRestored':False,'operationsEnabled':True}
    m.atomic_json(work/'state.private.json',state)
    rollback=f'python3 {work}/update-native-audio-v94.py voltar --estado {work.name} --confirmar-troca'
    m.write_new(work/'rollback.sh',('#!/bin/sh\nset -eu\nexec '+rollback+'\n').encode())
    print('Retorno somente desta atualizacao: '+rollback,flush=True)
    changed=False
    try:
        current,already=inspect_ready(m,builder)
        need(not already and current['Id']==info['Id'],'APP_MUDOU_ANTES_DA_TROCA')
        need(m.snapshot_settings(paths)==settings,'CONFIGURACAO_MUDOU_ANTES_DA_TROCA')
        guards(m,current);quality(m,revision)
        state['phase']='STOP_REQUESTED';m.atomic_json(work/'state.private.json',state);changed=True
        print('Trocando somente o app; site/chat pode ficar temporariamente indisponivel.',flush=True)
        state['stopEvidence']=m.stop_for_rollout(info,work,permit_legacy=False)
        need(state['stopEvidence']['legacyForcedStopUsed'] is False,'PARADA_FORCADA_NAO_ACEITA')
        state['freshSqliteBackup']=m.sqlite_snapshot(work/'before-database.sqlite')
        state['phase']='RECREATE_REQUESTED';m.atomic_json(work/'state.private.json',state)
        m.compose_up(work/'after.private.json',work,new_image)
        active=m.wait_health(new_image,info,env)
        need(active.get('HostConfig',{}).get('Init') is True,'INIT_NAO_PRESERVADO')
        m.verify_payload(active['Id'],expected_files(m,builder,True));m.api_probe(active['Id'])
        need(configuration(m.environment(active))['kling'].get('nativeAudio720')==TARIFF,'AUDIO_NAO_HABILITADO')
        need(m.snapshot_settings(paths)==settings,'CONFIGURACAO_ORIGINAL_ALTERADA')
        state['phase']='DEPLOYED';state['container']=active['Id'];m.atomic_json(work/'state.private.json',state)
        m.atomic_json(m.ROOT/'latest.private.json',{'directory':str(work),'image':new_image})
        print('=== RELATORIO LIA: AUDIO NATIVO ===')
        print(json.dumps({'status':'NATIVE_AUDIO_ENABLED_E2E_PENDING','deployed':True,'appHealthy':True,
          'nativeAudioEnabled':True,'operationsEnabled':True,'initEnabled':True,'imageRoutingPreserved':True,
          'sameDataMounts':True,'databaseRestored':False,'paidTaskExecuted':False,'realAudioGenerationVerified':False,
          'usdPerSecond':'0.126','resolution':'720p','rollbackCommand':rollback,'directory':str(work)},indent=2))
        return 0
    except BaseException as error:
        state['failure']=str(error) if isinstance(error,(Refused,m.Blocked)) else 'ERRO_PRIVADO_OMITIDO'
        if changed:
            try:
                m.rollback_work(work,state);state['phase']='ROLLED_BACK_AFTER_FAILURE'
                m.atomic_json(m.ROOT/'latest.private.json',latest_before)
            except BaseException:state['phase']='RECOVERY_REQUIRED'
        m.atomic_json(work/'state.private.json',state)
        print(json.dumps({'status':state['phase'],'error':state['failure'],'databaseRestored':False,
                          'rollbackCommand':rollback,'directory':str(work)},indent=2));return 2

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=('plano','aplicar','voltar'),nargs='?',default='plano')
    p.add_argument('--revision',default='');p.add_argument('--confirmar-troca',action='store_true');p.add_argument('--estado',default='')
    a=p.parse_args()
    need(os.geteuid()==0 and socket.gethostname().split('.')[0]==HOST,'EXECUTE_NA_VPS_PRINCIPAL_srv1901029')
    os.umask(0o077);m=load_helper()
    for signum in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(signum,m.interrupted)
    if a.mode=='plano':
        builder,files=load_bundle(m);info,already=inspect_ready(m,builder)
        if not already:quality(m,a.revision);guards(m,info);m.find_backup()
        print(json.dumps({'status':'ALREADY_UPDATED' if already else 'READY_NOT_DEPLOYED','appHealthy':True,
          'deployedByThisCommand':False,'nativeAudioUsdPerSecond':'0.126','paidTaskExecuted':False},indent=2));return 0
    need(a.confirmar_troca,'CONFIRMACAO_DE_TROCA_OBRIGATORIA')
    m.controlled(m.ROOT,private=True)
    fd=os.open(m.ROOT/'deployment.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+b') as lock:
        s=os.fstat(lock.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o077,'TRAVA_INVALIDA')
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refused('OUTRA_IMPLANTACAO_EM_ANDAMENTO') from None
        if a.mode=='voltar':
            work=m.release_by_id(a.estado);state=m.load(work/'state.private.json')
            need(state.get('kind')==KIND,'RETORNO_NAO_PERTENCE_A_ESTA_ATUALIZACAO')
            need(m.pending()==0,'RETORNO_BLOQUEADO_POR_PEDIDOS_PENDENTES')
            m.rollback_work(work,state);state['phase']='ROLLED_BACK';m.atomic_json(work/'state.private.json',state)
            m.atomic_json(m.ROOT/'latest.private.json',state['latestBefore'])
            print('AUDIO_REVERTIDO: codigo/configuracao anteriores; banco nao restaurado.');return 0
        builder,files=load_bundle(m);info,already=inspect_ready(m,builder)
        if already:print('ALREADY_UPDATED: nenhuma troca repetida.');return 0
        return update(m,builder,files,info,a.revision)
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:
        code=str(e)
        print('PARADO: '+(code if re.fullmatch('[A-Z][A-Za-z0-9_]{1,159}',code) else 'VERIFICACAO_INCOMPLETA_DADOS_PRIVADOS_OMITIDOS'),file=sys.stderr)
        sys.exit(1)
