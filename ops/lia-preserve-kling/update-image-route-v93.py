#!/usr/bin/env python3
"""Pinned image-word hotfix for the already deployed LIA with init.

Default plan is read-only. Apply requires --confirmar-troca. Only the routing
copy recognizes 'image'; prompts, provider adapters, coins, env and data stay
unchanged. No provider task, token prompt, forced-stop waiver or DB restore.
Uses the exact recovery helper from the owner's successful release.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import stat
import sys
import time

HOST = 'srv1901029'
SEED = Path('/var/lib/vitrinecity-lia-deploy/release-20260919T124012Z-673482fd')
HELPER_SHA256 = '27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44'
ENGINE = 'app/vitriny-neural/chat-engine.js'
BEFORE_HASH = '21ea860eb44f4bba2f6aa9399758407fb93e581c42c40d5b378d5a5ca79b4cb9'
AFTER_HASH = '9e1307f3b134e6de70cd652c3c8567da551bbb8665769c013b0898e88ab50426'
OLD = "  const text=normalize(message).trim();"
NEW = "  // Normalize only the routing copy; preserve the original prompt and its billing fingerprint.\n  const text=normalize(message).trim().replace(/\\bimage\\b/g,'imagem');"
WORKFLOW = 'LIA image routing hotfix tests'
KIND = 'LIA_IMAGE_ROUTE_V93'

# These tests only call the pure classifier, never prepare or confirm a paid job.
CASES = [
    ['vc pode gerar um image de jesus cristo em escultura de areia e seu escultor triste','image'],
    ['vc pode gerar uma imagem de Jesus Cristo na areia','image'],
    ['Gere uma image realista de uma flor','image'],
    ['Crie uma IMAGE de uma planta','image'],
    ['Faça uma image quadrada','image'],
    ['Quero uma image de uma cidade','image'],
    ['Gere uma imagem realista de uma flor','image'],
    ['Gere uma foto realista de uma planta','image'],
    ['Crie uma ilustração de uma cidade','image'],
    ['Gere um vídeo de uma flor','video'],
    ['Gere um video de uma planta crescendo por 5 segundos','video'],
    ['Crie um clipe de uma praia','video'],
    ['Anime esta imagem em um vídeo','video'],
    ['Escreva um prompt para gerar uma image de uma planta','text'],
    ['Gere um prompt para criar uma image','text'],
    ['Crie um roteiro para um vídeo de flores','text'],
    ['Escreva uma legenda para esta image','text'],
    ['Descreva esta image em texto','text'],
    ['O que significa image em inglês?','text'],
    ['Envie uma image para o cliente','action'],
    ['Pesquise imagens na internet','research'],
    ['Como adubar uma rosa do deserto?','text'],
]

class Refused(RuntimeError):
    """Only fixed codes may be shown publicly."""

def need(condition, code):
    if not condition:
        raise Refused(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def patch_engine(data):
    need(sha(data) == BEFORE_HASH, 'MOTOR_DIFERENTE_DA_VERSAO_IMPLANTADA')
    text = data.decode('utf-8')
    need(text.count(OLD) == 1, 'TRECHO_DE_ROTEAMENTO_NAO_UNICO')
    result = text.replace(OLD, NEW, 1).encode('utf-8')
    need(sha(result) == AFTER_HASH, 'CORRECAO_DE_ROTEAMENTO_NAO_CONFERE')
    need(result.replace(NEW.encode(), OLD.encode(), 1) == data, 'ALTERACAO_FORA_DO_ROTEAMENTO')
    return result

def load_helper():
    path = SEED/'deploy-lia-v9.py'
    for parent in [*reversed(path.parent.parents), path.parent]:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
             'DIRETORIO_DO_AUXILIAR_NAO_PROTEGIDO')
    fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o077 and s.st_size < 100000,
             'AUXILIAR_PRIVADO_INVALIDO')
        data = f.read(100001)
    need(sha(data) == HELPER_SHA256, 'AUXILIAR_DE_RECUPERACAO_DIFERENTE')
    # Execute the verified bytes, not a second read of the path.
    import types
    m = types.ModuleType('lia_recovery_verified')
    m.__file__ = str(path)
    exec(compile(data, str(path), 'exec'), m.__dict__)
    m.REQUIRED_CI = (*m.REQUIRED_CI, WORKFLOW)
    return m

def inspect_ready(m):
    info = m.app(); m.topology(info)
    need(m.healthy(info), 'APP_NAO_SAUDAVEL')
    need(info.get('HostConfig', {}).get('Init') is True, 'ATUALIZACAO_REQUER_INIT_JA_IMPLANTADO')
    need(m.environment(info).get('LIA_CHAT_OPERATIONS_ENABLED') == 'true', 'WORKERS_DEVEM_PERMANECER_HABILITADOS')
    actual = m.runtime_hashes(info['Id'], m.PAYLOAD)
    fixed = {**m.PAYLOAD, ENGINE: AFTER_HASH}
    need(actual in (m.PAYLOAD, fixed), 'ARQUIVOS_ATIVOS_DIVERGENTES')
    latest = m.load(m.ROOT/'latest.private.json')
    need(latest.get('image') == info['Image'], 'IMAGEM_DIFERENTE_DA_ULTIMA_IMPLANTACAO')
    if actual == fixed:
        return info, True
    seed = m.load(SEED/'state.private.json')
    need(seed.get('phase') == 'DEPLOYED' and seed.get('newImage') == info['Image'], 'BASE_DE_IMPLANTACAO_DIFERENTE')
    need(m.sha(m.private_read(SEED/'after.private.json')) == seed.get('frozenHashes', {}).get('after.private.json'),
         'CONFIGURACAO_DA_BASE_MUDOU')
    wanted = m.runtime_environment_from_render(m.render([SEED/'after.private.json']))
    need(m.environment(info) == wanted, 'AMBIENTE_MUDOU_DESDE_A_IMPLANTACAO')
    m.runtime_equivalent(m.load(SEED/'before-inspect.private.json'), info, wanted)
    paths = m.current_paths(info)
    need(len(paths) == 1 and Path(paths[0]).parent.parent == m.ROOT, 'COMPOSE_NAO_GERENCIADO')
    return info, False

def guards(m, info):
    need(m.consumers() == [info['Id']] and m.pending() == 0, 'HA_PEDIDOS_PENDENTES_OU_OUTRO_CONSUMIDOR')
    m.verify_retest()
    expected = {p:m.sha(m.private_read(m.STAGED/'candidate'/p)) for p in m.GUARDS}
    need(m.runtime_hashes(info['Id'], expected) == expected, 'DEPENDENCIAS_OU_CARTEIRA_DIVERGENTES')

ROUTE_JS = r"""import {routeChatIntent} from '/app/vitriny-neural/chat-engine.js';
const cases=JSON.parse(process.argv[1]);
for(let i=0;i<cases.length;i++){
 const [message,expected]=cases[i];if(routeChatIntent(message).kind!==expected){
  console.log(JSON.stringify({ok:false,caseIndex:i}));process.exit(2);}}
