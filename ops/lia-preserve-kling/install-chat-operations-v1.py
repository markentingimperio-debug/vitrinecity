#!/usr/bin/env python3
"""Deploy LIA chat operations over the currently running Vitrine City app image.

- Preserves the active image as the base (including existing DeepSeek/Kling/local-first config).
- Changes only the app image plus the explicit LIA operations env keys.
- Creates SQLite + .env backups.
- Runs offline syntax/unit tests before publication.
- Rolls back image/.env automatically on publication failure.
"""
from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

SOURCE_REV = "256a1a7d032926f15f2d115ade88e02be43d81fe"
REPO = "markentingimperio-debug/vitrinecity"
RAW = f"https://raw.githubusercontent.com/{REPO}/{SOURCE_REV}"
APP_FILES = [
    "app/server.js",
    "app/vitriny-neural/chat-api.js",
    "app/vitriny-neural/chat-engine.js",
    "app/vitriny-neural/lia-chat-operations.js",
    "app/public/neural-workspace.js",
    "app/public/neural-workspace.html",
    "app/public/neural-workspace.css",
]
TEST_FILES = [
    "app/scripts/test-vitriny-neural-chat.mjs",
    "app/scripts/test-vitriny-neural-chat-api.mjs",
    "app/scripts/test-vitriny-neural-lia-chat-operations.mjs",
]
OPERATIONS_URL = "https://lia.vitrinecity.com"
BACKUP_ROOT = Path("/var/backups")
TIMEOUT = 180


def run(args, *, cwd=None, input_text=None, timeout=TIMEOUT, check=True):
    result = subprocess.run(
        [str(x) for x in args],
        cwd=str(cwd) if cwd else None,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"Comando falhou ({result.returncode}): {' '.join(map(str,args))}\n{result.stdout[-5000:]}")
    return result.stdout.strip()


def docker_inspect(target):
    return json.loads(run(["docker", "inspect", target]))[0]


def active_app_container():
    ids = [x.strip() for x in run([
        "docker", "ps",
        "--filter", "label=com.docker.compose.service=app",
        "--format", "{{.ID}}",
    ]).splitlines() if x.strip()]
    if len(ids) != 1:
        raise RuntimeError(f"Esperava exatamente 1 container app ativo; encontrei {len(ids)}.")
    info = docker_inspect(ids[0])
    if not info.get("State", {}).get("Running"):
        raise RuntimeError("O container app não está em execução.")
    return ids[0], info


def compose_command(info):
    labels = info.get("Config", {}).get("Labels") or {}
    root = Path(labels.get("com.docker.compose.project.working_dir", "")).resolve()
    project = labels.get("com.docker.compose.project", "")
    config_files = [x for x in labels.get("com.docker.compose.project.config_files", "").split(",") if x]
    if not root.is_dir() or not project or not config_files:
        raise RuntimeError("Não foi possível reconstruir o comando Compose do app ativo.")
    cmd = ["docker", "compose", "--project-directory", str(root), "-p", project]
    for file in config_files:
        p = Path(file)
        if not p.is_absolute():
            p = root / p
        if not p.is_file():
            raise RuntimeError(f"Compose file ausente: {p}")
        cmd += ["-f", str(p)]
    return root, cmd


def data_mount(info):
    matches = [m for m in info.get("Mounts", []) if m.get("Destination") == "/data"]
    if len(matches) != 1:
        raise RuntimeError("O volume /data do app não pôde ser identificado com segurança.")
    m = matches[0]
    return {"Type": m.get("Type"), "Source": m.get("Source"), "Name": m.get("Name"), "Destination": m.get("Destination")}


def env_map(info):
    return dict(item.split("=", 1) for item in info.get("Config", {}).get("Env", []) if "=" in item)


