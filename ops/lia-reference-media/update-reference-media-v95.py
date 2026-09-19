#!/usr/bin/env python3
"""Product-reference media release: pinned overlay, opt-in audio, no Git checkout.
Plan never changes production. Apply requires explicit consent and live CI/Sonar.
No provider calls, no token prompts, no restoration of an old database.
"""
from __future__ import annotations
import argparse, copy, fcntl, hashlib, json, os, re, secrets, signal, socket, stat, sys, time, types
from pathlib import Path

HOST='srv1901029'
SEED=Path('/var/lib/vitrinecity-lia-deploy/release-20260919T124012Z-673482fd')
HELPER_HASH='27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44'
KIND='LIA_REFERENCE_MEDIA_V95'
PR=212
WORKFLOW='LIA reference media validation'
CONFIG_KEY='VITRINY_NEURAL_PAID_CONFIG_JSON'
TARIFF={'enabled':True,'model':'kling-3.0','resolution':'720p','usdPerSecond':'0.126',
 'tariffVersion':'kling-3.0-native-audio-720p-20260919','effectiveAt':'2026-09-19T00:00:00.000Z'}
BUNDLE_HASHES={'build-reference-media-v95.py': '812acd2274e0244ea56e5b6739d958ad88f1ca247b7126d7219459257e572183', 'build-native-audio-v94.py': '67dbc90dea123481244a798f714a0cea587401a6e30acadb00f41cc05ad4796e', 'neural-reference-media.js': 'b838281d028ed3e0764098c727de40766d2f4b7e038fd2be1e096d484ab68cf9', 'test-reference-media.mjs': '8e8e982df03a1cfb84b21566a63a1ad79fdca12003765e53c7c6c3aa7b405166'}

class Refused(RuntimeError):pass
def need(value,code):
    if not value:raise Refused(code)
def sha(data):return hashlib.sha256(data).hexdigest()
def module(name,data,p):
    m=types.ModuleType(name);m.__file__=str(p);exec(compile(data,str(p),'exec'),m.__dict__);return m

def load_helper():
    p=SEED/'deploy-lia-v9.py'
    for d in [*reversed(p.parent.parents),p.parent]:
        s=d.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'DIRETORIO_DO_AUXILIAR_INVALIDO')
    with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'rb') as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o077 and s.st_size<100000,'AUXILIAR_PRIVADO_INVALIDO');data=f.read(100001)
    need(sha(data)==HELPER_HASH,'AUXILIAR_DE_RECUPERACAO_DIFERENTE')
    m=module('verified_deploy',data,p);m.PR=PR
    m.REQUIRED_CI=(*m.REQUIRED_CI,'LIA image routing hotfix tests','LIA native audio validation',WORKFLOW)
    return m

def load_bundle(m):
    root=Path(__file__).resolve().parent
    files={name:m.private_read(root/name,limit=100000) for name in BUNDLE_HASHES}
    need(all(sha(data)==BUNDLE_HASHES[name] for name,data in files.items()),'PACOTE_DE_REFERENCIA_DIVERGENTE')
    b=module('reference_builder',files['build-reference-media-v95.py'],root/'build-reference-media-v95.py')
    a=module('audio_builder',files['build-native-audio-v94.py'],root/'build-native-audio-v94.py')
    need(sha(files['neural-reference-media.js'])==b.MODULE_HASH,'MODULO_DIVERGENTE')
    return b,a,files

