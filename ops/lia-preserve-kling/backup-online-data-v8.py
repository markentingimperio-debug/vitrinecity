#!/usr/bin/env python3
"""Create-only online backup; NEVER stop, start, deploy or restore an application.

SQLite uses its backup API, not a copy of a live database/WAL. Other regular files
are copied and checked separately. This is NOT an atomic database+files snapshot,
not a VPS snapshot, and not a release approval. Prior backups remain untouched.
"""
from __future__ import annotations
import fcntl
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
from contextlib import closing

HOST = 'srv1901029'
CID = '98ad009a8cfab575d34c62c293e669d452edc4f2d529fd26e2042183a850e5f1'
IMAGE = 'sha256:70fba9043ed420c8d3eb0a3e2904aeccd2cb593db598c450e59345dd95f47628'
SOURCE = Path('/var/lib/docker/volumes/vitrinecity_vitrinecity_data/_data')
PRIOR = Path('/var/backups/vitrinecity-lia-recovery-wla1lnw9')
PARENT = Path('/var/backups')
LOCK = Path('/run/lock/vitrinecity-lia-recovery.lock')
CONFIGS = tuple(Path('/opt/vitrinecity') / name for name in (
    'docker-compose.yml', 'docker-compose.override.yml', 'docker-compose.lia-1d1958f.yml',
    'docker-compose.social-20260916.yml', 'docker-compose.social-profile-20260916.yml',
    'docker-compose.social-agent-20260916.yml', '.env', 'app/Dockerfile'))
DB_FILES = frozenset(('vitrinecity.db', 'vitrinecity.db-wal', 'vitrinecity.db-shm', 'vitrinecity.db-journal'))
CHUNK = 1024 * 1024
MAX_FILES = 200000
MAX_BYTES = 64 * 1024**3

class Refused(RuntimeError):
    """Only fixed codes, never source content, paths from users or credentials."""

def require(ok, code):
    if not ok:
        raise Refused(code)

def checked_directory(path):
    require(path.is_absolute(), 'absolute_path_required')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'directory_not_root_controlled')

def opened_beneath(root, relative):
    """Open a regular file without following any symlink below root."""
    parts = Path(relative).parts
    require(parts and not Path(relative).is_absolute() and all(p not in ('.', '..') for p in parts),
            'invalid_relative_path')
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        device = os.fstat(directory).st_dev
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
            require(os.fstat(directory).st_dev == device, 'nested_mount_refused')
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_dev != device:
            os.close(fd)
            raise Refused('source_not_regular')
        return os.fdopen(fd, 'rb')
    finally:
        os.close(directory)

def signature(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns]

def read_small(path, private=False):
    checked_directory(path.parent)
    with opened_beneath(path.parent, path.name) as file:
        before = os.fstat(file.fileno())
        require(before.st_uid == 0 and not before.st_mode & (0o077 if private else 0o022),
                'input_permissions_invalid')
        data = file.read(8 * CHUNK + 1)
        require(len(data) <= 8 * CHUNK and signature(before) == signature(os.fstat(file.fileno())),
                'input_changed_or_too_large')
        return data

def new_file(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb')

def write_json(path, value):
    with new_file(path) as file:
        file.write(json.dumps(value, ensure_ascii=True, indent=2).encode())
        file.flush()
        os.fsync(file.fileno())

def inspect_app():
    # The only Docker action anywhere in this script is this read-only inspect.
    try:
        result = subprocess.run(['docker', 'inspect', '--type=container', CID],
                                capture_output=True, timeout=20, check=False)
        require(result.returncode == 0 and len(result.stdout) <= 8 * CHUNK, 'inspect_failed')
        items = json.loads(result.stdout)
        require(isinstance(items, list) and len(items) == 1, 'inspect_invalid')
        return items[0]
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise Refused('inspect_unavailable') from None

def identity(old, current):
    def mounts(value):
        return sorted(json.dumps(m, sort_keys=True) for m in value.get('Mounts', []))
    state = current.get('State', {})
    return {
        'sameContainer': current.get('Id') == old.get('Id') == CID,
        'sameImage': current.get('Image') == old.get('Image') == IMAGE,
        'sameConfiguration': current.get('Config') == old.get('Config'),
        'sameHostConfiguration': current.get('HostConfig') == old.get('HostConfig'),
        'sameMountsIgnoringOrder': mounts(current) == mounts(old),
        'running': state.get('Running') is True,
        'healthy': state.get('Health', {}).get('Status') == 'healthy',
        'notPausedOrRestarting': not state.get('Paused') and not state.get('Restarting')}

def inventory(root, deadline):
    files, dirs, special = {}, {}, []
    total = 0
    device = root.stat().st_dev
    def fail(_error):
        raise Refused('inventory_failed')
    for directory, names, leaves, fd in os.fwalk(root, follow_symlinks=False, onerror=fail):
        require(time.monotonic() < deadline, 'inventory_deadline')
        relative_dir = Path(directory).relative_to(root)
        for name in names[:]:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            relative = (relative_dir / name).as_posix()
            if not stat.S_ISDIR(info.st_mode) or info.st_dev != device:
                special.append(relative)
                names.remove(name)
            else:
                dirs[relative] = signature(info)
        for name in leaves:
            relative = (relative_dir / name).as_posix()
            if relative in DB_FILES:
                continue
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode) or info.st_dev != device:
                special.append(relative)
            else:
                files[relative] = signature(info)
                total += info.st_size
        require(len(files) + len(dirs) + len(special) <= MAX_FILES and total <= MAX_BYTES,
                'inventory_limit')
    return {'files': files, 'directories': dirs, 'special': sorted(special), 'bytes': total}

