#!/usr/bin/env python3
"""Additive LIA installer. No git pull/reset, no .env changes, no volume removal."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

VERSION = '2026-09-16.1'
MARKER = '// LIA_CONNECTED_INSTALL_V1'
HERE = Path(__file__).resolve().parent


def run(args, *, cwd=None, timeout=180, input=None):
    p = subprocess.run(args, cwd=cwd, input=input, text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if p.returncode:
        # Provider keys and Compose-expanded configuration are never printed.
        raise RuntimeError('Comando falhou: ' + ' '.join(str(x) for x in args[:4]) +
                           '. Saida omitida para proteger credenciais.')
    return p.stdout.strip()


def replace_once(source, old, new, label):
    if source.count(old) != 1:
        raise RuntimeError('Versao incompativel em ' + label + '. Nenhum arquivo sera substituido.')
    return source.replace(old, new, 1)


def patches(root):
    src = root / 'app/vitriny-neural/server-integration.js'
    ui = root / 'app/public/admin-lia.js'
    html = root / 'app/public/admin-lia.html'
    css = root / 'app/public/admin-lia.css'
    target = root / 'app/vitriny-neural/lia-connected.mjs'
    for p in [src, ui, html, css, root / 'app/video-provider-receipts.js']:
        if not p.is_file() or p.is_symlink():
            raise RuntimeError('Arquivo esperado nao encontrado ou e link: ' + str(p.relative_to(root)))
    s = src.read_text()
    if MARKER in s:
        if target.is_file() and target.read_bytes() == (HERE / 'lia-connected.mjs').read_bytes():
            return None
        raise RuntimeError('Uma versao diferente da LIA Connected ja existe. Nao foi sobrescrita.')
    if target.exists():
        raise RuntimeError('Ja existe lia-connected.mjs sem marcador. Nao foi sobrescrito.')
    s = "import {mountConnectedLia} from './lia-connected.mjs';\nimport {downloadVideo as downloadLiaVideo} from '../video-provider-receipts.js';\n" + MARKER + '\n' + s
    anchor = '    const lia=mountLiaAdmin({app,requireAdmin,sameOriginOnly,env,fetchImpl});'
    s = replace_once(s, anchor,
        '    const connectedLia=mountConnectedLia({app,db,requireAdmin,sameOriginOnly,env,fetchImpl,service,downloadVideo:downloadLiaVideo});\n' + anchor, 'server-integration.js')
    s = replace_once(s, 'stop:()=>{spatialBridge?.stop?.();',
                     'stop:()=>{connectedLia.stop();spatialBridge?.stop?.();', 'stop')
    u = ui.read_text()
    old = "    if(item.result){const pre=document.createElement('pre');pre.textContent=item.result;article.append(pre);}"
    media = """
    for(const asset of Array.isArray(item.assets)?item.assets:[]){
      if(!/^\\/api\\/admin\\/lia\\/connected\\/assets\\/[a-f0-9-]{36}$/.test(String(asset.url||'')))continue;
      const link=document.createElement('a');link.href=asset.url;link.textContent='Abrir arquivo gerado';link.target='_blank';link.rel='noopener noreferrer';article.append(link);
      if(asset.type==='image'){const img=document.createElement('img');img.src=asset.url;img.alt='Imagem gerada pela LIA';img.loading='lazy';img.className='lia-connected-asset';article.append(img);}
      if(asset.type==='video'){const video=document.createElement('video');video.src=asset.url;video.controls=true;video.preload='metadata';video.className='lia-connected-asset';article.append(video);}
    }
