#!/usr/bin/env python3
"""Build a standalone selector-fixed installer; never run it or change a service.

The input is the exact reviewed v9. Only app selection changes. The produced
installer retains its gate, backup, token, image and rollback checks unchanged.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import stat

SOURCE_SHA256 = '8f601991e8aab59ba12833e15106ec44bf4224ccfdfe9e6646911b16130232a4'
RESULT_SHA256 = '0192cb4a2cb4535d48a0ffc79e16013ebbf357edc4dd582313040d749e7c712e'
OLD_SELECTION = """def app_optional():
    ids = command(['docker', 'ps', '-a', '--no-trunc', '--filter', 'label=com.docker.compose.project='+PROJECT,
                   '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}}']).stdout.decode().splitlines()
    need(len(ids) <= 1, 'ESPERADO_UM_UNICO_APP')
    if not ids: return None
    need(re.fullmatch('[0-9a-f]{64}', ids[0]) is not None, 'ID_DE_CONTAINER_INVALIDO')
    return inspect(ids[0])
"""
NEW_SELECTION = """# Historical checks identified by the owner's read-only VPS inventory.
# They are NEVER stopped, removed, renamed, or selected as a rollback target.
RETIRED_APPS = {
    'bb7d2b8a5a5a08b0ed39f58b83d094cfbff315f4f91baa9a5e74e2a8c56d5a11': '/vitrinecity-search-final-check',
    '1ad25a972b7d591ff65cc35092b49a29c6f6e149198f8076284398857f3acaf3': '/vitrinecity-search-check',
}

def select_app(rows):
    selected = []
    seen = set()
    for row in rows:
        cid = row.get('Id', '')
        need(re.fullmatch('[0-9a-f]{64}', cid) is not None and cid not in seen, 'ID_DE_CONTAINER_INVALIDO')
        seen.add(cid)
        labels = row.get('Config', {}).get('Labels') or {}
        need(labels.get('com.docker.compose.project') == PROJECT and
             labels.get('com.docker.compose.service') == 'app', 'ETIQUETAS_DO_CONTAINER_DIVERGENTES')
        if row.get('Name') == '/' + PROJECT + '-app-1':
            need(str(labels.get('com.docker.compose.oneoff', '')).lower() == 'false', 'APP_CANONICO_AVULSO_OU_NAO_IDENTIFICADO')
            selected.append(row)
            continue
        state = row.get('State', {})
        need(cid in RETIRED_APPS and RETIRED_APPS[cid] == row.get('Name'), 'CONTAINER_EXTRA_NAO_REVISADO')
        need(state.get('Status') == 'exited' and state.get('Running') is False and
             state.get('Paused') is False and state.get('Restarting') is False,
             'CONTAINER_HISTORICO_NAO_ESTA_PARADO')
    need(len(selected) <= 1, 'ESPERADO_UM_UNICO_APP')
    return selected[0] if selected else None

def app_optional():
    ids = command(['docker', 'ps', '-a', '--no-trunc', '--filter', 'label=com.docker.compose.project='+PROJECT,
                   '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}}']).stdout.decode().splitlines()
    need(len(ids) <= 64 and len(set(ids)) == len(ids) and
         all(re.fullmatch('[0-9a-f]{64}', cid) is not None for cid in ids), 'LISTAGEM_DE_CONTAINERS_INVALIDA')
    return select_app([inspect(cid) for cid in ids])
"""


def build(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('INSTALADOR_ORIGINAL_DIFERENTE')
    text = source.decode('utf-8')
    if text.count(OLD_SELECTION) != 1 or NEW_SELECTION in text:
        raise ValueError('SELETOR_ORIGINAL_NAO_IDENTIFICADO')
    result = text.replace(OLD_SELECTION, NEW_SELECTION, 1).encode('utf-8')
    if hashlib.sha256(result).hexdigest() != RESULT_SHA256:
        raise ValueError('INSTALADOR_CORRIGIDO_NAO_CONFERE')
    if result.replace(NEW_SELECTION.encode(), OLD_SELECTION.encode(), 1) != source:
        raise ValueError('ALTERACAO_FORA_DO_SELETOR')
    compile(result, 'deploy-lia-v9-fixed.py', 'exec')
    return result


def read_file(path: Path) -> bytes:
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as file:
        info = os.fstat(file.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or
                info.st_mode & 0o022 or info.st_size > 65536):
            raise ValueError('ARQUIVO_NAO_PROTEGIDO')
        data = file.read(65537)
        if len(data) > 65536:
            raise ValueError('ARQUIVO_ACIMA_DO_LIMITE')
        return data


def main() -> None:
    parent = Path(__file__).resolve().parent
    info = parent.lstat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise ValueError('DIRETORIO_NAO_PROTEGIDO')
    target = parent / 'deploy-lia-v9-fixed.py'
    data = build(read_file(parent / 'deploy-lia-v9.py'))
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        if read_file(target) != data:
            raise ValueError('DESTINO_DIFERENTE_NADA_SOBRESCRITO') from None
    else:
        with os.fdopen(fd, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
    if hashlib.sha256(read_file(target)).hexdigest() != RESULT_SHA256:
        raise ValueError('GRAVACAO_NAO_CONFIRMADA')
    print('INSTALADOR_CORRIGIDO_GERADO: nenhuma implantacao executada.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        code = str(error) if isinstance(error, ValueError) else 'FALHA_DE_ARQUIVO'
        raise SystemExit('PARADO: ' + code) from None
