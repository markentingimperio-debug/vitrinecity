#!/usr/bin/env python3
"""Retest the existing VPS candidate after a confirmed legacy-text assertion failure.
Never deploy, restart, touch Git/.env, mount production data, or alter old reports.
Requires the pinned prepare-chat-update-v2.py beside this file.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import tempfile

STAGED = Path('/var/backups/vitrinecity-lia-stage-1ikp036m')
HELPER_BLOB = '0de57860ccf14f950873312f8d8decbbb09ae547'
FAILURE = 'local-first admin uses local before paid text and only offers paid quote after explicit local escalation'
OLD = '/modelo local não concluiu/i'
NEW = '/modelo local n[ãa]o concluiu/i'
LEGACY_TEXT = 'O modelo local nao concluiu o pedido. Abaixo foi preparado um novo orcamento para a API de texto ja configurada. Confira e confirme o valor antes de continuar; nenhuma API paga foi chamada.'
CANDIDATE = {
 'app/server.js': 'b1442820e73432fb35fcaca56e79d3935afeea29b45b22f11d2943d86a788f7d',
 'app/vitriny-neural/chat-engine.js': '21ea860eb44f4bba2f6aa9399758407fb93e581c42c40d5b378d5a5ca79b4cb9',
 'app/vitriny-neural/chat-api.js': 'c5dd647278e763db66f16529abf4235ae5d9ad9d68301bd0fdba3f65c05bc237',
 'app/vitriny-neural/lia-chat-operations.js': 'f74d1190347d9cbffbf86870658dda08ff8da83afe368ef6c03bb6132154b07f',
 'app/public/neural-workspace.js': '79b1e820bd5646a58f6d7d3a6c12b954305915407db618f5485aebdb6d52cc9f',
 'app/public/neural-workspace.html': '84c39cf71a8d1a5c323588b1659dc4ba68cc2072fcfa4854bc02d2f0cc0b1251',
 'app/public/neural-workspace.css': 'bbc9bc34cd3e2e062d627ba07f2ebeb77a2e15a953de46421337e1bedc4749d7',
}
TEST_BLOBS = {
 'app/scripts/test-vitriny-neural-chat.mjs': 'de485e84020113465d33f6babafe169a19b5485e',
 'app/scripts/test-vitriny-neural-chat-api.mjs': '7b1b59c5d1789f2542d81bcde83af189753e3297',
 'app/scripts/test-vitriny-neural-lia-chat-operations.mjs': '64269baaa1d7001aa4b541d38bd8e4e65d42c7a4',
 'app/scripts/test-lia-preserve-kling.mjs': 'd5e741b2e49ec2becbf245eda554a56b172754ca',
}

class Refused(RuntimeError):
    """Only fixed, non-sensitive diagnostic messages."""

def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_private(path, limit=8*1024*1024):
    # Root-controlled paths only; do not follow symlinks in any component.
    if not path.is_absolute():
        raise Refused('Caminho nao absoluto.')
    for directory in reversed(path.parents):
        s = directory.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise Refused('Diretorio de preparacao nao protegido.')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077 or s.st_size > limit:
            raise Refused('Arquivo de preparacao nao protegido ou maior que o limite.')
        return f.read(limit + 1)

def summary(text):
    names = re.findall(r'^\s*not ok \d+ - ([^\r\n]+)', text, re.M)
    counts = {}
    for key in ('tests','pass','fail','cancelled','skipped','todo'):
        found = re.findall(r'^# ' + key + r' (\d+)\s*$', text, re.M)
        counts[key] = int(found[-1]) if found else None
    codes = sorted(set(re.findall(r'\b(?:ERR_[A-Z0-9_]{1,60}|EACCES|EPERM|ENOENT|EROFS|ENOMEM|ENOSPC)\b', text)))
    # Never print arbitrary assertion values, test names, log lines or tokens.
    return {'counts':counts, 'failedCases':[
        FAILURE if name == FAILURE else 'outro_teste_nao_exibido' for name in names[:12]
    ], 'failureCount':len(names), 'errorCodes':codes[:12],
        'legacyTextMismatch':names == [FAILURE] and counts['fail'] == 1 and
            codes == ['ERR_ASSERTION'] and OLD in text and LEGACY_TEXT in text and
            re.search(r'''^\s+operator:\s*['"]?match['"]?\s*$''', text, re.M) is not None}

def patch_test(data):
    if blob(data) != TEST_BLOBS['app/scripts/test-vitriny-neural-chat.mjs']:
        raise Refused('Teste diferente da revisao conhecida.')
    old, new = OLD.encode(), NEW.encode()
    if data.count(old) != 1 or new in data:
        raise Refused('Assercao revisada ausente, duplicada ou ja alterada.')
    changed = data.replace(old, new, 1)
    if changed.replace(new, old, 1) != data:
        raise Refused('Mudanca excede a assercao de acentuacao.')
    return changed

def load_helper():
    path = Path(__file__).resolve().with_name('prepare-chat-update-v2.py')
    data = path.read_bytes()
    if path.is_symlink() or len(data) > 65536 or blob(data) != HELPER_BLOB:
        raise Refused('Preparador auxiliar diferente da revisao conhecida.')
    spec = importlib.util.spec_from_file_location('lia_pinned_stage', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def approved_test_result(result, details):
    c = details['counts']
    return result == 'passed' and isinstance(c['tests'], int) and c['tests'] > 0 and c['pass'] == c['tests'] and all(c[k] == 0 for k in ('fail','cancelled','skipped','todo')) and details['failureCount'] == 0

def main():
    os.umask(0o077)
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'srv1901029':
        raise Refused('Execute como root somente na VPS principal srv1901029.')
    stage = load_helper()
    previous = json.loads(read_private(STAGED / 'report.json'))
    if (previous.get('source') != stage.SOURCE or previous.get('activeImage') != stage.IMAGE or
        previous.get('directory') != str(STAGED) or previous.get('deployed') is not False or
        previous.get('productionChanged') is not False or previous.get('conflicts') != [] or
        previous.get('dependencyDrift') != [] or previous.get('tests') != 'failed' or
        previous.get('candidateHashes') != CANDIDATE):
        raise Refused('O relatorio nao corresponde a candidata recebida.')
    old_log = read_private(STAGED / 'tests.private.log').decode('utf-8', 'replace')
    details = summary(old_log)
    print('=== DIAGNOSTICO SEGURO DOS TESTES ANTERIORES ===')
    print(json.dumps(details, ensure_ascii=False, indent=2), flush=True)
    counts = details['counts']
    if (not details['legacyTextMismatch'] or not isinstance(counts['tests'], int) or counts['tests'] < 1 or
        counts['pass'] != counts['tests'] - 1 or any(counts[k] != 0 for k in ('cancelled','skipped','todo'))):
        raise Refused('O log nao confirma somente a falha de acentuacao. Nenhum teste foi alterado ou repetido.')
    info, _, _ = stage.target_info()
    live = stage.runtime_files(info['Id'])
    for path, expected in stage.EXPECTED.items():
        if stage.digest(live.get(path)) != expected:
            raise Refused('O codigo ativo mudou; repeticao interrompida.')
    copies = tuple(CANDIDATE) + stage.GUARDS + tuple(TEST_BLOBS)
    data = {p:read_private(STAGED / 'candidate' / p) for p in copies}
    if any(digest(data[p]) != h for p,h in CANDIDATE.items()):
        raise Refused('Um arquivo da candidata mudou.')
    if any(blob(data[p]) != h for p,h in TEST_BLOBS.items()):
        raise Refused('Uma suite de testes mudou.')
    if any(data[p] != live[p] for p in stage.GUARDS):
        raise Refused('As dependencias da candidata divergem do aplicativo ativo.')
    work = Path(tempfile.mkdtemp(prefix='vitrinecity-lia-retest-', dir='/var/backups'))
    print('Copia de testes: ' + str(work), flush=True)
    for p in copies:
        stage.write(work / 'candidate' / p, patch_test(data[p]) if p == 'app/scripts/test-vitriny-neural-chat.mjs' else data[p])
    stage.TESTS = tuple(TEST_BLOBS)
    result = stage.isolated_tests(work, copies)
    new_details = summary(read_private(work / 'tests.private.log').decode('utf-8','replace'))
    current, _, _ = stage.target_info()
    unchanged = current['Id'] == info['Id'] and stage.runtime_files(current['Id']) == live
    hashes = {p:digest(read_private(work / 'candidate' / p)) for p in CANDIDATE}
    passed = approved_test_result(result, new_details) and unchanged and hashes == CANDIDATE
    report = {'schema':4, 'productionChanged':False, 'deployed':False, 'publishApproved':False,
        'source':stage.SOURCE, 'activeImage':stage.IMAGE, 'previousDirectory':str(STAGED),
        'directory':str(work), 'tests':result, 'testSummary':new_details,
        'candidateHashes':hashes, 'candidateCodeUnchanged':hashes == CANDIDATE,
        'activeCodeUnchanged':unchanged, 'onlyTestChange':'assertion: ' + OLD + ' -> ' + NEW,
        'status':'STAGED_NOT_DEPLOYED' if passed else 'REVIEW_REQUIRED',
        'pending':['Reavaliar SonarQube','Validar gateway/workers e configurar token na VPS',
                   'Backup completo e plano de rollback antes de publicar']}
    stage.write(work / 'retest-report.json', json.dumps(report, ensure_ascii=False, indent=2).encode())
    print('=== RELATORIO LIA: RETESTE, NAO PUBLICACAO ===')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if passed else 2

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        message = str(error) if isinstance(error, Refused) else 'Diagnostico incompleto; detalhes privados omitidos. Nenhum deploy solicitado.'
        print('PARADO: ' + message, file=sys.stderr)
        sys.exit(1)