"""
    u = replace_once(u, old, old + media, 'render de midia')
    u = replace_once(u, "${Number(item.usage?.totalTokens||0).toLocaleString('pt-BR')} tokens",
                    "${item.usage?.known===false?'cota de chamadas':Number(item.usage?.totalTokens||0).toLocaleString('pt-BR')+' tokens'}", 'consumo')
    u = replace_once(u, "const busy=items.some(item=>item.status==='running'||item.status==='queued');",
                    "const busy=items.some(item=>['running','queued','processing'].includes(item.status));", 'polling')
    u = replace_once(u, "if(['queued','running'].includes(item.status))",
                    "if(['queued','running','processing'].includes(item.status))", 'cancelamento')
    status = """if(data.connected){const s=data.connected;$('state-detail').textContent=data.legacyAvailable?'texto/midia e executor disponiveis':'texto/midia; executor de codigo indisponivel';$('model-detail').textContent=`DeepSeek: ${s.keys.deepseek?'chave encontrada':'sem chave'} | OpenAI: ${s.keys.openai?'chave encontrada':'sem chave'}`;$('limits').textContent=`${s.limits.deepseek}+${s.limits.openai} texto / ${s.limits.image} imagem / ${s.limits.video} video por dia`;}
      return data.enabled;"""
    u = replace_once(u, 'return data.enabled;', status, 'status')
    h = html.read_text()
    h = replace_once(h, '</body>', """<section class="lia-connected-info"><h2>LIA conectada</h2><p>Perguntas usam o modelo local, quando habilitado, e consultam DeepSeek e OpenAI se necessario. /imagem cria uma imagem quadrada; /video cria um video de 4 segundos, 720p, horizontal. /codigo encaminha ao executor anterior. Nada e publicado automaticamente.</p><p>As cotas limitam apenas esta nova camada. Chave encontrada nao confirma saldo ou permissao da API. Sora fica indisponivel a partir de 24/09/2026; OpenRouter e usado para video quando configurado.</p></section>\n</body>""", 'HTML')
    c = css.read_text() + '\n.lia-connected-asset{display:block;max-width:100%;max-height:480px;margin:12px 0;border-radius:8px}.lia-connected-info{max-width:1100px;margin:24px auto;padding:16px;line-height:1.5}\n'
    return {src: s.encode(), ui: u.encode(), html: h.encode(), css: c.encode(),
            target: (HERE / 'lia-connected.mjs').read_bytes()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', default='/opt/vitrinecity')
    parser.add_argument('--check-only', action='store_true')
    a = parser.parse_args()
    root = Path(a.project).resolve()
    if not root.is_dir() or not (root / '.git').exists():
        raise RuntimeError('Projeto Git nao encontrado em ' + str(root))
    for executable in ['docker', 'git']:
        if not shutil.which(executable):
            raise RuntimeError('Comando necessario ausente: ' + executable)
    origin = run(['git', 'remote', 'get-url', 'origin'], cwd=root).lower().rstrip('/')
    if not origin.endswith(('markentingimperio-debug/vitrinecity.git', 'markentingimperio-debug/vitrinecity')):
        raise RuntimeError('Este nao e o repositorio Vitrine City esperado.')
    changed = patches(root)
    if changed is None:
        print('Esta versao ja esta instalada nos arquivos. Nenhuma nova alteracao realizada.')
        return
    compose = ['docker', 'compose']
    services = run(compose + ['config', '--services'], cwd=root).splitlines()
    if 'app' not in services:
        raise RuntimeError('Servico app nao encontrado no Compose ativo.')
    ids = run(compose + ['ps', '-q', 'app'], cwd=root).splitlines()
    if len(ids) != 1:
        raise RuntimeError('E necessario exatamente um container app em execucao.')
    cid = ids[0]
    inspected = json.loads(run(['docker', 'inspect', cid]))[0]
    if not inspected['State'].get('Running'):
        raise RuntimeError('O app nao esta em execucao.')
    labels = inspected['Config'].get('Labels', {})
    if Path(labels.get('com.docker.compose.project.working_dir', '')).resolve() != root:
        raise RuntimeError('O container app pertence a outro diretorio Compose.')
    if any(m.get('Type') == 'bind' and (m.get('Destination') == '/app' or m.get('Destination','').startswith('/app/')) for m in inspected.get('Mounts', [])):
        raise RuntimeError('Codigo do app montado diretamente por bind. Instalacao requer revisao para evitar mudanca em processo vivo.')
    execnode = compose + ['exec', '-T', 'app', 'node']
    # Run isolated tests using the actual app runtime, never production credentials or its database.
    checkdir = '/tmp/lia-connected-check-' + str(os.getpid())
    run(['docker', 'cp', str(HERE), cid + ':' + checkdir])
    try:
        report = run(execnode + ['--test', checkdir + '/test-connected.mjs'], cwd=root, timeout=120)
        print('Testes isolados no runtime do app: aprovados.')
        for dest, data in changed.items():
            if dest.suffix in ('.js', '.mjs'):
                run(execnode + ['--check', '--input-type=module'], cwd=root, input=data.decode())
    finally:
        run(execnode + ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true})', checkdir], cwd=root)
    keys = json.loads(run(execnode + ['-e', 'console.log(JSON.stringify({deepseek:!!process.env.DEEPSEEK_API_KEY,openai:!!process.env.OPENAI_API_KEY,openrouter:!!process.env.OPENROUTER_API_KEY,neuralProvider:!!process.env.VITRINY_NEURAL_MODEL_API_KEY,neuralFallback:!!process.env.VITRINY_NEURAL_FALLBACK_API_KEY,liaOpenai:!!process.env.LIA_OPENAI_API_KEY,liaDeepseek:!!process.env.LIA_DEEPSEEK_API_KEY,liaFallback:!!process.env.LIA_FALLBACK_API_KEY}))'], cwd=root))
    print('Credenciais no ambiente (valores nao exibidos): ' + json.dumps(keys))
    if not any(keys.values()):
        raise RuntimeError('Nao encontrei credenciais no ambiente do app. APIs salvas somente no painel/banco precisam de adaptador. Nenhuma alteracao aplicada.')
    if a.check_only:
        print('Pre-verificacao concluida. Nenhuma alteracao aplicada.')
        return
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = root.parent / ('vitrinecity-lia-backup-' + stamp)
    backup.mkdir(mode=0o700)
    print('Backup local: ' + str(backup))
    for dest in changed:
        if dest.exists():
            copy = backup / 'files' / dest.relative_to(root)
            copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, copy)
    # SQLite online backup captures the WAL consistently. No raw copying of an active DB.
    database = 'import Database from "better-sqlite3";import fs from "node:fs";import path from "node:path";const dir=process.env.DATA_DIR||"/data";const db=new Database(path.join(dir,"vitrinecity.db"),{readonly:true,fileMustExist:true});const p=path.join(dir,"lia-install-backups",process.argv[1]);fs.mkdirSync(p,{recursive:true,mode:0o700});const counts={};for(const t of ["jarvis_documents","neural_lessons","neural_events","neural_checkpoints"]){if(db.prepare("SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?").get(t))counts[t]=db.prepare("SELECT COUNT(*) AS n FROM "+t).get().n;}await db.backup(path.join(p,"vitrinecity.db"));console.log(JSON.stringify({path:p,counts}));db.close();'
    snapshot = json.loads(run(execnode + ['--input-type=module', '-e', database, stamp], cwd=root, timeout=300))
    run(['docker', 'cp', cid + ':' + snapshot['path'] + '/vitrinecity.db', str(backup / 'vitrinecity.db')], timeout=300)
    os.chmod(backup / 'vitrinecity.db', 0o600)
    (backup / 'memory-counts.json').write_text(json.dumps(snapshot['counts'], indent=2))
    image = inspected['Image']
    tag = inspected['Config']['Image']
    rollback_tag = 'vitrinecity-lia-rollback:' + stamp.lower()
    run(['docker', 'image', 'tag', image, rollback_tag])
    manifest = {'project': str(root), 'oldImage': image, 'oldTag': tag, 'rollbackTag': rollback_tag,
                'files': [{'path': str(p.relative_to(root)), 'existed': p.exists(),
                           'newSha256': hashlib.sha256(content).hexdigest()} for p, content in changed.items()]}
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    shutil.copy2(HERE / 'rollback.py', backup / 'rollback.py')
    def restore():
        for item in manifest['files']:
            dest = root / item['path']
            if item['existed']:
                shutil.copy2(backup / 'files' / item['path'], dest)
            else:
                dest.unlink(missing_ok=True)
        run(['docker', 'image', 'tag', image, tag])
        run(compose + ['up', '-d', '--no-deps', '--no-build', 'app'], cwd=root)
    try:
        for dest, data in changed.items():
            tmp = dest.with_name(dest.name + '.lia-tmp')
            tmp.write_bytes(data)
            tmp.chmod(0o644)
            os.replace(tmp, dest)
        print('Construindo somente o app; banco, volumes e .env preservados.')
        run(compose + ['build', 'app'], cwd=root, timeout=900)
        run(compose + ['up', '-d', '--no-deps', '--no-build', 'app'], cwd=root, timeout=180)
        success = False
        for _ in range(30):
            try:
                probe = run(execnode + ['-e', 'Promise.all([fetch("http://127.0.0.1:3000/api/health"),fetch("http://127.0.0.1:3000/api/health/lia-connected")]).then(async([a,b])=>{const j=await b.json();if(!a.ok||!b.ok||j.version!=="'+VERSION+'")process.exit(1);console.log("ok")}).catch(()=>process.exit(1))'], cwd=root, timeout=15)
                if probe == 'ok':
                    success = True
                    break
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
            time.sleep(3)
        if not success:
            raise RuntimeError('A saude da nova camada nao foi confirmada.')
        counts_code = 'const Database=require("better-sqlite3"),path=require("path");const db=new Database(path.join(process.env.DATA_DIR||"/data","vitrinecity.db"),{readonly:true});const expected=JSON.parse(process.argv[1]);for(const [t,n] of Object.entries(expected)){if(db.prepare("SELECT COUNT(*) AS n FROM "+t).get().n<n)process.exit(1);}console.log("ok");db.close();'
        run(execnode + ['-e', counts_code, json.dumps(snapshot['counts'])], cwd=root)
    except BaseException:
        print('Validacao falhou. Restaurando arquivos anteriores e a imagem anterior; sem restaurar o banco de pedidos.')
        try:
            restore()
            print('Rollback do app executado. Confira a saude e o backup: ' + str(backup))
        except Exception:
            print('Rollback automatico falhou. Execute: python3 ' + str(backup / 'rollback.py'))
        raise
    print('\nINSTALACAO VALIDADA: https://vitrinecity.com/admin-lia.html')
    print('Chaves encontradas nao confirmam saldo ou acesso a modelos. Nenhuma geracao paga foi feita no teste.')
    print('Memorias: tabelas anteriores nao foram alteradas; contagens nao diminuiram.')
    print('Desfazer: python3 ' + str(backup / 'rollback.py'))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('PARADO: ' + str(exc), file=sys.stderr)
        sys.exit(1)
