#!/usr/bin/env python3
"""Compare Node signal handling in disposable containers. Never deploy or stop production."""
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time

HOST = 'srv1901029'
APP = '98ad009a8cfab575d34c62c293e669d452edc4f2d529fd26e2042183a850e5f1'
IMAGE = 'sha256:70fba9043ed420c8d3eb0a3e2904aeccd2cb593db598c450e59345dd95f47628'
LABEL = 'org.vitrinecity.lia.disposable-signal-probe'
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
PROGRAM = """const fs=require('node:fs');const timer=setInterval(()=>{},1000);
if(process.argv[1]==='handler')process.on('SIGTERM',()=>{clearInterval(timer);process.exitCode=0;});
fs.writeFileSync('/tmp/lia-probe-ready',JSON.stringify({pid:process.pid,node:process.version}),{mode:0o600});"""
CASES = (('sem_init', False, 'default'), ('com_init', True, 'default'), ('handler_explicito', False, 'handler'))

class Blocked(RuntimeError):
    pass

def need(test, code):
    if not test:
        raise Blocked(code)

def docker(*args, timeout=20):
    try:
        p = subprocess.run(['docker', *args], capture_output=True, timeout=timeout, env=ENV)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked('DOCKER_INDISPONIVEL_OU_TIMEOUT') from None
    need(p.returncode == 0, 'COMANDO_DE_TESTE_FALHOU_SEM_EXIBIR_DADOS_PRIVADOS')
    return p.stdout

def inspect(cid):
    rows = json.loads(docker('inspect', '--type=container', cid))
    need(len(rows) == 1 and rows[0].get('Id') == cid, 'IDENTIDADE_NAO_CONFIRMADA')
    return rows[0]

def healthy(row):
    state = row.get('State', {})
    return state.get('Running') is True and state.get('Health', {}).get('Status') == 'healthy' and not state.get('Paused') and not state.get('Restarting')

def mounts(row):
    return sorted(json.dumps(x, sort_keys=True) for x in row.get('Mounts', []))

def production_checks(before, after):
    return {
        'sameContainer': before.get('Id') == after.get('Id') == APP,
        'sameImage': before.get('Image') == after.get('Image') == IMAGE,
        'sameConfiguration': before.get('Config') == after.get('Config'),
        'sameHostConfiguration': before.get('HostConfig') == after.get('HostConfig'),
        'sameMountsIgnoringOrder': mounts(before) == mounts(after),
        'sameStartTime': before.get('State', {}).get('StartedAt') == after.get('State', {}).get('StartedAt'),
        'healthy': healthy(after),
    }

def creation_args(name, nonce, init, mode):
    args = ['create', '--name', name, '--pull', 'never', '--network', 'none', '--read-only', '--no-healthcheck',
            '--restart', 'no', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32',
            '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.25', '--user', '65534:65534',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=8m,mode=1777',
            '--label', LABEL+'='+nonce,
            '--label', 'com.docker.compose.project=lia-signal-probe',
            '--label', 'com.docker.compose.service=probe',
            '--label', 'com.docker.compose.oneoff=True', '--log-driver', 'none']
    if init:
        args += ['--init']
    args += ['--entrypoint', '/usr/bin/env', IMAGE, '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
             'HOME=/tmp', 'TMPDIR=/tmp', 'node', '-e', PROGRAM, mode]
    return args

def owned(cid, nonce, name):
    need(cid != APP and re.fullmatch('[0-9a-f]{64}', cid) is not None, 'ALVO_DE_TESTE_INVALIDO')
    row = inspect(cid)
    labels = row.get('Config', {}).get('Labels') or {}
    need(row.get('Name') == '/'+name and row.get('Image') == IMAGE and labels.get(LABEL) == nonce and
         labels.get('com.docker.compose.project') == 'lia-signal-probe' and
         labels.get('com.docker.compose.service') == 'probe', 'CONTAINER_NAO_PERTENCE_AO_TESTE')
    need(row.get('HostConfig', {}).get('NetworkMode') == 'none' and
         not any(m.get('Type') in ('bind', 'volume') for m in row.get('Mounts', [])), 'ISOLAMENTO_NAO_CONFIRMADO')
    return row

