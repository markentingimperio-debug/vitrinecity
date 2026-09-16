# Ativação da LIA na VPS

A LIA usa o mesmo modelo local `jarvis-model` já previsto na Vitrine City. O serviço `lia-agent` não publica porta no host: a aplicação principal conversa com ele pela rede Docker.

## 1. Configurar o `.env` da VPS

Adicione:

```env
JARVIS_LOCAL_MODEL=1
VITRINY_NEURAL_ENABLED=1
VITRINY_NEURAL_MODE=advisory
LIA_ENABLED=1
LIA_EXECUTOR_TOKEN=COLOQUE_UM_SEGREDO_ALEATORIO_COM_32_OU_MAIS_CARACTERES
LIA_MODEL_NAME=jarvis-local
LIA_MAX_STEPS=12
LIA_MAX_TOTAL_TOKENS=40000
LIA_MAX_FILE_BYTES=196608
LIA_MODEL_TIMEOUT_MS=90000
```

Gere o token na própria VPS, por exemplo:

```bash
openssl rand -hex 32
```

O token é somente para comunicação interna entre o app e o executor. Não o coloque no GitHub.

## 2. Modelo local

O Compose atual espera o arquivo:

```text
/opt/vitrinecity-jarvis-model/Qwen3-1.7B-Q8_0.gguf
```

Se ele já existe, não é necessário baixar outro modelo para ativar a primeira versão da LIA.

## 3. Subir a LIA

Na raiz do projeto na VPS:

```bash
git pull
docker compose --profile lia up -d --build
```

## 4. Verificar

```bash
docker compose --profile lia ps
docker compose logs --tail=100 lia-agent
docker compose logs --tail=100 jarvis-model
```

No site, abra:

```text
https://vitrinecity.com/admin-lia.html
```

A tela deve mostrar `ONLINE`.

## 5. Política da versão 1

Ferramentas disponíveis ao modelo:

- listar arquivos;
- ler arquivos de texto/código;
- pesquisar texto no repositório;
- escrever arquivos permitidos;
- validar sintaxe JavaScript;
- consultar `git status`;
- consultar `git diff`.

A LIA v1 não recebe ferramenta de shell livre, não exclui arquivos e não executa deploy, pagamentos, alterações de credenciais, mudanças de permissões ou operações destrutivas em banco. Essas etapas continuam sob revisão humana.

## 6. Fallback forte opcional

O padrão é gastar zero crédito externo durante a execução do modelo local. Se futuramente for necessário um modelo remoto somente para tarefas difíceis, configure:

```env
LIA_FALLBACK_ORIGIN=
LIA_FALLBACK_MODEL=
LIA_FALLBACK_API_KEY=
```

Sem essas variáveis, a LIA permanece 100% no modelo local.
