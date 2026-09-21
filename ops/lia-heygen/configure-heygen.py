#!/usr/bin/env python3
"""Register HeyGen metadata and a private key. No uploads, generations or deploy.
Reads GET /v3/api_keys/self once. Root-only, create-only, no .env modifications.
"""
import datetime
import getpass
import hashlib
import json
import os
import re
import signal
import socket
import ssl
import sys
import urllib.error
import urllib.request
import uuid
import warnings

HOST = 'srv1901029'
FOLDER = '/etc/vitrinecity/lia-heygen'
NAME = 'connection.json'
URL = 'https://api.heygen.com/v3/api_keys/self'
REQUIRED = ('lipsync:write', 'assets:write', 'account:read')

class Refused(Exception):
    pass

class Deadline(BaseException):
    pass

def need(value, code):
    if not value:
        raise Refused(code)

def key_value(value):
    need(isinstance(value, str), 'CHAVE_INVALIDA')
    value = value.strip()
    need(re.fullmatch(r'[\x21-\x7e]{8,4096}', value) and
         not any(c in value for c in ('"', "'", '<', '>', '*')) and
         '...' not in value and not value.lower().startswith(('x-api-key:', 'xi-api-key:', 'bearer')),
         'COLE_SOMENTE_A_CHAVE_HEYGEN_COMPLETA')
    need(value != 'cgSgspJ2msm6clMCkdW9', 'FOI_COLADO_O_ID_DA_VOZ_NAO_A_CHAVE')
    return value

def private_directory(create=False):
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in FOLDER.strip('/').split('/'):
            need(part not in ('', '.', '..'), 'CAMINHO_INVALIDO')
            s = os.fstat(fd)
            need(s.st_uid == 0 and not s.st_mode & 0o022, 'DIRETORIO_INSEGURO')
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        s = os.fstat(fd)
        need(s.st_uid == 0 and not s.st_mode & 0o077, 'PASTA_HEYGEN_DEVE_SER_PRIVADA')
        return fd
    except BaseException:
        os.close(fd)
        raise