def quality(m,revision):
    need(re.fullmatch('[a-f0-9]{40}',revision or '') is not None,'REVISAO_COMPLETA_OBRIGATORIA')
    base='https://api.github.com/repos/'+m.REPO;pr=m.public_json(base+'/pulls/'+str(PR))
    need(pr.get('head',{}).get('repo',{}).get('full_name')==m.REPO and pr.get('head',{}).get('ref')=='feat/lia-product-reference-20260919' and
         pr.get('base',{}).get('ref')=='feat/lia-native-audio-20260919','BASE_OU_BRANCH_NAO_REVISADA')
    project='markentingimperio-debug_vitrinecity'
    return m.validate_gate(revision,pr,
     m.public_json(base+'/actions/runs?event=pull_request&head_sha='+revision+'&per_page=100'),
     m.public_json('https://sonarcloud.io/api/project_pull_requests/list?project='+project),
     m.public_json('https://sonarcloud.io/api/qualitygates/project_status?projectKey='+project+'&pullRequest='+str(PR)))

def expected_files(m,b,a,audio=False,reference=False):
    return {**m.PAYLOAD,**{p:v[int(audio)] for p,v in a.MANIFEST.items()},
     **{p:v[int(reference)] for p,v in b.MANIFEST.items()},b.MODULE:b.MODULE_HASH if reference else None}

def desired_environment(env,enable_audio):
    if not enable_audio:return env.copy()
    try:cfg=json.loads(env[CONFIG_KEY])
    except Exception:raise Refused('CONFIGURACAO_PAGA_INVALIDA') from None
    need(isinstance(cfg,dict) and cfg.get('enabled') is True and isinstance(cfg.get('kling'),dict),'KLING_NAO_CONFIGURADO')
    old=cfg['kling'].get('nativeAudio720');need(old is None or old==TARIFF,'TARIFA_DE_AUDIO_EXISTENTE_DIFERENTE')
    if old==TARIFF:return env.copy()
    cfg=copy.deepcopy(cfg);cfg['kling']['nativeAudio720']=copy.deepcopy(TARIFF)
    result=env.copy();result[CONFIG_KEY]=json.dumps(cfg,ensure_ascii=True,separators=(',',':'))
    return result

def inspect_ready(m,b,a):
    info=m.app();m.topology(info);need(m.healthy(info) and info.get('HostConfig',{}).get('Init') is True,'APP_OU_INIT_NAO_SAUDAVEL')
    env=m.environment(info);need(env.get('LIA_CHAT_OPERATIONS_ENABLED')=='true','WORKERS_DEVEM_PERMANECER_HABILITADOS')
    latest=m.load(m.ROOT/'latest.private.json');p=Path(latest.get('directory',''))
    need(p.parent==m.ROOT and re.fullmatch(r'release-\d{8}T\d{6}Z-[a-f0-9]{8}',p.name) is not None,'RELEASE_GERENCIADA_INVALIDA')
    m.controlled(p,private=True);state=m.load(p/'state.private.json')
    need(state.get('phase')=='DEPLOYED' and state.get('newImage')==info['Image']==latest.get('image') and
         state.get('kind') in ('LIA_IMAGE_ROUTE_V93','LIA_NATIVE_AUDIO_V94',KIND),'BASE_GERENCIADA_DIVERGENTE')
    need(sha(m.private_read(p/'after.private.json'))==state.get('frozenHashes',{}).get('after.private.json'),'CONFIGURACAO_SALVA_ALTERADA')
    wanted=m.runtime_environment_from_render(m.render([p/'after.private.json']))
    need(env==wanted,'AMBIENTE_MUDOU_DESDE_A_IMPLANTACAO')
    m.runtime_equivalent(m.load(p/'before-inspect.private.json'),info,wanted)
    paths=m.current_paths(info);need(len(paths)==1 and Path(paths[0]).parent.parent==m.ROOT,'COMPOSE_NAO_GERENCIADO')
    actual=m.runtime_hashes(info['Id'],expected_files(m,b,a));matches=[]
    for audio in (False,True):
        for ref in (False,True):
            if actual==expected_files(m,b,a,audio,ref):matches.append((audio,ref))
    need(len(matches)==1,'CODIGO_ATIVO_DIFERENTE_DA_BASE')
    audio,ref=matches[0]
    if audio:need(desired_environment(env,True)==env,'AUDIO_INSTALADO_COM_CONFIGURACAO_DIVERGENTE')
    need(ref==(state.get('kind')==KIND),'ESTADO_DA_REFERENCIA_DIVERGENTE')
    return info,audio,ref