def one_case(kind, init, mode, nonce):
    name = 'lia-signal-probe-'+nonce+'-'+kind.replace('_', '-')
    cid = docker(*creation_args(name, nonce, init, mode), timeout=30).decode().strip()
    need(re.fullmatch('[0-9a-f]{64}', cid) is not None and cid != APP, 'CRIACAO_NAO_CONFIRMADA')
    primary_error = None
    result = None
    try:
        owned(cid, nonce, name)
        docker('start', cid)
        ready = None
        for _ in range(25):
            owned(cid, nonce, name)
            data = docker('exec', '--user', '65534:65534', cid, '/usr/bin/env', '-i',
                          'PATH=/usr/local/bin:/usr/bin:/bin', 'node', '-e',
                          "const f=require('fs');try{process.stdout.write(f.readFileSync('/tmp/lia-probe-ready','utf8'));}catch{}")
            if data:
                ready = json.loads(data)
                break
            time.sleep(0.2)
        need(ready and type(ready.get('pid')) is int and re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', ready.get('node', '')),
             'NODE_DE_TESTE_NAO_CONFIRMADO')
        owned(cid, nonce, name)
        started = time.monotonic()
        # This stop can force termination ONLY of this newly-created isolated test process.
        docker('stop', '--time', '3', cid, timeout=20)
        row = owned(cid, nonce, name)
        state = row.get('State', {})
        result = {'case': kind, 'init': init, 'explicitHandler': mode == 'handler',
                  'nodePidInsideTest': ready['pid'], 'nodeVersion': ready['node'],
                  'stopped': not state.get('Running'), 'exitCode': state.get('ExitCode'),
                  'oomKilled': state.get('OOMKilled'), 'elapsedSeconds': round(time.monotonic()-started, 2)}
    except Exception as error:
        primary_error = error
    finally:
        try:
            row = owned(cid, nonce, name)
            # Never target any pre-existing container. Guard is rechecked before each lifecycle operation.
            if row.get('State', {}).get('Running'):
                docker('rm', '-f', cid)
            else:
                docker('rm', cid)
        except Exception:
            raise Blocked('LIMPEZA_DO_TESTE_NAO_CONFIRMADA_APP_NAO_ALTERADO') from None
    if primary_error:
        raise primary_error
    return result

def main():
    need(os.geteuid() == 0 and socket.gethostname().split('.')[0] == HOST, 'EXECUTE_NA_VPS_PRINCIPAL_srv1901029')
    with open('/proc/meminfo') as memory:
        available = re.search(r'^MemAvailable:\s+(\d+) kB$', memory.read(), re.M)
    need(available and int(available[1]) >= 512*1024, 'MEMORIA_DISPONIVEL_INSUFICIENTE_PARA_TESTE')
    before = inspect(APP)
    need(before.get('Image') == IMAGE and healthy(before), 'APP_ORIGINAL_NAO_CONFIRMADO_SAUDAVEL')
    image = json.loads(docker('image', 'inspect', IMAGE))[0]
    need(not image.get('Config', {}).get('Volumes'), 'IMAGEM_DECLARA_VOLUMES_REQUER_REVISAO')
    nonce = secrets.token_hex(8)
    report = {'productionStopRequested': False, 'productionDataMounted': False, 'productionCredentialsPassed': False,
              'applicationLoadedInTests': False, 'deployed': False, 'cases': []}
    try:
        for case in CASES:
            need(all(production_checks(before, inspect(APP)).values()), 'APP_MUDOU_ANTES_DO_TESTE')
            print('Teste descartavel: '+case[0]+'; aplicativo original permanece ligado.', flush=True)
            result = one_case(*case, nonce)
            report['cases'].append(result)
            print(json.dumps(result), flush=True)
        report['status'] = 'ISOLATED_SIGNAL_PROBE_COMPLETED_NOT_DEPLOYED'
    except Exception as error:
        report['status'] = 'ISOLATED_SIGNAL_PROBE_INCOMPLETE'
        report['error'] = str(error) if isinstance(error, Blocked) else 'ERRO_DE_TESTE_DADOS_PRIVADOS_OMITIDOS'
    report['appAfter'] = production_checks(before, inspect(APP))
    if not all(report['appAfter'].values()):
        report['status'] = 'APP_REQUIRES_REVIEW'
    print('=== RELATORIO LIA: TESTES DE ENCERRAMENTO ISOLADOS ===')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'ISOLATED_SIGNAL_PROBE_COMPLETED_NOT_DEPLOYED' else 2

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('PARADO: '+(str(error) if isinstance(error, Blocked) else 'CONSULTA_INCOMPLETA_SEM_DETALHES_PRIVADOS'), file=sys.stderr)
        sys.exit(1)