def exists():
    try:
        fd = private_directory()
    except FileNotFoundError:
        return False
    try:
        try:
            os.stat(NAME, dir_fd=fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False
    finally:
        os.close(fd)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Refused('REDIRECIONAMENTO_HEYGEN_RECUSADO')

def access_metadata(raw, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    need(isinstance(raw, dict) and not raw.get('error'), 'RESPOSTA_HEYGEN_INVALIDA')
    d = raw.get('data')
    need(isinstance(d, dict) and d.get('status') == 'active', 'CHAVE_HEYGEN_NAO_ATIVA')
    kid, scopes = d.get('key_id'), d.get('scopes')
    need(isinstance(kid, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', kid), 'IDENTIFICADOR_HEYGEN_INVALIDO')
    need(isinstance(scopes, list) and len(scopes) <= 200 and all(isinstance(s, str) for s in scopes), 'PERMISSOES_HEYGEN_NAO_CONFIRMADAS')
    grants = set(scopes)
    full = '*:*' in grants or d.get('scope_mode') == 'full'
    def allows(scope):
        resource, action = scope.split(':')
        return full or scope in grants or resource + ':*' in grants or (
            action == 'read' and (resource + ':write' in grants or '*:read' in grants))
    verified = {s: allows(s) for s in REQUIRED}
    need(all(verified.values()), 'PERMISSOES_INSUFICIENTES_LIPSYNC_WRITE_ASSETS_WRITE_ACCOUNT_READ')
    need('expires_at' in d, 'VALIDADE_HEYGEN_NAO_INFORMADA')
    expiry = d.get('expires_at')
    if expiry is not None:
        need(isinstance(expiry, str) and len(expiry) < 64, 'VALIDADE_HEYGEN_INVALIDA')
        try:
            dt = datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00'))
        except ValueError:
            raise Refused('VALIDADE_HEYGEN_INVALIDA') from None
        need(dt.tzinfo is not None and dt > now, 'CHAVE_HEYGEN_EXPIRADA')
    return {'accountBinding': hashlib.sha256(kid.encode()).hexdigest(), 'expiresAt': expiry,
            'requiredScopesVerified': verified, 'broadAccess': full}

def verify_key(key):
    key = key_value(key)
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=context))
    request = urllib.request.Request(URL, method='GET', headers={'x-api-key': key, 'Accept': 'application/json'})
    try:
        with opener.open(request, timeout=20) as response:
            need(response.status == 200 and response.geturl() == URL and response.headers.get_content_type() == 'application/json', 'RESPOSTA_HEYGEN_INVALIDA')
            raw = response.read(131073)
            need(len(raw) <= 131072, 'RESPOSTA_HEYGEN_MUITO_GRANDE')
            return access_metadata(json.loads(raw.decode('utf-8')))
    except urllib.error.HTTPError as error:
        http = error.code
        try:
            raw = json.loads(error.read(65537))
            code = raw.get('error', {}).get('code') if isinstance(raw, dict) and isinstance(raw.get('error'), dict) else None
        except Exception:
            code = None
        finally:
            error.close()
        recognized = {'unauthorized': 'CHAVE_HEYGEN_INVALIDA_OU_EXPIRADA',
                      'insufficient_api_key_scope': 'PERMISSOES_HEYGEN_INSUFICIENTES',
                      'rate_limit_exceeded': 'LIMITE_HEYGEN_AGUARDE'}
        raise Refused(recognized.get(code, 'CONSULTA_HEYGEN_HTTP_' + str(http))) from None

def save_new(key, metadata):
    cfg = {'schema': 1, 'provider': 'heygen', 'apiKey': key_value(key), 'allowedUserIds': [1],
           'mode': 'precision', 'accountBinding': metadata['accountBinding'],
           'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'expiresAt': metadata['expiresAt'], 'metadataAccessVerified': True,
           'requiredScopesVerified': metadata['requiredScopesVerified'],
           'generationPermissionVerified': False, 'realLipSyncVerified': False}
    payload = (json.dumps(cfg, ensure_ascii=False, indent=2) + '\n').encode()
    directory = private_directory(create=True)
    temporary = '.register-' + uuid.uuid4().hex
    created = False
    linked = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        created = True
        with os.fdopen(fd, 'wb') as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(temporary, NAME, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        except FileExistsError:
            raise Refused('CONFIGURACAO_HEYGEN_JA_EXISTE_NADA_SOBRESCRITO') from None
        linked = True
        os.fsync(directory)
    except Refused:
        raise
    except Exception:
        raise Refused('ARQUIVO_CRIADO_PERSISTENCIA_A_CONFERIR_NAO_APAGUE' if linked else 'GRAVACAO_HEYGEN_NAO_CONCLUIDA') from None
    finally:
        try:
            if created:
                os.unlink(temporary, dir_fd=directory)
                os.fsync(directory)
        finally:
            os.close(directory)

def deadline(*_args):
    raise Deadline()

def main():
    need(os.geteuid() == 0 and socket.gethostname().split('.')[0] == HOST, 'EXECUTE_COM_ROOT_NA_VPS_SRV1901029')
    os.umask(0o077)
    need(not exists(), 'CONFIGURACAO_HEYGEN_JA_EXISTE_NADA_SOBRESCRITO')
    print('Cadastro privado HeyGen para conta 1. Sem enviar midia, gerar video ou reiniciar o app.', flush=True)
    key = None
    try:
        with open('/dev/tty', 'r', encoding='utf-8') as ti, open('/dev/tty', 'w', encoding='utf-8', buffering=1) as to:
            need(ti.isatty() and to.isatty(), 'TERMINAL_INTERATIVO_OBRIGATORIO')
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                key = key_value(getpass.getpass('Cole SOMENTE a chave API do HEYGEN (entrada oculta): ', stream=to))
            print('Consultando autenticacao, validade e permissoes declaradas; sem gerar video.', flush=True)
            previous = signal.signal(signal.SIGALRM, deadline)
            signal.alarm(35)
            try:
                info = verify_key(key)
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, previous)
            to.write('Autenticacao e permissoes declaradas conferidas. Isso nao testa uma sincronizacao.\n')
            if info['broadAccess']:
                to.write('Aviso: esta chave tem acesso total. Prefira permissoes restritas para producao.\n')
            to.write('Digite SALVAR_HEYGEN para cadastrar, ou Enter para cancelar: ')
            need(ti.readline().strip() == 'SALVAR_HEYGEN', 'CANCELADO_SEM_CADASTRO')
            save_new(key, info)
        print('=== LIA: CADASTRO HEYGEN ===')
        print(json.dumps({'status': 'HEYGEN_CONFIG_SAVED_CHAT_NOT_ACTIVATED', 'configurationSaved': True,
            'configurationPath': FOLDER + '/' + NAME, 'authorizedUserIds': [1],
            'metadataAccessVerified': True, 'requiredScopesVerified': info['requiredScopesVerified'],
            'expiresAt': info['expiresAt'], 'generationPermissionVerified': False,
            'realLipSyncVerified': False, 'paidGenerationExecuted': False,
            'chatActivated': False, 'deployed': False, 'serviceRestarted': False,
            'elevenLabsConfigurationChanged': False}, ensure_ascii=False, indent=2))
    finally:
        key = None

if __name__ == '__main__':
    try:
        main()
    except Refused as error:
        print('PARADO: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Deadline:
        print('PARADO: CONSULTA_HEYGEN_EXCEDEU_O_PRAZO', file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        print('PARADO: CADASTRO_HEYGEN_NAO_CONCLUIDO; detalhes privados omitidos. Nenhum deploy solicitado.', file=sys.stderr)
        sys.exit(1)
