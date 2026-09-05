#!/bin/sh
set -eu
cd /opt/vitrinecity
exec 9>/run/lock/vitrinecity-database-backup.lock
flock -n 9 || exit 0
docker compose exec -T app python3 - <<'PY'
import sqlite3, pathlib, datetime, os, re
source = pathlib.Path('/data/vitrinecity.db')
assert source.is_file(), 'Database unavailable'
folder = pathlib.Path('/data/recovery-backups')
folder.mkdir(mode=0o700, exist_ok=True)
os.chmod(folder, 0o700)
name = 'daily-vitrinecity-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S') + '.db'
target = folder / name
temporary = folder / (name + '.tmp')
assert not target.exists() and not temporary.exists(), 'Backup already exists'
os.umask(0o077)
src = sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True, timeout=30)
dst = sqlite3.connect(temporary)
try:
    src.backup(dst, pages=1000, sleep=0.1)
    assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Backup integrity failed'
finally:
    dst.close()
    src.close()
os.chmod(temporary, 0o600)
temporary.replace(target)
# Retention applies only to successful daily copies created by this script.
copies = sorted(p for p in folder.iterdir() if p.is_file() and not p.is_symlink() and re.fullmatch(r'daily-vitrinecity-[0-9]{8}-[0-9]{6}\.db', p.name))
for old in copies[:-14]:
    old.unlink()
print('DATABASE_BACKUP_OK', target.name)
PY

