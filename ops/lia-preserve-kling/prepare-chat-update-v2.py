#!/usr/bin/env python3
"""Stage a targeted LIA update. NEVER deploy, restart, change Git or change .env.

Host-specific to the inventory supplied on 2026-09-18. Backups and candidates
stay root-only on this VPS. A successful staging report is NOT deploy approval.
"""
from __future__ import annotations
import base64
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = '3f6febfe7c4ca66ef041bb49b6dfbd2d61ca703a'
SOURCE = '67b48e632ae6e0ca7776cb27a924fd6eb12a60c0'
IMAGE = 'sha256:70fba9043ed420c8d3eb0a3e2904aeccd2cb593db598c450e59345dd95f47628'
ROOT = Path('/opt/vitrinecity')
EXPECTED = {
 'app/server.js': '10c359c8d3d98b5a2b746b65b7a279ec0582d7d4147ac1b7801a247d0dbccfa7',
 'app/vitriny-neural/chat-engine.js': 'c60e7af4022f66b90f96a5ebff8812aa1a9f88ad88fcccdc728b5e9245799eb5',
 'app/vitriny-neural/chat-api.js': 'f93f838bad8f08b5cb8270a8257d96fe2037d96040072acf3cd64cf4d67940c9',
 'app/vitriny-neural/lia-chat-operations.js': None,
 'app/public/neural-workspace.js': '2505e0a7c2b8866632e59ec1df287460cc4b518ff71a7ce90f4a772047b03461',
 'app/public/neural-workspace.html': '4c0c4d678e7df08c9e8606b98f5ab0a3e95ea2f147a01967b78d49188a4f9f79',
 'app/public/neural-workspace.css': '1d2540d804f9bec2cad04f5c20e76c48bf3ad263a1f26cc4131fe95fae009e3d',
 'app/vitriny-neural/paid-chat-runtime.js': '4c7a22ec6bcbb9a546525c5e7368698c1938ad0b504f166279acacef6d8de59c',
 'app/vitriny-neural/coin-wallet-adapter.js': 'fcceaac79d348bcb285ee212a00e66bf1500c9c0d2b529c1885527de66db834b',
 'app/vitrine-coins-wallet.js': 'fb4457496829bdb1d2fa59462fd2fb9a8c35fdf0be86546ad5705d0b271d1180',
}
PAYLOAD = tuple(EXPECTED)[:7]
GUARDS = tuple(EXPECTED)[7:] + ('app/package.json', 'app/package-lock.json')
TESTS = tuple('app/scripts/' + name for name in (
 'test-vitriny-neural-chat.mjs', 'test-vitriny-neural-chat-api.mjs',
 'test-vitriny-neural-lia-chat-operations.mjs',
))
LIMIT = 8 * 1024 * 1024
ALLOWED = set(PAYLOAD + GUARDS + TESTS)

class Stop(RuntimeError):
    """Only non-sensitive, explicitly written messages may be displayed."""

def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None

