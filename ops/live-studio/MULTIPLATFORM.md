# Lives: Instagram, YouTube e TikTok

O painel `/admin-live.html` distribui **o mesmo vídeo simultaneamente para uma, duas ou três redes**. Marque os destinos desejados e salve as credenciais separadas de cada rede. O seletor de credenciais não altera sozinho as redes selecionadas.

Selecione a rede, cole o servidor oficial e sua chave, salve, revise o vídeo e use primeiro o teste local de 15 segundos. Salvar não inicia o sinal. A publicação pode ocorrer imediatamente após iniciar o sinal, dependendo da configuração do canal.

As chaves são armazenadas no volume privado `/live-studio/config.json`, com permissão 0600. A API retorna somente a existência de cada chave. Cada rede tem perfil independente; trocar servidor invalida a chave antiga daquele perfil. Configurações antigas são tratadas como Instagram sem migração destrutiva.

- Instagram: RTMPS, domínios Meta já aceitos pela integração.
- YouTube: RTMPS/443, domínio youtube.com; copie o endpoint no YouTube Studio.
- TikTok: RTMPS/443 ou RTMP/1935, domínios tiktok.com e tiktokv.com. RTMP não é criptografado. Use somente credenciais oficiais liberadas para a conta. Se o servidor fornecido usar outro domínio, valide sua origem antes de ampliar a lista; não desative a validação.

Ter TikTok LIVE Studio instalado ou OAuth de vídeos conectado não comprova acesso a uma chave RTMP. Este módulo não obtém chaves, não contorna elegibilidade, não adiciona links de compra e não lê chats dessas redes. O status mede a saída do OBS, não confirma publicação na plataforma.

O aviso de apresentação gravada é preservado. Alterações de movimento não garantem conformidade nem evitam bloqueios. Revise as regras da rede antes de publicar conteúdo em repetição.

O OBS codifica uma vez e envia para um receptor RTMP no loopback do próprio contêiner. O FFmpeg distribui por UDP local para três remuxadores independentes, sem recodificação. Não há portas novas expostas no host. RTMPS usa validação de certificado TLS. As URLs e chaves não entram no status nem nos logs de erro. A largura de banda de saída cresce com o número de destinos.

Cada rede informa conectando, enviando, parada ou falha. Enviando significa que o remuxador avançou na escrita; não confirma que a live ficou pública. Use Parar somente [rede] para manter as demais ou Parar sinal/teste para todas. Falhas não são repetidas automaticamente. Quando todas param ou a entrada do OBS cai, o distribuidor é encerrado. Não há sincronismo garantido entre os players das redes, pois cada plataforma adiciona latência própria.

Testes: `node app/scripts/test-live-studio.mjs`; em ambiente com python3-websocket e FFmpeg, `python3 -m unittest test_worker.py test_relay.py` na pasta do controlador. O teste do relay usa vídeo sintético e três receptores RTMP de loopback, verificando envio, parada independente e isolamento de falha, sem acesso às redes sociais.

Publicação: faça backup dos arquivos alterados e marque as imagens Docker anteriores. Construa somente os serviços app e live-studio, confirme que não há transmissão/teste ativo e recrie esses dois serviços sem remover volumes ou serviços órfãos. Confira `/api/health`, autenticação da API de lives e o heartbeat do OBS. Para rollback, restaure os arquivos do backup e as imagens Docker anteriores; não reverta nem apague o volume de mídia/configuração.