console.log(JSON.stringify({ok:true,tests:cases.length,paidTaskExecuted:false}));"""

def route_tests(m, image, work):
    name = 'lia-route-tests-'+work.name
    cmd = ['docker','run','--init','--rm','--name',name,'--pull','never','--network','none',
           '--read-only','--no-healthcheck','--cap-drop','ALL','--security-opt','no-new-privileges',
           '--memory','192m','--cpus','0.5','--pids-limit','32','--entrypoint','/usr/bin/env',image,
           '-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp',
           'node','--input-type=module','-e',ROUTE_JS,json.dumps(CASES)]
    try:
        p = m.command(cmd, timeout=45)
        result = json.loads(p.stdout)
        need(result == {'ok':True,'tests':len(CASES),'paidTaskExecuted':False}, 'TESTES_DE_ROTEAMENTO_FALHARAM')
        return result
    finally:
        # The random test name is never a production name or Compose service.
        try:
            m.command(['docker','rm','-f',name], timeout=20, allow_failure=True)
        except m.Blocked:
            pass

def build_image(m, info, work):
    diff = m.command(['docker','diff',info['Id']]).stdout.decode().splitlines()
    need(not any(line[2:] == '/app' or line[2:].startswith('/app/') for line in diff), 'CODIGO_MODIFICADO_DENTRO_DO_CONTAINER')
    data = m.command(['docker','exec',info['Id'],'node','-e',
                      "process.stdout.write(require('fs').readFileSync('/app/vitriny-neural/chat-engine.js'))"]).stdout
    updated = patch_engine(data)
    context = work/'context'; context.mkdir(mode=0o700)
    m.write_new(context/'chat-engine.js', updated)
    base = 'vitrinecity-lia:route-base-'+work.name
    tag = 'vitrinecity-lia:route-fixed-'+work.name
    m.command(['docker','image','tag',info['Image'],base])
    m.write_new(context/'Dockerfile', ('FROM '+base+'\nCOPY chat-engine.js /app/vitriny-neural/chat-engine.js\n').encode())
    m.command(['docker','build','--network=none','--pull=false','-t',tag,str(context)],
              timeout=600, log=work/'build.private.log')
    image = m.image_id(tag)
    need(image != info['Image'], 'IMAGEM_NOVA_NAO_CONFIRMADA')
    return base, tag, image

def update(m, info, revision):
    m.quality(revision); guards(m, info)
    directory, report = m.find_backup()
    print('Conferindo o backup existente; sem nova copia dos anexos.', flush=True)
    backup = m.verify_backup(directory, report)
    paths = m.current_paths(info); settings = m.snapshot_settings(paths)
    work = m.ROOT/('release-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+secrets.token_hex(4))
    work.mkdir(mode=0o700)
    m.write_new(work/'update-image-route-v93.py', Path(__file__).read_bytes())
    m.write_new(work/'before-inspect.private.json', json.dumps(info).encode())
    print('Construindo a correcao de uma linha e testando sem credenciais nem rede.', flush=True)
    base, tag, new_image = build_image(m, info, work)
    m.syntax_image(work, tag)
    regression = m.test_image(work, tag)
    routing = route_tests(m, tag, work)
    env = m.environment(info)
    before, after = m.frozen_files(work, info, base, tag, env)
    # No price, token, model, init, network, volume or process-setting change.
    compared = json.loads(json.dumps(after))
    compared['services']['app']['image'] = before['services']['app']['image']
    need(compared == before, 'ALTERACAO_DE_CONFIGURACAO_FORA_DA_IMAGEM')
    latest_before = m.load(m.ROOT/'latest.private.json')
    state = {'kind':KIND,'directory':str(work),'phase':'PREPARED','oldImage':info['Image'],
             'newImage':new_image,'frozenHashes':{n:sha(m.private_read(work/n)) for n in ('before.private.json','after.private.json')},
             'revision':revision,'settings':settings,'backup':backup,'tests':{'regression':regression,'routing':routing},
             'latestBefore':latest_before,'databaseRestored':False,'operationsEnabled':True}
    m.atomic_json(work/'state.private.json', state)
    rollback = f'python3 {work}/update-image-route-v93.py voltar --estado {work.name} --confirmar-troca'
    m.write_new(work/'rollback.sh', ('#!/bin/sh\nset -eu\nexec '+rollback+'\n').encode())
    print('Retorno somente desta correcao: '+rollback, flush=True)
    changed = False
    try:
        current, already = inspect_ready(m)
        need(not already and current['Id'] == info['Id'], 'APP_MUDOU_ANTES_DA_TROCA')
        need(m.snapshot_settings(paths) == settings, 'CONFIGURACAO_MUDOU_ANTES_DA_TROCA')
        guards(m, current); m.quality(revision)
        state['phase'] = 'STOP_REQUESTED'; m.atomic_json(work/'state.private.json', state)
        changed = True
        print('Atualizando somente o app; o chat/site pode ficar temporariamente indisponivel.', flush=True)
        state['stopEvidence'] = m.stop_for_rollout(info, work, permit_legacy=False)
        need(state['stopEvidence']['legacyForcedStopUsed'] is False, 'PARADA_FORCADA_NAO_ACEITA')
        state['freshSqliteBackup'] = m.sqlite_snapshot(work/'before-database.sqlite')
        state['phase'] = 'RECREATE_REQUESTED'; m.atomic_json(work/'state.private.json', state)
        m.compose_up(work/'after.private.json', work, new_image)
        active = m.wait_health(new_image, info, env)
        need(active.get('HostConfig', {}).get('Init') is True, 'INIT_NAO_PRESERVADO')
        m.verify_payload(active['Id'], {**m.PAYLOAD, ENGINE:AFTER_HASH})
        # Check against the saved staged guards; the former container may be gone.
        expected_guards = {p:sha(m.private_read(m.STAGED/'candidate'/p)) for p in m.GUARDS}
        need(m.runtime_hashes(active['Id'], m.GUARDS) == expected_guards, 'DEPENDENCIAS_ATIVAS_DIVERGENTES')
        m.api_probe(active['Id'])
        need(m.snapshot_settings(paths) == settings, 'CONFIGURACAO_ORIGINAL_MUDOU')
        state['phase'] = 'DEPLOYED'; state['container'] = active['Id']
        m.atomic_json(work/'state.private.json', state)
        m.atomic_json(m.ROOT/'latest.private.json', {'directory':str(work),'image':new_image})
        print('=== RELATORIO LIA: CORRECAO DE ROTEAMENTO ===')
        print(json.dumps({'status':'IMAGE_ROUTING_UPDATED_E2E_PENDING','deployed':True,'appHealthy':True,
                          'imageAliasRecognized':True,'operationsEnabled':True,'initEnabled':True,
                          'sameEnvironment':True,'sameDataMounts':True,'databaseRestored':False,
                          'paidTaskExecuted':False,'mediaGenerationVerified':False,
                          'engineSha256':AFTER_HASH,'rollbackCommand':rollback,'directory':str(work)}, indent=2))
        return 0
    except BaseException as error:
        state['failure'] = str(error) if isinstance(error, (Refused,m.Blocked)) else 'ERRO_PRIVADO_OMITIDO'
        if changed:
            try:
                m.rollback_work(work, state)
                state['phase'] = 'ROLLED_BACK_AFTER_FAILURE'
                m.atomic_json(m.ROOT/'latest.private.json', latest_before)
            except BaseException:
                state['phase'] = 'RECOVERY_REQUIRED'
        m.atomic_json(work/'state.private.json', state)
        print(json.dumps({'status':state['phase'],'error':state['failure'],'databaseRestored':False,
                          'directory':str(work),'rollbackCommand':rollback}, indent=2))
        return 2

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modo', choices=('plano','aplicar','voltar'), nargs='?', default='plano')
    parser.add_argument('--revision', default='')
    parser.add_argument('--confirmar-troca', action='store_true')
    parser.add_argument('--estado', default='')
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname().split('.')[0] == HOST, 'EXECUTE_NA_VPS_PRINCIPAL_srv1901029')
    os.umask(0o077)
    m = load_helper()
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, m.interrupted)
    if args.modo == 'plano':
        info, applied = inspect_ready(m)
        if not applied:
            m.quality(args.revision); guards(m, info); m.find_backup()
        print(json.dumps({'status':'ALREADY_UPDATED' if applied else 'READY_NOT_DEPLOYED',
                          'appHealthy':True,'deployedByThisCommand':False,'onlyEngineRoutingWillChange':True}, indent=2))
        return 0
    need(args.confirmar_troca, 'CONFIRMACAO_DE_TROCA_OBRIGATORIA')
    m.controlled(m.ROOT, private=True)
    fd = os.open(m.ROOT/'deployment.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+b') as lock:
        s = os.fstat(lock.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o077, 'TRAVA_INVALIDA')
        try: fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise Refused('OUTRA_IMPLANTACAO_EM_ANDAMENTO') from None
        if args.modo == 'voltar':
            work = m.release_by_id(args.estado); state = m.load(work/'state.private.json')
            need(state.get('kind') == KIND, 'RETORNO_NAO_PERTENCE_A_ESTA_CORRECAO')
            m.rollback_work(work, state)
            state['phase'] = 'ROLLED_BACK'; m.atomic_json(work/'state.private.json', state)
            m.atomic_json(m.ROOT/'latest.private.json', state['latestBefore'])
            print('ROTEAMENTO_ANTERIOR_RESTAURADO: banco nao restaurado, workers preservados.')
            return 0
        info, applied = inspect_ready(m)
        if applied:
            print('ALREADY_UPDATED: nenhuma troca repetida.'); return 0
        return update(m, info, args.revision)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        code = str(e)
        print('PARADO: '+(code if re.fullmatch(r'[A-Z][A-Za-z0-9_]{1,159}', code) else 'VERIFICACAO_INCOMPLETA_DADOS_PRIVADOS_OMITIDOS'), file=sys.stderr)
        sys.exit(1)