def assert_live_contract(cid, info):
    env = env_map(info)
    if env.get("VITRINY_NEURAL_PAID_ENABLED") != "true":
        raise RuntimeError("VITRINY_NEURAL_PAID_ENABLED não está true no app atual.")
    if not env.get("KLING_API_KEY"):
        raise RuntimeError("KLING_API_KEY não está presente no app atual.")
    if not (env.get("DEEPSEEK_API_KEY") or env.get("OPENAI_API_KEY")):
        raise RuntimeError("Nenhuma chave de texto DeepSeek/OpenAI está presente no app atual.")
    if env.get("LIA_LOCAL_FIRST_ADMIN") != "1":
        raise RuntimeError("LIA_LOCAL_FIRST_ADMIN=1 não foi confirmado no app atual.")
    if env.get("VITRINE_COINS_ENABLED") != "true":
        raise RuntimeError("A carteira unificada Vitrine Coins não está habilitada.")

    marker = run(["docker", "exec", cid, "sh", "-lc", "grep -c 'LIA_PRESERVE_KLING_V1' /app/vitriny-neural/chat-engine.js || true"])
    if marker.strip() != "1":
        raise RuntimeError("O patch local-first atual não foi identificado exatamente uma vez.")

    # Do not redeploy while the private chat or a paid provider has unresolved work.
    js = r"""
import DB from 'better-sqlite3';
import path from 'node:path';
const db=new DB(path.join(process.env.DATA_DIR||'/data','vitrinecity.db'),{readonly:true,fileMustExist:true});
const has=t=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
let active=0;
if(has('neural_chat_requests')) active+=db.prepare("SELECT COUNT(*) n FROM neural_chat_requests WHERE status IN ('awaiting_confirmation','queued','running')").get().n;
if(has('neural_paid_chat_requests')) active+=db.prepare("SELECT COUNT(*) n FROM neural_paid_chat_requests WHERE state IN ('reserved','dispatched','held') OR phase NOT IN ('finished','quoted')").get().n;
console.log(String(active));
db.close();
"""
    active = int(run(["docker", "exec", "-w", "/app", cid, "node", "--input-type=module", "-e", js]).splitlines()[-1])
    if active:
        raise RuntimeError(f"Existem {active} pedido(s) da LIA em andamento/conferência. Aguarde ou cancele antes de atualizar.")


def fetch_file(path, destination):
    url = f"{RAW}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "VitrineCity-LIA-Deploy/1"})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read()
    if not data:
        raise RuntimeError(f"Arquivo vazio recebido: {path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def validate_operations_token(token):
    if len(token) < 32 or any(ch.isspace() for ch in token):
        raise RuntimeError("Token operacional inválido.")
    body = json.dumps({"instruction": "Abra https://vitrinecity.com e tire uma captura"}).encode()
    req = urllib.request.Request(
        OPERATIONS_URL + "/v1/operations/quote",
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": "VitrineCity-LIA-Deploy/1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Operations Gateway recusou o token/quote (HTTP {error.code}).")
    if data.get("ok") is not True or data.get("kind") != "browser" or data.get("supported") is not True:
        raise RuntimeError("Operations Gateway não confirmou o roteamento browser.")
    return True


def backup_database(cid, backup_dir):
    snapshot = f".lia-chat-ops-backup-{int(time.time())}.sqlite"
    code = r"""
import DB from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
const dir=process.env.DATA_DIR||'/data';
const db=new DB(path.join(dir,'vitrinecity.db'),{readonly:true,fileMustExist:true});
const out=path.join(dir,process.argv[1]);
await db.backup(out);fs.chmodSync(out,0o600);db.close();console.log(out);
"""
    remote = run(["docker", "exec", "-w", "/app", cid, "node", "--input-type=module", "-e", code, snapshot]).splitlines()[-1]
    run(["docker", "cp", f"{cid}:{remote}", str(backup_dir / "database.sqlite")], timeout=300)
    os.chmod(backup_dir / "database.sqlite", 0o600)
    run(["docker", "exec", cid, "rm", "-f", remote])


def atomic_env_update(env_path, token, backup_dir):
    if not env_path.is_file():
        raise RuntimeError(f".env não encontrado: {env_path}")
    shutil.copy2(env_path, backup_dir / ".env.before")
    original = env_path.read_text()
    lines = original.splitlines()
    values = {
        "LIA_CHAT_OPERATIONS_ENABLED": "true",
        "LIA_OPERATIONS_URL": OPERATIONS_URL,
        "LIA_OPERATIONS_TOKEN": token,
        "LIA_BROWSER_PRICE_MICRO_BRL": "104167",
        "LIA_MEDIA_PRICE_MICRO_BRL": "520833",
    }
    seen = set()
    output = []
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in values:
                output.append(f"{key}={values[key]}")
                seen.add(key)
                continue
        output.append(line)
    if output and output[-1] != "":
        output.append("")
    for key, value in values.items():
        if key not in seen:
            output.append(f"{key}={value}")
    output.append("")
    tmp = env_path.with_name(env_path.name + ".lia-ops.tmp")
    tmp.write_text("\n".join(output))
    os.chmod(tmp, env_path.stat().st_mode & 0o777)
    os.replace(tmp, env_path)


def build_candidate(tmp, old_image_id, backup_tag, candidate_tag):
    context = tmp / "context"
    for path in APP_FILES + TEST_FILES:
        fetch_file(path, context / path)
    dockerfile = f"""FROM {backup_tag}
COPY app/server.js /app/server.js
COPY app/vitriny-neural/chat-api.js /app/vitriny-neural/chat-api.js
COPY app/vitriny-neural/chat-engine.js /app/vitriny-neural/chat-engine.js
COPY app/vitriny-neural/lia-chat-operations.js /app/vitriny-neural/lia-chat-operations.js
COPY app/public/neural-workspace.js /app/public/neural-workspace.js
COPY app/public/neural-workspace.html /app/public/neural-workspace.html
COPY app/public/neural-workspace.css /app/public/neural-workspace.css
LABEL org.vitrinecity.lia-operations-source="{SOURCE_REV}"
"""
    (context / "Dockerfile").write_text(dockerfile)
    run(["docker", "build", "--network=none", "--pull=false", "-t", candidate_tag, str(context)], timeout=300)
    candidate = docker_inspect(candidate_tag)["Id"]
    if candidate == old_image_id:
        raise RuntimeError("A imagem candidata não mudou.")

    for target in [
        "/app/server.js",
        "/app/vitriny-neural/chat-api.js",
        "/app/vitriny-neural/chat-engine.js",
        "/app/vitriny-neural/lia-chat-operations.js",
        "/app/public/neural-workspace.js",
    ]:
        run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "node", candidate_tag, "--check", target], timeout=60)

    test_mounts = []
    for path in TEST_FILES:
        host = context / path
        test_mounts += ["-v", f"{host}:{Path('/app') / Path(path).relative_to('app')}:ro"]
    run([
        "docker", "run", "--rm", "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m",
        *test_mounts,
        "--entrypoint", "node", candidate_tag,
        "--test",
        "/app/scripts/test-vitriny-neural-chat.mjs",
        "/app/scripts/test-vitriny-neural-chat-api.mjs",
        "/app/scripts/test-vitriny-neural-lia-chat-operations.mjs",
    ], timeout=240)
    return candidate


