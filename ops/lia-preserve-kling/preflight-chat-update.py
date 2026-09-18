#!/usr/bin/env python3
"""Read-only inventory for a targeted Vitrine City chat update.

Does not read .env files, show credentials, update Git, restart a service,
execute a task, change a wallet or contact an AI provider.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from urllib.parse import urlsplit

FILES = (
    'app/server.js',
    'app/vitriny-neural/chat-engine.js',
    'app/vitriny-neural/chat-api.js',
    'app/vitriny-neural/lia-chat-operations.js',
    'app/vitriny-neural/paid-chat-runtime.js',
    'app/vitriny-neural/coin-wallet-adapter.js',
    'app/vitrine-coins-wallet.js',
    'app/public/neural-workspace.js',
    'app/public/neural-workspace.html',
    'app/public/neural-workspace.css',
)
FLAGS = (
    'VITRINE_COINS_ENABLED', 'VITRINY_NEURAL_PAID_ENABLED',
    'LIA_LOCAL_FIRST_ADMIN', 'LIA_CHAT_OPERATIONS_ENABLED',
)
SECRET_FLAGS = ('DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'KLING_API_KEY', 'LIA_OPERATIONS_TOKEN')


def command(args, cwd=None, timeout=25):
    try:
        result = subprocess.run(args, cwd=cwd, text=True, encoding='utf-8',
                                errors='replace', capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Comando de leitura indisponivel ou excedeu o prazo.') from None
    if result.returncode:
        raise RuntimeError('Leitura falhou; detalhes privados foram omitidos.')
    return result.stdout.strip()


def environment(info):
    return dict(v.split('=', 1) for v in info.get('Config', {}).get('Env', []) if '=' in v)


def target_host(value):
    try:
        return urlsplit(value).hostname in ('vitrinecity.com', 'www.vitrinecity.com')
    except (ValueError, TypeError):
        return False


def public_flags(values):
    enabled = {'1', 'true', 'yes', 'on'}
    return {**{key: ('ausente' if key not in values else
                     'ativado' if values[key].strip().lower() in enabled else 'desativado')
               for key in FLAGS},
            **{key: bool(values.get(key)) for key in SECRET_FLAGS}}


def candidates():
    identifiers = command(['docker', 'ps', '--filter', 'label=com.docker.compose.service=app',
                           '--format', '{{.ID}}']).splitlines()
    rows = []
    for cid in identifiers:
        if not cid:
            continue
        info = json.loads(command(['docker', 'inspect', cid]))[0]
        if target_host(environment(info).get('SITE_URL', '')):
            rows.append(info)
    if len(rows) != 1:
        raise RuntimeError('Esperado um unico servico Compose app com SITE_URL da Vitrine City; '
                           'nao houve tentativa de alterar outro servico.')
    return rows[0]


RUNTIME = r'''
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const names=JSON.parse(process.argv[1]),files={};
for(const p of names){
  try{const full='/'+p,s=fs.lstatSync(full);files[p]=s.isFile()&&!s.isSymbolicLink()
    ?createHash('sha256').update(fs.readFileSync(full)).digest('hex'):'not_regular';}
  catch{files[p]='absent';}
}
let database={available:false};
try{
  const {default:DB}=await import('better-sqlite3');
  const db=new DB(path.join(process.env.DATA_DIR||'/data','vitrinecity.db'),{readonly:true,fileMustExist:true});
  const has=t=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  database={available:true,chatRequestsPending:0,paidRequestsUnsettled:0,operationsPending:0};
  if(has('neural_chat_requests'))database.chatRequestsPending=db.prepare(
    "SELECT COUNT(*) n FROM neural_chat_requests WHERE status IN ('awaiting_confirmation','queued','running')").get().n;
  if(has('neural_paid_chat_requests'))database.paidRequestsUnsettled=db.prepare(
    "SELECT COUNT(*) n FROM neural_paid_chat_requests WHERE state NOT IN ('quoted','settled','released')").get().n;
  if(has('lia_chat_operations'))database.operationsPending=db.prepare(
    "SELECT COUNT(*) n FROM lia_chat_operations WHERE status IN ('created','reserved','executing','review_required')").get().n;
  db.close();
}catch{database={available:false,error:'read_only_inspection_failed'};}
let health=false;
try{const port=Number(process.env.PORT||3000);if(Number.isInteger(port)&&port>0&&port<=65535){
 const r=await fetch('http://127.0.0.1:'+port+'/api/health',{redirect:'error',signal:AbortSignal.timeout(4000)});health=r.ok;}}
catch{}
console.log(JSON.stringify({files,database,health}));
'''


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Execute a verificacao no terminal root da VPS principal.')
    if socket.gethostname().split('.')[0] == 'srv1987582':
        raise RuntimeError('Este e o servidor separado da LIA. Execute na VPS principal da Vitrine City.')
    info = candidates()
    labels = info.get('Config', {}).get('Labels') or {}
    root_value = labels.get('com.docker.compose.project.working_dir', '')
    if not root_value or not Path(root_value).is_absolute():
        raise RuntimeError('Diretorio do Compose nao identificado; nenhuma pasta foi presumida.')
    root = Path(root_value).resolve(strict=True)
    git = ['git', '-c', 'safe.directory=' + str(root), '-C', str(root)]
    head = command(git + ['rev-parse', 'HEAD'])
    branch = command(git + ['branch', '--show-current'])
    changed = command(git + ['diff', '--name-only', 'HEAD', '--', 'app', 'ops'])
    inspected = json.loads(command(['docker', 'exec', '-w', '/app', info['Id'],
                                   'node', '--input-type=module', '-e', RUNTIME,
                                   json.dumps(FILES)], timeout=35))
    disk = {}
    for relative in FILES:
        p = root / relative
        if p.is_symlink():
            disk[relative] = 'symlink'
        elif p.is_file() and p.stat().st_size <= 5 * 1024 * 1024:
            disk[relative] = hashlib.sha256(p.read_bytes()).hexdigest()
        else:
            disk[relative] = 'absent_or_oversize'
    data_target = environment(info).get('DATA_DIR', '/data')
    mounts = [{key: m.get(key) for key in ('Type', 'Name', 'Destination', 'RW')}
              for m in info.get('Mounts', []) if m.get('Destination') == data_target]
    output = {
        'schema': 1, 'readOnly': True,
        'host': socket.gethostname(), 'composeProject': labels.get('com.docker.compose.project'),
        'service': labels.get('com.docker.compose.service'), 'checkout': str(root),
        'branch': branch or '(detached)', 'head': head, 'imageId': info.get('Image'),
        'trackedChangedPaths': changed.splitlines(), 'dataMount': mounts,
        'flags': public_flags(environment(info)), **inspected,
        'checkoutHashes': disk,
        'note': 'Git nao atualizado; nenhum servico reiniciado; nenhum token exibido; nenhuma tarefa executada.'
    }
    print('=== PREFLIGHT VPS PRINCIPAL VITRINE CITY ===')
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is RuntimeError else 'Inspecao incompleta; dados privados nao exibidos.'
        print('PARADO: ' + message, file=sys.stderr)
        sys.exit(1)