def run(args, *, timeout=40):
    try:
        p = subprocess.run([str(x) for x in args], stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop('Comando indisponivel ou prazo excedido; detalhes privados omitidos.') from None
    if p.returncode:
        raise Stop('Comando de preparacao falhou; detalhes privados omitidos.')
    return p.stdout

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('xb') as f:
        f.write(data)
    path.chmod(0o600)

def regular(path, limit=LIMIT):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_size > limit:
        raise Stop('Arquivo ausente, nao regular ou maior que o limite.')
    return path.read_bytes()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Stop('Redirecionamento do download recusado.')

def source_file(rev, path, *, absent=False):
    if rev not in (BASE, SOURCE) or path not in ALLOWED:
        raise Stop('Origem ou caminho fora da lista fixa.')
    url = f'https://raw.githubusercontent.com/markentingimperio-debug/vitrinecity/{rev}/{path}'
    # No ambient proxy credentials and no redirect to another origin.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(url, timeout=30) as r:
            data = r.read(LIMIT + 1)
    except urllib.error.HTTPError as e:
        if absent and e.code == 404:
            return None
        raise Stop('Download da revisao fixada falhou; nenhuma publicacao realizada.') from None
    except (OSError, urllib.error.URLError):
        raise Stop('Falha de rede no download; nenhuma publicacao realizada.') from None
    if not data or len(data) > LIMIT or b'\0' in data:
        raise Stop('Arquivo de origem vazio, binario ou maior que o limite.')
    return data

def merge_bytes(active, base, target, work):
    """Three-way merge on copies. Never choose a side after a conflict."""
    if active == base or active == target:
        return target, True
    if base == target:
        return active, True
    if base is None or active is None:
        return b'', False
    with tempfile.TemporaryDirectory(dir=work) as temp:
        paths = [Path(temp) / n for n in ('active', 'base', 'target')]
        for p, data in zip(paths, (active, base, target)):
            write(p, data)
        p = subprocess.run(['git', 'merge-file', '-p', '-L', 'ATIVO', '-L', 'BASE',
                            '-L', 'CANDIDATA', *map(str, paths)],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        return p.stdout, p.returncode == 0

READ_RUNTIME = r'''
import fs from 'node:fs';
const out={};
for(const p of JSON.parse(process.argv[1])){
 const name='/'+p;
 try{
  const s=fs.lstatSync(name);
  if(!s.isFile()||s.isSymbolicLink()||s.size>8388608||!fs.realpathSync(name).startsWith('/app/'))throw Error('invalid');
  out[p]=fs.readFileSync(name).toString('base64');
 }catch(e){if(e.code==='ENOENT')out[p]=null;else throw Error('Private inspection failed');}
}
console.log(JSON.stringify(out));
'''

def runtime_files(cid):
    data = json.loads(run(['docker', 'exec', '-w', '/app', cid, 'node',
        '--input-type=module', '-e', READ_RUNTIME, json.dumps(list(EXPECTED) + list(GUARDS[-2:]))]))
    return {k: (None if v is None else base64.b64decode(v, validate=True)) for k, v in data.items()}

def target_info():
    ids = run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=vitrinecity',
        '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}}']).decode().splitlines()
    if len(ids) != 1:
        raise Stop('Nao foi identificado exatamente um app da Vitrine City.')
    info = json.loads(run(['docker', 'inspect', ids[0]]))[0]
    env = dict(x.split('=', 1) for x in info['Config'].get('Env', []) if '=' in x)
    labels = info['Config'].get('Labels') or {}
    if (not info['State'].get('Running') or info.get('Image') != IMAGE or
        labels.get('com.docker.compose.project.working_dir') != str(ROOT) or
        urllib.parse.urlsplit(env.get('SITE_URL', '')).hostname not in ('vitrinecity.com', 'www.vitrinecity.com') or
        env.get('DATA_DIR', '/data') != '/data'):
        raise Stop('O alvo mudou em relacao ao inventario; nenhuma alteracao no app.')
    mounts = [m for m in info.get('Mounts', []) if m.get('Destination') == '/data']
    if len(mounts) != 1 or mounts[0].get('Type') != 'volume' or mounts[0].get('Name') != 'vitrinecity_vitrinecity_data':
        raise Stop('Volume de dados diferente do inventario.')
    return info, env, mounts[0]

def backup_database(src, dst):
    if not stat.S_ISREG(src.lstat().st_mode):
        raise Stop('Banco de origem nao regular.')
    uri = src.absolute().as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True, timeout=3)) as db:
        size = db.execute('PRAGMA page_count').fetchone()[0] * db.execute('PRAGMA page_size').fetchone()[0]
        if shutil.disk_usage(dst.parent).free < size * 2 + 256 * 1024 * 1024:
            raise Stop('Espaco insuficiente para o backup com margem de seguranca.')
        deadline = time.monotonic() + 120
        def progress(status, remaining, total):
            if time.monotonic() > deadline:
                raise Stop('Backup excedeu o prazo; a copia nao foi aprovada.')
        if dst.exists():
            raise Stop('Backup de destino ja existe.')
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        dest = sqlite3.connect(dst)
        try:
            db.backup(dest, pages=256, progress=progress, sleep=0.05)
            valid = dest.execute('PRAGMA quick_check').fetchall() == [('ok',)]
        finally:
            dest.close()
    if not valid:
        raise Stop('Verificacao do backup SQLite falhou.')
    return {'quickCheck': 'ok', 'bytes': dst.stat().st_size}

def isolated_tests(work, copies):
    """Only a disposable test container; no live volume, credentials or network."""
    name = 'lia-stage-test-' + work.name.rsplit('-', 1)[-1]
    cmd = ['docker', 'run', '--name', name, '--rm', '--pull', 'never',
           '--network', 'none', '--read-only', '--no-healthcheck',
           '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
           '--pids-limit', '128', '--cpus', '0.5', '--memory', '512m',
           '--tmpfs', '/tmp:rw,nosuid,nodev,size=192m',
           '--tmpfs', '/data:rw,nosuid,nodev,size=32m', '--workdir', '/app']
    for p in copies:
        cmd += ['--mount', f'type=bind,source={work / "candidate" / p},target=/{p},readonly']
    cmd += ['--entrypoint', '/usr/bin/env', IMAGE, '-i',
            'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'HOME=/tmp', 'TMPDIR=/tmp', 'DATA_DIR=/tmp/lia-test-data',
            'node', '--test', *('/' + p for p in TESTS)]
    try:
        with (work / 'tests.private.log').open('xb') as log:
            p = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, timeout=240)
        return 'passed' if p.returncode == 0 else 'failed'
    except subprocess.TimeoutExpired:
        # The name is newly generated in our root-only staging directory, not an app name.
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30)
        return 'timeout'

