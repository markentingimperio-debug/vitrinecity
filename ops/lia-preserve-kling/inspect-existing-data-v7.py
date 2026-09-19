#!/usr/bin/env python3
"""Inspect an existing recovery archive after manual app recovery. NEVER deploy.

Only Docker inspect is permitted. No service lifecycle command, live-volume access,
network access, restore, or change to previous backups. SQLite writes, if needed
for journal recovery, are confined to a disposable private directory.
This validates readability, NOT completeness, authenticity, or deploy approval.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

ROOT = Path('/var/backups/vitrinecity-lia-recovery-wla1lnw9')
CID = '98ad009a8cfab575d34c62c293e669d452edc4f2d529fd26e2042183a850e5f1'
IMAGE = 'sha256:70fba9043ed420c8d3eb0a3e2904aeccd2cb593db598c450e59345dd95f47628'
DB_NAMES = frozenset(('vitrinecity.db', 'vitrinecity.db-wal',
                      'vitrinecity.db-shm', 'vitrinecity.db-journal'))
LIMIT = 16 * 1024**3
DB_LIMIT = 1024**3

class Refused(RuntimeError):
    """Only fixed diagnostic codes, never private exception text."""

def require(ok, code):
    if not ok:
        raise Refused(code)

def protected_directory(path):
    require(path.is_absolute(), 'invalid_directory')
    for p in [*reversed(path.parents), path]:
        info = p.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'directory_not_protected')

def private_open(path, limit):
    protected_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
                not info.st_mode & 0o077 and info.st_nlink == 1 and
                0 < info.st_size <= limit, 'invalid_private_file')
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise

def read_json(path):
    with private_open(path, 8 * 1024**2) as f:
        return json.load(f)

def canonical_mounts(value):
    require(isinstance(value, list) and len(value) == 4 and
            all(isinstance(m, dict) and isinstance(m.get('Destination'), str) for m in value),
            'invalid_mount_list')
    require(len({m['Destination'] for m in value}) == len(value), 'duplicate_mount_destination')
    return sorted(json.dumps(m, sort_keys=True, separators=(',', ':')) for m in value)

def identity_checks(old, current):
    return {
        'sameContainer': old.get('Id') == current.get('Id') == CID and
                         old.get('Name') == current.get('Name') == '/vitrinecity-app-1',
        'sameImage': old.get('Image') == current.get('Image') == IMAGE,
        'sameConfiguration': old.get('Config') == current.get('Config') and isinstance(old.get('Config'), dict),
        'sameMountsIgnoringOrder': canonical_mounts(old.get('Mounts')) == canonical_mounts(current.get('Mounts')),
        'running': current.get('State', {}).get('Running') is True,
        'healthy': current.get('State', {}).get('Health', {}).get('Status') == 'healthy',
        'notPausedOrRestarting': not current.get('State', {}).get('Paused') and
                                 not current.get('State', {}).get('Restarting'),
    }

def inspect_original():
    # Fixed read-only command. Do not add any start/stop/restart/exec operation.
    p = subprocess.run(['docker', 'inspect', '--type=container', CID],
                       capture_output=True, timeout=20, check=False)
    require(p.returncode == 0 and len(p.stdout) <= 8 * 1024**2, 'inspect_failed')
    data = json.loads(p.stdout)
    require(isinstance(data, list) and len(data) == 1, 'inspect_shape_invalid')
    return data[0]

def normalized(name):
    require(isinstance(name, str) and not PurePosixPath(name).is_absolute() and
            '..' not in PurePosixPath(name).parts and '\x00' not in name,
            'unsafe_archive_path')
    return str(PurePosixPath(name))

def stamp(file):
    s = os.fstat(file.fileno())
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def check_database(path):
    deadline = time.monotonic() + 90
    # This path is ALWAYS the extracted temporary copy, never a live mount.
    db = sqlite3.connect(str(path), timeout=3)
    try:
        db.execute('PRAGMA trusted_schema=OFF')
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        valid = db.execute('PRAGMA integrity_check(1)').fetchall() == [('ok',)]
        require(valid, 'sqlite_copy_integrity_failed')
    finally:
        db.close()
    return 'ok'

def verify_data(file, temporary_parent):
    before = stamp(file)
    require(1024 <= before[2] <= LIMIT and before[2] % 512 == 0, 'invalid_tar_size')
    deadline = time.monotonic() + 180
    names, database, count = set(), {}, 0
    file.seek(0)
    with tarfile.open(fileobj=file, mode='r:') as archive:
        for member in archive:
            require(time.monotonic() < deadline, 'archive_scan_timeout')
            count += 1
            require(count <= 200000, 'archive_entry_limit')
            name = normalized(member.name)
            require(name not in names, 'duplicate_archive_entry')
            names.add(name)
            require(archive.offset <= before[2], 'truncated_archive')
            if name in DB_NAMES:
                require(member.isfile() and not member.issparse() and 0 <= member.size <= DB_LIMIT,
                        'invalid_database_entry')
                database[name] = member
        # Python accepts some tar files without end markers. Require the markers
        # and zero padding explicitly, but do not mistake that for completeness.
        file.seek(archive.offset)
        require(file.read(1024) == bytes(1024), 'missing_tar_end_markers')
        while True:
            chunk = file.read(1024**2)
            if not chunk:
                break
            require(not any(chunk), 'unexpected_data_after_tar_end')
        require('vitrinecity.db' in database and database['vitrinecity.db'].size >= 512,
                'database_missing_or_empty')
        total = sum(m.size for m in database.values())
        require(shutil.disk_usage(temporary_parent).free >= 2 * total + 256 * 1024**2,
                'temporary_space_insufficient')
        with tempfile.TemporaryDirectory(prefix='lia-sqlite-check-', dir=temporary_parent) as directory:
            os.chmod(directory, 0o700)
            for name, member in database.items():
                # Never extractall(), follow a link, or use arbitrary archive paths.
                target = Path(directory) / name
                stream = archive.extractfile(member)
                require(stream is not None, 'database_entry_unreadable')
                with stream, target.open('xb') as output:
                    target.chmod(0o600)
                    remaining = member.size
                    while remaining:
                        chunk = stream.read(min(1024**2, remaining))
                        require(bool(chunk), 'database_entry_truncated')
                        output.write(chunk)
                        remaining -= len(chunk)
            valid = check_database(Path(directory) / 'vitrinecity.db')
    file.seek(0)
    digest = hashlib.sha256()
    while True:
        chunk = file.read(1024**2)
        if not chunk:
            break
        require(time.monotonic() < deadline, 'archive_hash_timeout')
        digest.update(chunk)
    require(stamp(file) == before, 'archive_changed_during_check')
    return {'bytes': before[2], 'sha256': digest.hexdigest(), 'entries': count,
            'tarStructureReadable': True, 'sqliteIntegrityCheck': valid,
            'databaseCheckedInTemporaryCopy': True, 'sourceCompletenessVerified': False,
            'archiveAuthenticityVerified': False}

def main():
    os.umask(0o077)
    os.nice(10)
    require(not sys.argv[1:], 'no_arguments_allowed')
    require(os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv1901029', 'wrong_host_or_user')
    result = {'schema': 7, 'directory': str(ROOT), 'productionChanged': False,
              'serviceLifecycleCommands': False, 'backupApproved': False,
              'publishApproved': False, 'deployed': False,
              'imageArchiveRevalidated': False, 'fullVpsSnapshot': False}
    old = read_json(ROOT / 'container-inspect.private.json')
    prior = read_json(ROOT / 'backup-report.json')
    require(prior.get('directory') == str(ROOT) and prior.get('activeImage') == IMAGE and
            prior.get('status') == 'BACKUP_FAILED_NOT_DEPLOYED' and
            prior.get('maintenanceStopRequested') is True and prior.get('deployed') is False,
            'unexpected_prior_report')
    result['appBefore'] = identity_checks(old, inspect_original())
    require(all(result['appBefore'].values()), 'app_identity_or_health_mismatch')
    print('Verificando somente data.tar existente; aplicativo permanece em execucao.', flush=True)
    try:
        with private_open(ROOT / 'data.tar', LIMIT) as file:
            result['dataArchive'] = verify_data(file, '/var/backups')
        result['status'] = 'DATA_ARCHIVE_READABLE_REVIEW_REQUIRED'
    except FileNotFoundError:
        result['status'] = 'DATA_ARCHIVE_MISSING'
    except Exception as error:
        result['status'] = 'DATA_ARCHIVE_REVIEW_REQUIRED'
        result['errorCode'] = str(error) if isinstance(error, Refused) else 'archive_check_incomplete'
    result['appAfter'] = identity_checks(old, inspect_original())
    if not all(result['appAfter'].values()):
        result['status'] = 'APP_REQUIRES_REVIEW'
    print('=== RELATORIO LIA: VERIFICACAO SEM PARADA ===')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['status'] == 'DATA_ARCHIVE_READABLE_REVIEW_REQUIRED' else 2

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        code = str(error) if isinstance(error, Refused) else 'inspection_incomplete'
        print('PARADO: ' + code + '. Nenhum start, stop, restore ou deploy executado.', file=sys.stderr)
        sys.exit(1)
