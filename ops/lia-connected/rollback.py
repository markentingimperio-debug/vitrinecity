#!/usr/bin/env python3
"""Restore only this installer patch. Refuse overwriting subsequent edits."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
here=Path(__file__).resolve().parent
try:
    m=json.loads((here/'manifest.json').read_text())
    root=Path(m['project'])
    for item in m['files']:
        dest=root/item['path']
        if not dest.is_file() or hashlib.sha256(dest.read_bytes()).hexdigest()!=item['newSha256']:
            raise RuntimeError('Arquivo modificado depois da instalacao; rollback automatico bloqueado: '+item['path'])
    for item in m['files']:
        dest=root/item['path']
        if item['existed']: shutil.copy2(here/'files'/item['path'],dest)
        else: dest.unlink()
    subprocess.run(['docker','image','tag',m['oldImage'],m['oldTag']],check=True)
    subprocess.run(['docker','compose','up','-d','--no-deps','--no-build','app'],cwd=root,check=True)
    print('App anterior restaurado. Banco e volumes nao foram revertidos. Confira docker compose ps.')
except Exception as exc:
    print('PARADO: '+str(exc),file=sys.stderr)
    sys.exit(1)