def main():
    os.umask(0o077)
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'srv1901029':
        raise Stop('Execute somente como root na VPS principal srv1901029.')
    git = ['git', '-c', 'safe.directory=' + str(ROOT), '-C', str(ROOT)]
    if run(git + ['rev-parse', 'HEAD']).decode().strip() != BASE:
        raise Stop('O checkout mudou; nenhuma alteracao no app.')
    info, env, mount = target_info()
    active = runtime_files(info['Id'])
    for p, expected in EXPECTED.items():
        if p not in active or digest(active[p]) != expected:
            raise Stop('Arquivo ativo mudou desde o inventario: ' + p)
    parent = Path('/var/backups')
    if parent.is_symlink() or not parent.is_dir():
        raise Stop('Diretorio de backup invalido.')
    work = Path(tempfile.mkdtemp(prefix='vitrinecity-lia-stage-', dir=parent))
    print('Preparacao privada: ' + str(work), flush=True)
    report = {'schema': 2, 'productionChanged': False, 'deployed': False,
              'source': SOURCE, 'activeImage': IMAGE, 'directory': str(work),
              'backups': {}, 'conflicts': [], 'dependencyDrift': [], 'tests': 'not_run',
              'operationsTokenPresent': bool(env.get('LIA_OPERATIONS_TOKEN')),
              'publishApproved': False,
              'pending': ['Reavaliar alerta SonarQube', 'Configurar e validar gateway/workers',
                          'Backup completo e plano de rollback antes de publicar']}
    try:
        for p, data in active.items():
            if data is not None:
                write(work / 'active' / p, data)
        write(work / '.env.private', regular(ROOT / '.env'))
        write(work / 'Dockerfile.checkout', regular(ROOT / 'app/Dockerfile'))
        write(work / 'checkout.patch.private', run(git + ['diff', '--binary', 'HEAD', '--', 'app', 'ops']))
        labels = info['Config'].get('Labels') or {}
        compose_paths = labels.get('com.docker.compose.project.config_files', '').split(',')
        if not compose_paths or not compose_paths[0]:
            raise Stop('Arquivos Compose nao identificados.')
        saved = []
        for i, entry in enumerate(compose_paths):
            p = Path(entry) if Path(entry).is_absolute() else ROOT / entry
            write(work / f'compose-{i}.private', regular(p))
            saved.append(str(p))
        write(work / 'compose-paths.private.json', json.dumps(saved).encode())
        report['backups']['sqlite'] = backup_database(Path(mount['Source']) / 'vitrinecity.db', work / 'database.sqlite')
        report['backups']['scope'] = 'SQLite, .env, Compose, arquivos inventariados e diff local; nao e backup completo da VPS/anexos.'
        print('Backup SQLite validado. Preparando copias reconciliadas.', flush=True)
        for p in PAYLOAD:
            target = source_file(SOURCE, p)
            base = source_file(BASE, p, absent=(p == 'app/vitriny-neural/lia-chat-operations.js'))
            write(work / 'source' / p, target)
            if base is not None:
                write(work / 'base' / p, base)
            merged, clean = merge_bytes(active[p], base, target, work)
            write(work / ('candidate' if clean else 'conflicts') / p, merged)
            if not clean:
                report['conflicts'].append(p)
        for p in GUARDS:
            target = source_file(SOURCE, p)
            if active.get(p) != target:
                report['dependencyDrift'].append(p)
            if active.get(p) is not None:
                write(work / 'candidate' / p, active[p])
        for p in TESTS:
            write(work / 'candidate' / p, source_file(SOURCE, p))
        if not report['conflicts'] and not report['dependencyDrift']:
            engine = regular(work / 'candidate/app/vitriny-neural/chat-engine.js')
            if b'LIA_PRESERVE_KLING_V1' not in engine:
                raise Stop('Contrato local-first nao encontrado; teste interrompido.')
            print('Executando testes isolados, sem banco de producao ou chaves.', flush=True)
            report['tests'] = isolated_tests(work, PAYLOAD + GUARDS + TESTS)
        current, _, _ = target_info()
        if current['Id'] != info['Id'] or runtime_files(current['Id']) != active:
            raise Stop('O app mudou durante a preparacao. Pacote exige nova revisao.')
        report['candidateHashes'] = {p: digest(regular(work / 'candidate' / p))
            for p in PAYLOAD if p not in report['conflicts']}
        report['status'] = 'STAGED_NOT_DEPLOYED' if report['tests'] == 'passed' else 'REVIEW_REQUIRED'
    except Exception as e:
        report['status'] = 'STOPPED_NOT_DEPLOYED'
        report['error'] = str(e) if type(e) is Stop else 'Falha de preparacao; detalhes privados omitidos.'
    write(work / 'report.json', json.dumps(report, ensure_ascii=False, indent=2).encode())
    print('=== RELATORIO LIA: PREPARACAO, NAO PUBLICACAO ===')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['status'] == 'STAGED_NOT_DEPLOYED' else 2

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print('PARADO: ' + (str(e) if type(e) is Stop else 'Verificacao incompleta; detalhes privados omitidos.'), file=sys.stderr)
        sys.exit(1)