def wait_health(compose, root, expected_image, expected_mount, timeout=90):
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            cid = run(compose + ["ps", "-q", "app"], cwd=root).splitlines()[0].strip()
            info = docker_inspect(cid)
            health = info.get("State", {}).get("Health", {}).get("Status")
            running = info.get("State", {}).get("Running")
            if running and health in (None, "healthy"):
                if info["Image"] != expected_image:
                    raise RuntimeError("O app saudável não está usando a imagem candidata esperada.")
                if data_mount(info) != expected_mount:
                    raise RuntimeError("O volume /data mudou durante a publicação.")
                return cid, info
            last = str(health)
        except Exception as error:
            last = str(error)
        time.sleep(2)
    raise RuntimeError(f"Healthcheck do app não ficou saudável: {last}")


def write_rollback(backup_dir, root, compose, old_tag, backup_tag):
    payload = {
        "root": str(root),
        "compose": compose,
        "oldTag": old_tag,
        "backupTag": backup_tag,
        "envBackup": str(backup_dir / ".env.before"),
        "envPath": str(root / ".env"),
    }
    (backup_dir / "rollback.json").write_text(json.dumps(payload, indent=2))
    rollback = r'''#!/usr/bin/env python3
import json, pathlib, shutil, subprocess, sys, time
here=pathlib.Path(__file__).resolve().parent
m=json.loads((here/'rollback.json').read_text())
def run(a,cwd=None):
 r=subprocess.run(a,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 if r.returncode: raise SystemExit(r.stdout)
 return r.stdout.strip()
shutil.copy2(m['envBackup'],m['envPath'])
run(['docker','tag',m['backupTag'],m['oldTag']])
run(m['compose']+['up','-d','--no-deps','--no-build','--pull','never','app'],cwd=m['root'])
print('Rollback da imagem/.env solicitado. O backup do banco foi preservado e NÃO foi restaurado automaticamente.')
'''
    p = backup_dir / "rollback.py"
    p.write_text(rollback)
    os.chmod(p, 0o700)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Execute como root.")
    for command in ("docker", "git"):
        if shutil.which(command) is None:
            raise RuntimeError(f"Comando ausente: {command}")
    run(["docker", "compose", "version"])

    cid, info = active_app_container()
    root, compose = compose_command(info)
    env_path = root / ".env"
    old_image_id = info["Image"]
    old_tag = info.get("Config", {}).get("Image", "")
    if not old_tag or old_tag.startswith("sha256:") or "@sha256:" in old_tag:
        raise RuntimeError("A imagem atual não possui uma tag substituível com segurança.")
    old_mount = data_mount(info)

    print("Contrato do app atual: verificando DeepSeek/Kling/local-first/Vitrine Coins...")
    assert_live_contract(cid, info)
    print("Pedidos ativos da LIA: ZERO")

    token = os.environ.get("LIA_OPERATIONS_TOKEN_INPUT", "")
    if not token:
        token = getpass.getpass("Cole o token de /root/lia-operations-main-app-token.txt da VPS da LIA (não será exibido): ").strip()
    validate_operations_token(token)
    print("Operations Gateway: TOKEN/QUOTE VALIDADO (nenhuma tarefa executada)")

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup_dir = BACKUP_ROOT / f"vitrinecity-lia-chat-ops-{stamp}"
    backup_dir.mkdir(parents=True, mode=0o700)
    os.chmod(backup_dir, 0o700)
    shutil.copy2(env_path, backup_dir / ".env.before")
    backup_database(cid, backup_dir)

    backup_tag = f"vitrinecity-lia-before-ops:{stamp.lower()}"
    candidate_tag = f"vitrinecity-lia-ops-candidate:{stamp.lower()}"
    run(["docker", "tag", old_image_id, backup_tag])
    write_rollback(backup_dir, root, compose, old_tag, backup_tag)

    published = False
    with tempfile.TemporaryDirectory(prefix="vitrinecity-lia-ops-") as tmp_name:
        tmp = Path(tmp_name)
        print("Construindo imagem candidata sobre a imagem atual, sem acesso de rede...")
        candidate_id = build_candidate(tmp, old_image_id, backup_tag, candidate_tag)
        print("Testes isolados: APROVADOS")
        try:
            atomic_env_update(env_path, token, backup_dir)
            run(["docker", "tag", candidate_id, old_tag])
            print("Publicando somente o serviço app; banco/volumes/Kling preservados...")
            run(compose + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"], cwd=root, timeout=180)
            new_cid, new_info = wait_health(compose, root, candidate_id, old_mount)

            new_env = env_map(new_info)
            required = {
                "LIA_CHAT_OPERATIONS_ENABLED": "true",
                "LIA_OPERATIONS_URL": OPERATIONS_URL,
                "LIA_LOCAL_FIRST_ADMIN": "1",
                "VITRINY_NEURAL_PAID_ENABLED": "true",
            }
            for key, expected in required.items():
                if new_env.get(key) != expected:
                    raise RuntimeError(f"Configuração final ausente/divergente: {key}")
            if new_env.get("LIA_OPERATIONS_TOKEN") != token:
                raise RuntimeError("O token operacional não chegou ao app.")
            if not new_env.get("KLING_API_KEY") or not (new_env.get("DEEPSEEK_API_KEY") or new_env.get("OPENAI_API_KEY")):
                raise RuntimeError("DeepSeek/Kling não foram preservados no app final.")

            # Server-to-server connectivity from the actual new app. No paid execution.
            probe = r"""
const r=await fetch((process.env.LIA_OPERATIONS_URL||'https://lia.vitrinecity.com')+'/v1/operations/quote',{
 method:'POST',headers:{Authorization:'Bearer '+process.env.LIA_OPERATIONS_TOKEN,'Content-Type':'application/json'},
 body:JSON.stringify({instruction:'Abra https://vitrinecity.com e tire uma captura'})
});
const d=await r.json();if(!r.ok||d.kind!=='browser'||d.supported!==true)process.exit(2);console.log('OPERATIONS_QUOTE_OK');
"""
            run(["docker", "exec", new_cid, "node", "--input-type=module", "-e", probe], timeout=30)
            run(["docker", "exec", new_cid, "sh", "-lc",
                 "grep -q 'LIA_PRESERVE_KLING_V1' /app/vitriny-neural/chat-engine.js && "
                 "grep -q 'deleteConversation' /app/vitriny-neural/chat-engine.js && "
                 "grep -q 'tryOperationalCommand' /app/public/neural-workspace.js"])
            published = True
        except BaseException:
            print("Falha pós-publicação detectada. Restaurando imagem e .env anteriores...")
            shutil.copy2(backup_dir / ".env.before", env_path)
            run(["docker", "tag", backup_tag, old_tag], check=False)
            run(compose + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"], cwd=root, timeout=180, check=False)
            raise

    if not published:
        raise RuntimeError("Publicação não foi confirmada.")

    print()
    print("=== LIA CHAT OPERACIONAL PUBLICADA COM SEGURANÇA ===")
    print("Chat DeepSeek: PRESERVADO")
    print("Kling imagem/vídeo: PRESERVADO")
    print("ADMIN local-first: PRESERVADO E CONSOLIDADO")
    print("Browser Worker: CONECTADO AO CHAT PESSOAL")
    print("Media Worker: CONECTADO AO CHAT PESSOAL")
    print("Vitrine Coins: COTAÇÃO + CONFIRMAÇÃO + RESERVA/LIQUIDAÇÃO")
    print("Excluir conversas antigas: ATIVO")
    print("Git push/Codex/deploy autônomo: NÃO LIBERADOS")
    print("Teste pago/API de geração realizado: NÃO")
    print(f"Backup: {backup_dir}")
    print(f"Rollback: python3 {backup_dir / 'rollback.py'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"PARADO: {error}", flush=True)
        raise SystemExit(1)
