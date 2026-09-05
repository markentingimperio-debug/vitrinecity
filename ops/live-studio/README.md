# Estúdio de Lives

O serviço OBS é privado, sem portas publicadas. App e worker trocam apenas arquivos no volume `live_studio`; o OBS não recebe o banco de dados nem o `.env` da plataforma. Chaves ficam em arquivos privados (não criptografadas em repouso), nunca na resposta da API. Não compartilhar o volume nem backups dele.

## Operação

`docker compose build app live-studio` e `docker compose up -d live-studio app` na VPS.

Abra `/admin-live.html` com sessão administrativa. Salve vídeo, repetições e destino. Execute o teste local de 15 segundos. A chave RTMPS deve ser preenchida na página, nunca no chat ou logs. O botão de início exige confirmação; o usuário pode ainda precisar iniciar a live dentro do Instagram. Nenhuma chamada ao OBS confirma publicação pública na plataforma.

As sessões limitadas duram até 30 minutos e param pelo prazo persistido. A opção explícita `repetitions: 0` repete o vídeo continuamente até parada manual, falha ou encerramento pela rede; não reabre uma live encerrada nem inicia transmissão após reboot. Testes continuam limitados a 15 segundos, inclusive no modo contínuo. Verificar se a rede permite o uso pretendido antes de transmitir. OBS usa 720×1280, 30 fps, H.264 2500 kbps, áudio AAC 128 kbps/48 kHz. Limites do contêiner: 1,5 CPU e 1536 MB. Avaliar desempenho antes de live real. Comentários/respostas automáticas não estão integrados.

O preset ultrafast e a prévia da interface desativada reduzem o custo de renderização por software na VPS. O arquivo continua visível no player do painel. O teste local teve parada automática confirmada; o teste externo de RTMPS depende de chave válida da conta.

## Biblioteca revisada

Copiar MP4 aprovado para `/live-studio/media/` no contêiner. Ajustar proprietário para UID/GID 10001. Executar `python3 /opt/studio/import-media.py` como usuário studio; o importador rejeita proporção diferente de 9:16 e duração acima de 601 segundos (tolerância para padding AAC). A biblioteca contém o quiz corrigido e apresentações VitrineCity de 1 e 10 minutos. As apresentações usam cenas ilustrativas com IA e narração sintética, identificadas no próprio vídeo.

## Diagnóstico

`docker compose ps live-studio app`, status JSON `/live-studio/status.json` e gravações privadas em `/live-studio/recordings`. Não imprimir `config.json`, `obs-password`, perfil de serviço do OBS ou chave da rede em logs. Se heartbeat ficar obsoleto, o painel mostra indisponível. Não repetir início sem verificar o estado real. A gravação de teste deve ser revisada para áudio, texto e enquadramento.

## Reversão

Primeiro interromper sinal no painel e verificar no Instagram. Parar apenas `live-studio`, manter seu volume (sem `down -v`). A imagem anterior do app foi preservada como `vitrinecity-app:before-live-studio`. Reverter somente o commit do Estúdio de Lives se necessário; não desfazer outras alterações da VPS.
