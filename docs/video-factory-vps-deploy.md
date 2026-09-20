# Fábrica Viral — implantação na VPS

## O que está operacional

A `main` contém o pipeline de produção de quizzes verticais:

1. captura/curadoria de temas e tendências;
2. criação do roteiro de 65 segundos;
3. aprovação automática ou supervisionada, conforme `viral_factory_settings.approval_required`;
4. geração de 9 cenas por OpenRouter Video;
5. persistência dos recibos e retomada da mesma tarefa sem duplicar geração;
6. download validado dos MP4;
7. montagem com FFmpeg em 720x1280, H.264/AAC e fast-start;
8. publicação na Vitrine Social por Cloudflare Stream, com recibo e reconciliação;
9. registro das filas das demais redes em `viral_distribution_jobs`.

A LIA Vídeo reutiliza essa infraestrutura e acrescenta duração por minutos, cotas por plano, roteiro, descrição, hashtags, narração TTS, sincronização de áudio por FFmpeg e agendamento. O cliente usa `/lia-video.html`; a administração usa `/admin-lia-video.html`.

Instagram, Facebook, TikTok, YouTube, Kwai e Bilibili só devem sair de
`awaiting_connection` quando existir um publicador oficial com autorização de
upload daquela conta. Credenciais usadas apenas para métricas não são tratadas
como permissão de postagem.

## Variáveis mínimas para o pipeline completo

No `/opt/vitrinecity/.env`:

```dotenv
SITE_URL=https://vitrinecity.com
OPENROUTER_API_KEY=...
OPENROUTER_VIDEO_MODEL=google/veo-3.1-lite
OPENAI_API_KEY=...
LIA_VIDEO_TTS_MODEL=gpt-4o-mini-tts
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_STREAM_API_TOKEN=...
CLOUDFLARE_STREAM_WEBHOOK_SECRET=...
```

Não versionar valores reais.

## Implantar a partir da revisão antiga da VPS

O comando abaixo executa o script da `origin/main` sem exigir que o arquivo já
exista no checkout antigo. O script registra o SHA anterior antes de atualizar,
faz backup online do SQLite, constrói o app, sobe somente o container `app`,
valida o healthcheck e roda a verificação da fábrica.

```bash
cd /opt/vitrinecity
git fetch origin main
git show origin/main:ops/deploy-video-factory.sh | bash
```

Para outro diretório ou branch:

```bash
cd /opt/vitrinecity
git fetch origin main
git show origin/main:ops/deploy-video-factory.sh | \
  VITRINE_APP_DIR=/opt/vitrinecity VITRINE_REF=main bash
```

## Verificação manual

```bash
cd /opt/vitrinecity
bash ops/verify-video-factory.sh
docker compose logs --tail=200 app
```

Na inicialização deve aparecer:

```text
Fábrica Viral agendada: pautas a cada 30 min; geração/edição a cada 60 s.
```

A verificação também confirma FFmpeg, as variáveis essenciais, o schema e um
resumo das filas sem imprimir tokens ou segredos.

## Backup e rollback

Antes de trocar a revisão, o deploy cria:

```text
/data/backups/vitrinecity-<UTC>-pre-video-factory.db
```

dentro do volume persistente do app.

Se build, subida, healthcheck ou verificação falharem, o script retorna o código
para o SHA anterior e reconstrói o serviço `app`. O backup do banco não é
restaurado automaticamente para evitar perda de dados gravados após a tentativa
de deploy.