def hash_stream(file, deadline):
    digest = hashlib.sha256()
    while True:
        require(time.monotonic() < deadline, 'hash_deadline')
        block = file.read(CHUNK)
        if not block:
            break
        digest.update(block)
    return digest.hexdigest()

def copy_one(root, relative, expected, target, deadline):
    """Copy one bounded, stable source; verify destination by reading it back."""
    with opened_beneath(root, relative) as source:
        before = signature(os.fstat(source.fileno()))
        require(before == expected, 'source_changed_before_copy')
        remaining, digest = before[5], hashlib.sha256()
        with new_file(target) as dest:
            while remaining:
                require(time.monotonic() < deadline, 'copy_deadline')
                block = source.read(min(CHUNK, remaining))
                require(bool(block), 'source_truncated')
                remaining -= len(block)
                digest.update(block)
                dest.write(block)
            require(not source.read(1) and signature(os.fstat(source.fileno())) == before,
                    'source_changed_during_copy')
            dest.flush()
            os.fsync(dest.fileno())
    with target.open('rb') as copied:
        require(hash_stream(copied, deadline) == digest.hexdigest(), 'copy_hash_mismatch')
    return {'sha256': digest.hexdigest(), 'bytes': before[5], 'sourceMetadata': before}

def online_database(source, target, timeout=120):
    """Short backup steps; source opened read-only; committed WAL is handled by SQLite."""
    with opened_beneath(source.parent, source.name) as file:
        before = os.fstat(file.fileno())
    require(before.st_size > 0, 'database_empty')
    require(shutil.disk_usage(target.parent).free >= 2 * before.st_size + 256 * CHUNK,
            'database_backup_space')
    with new_file(target):
        pass
    deadline = time.monotonic() + timeout
    def progress(_status, _remaining, _total):
        require(time.monotonic() < deadline, 'database_backup_deadline')
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=2)) as db:
        with closing(sqlite3.connect(target.as_uri() + '?mode=rw', uri=True, timeout=2)) as dest:
            db.backup(dest, pages=256, progress=progress, sleep=0.05)
    require(source.lstat().st_ino == before.st_ino and source.lstat().st_dev == before.st_dev,
            'database_replaced')
    with closing(sqlite3.connect(target.as_uri() + '?mode=ro', uri=True)) as check:
        check.set_progress_handler(lambda: int(time.monotonic() >= deadline), 10000)
        require(check.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'sqlite_integrity_failed')
    with target.open('rb') as file:
        digest = hash_stream(file, deadline)
        os.fsync(file.fileno())
    return {'integrityCheck': 'ok', 'bytes': target.stat().st_size, 'sha256': digest,
            'method': 'sqlite_online_backup', 'liveJournalFilesCopied': False}

def perform_data_backup(source, work, deadline):
    print('Inventariando arquivos; nenhum comando de parada sera executado.', flush=True)
    initial = inventory(source, deadline)
    require(shutil.disk_usage(work).free > initial['bytes'] * 2 + 2 * 1024**3, 'insufficient_free_space')
    data_dir = work / 'data'
    data_dir.mkdir(mode=0o700)
    print('Criando e verificando a copia online do SQLite.', flush=True)
    database = online_database(source / 'vitrinecity.db', data_dir / 'vitrinecity.db')
    copied, failures = {}, {}
    for relative in initial['directories']:
        (data_dir / relative).mkdir(parents=True, exist_ok=True, mode=0o700)
    print('Copiando arquivos e verificando SHA-256; o app permanece ligado.', flush=True)
    for relative, expected in sorted(initial['files'].items()):
        try:
            copied[relative] = copy_one(source, relative, expected, data_dir / relative, deadline)
        except (OSError, Refused) as error:
            failures[relative] = str(error) if isinstance(error, Refused) else 'file_unavailable'
        require(time.monotonic() < deadline, 'backup_deadline')
    final = inventory(source, deadline)
    unchanged = initial == final
    write_json(work / 'manifest.private.json', {'initialInventory': initial, 'finalInventory': final,
                'copiedFiles': copied, 'failedFiles': failures, 'database': database,
                'metadataNote': 'Original POSIX metadata recorded only; ACL/xattr and sparse layout not preserved.'})
    return {'database': database, 'regularFilesExpected': len(initial['files']),
            'regularFilesVerified': len(copied), 'fileFailures': len(failures),
            'specialEntriesNotCopied': len(initial['special']), 'sourceFilesStableAcrossChecks': unchanged,
            'allRegularFilesVerified': not failures and len(copied) == len(initial['files']),
            'metadataRestorationAutomatic': False, 'aclXattrPreserved': False}