def guards(m,info,a):
    need(m.consumers()==[info['Id']] and m.pending()==0,'HA_PEDIDOS_PENDENTES_OU_OUTRO_CONSUMIDOR')
    m.verify_retest()
    expected={p:sha(m.private_read(m.STAGED/'candidate'/p)) for p in m.GUARDS if p not in a.MANIFEST}
    need(m.runtime_hashes(info['Id'],expected)==expected,'DEPENDENCIAS_OU_CARTEIRA_DIVERGENTES')

def build_image(m,b,a,files,info,work,had_audio,want_audio):
    changes=m.command(['docker','diff',info['Id']]).stdout.decode().splitlines()
    need(not any(x[2:]=='/app' or x[2:].startswith('/app/') for x in changes),'CODIGO_LOCAL_NAO_VERSIONADO')
    def read(p):return m.command(['docker','exec',info['Id'],'node','-e',"process.stdout.write(require('fs').readFileSync(process.argv[1]))",'/'+p]).stdout
    payload={p:b.patch(p,read(p)) for p in b.MANIFEST};payload[b.MODULE]=files['neural-reference-media.js']
    if want_audio and not had_audio:
        for p,(before,_) in a.MANIFEST.items():payload[p]=a.patch(p,None if before is None else read(p))
    context=work/'context';context.mkdir(mode=0o700)
    for p,data in payload.items():m.write_new(context/p,data)
    base='vitrinecity-lia:reference-base-'+work.name;tag='vitrinecity-lia:reference-'+work.name
    m.command(['docker','image','tag',info['Image'],base])
    m.write_new(context/'Dockerfile',('FROM '+base+'\n'+''.join('COPY '+p+' /'+p+'\n' for p in payload)).encode())
    m.command(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600,log=work/'build.private.log')
    image=m.image_id(tag);need(image!=info['Image'],'NOVA_IMAGEM_NAO_CONFIRMADA');return base,tag,image

def reference_tests(m,tag,files,work,audio):
    p=work/'tests/test-reference-media.mjs';m.write_new(p,files['test-reference-media.mjs'])
    name='lia-reference-tests-'+work.name
    cmd=['docker','run','--init','--rm','--name',name,'--pull','never','--network','none','--read-only','--no-healthcheck',
      '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1','--pids-limit','128',
      '--tmpfs','/tmp:rw,nosuid,nodev,size=192m','--tmpfs','/data:rw,nosuid,nodev,size=32m','-w','/app',
      '--mount',f'type=bind,source={p},target=/app/scripts/test-reference-media.mjs,readonly','--entrypoint','/usr/bin/env',tag,
      '-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','TMPDIR=/tmp','REFERENCE_AUDIO_ENABLED='+str(int(audio)),
      'node','--test','--test-reporter=tap','scripts/test-reference-media.mjs']
    try:
        r=m.command(cmd,timeout=300,log=work/'reference-tests.private.log',allow_failure=True)
        counts=m.parse_tap(m.private_read(work/'reference-tests.private.log').decode('utf8','replace'))
        need(r.returncode==0 and counts==dict(tests=46,**{'pass':46},fail=0,cancelled=0,skipped=0,todo=0),'TESTES_DE_REFERENCIA_FALHARAM');return counts
    finally:
        try:m.command(['docker','rm','-f',name],timeout=20,allow_failure=True)
        except m.Blocked:pass

