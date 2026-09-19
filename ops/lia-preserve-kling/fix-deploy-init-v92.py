#!/usr/bin/env python3
"""Build a pinned deployment repair; running this builder NEVER touches Docker.

The generated installer adds init to the NEW app. Migrating the inventoried
legacy PID-1 Node requires explicit consent for Docker's SIGKILL fallback.
A database writer fence, before/after snapshots, and the original quality,
identity, billing, backup and rollback gates remain mandatory.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import stat
import sys

SOURCE_SHA256 = '0192cb4a2cb4535d48a0ffc79e16013ebbf357edc4dd582313040d749e7c712e'
RESULT_SHA256 = '27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44'
LEGACY_STOP = r'''
# One-time escape from the inventoried PID-1 runtime, NOT a blanket 137 bypass.
LEGACY_CONTAINER = '98ad009a8cfab575d34c62c293e669d452edc4f2d529fd26e2042183a850e5f1'
PENDING_FOR_STOP = (
    ('neural_chat_requests', "status IN ('awaiting_confirmation','queued','running','interrupted')"),
    ('neural_paid_chat_requests', "state NOT IN ('quoted','settled','released')"),
    ('lia_chat_operations', "status NOT IN ('completed','failed','cancelled','released')"),
    ('neural_durable_jobs', "status IN ('queued','leased','dispatched','unknown')"),
)

def pending_locked(db):
    total = 0
    for table, condition in PENDING_FOR_STOP:
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            total += db.execute('SELECT COUNT(*) FROM '+table+' WHERE '+condition).fetchone()[0]
    return total

def legacy_runtime(info):
    return (info.get('Id') == LEGACY_CONTAINER and info.get('Image') == ORIGINAL_IMAGE and
            info.get('Name') == '/' + PROJECT + '-app-1' and
            info.get('HostConfig', {}).get('Init') in (None, False))

def assert_stop_identity(before, after):
    need(after.get('Id') == before.get('Id') and after.get('Image') == before.get('Image') and
         mounts(after) == mounts(before) and after.get('Config') == before.get('Config') and
         after.get('HostConfig') == before.get('HostConfig'), 'IDENTIDADE_MUDOU_DURANTE_PARADA')

def evaluate_stop(before, after, permit_legacy):
    assert_stop_identity(before, after)
    s = after.get('State', {})
    need(s.get('Status') == 'exited' and s.get('Running') is False and
         not s.get('Paused') and not s.get('Restarting') and s.get('OOMKilled') is False,
         'PARADA_NAO_CONFIRMADA_OU_FALTA_DE_MEMORIA')
    code = s.get('ExitCode')
    need(type(code) is int, 'CODIGO_DE_SAIDA_INVALIDO')
    forced = code == 137
    if forced:
        need(permit_legacy is True and legacy_runtime(before), 'PARADA_FORCADA_NAO_AUTORIZADA')
    else:
        need(code in (0, 143), 'CODIGO_DE_SAIDA_NAO_REVISADO')
    return {'exitCode': code, 'legacyForcedStopUsed': forced, 'oomKilled': False,
            'gracefulExit': not forced, 'databaseWriterFenceHeldDuringStop': True}

def stop_for_rollout(info, work, permit_legacy=False):
    legacy = legacy_runtime(info)
    need(not legacy or permit_legacy is True, 'MIGRACAO_LEGADA_EXIGE_aceitar_parada_forcada_inicial')
    need(not permit_legacy or legacy, 'EXCECAO_DE_PARADA_RESTRITA_AO_CONTAINER_LEGADO')
    # Obtain a fresh consistent backup BEFORE any lifecycle operation. Never restore it.
    backup = sqlite_snapshot(work/'pre-stop-database.sqlite')
    fresh = inspect(info['Id'])
    assert_stop_identity(info, fresh)
    need(healthy(fresh) and consumers() == [info['Id']], 'ESTADO_MUDOU_ANTES_DA_PARADA')
    dbpath = DATA/'vitrinecity.db'
    controlled(DATA)
    before = dbpath.lstat()
    need(stat.S_ISREG(before.st_mode), 'BANCO_NAO_REGULAR')
    # BEGIN IMMEDIATE prevents new database writers until stop completes. No rows are changed.
    # SQLite/billing checks do not prove that unrelated external HTTP side effects are idle.
    with closing(sqlite3.connect(dbpath.as_uri()+'?mode=rw', uri=True, timeout=3)) as fence:
        try:
            fence.execute('BEGIN IMMEDIATE')
            need(pending_locked(fence) == 0, 'HA_OPERACOES_PENDENTES_NENHUMA_PARADA')
            current = inspect(info['Id'])
            assert_stop_identity(info, current)
            need(healthy(current) and current['State'].get('StartedAt') == fresh['State'].get('StartedAt'),
                 'APP_MUDOU_ANTES_DA_PARADA')
            need(consumers() == [info['Id']], 'OUTRO_CONSUMIDOR_ANTES_DA_PARADA')
            if legacy:
                print('MIGRACAO INICIAL AUTORIZADA: o Docker pode encerrar o Node antigo com SIGKILL. '
                      'Novas gravacoes ficam bloqueadas durante esta parada.', flush=True)
            started = time.monotonic()
            command(['docker','stop','--time','60',info['Id']], timeout=90, log=work/'stop.private.log')
            stopped = inspect(info['Id'])
            evidence = evaluate_stop(info, stopped, permit_legacy)
            need(not consumers(), 'OUTRO_CONSUMIDOR_APOS_PARADA')
            need(pending_locked(fence) == 0, 'PENDENCIA_APOS_PARADA')
            current_file = dbpath.lstat()
            need((before.st_dev, before.st_ino) == (current_file.st_dev, current_file.st_ino),
                 'BANCO_SUBSTITUIDO_DURANTE_PARADA')
            evidence.update({'elapsedSeconds': round(time.monotonic()-started, 3), 'preStopBackup': backup})
            write_new(work/'stop-evidence.json', json.dumps(evidence, indent=2).encode())
            return evidence
        finally:
            if fence.in_transaction:
                fence.rollback()

'''

# Each replacement must match exactly once. The application payload pins are NOT changed.
REPLACEMENTS = (
    ("Modes: plano, implantar, ativar-workers, desativar-workers, voltar, status.\n",
     "Modes: plano, implantar, ativar-workers, desativar-workers, voltar, status.\n"
     "Legacy initial migration additionally requires --aceitar-parada-forcada-inicial.\n"),
    ("               'LIA deploy package tests')", "               'LIA deploy package tests', 'LIA init migration tests')"),
    ("    new['services']['app']['image']=new_ref\n",
     "    new['services']['app']['image']=new_ref\n    new['services']['app']['init']=True\n"),
    ("        need(checked.get('volumes')==original.get('volumes') and checked.get('networks')==original.get('networks'),'REDE_OU_VOLUMES_DIVERGENTES')\n",
     "        need(checked.get('volumes')==original.get('volumes') and checked.get('networks')==original.get('networks'),'REDE_OU_VOLUMES_DIVERGENTES')\n"
     "        if filename=='after.private.json':\n            need(checked['services']['app'].get('init') is True,'INIT_NAO_CONFIGURADO')\n"),
    ("    cmd=['docker','run','--rm','--name',name,'--pull','never','--network','none','--read-only',\n",
     "    cmd=['docker','run','--init','--rm','--name',name,'--pull','never','--network','none','--read-only',\n"),
    ("dest.execute('PRAGMA quick_check').fetchall()==[('ok',)]", "dest.execute('PRAGMA integrity_check').fetchall()==[('ok',)]"),
    ("def interrupted(_signum,_frame):\n", LEGACY_STOP+"def interrupted(_signum,_frame):\n"),
    ("    parser.add_argument('--ativar-workers',action='store_true')\n",
     "    parser.add_argument('--ativar-workers',action='store_true')\n"
     "    parser.add_argument('--aceitar-parada-forcada-inicial',action='store_true',\n"
     "        help='Autoriza SIGKILL de transicao SOMENTE para o container legado inventariado, com trava SQLite e backup.')\n"),
    ("    need(healthy(info),'APP_NAO_SAUDAVEL_ANTES_DA_TROCA')\n",
     "    need(healthy(info),'APP_NAO_SAUDAVEL_ANTES_DA_TROCA')\n"
     "    if legacy_runtime(info):\n        need(args.modo=='implantar' and args.aceitar_parada_forcada_inicial,\n"
     "             'MIGRACAO_LEGADA_EXIGE_aceitar_parada_forcada_inicial')\n"
     "    else:\n        need(not args.aceitar_parada_forcada_inicial,'EXCECAO_DE_PARADA_RESTRITA_AO_CONTAINER_LEGADO')\n"),
    ("                          'endToEndTaskVerified':False},indent=2));return 0\n",
     "                          'initEnabled':info.get('HostConfig',{}).get('Init') is True,\n"
     "                          'endToEndTaskVerified':False},indent=2));return 0\n"),
    ("        command(['docker','stop','--time','60',info['Id']],timeout=90,log=work/'stop.private.log')\n"
     "        stopped=inspect(info['Id'])\n"
     "        need(not stopped['State'].get('Running') and stopped['State'].get('ExitCode')!=137,'PARADA_NORMAL_NAO_CONFIRMADA')\n",
     "        state['stopEvidence']=stop_for_rollout(info,work,args.aceitar_parada_forcada_inicial)\n"
     "        atomic_json(work/'state.private.json',state)\n"),
    ("        active=wait_health(new_image,info,env)\n",
     "        active=wait_health(new_image,info,env)\n"
     "        need(active.get('HostConfig',{}).get('Init') is True,'INIT_ATIVO_NAO_CONFIRMADO')\n"),
    ("              'endToEndTaskVerified':False,'rollbackCommand':rollback_command,'directory':str(work)},indent=2))\n",
     "              'initEnabled':True,'legacyForcedStopUsed':state['stopEvidence']['legacyForcedStopUsed'],\n"
     "              'endToEndTaskVerified':False,'rollbackCommand':rollback_command,'directory':str(work)},indent=2))\n"),
)


def build(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('INSTALADOR_V91_DIFERENTE')
    text = source.decode('utf-8')
    for old, new in REPLACEMENTS:
        if text.count(old) != 1:
            raise ValueError('TRECHO_NAO_UNICO_NENHUM_INSTALADOR_GERADO')
        text = text.replace(old, new, 1)
    result = text.encode('utf-8')
    if hashlib.sha256(result).hexdigest() != RESULT_SHA256:
        raise ValueError('INSTALADOR_V92_NAO_CONFERE')
    compile(result, 'deploy-lia-v92.py', 'exec')
    return result


def main():
    if len(sys.argv) != 1:
        raise ValueError('GERADOR_NAO_ACEITA_ARGUMENTOS')
    here = Path(__file__).resolve().parent
    p = here/'deploy-lia-v9-fixed.py'
    if p.is_symlink() or not p.is_file() or p.stat().st_size > 65536:
        raise ValueError('FONTE_INVALIDA')
    data = build(p.read_bytes())
    target = here/'deploy-lia-v92.py'
    fd = os.open(target, os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())
    print('INSTALADOR_COM_INIT_GERADO: nenhum comando Docker executado.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else 'GERACAO_INTERROMPIDA_NADA_IMPLANTADO'
        print('PARADO: '+message, file=sys.stderr)
        sys.exit(1)