def main():
    os.umask(0o077)
    require(sys.argv[1:] == ['--backup-online'], 'explicit_online_mode_required')
    require(os.geteuid() == 0 and socket.gethostname().split('.')[0] == HOST, 'wrong_host_or_user')
    checked_directory(PARENT)
    checked_directory(SOURCE)
    os.nice(10)
    lock = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'lock_invalid')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('another_backup_running') from None
        old = json.loads(read_small(PRIOR / 'container-inspect.private.json', private=True))
        current = inspect_app()
        checks = identity(old, current)
        require(all(checks.values()), 'app_identity_or_health_mismatch')
        mounts = [m for m in current.get('Mounts', []) if m.get('Destination') == '/data']
        require(len(mounts) == 1 and mounts[0].get('Source') == str(SOURCE) and
                mounts[0].get('Name') == 'vitrinecity_vitrinecity_data', 'unexpected_data_mount')
        work = Path(tempfile.mkdtemp(prefix='vitrinecity-lia-online-', dir=PARENT))
        print('Backup privado novo: ' + str(work), flush=True)
        result = {'schema': 8, 'directory': str(work), 'serviceLifecycleCommands': False,
                  'deployed': False, 'publishApproved': False, 'fullVpsSnapshot': False,
                  'offHostBackup': False, 'jointPointInTimeSnapshot': False,
                  'databaseFilesConsistencyVerified': False, 'appBefore': checks,
                  'excludedMounts': ['/live-studio', '/var/lib/vitrinecity-kling', '/private-courses'],
                  'imageArchiveIncluded': False, 'previousImageDirectory': str(PRIOR)}
        try:
            saved = {}
            write_json(work / 'container-inspect.private.json', current)
            for index, path in enumerate(CONFIGS):
                raw = read_small(path)
                name = 'settings/config-' + str(index) + '.private'
                with new_file(work / name) as file:
                    file.write(raw)
                    file.flush()
                    os.fsync(file.fileno())
                saved[str(path)] = {'file': name, 'sha256': hashlib.sha256(raw).hexdigest()}
            write_json(work / 'settings-map.private.json', saved)
            result['data'] = perform_data_backup(SOURCE, work, time.monotonic() + 1200)
            result['settingsUnchanged'] = all(hashlib.sha256(read_small(Path(path))).hexdigest() == record['sha256']
                                               for path, record in saved.items())
            details = result['data']
            valid = details['allRegularFilesVerified'] and details['sourceFilesStableAcrossChecks'] and not details['specialEntriesNotCopied'] and result['settingsUnchanged']
            result['status'] = 'ONLINE_BACKUP_COMPONENTS_VERIFIED' if valid else 'ONLINE_BACKUP_REVIEW_REQUIRED'
        except (Exception, KeyboardInterrupt) as error:
            result['status'] = 'ONLINE_BACKUP_INCOMPLETE'
            result['errorCode'] = str(error) if isinstance(error, Refused) else 'backup_interrupted_or_io_error'
        try:
            after = inspect_app()
            result['appAfter'] = identity(current, after)
            result['sameStartTime'] = after.get('State', {}).get('StartedAt') == current.get('State', {}).get('StartedAt')
            if not all(result['appAfter'].values()) or not result['sameStartTime']:
                result['status'] = 'APP_CHANGED_REVIEW_REQUIRED'
        except Exception:
            result['appAfter'] = {'verified': False}
            result['status'] = 'APP_STATE_UNCONFIRMED'
        write_json(work / 'online-backup-report.json', result)
        print('=== RELATORIO LIA: BACKUP ONLINE, SEM PARADA ===')
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 0 if result['status'] == 'ONLINE_BACKUP_COMPONENTS_VERIFIED' else 2
    finally:
        os.close(lock)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt) as error:
        print('PARADO: ' + (str(error) if isinstance(error, Refused) else 'online_backup_unavailable') +
              '. Nenhum comando de parada ou deploy foi executado.', file=sys.stderr)
        sys.exit(1)