def update(m,b,a,files,info,had_audio,revision,enable_audio):
    quality(m,revision);guards(m,info,a)
    want_audio=had_audio or enable_audio;env=desired_environment(m.environment(info),want_audio)
    backup_dir,report=m.find_backup();print('Conferindo o backup existente; nenhuma API paga sera chamada.',flush=True)
    backup=m.verify_backup(backup_dir,report)
    paths=m.current_paths(info);settings=m.snapshot_settings(paths);latest=m.load(m.ROOT/'latest.private.json')
    work=m.ROOT/('release-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+secrets.token_hex(4));work.mkdir(mode=0o700)
    m.write_new(work/'update-reference-media-v95.py',Path(__file__).read_bytes())
    m.write_new(work/'before-inspect.private.json',json.dumps(info).encode())
    print('Construindo referencia de produto e testando sem credenciais/dados de producao.',flush=True)
    base,tag,image=build_image(m,b,a,files,info,work,had_audio,want_audio)
    m.syntax_image(work,tag);regression=m.test_image(work,tag);tested=reference_tests(m,tag,files,work,want_audio)
    before,after=m.frozen_files(work,info,base,tag,env)
    check=copy.deepcopy(after);check['services']['app']['image']=before['services']['app']['image'];check['services']['app']['environment']=before['services']['app']['environment']
    need(check==before,'CONFIGURACAO_FORA_DA_IMAGEM_E_AUDIO')
    state={'kind':KIND,'phase':'PREPARED','directory':str(work),'oldImage':info['Image'],'newImage':image,'revision':revision,
      'frozenHashes':{n:sha(m.private_read(work/n)) for n in ('before.private.json','after.private.json')},
      'settings':settings,'backup':backup,'tests':{'regression':regression,'reference':tested},'latestBefore':latest,
      'nativeAudioEnabled':want_audio,'databaseRestored':False}
    m.atomic_json(work/'state.private.json',state)
    rollback=f'python3 {work}/update-reference-media-v95.py voltar --estado {work.name} --confirmar-troca'
    m.write_new(work/'rollback.sh',('#!/bin/sh\nset -eu\nexec '+rollback+'\n').encode());print('Retorno desta atualizacao: '+rollback,flush=True)
    changed=False
    try:
        current,audio,already=inspect_ready(m,b,a)
        need(current['Id']==info['Id'] and audio==had_audio and not already,'APP_MUDOU_ANTES_DA_TROCA')
        need(m.snapshot_settings(paths)==settings,'CONFIGURACAO_MUDOU_ANTES_DA_TROCA');guards(m,current,a);quality(m,revision)
        state['phase']='STOP_REQUESTED';m.atomic_json(work/'state.private.json',state);changed=True
        print('Trocando somente o app; site/chat pode ficar temporariamente indisponivel.',flush=True)
        state['stopEvidence']=m.stop_for_rollout(info,work,permit_legacy=False)
        need(state['stopEvidence']['legacyForcedStopUsed'] is False,'PARADA_FORCADA_NAO_ACEITA')
        state['freshSqliteBackup']=m.sqlite_snapshot(work/'before-database.sqlite')
        state['phase']='RECREATE_REQUESTED';m.atomic_json(work/'state.private.json',state)
        m.compose_up(work/'after.private.json',work,image);active=m.wait_health(image,info,env)
        need(active.get('HostConfig',{}).get('Init') is True,'INIT_NAO_PRESERVADO')
        m.verify_payload(active['Id'],expected_files(m,b,a,want_audio,True));m.api_probe(active['Id'])
        need(m.snapshot_settings(paths)==settings,'CONFIGURACAO_ORIGINAL_ALTERADA')
        state['phase']='DEPLOYED';state['container']=active['Id'];m.atomic_json(work/'state.private.json',state)
        m.atomic_json(m.ROOT/'latest.private.json',{'directory':str(work),'image':image})
        print('=== RELATORIO LIA: REFERENCIA DO PRODUTO ===')
        print(json.dumps({'status':'PRODUCT_REFERENCE_ENABLED_E2E_PENDING','deployed':True,'appHealthy':True,
          'referenceImageToVideoEnabled':True,'referenceImageToImageEnabled':True,'nativeAudioEnabled':want_audio,
          'visualAnalysisEnabled':False,'operationsEnabled':True,'initEnabled':True,'sameDataMounts':True,
          'databaseRestored':False,'paidTaskExecuted':False,'realProviderGenerationVerified':False,
          'rollbackCommand':rollback,'directory':str(work)},indent=2));return 0
    except BaseException as error:
        state['failure']=str(error) if isinstance(error,(Refused,m.Blocked)) else 'ERRO_PRIVADO_OMITIDO'
        if changed:
            try:
                m.rollback_work(work,state);state['phase']='ROLLED_BACK_AFTER_FAILURE';m.atomic_json(m.ROOT/'latest.private.json',latest)
            except BaseException:state['phase']='RECOVERY_REQUIRED'
        m.atomic_json(work/'state.private.json',state)
        print(json.dumps({'status':state['phase'],'error':state['failure'],'databaseRestored':False,'rollbackCommand':rollback,'directory':str(work)},indent=2));return 2

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=('plano','aplicar','voltar'),nargs='?',default='plano')
    p.add_argument('--revision',default='');p.add_argument('--estado',default='');p.add_argument('--confirmar-troca',action='store_true');p.add_argument('--ativar-audio',action='store_true');args=p.parse_args()
    need(os.geteuid()==0 and socket.gethostname().split('.')[0]==HOST,'EXECUTE_NA_VPS_PRINCIPAL_srv1901029');os.umask(0o077);m=load_helper()
    for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,m.interrupted)
    if args.mode=='plano':
        b,a,files=load_bundle(m);info,audio,already=inspect_ready(m,b,a)
        if not already:quality(m,args.revision);guards(m,info,a);m.find_backup();desired_environment(m.environment(info),audio or args.ativar_audio)
        need(not already or not args.ativar_audio or audio,'REFERENCIA_JA_INSTALADA_SEM_AUDIO_REQUER_REVISAO')
        print(json.dumps({'status':'ALREADY_UPDATED' if already else 'READY_NOT_DEPLOYED','appHealthy':True,
          'deployedByThisCommand':False,'nativeAudioAfterUpdate':audio or args.ativar_audio,'paidTaskExecuted':False},indent=2));return 0
    need(args.confirmar_troca,'CONFIRMACAO_DE_TROCA_OBRIGATORIA');m.controlled(m.ROOT,private=True)
    lock=os.open(m.ROOT/'deployment.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        s=os.fstat(lock);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o077,'TRAVA_INVALIDA')
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refused('OUTRA_IMPLANTACAO_EM_ANDAMENTO') from None
        if args.mode=='voltar':
            work=m.release_by_id(args.estado);m.controlled(work,private=True);state=m.load(work/'state.private.json')
            need(state.get('kind')==KIND,'ESTADO_NAO_PERTENCE_A_ESTA_ATUALIZACAO');m.rollback_work(work,state)
            state['phase']='ROLLED_BACK';m.atomic_json(work/'state.private.json',state);m.atomic_json(m.ROOT/'latest.private.json',state['latestBefore'])
            print('ROLLBACK_CONCLUIDO: somente codigo/configuracao; banco nao restaurado.');return 0
        b,a,files=load_bundle(m);info,audio,already=inspect_ready(m,b,a)
        if already:
            need(not args.ativar_audio or audio,'REFERENCIA_JA_INSTALADA_SEM_AUDIO_REQUER_REVISAO');print('ALREADY_UPDATED: nenhuma troca executada.');return 0
        return update(m,b,a,files,info,audio,args.revision,args.ativar_audio)
    finally:os.close(lock)

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        code=str(error) if isinstance(error,Refused) or type(error).__name__=='Blocked' else 'ERRO_PRIVADO_OMITIDO'
        print('PARADO: '+code,file=sys.stderr);raise SystemExit(1)
