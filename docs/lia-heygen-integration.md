# LIA + ElevenLabs + HeyGen: integração opt-in

## Estado de publicação

A implementação acrescenta HeyGen como alternativa explícita à sincronização
labial do executor no PR #217. O TTS continua no ElevenLabs e a montagem no FFmpeg.
O código está no PR #218, branch `feat/lia-heygen-lipsync-20260921`.
Não foi publicado na VPS. Nenhum código foi montado no `server.js` ou no frontend.
**O configurador abaixo cadastra uma credencial; não ativa o chat.**
Não executar `git pull main`, trocar branches no checkout da produção ou copiar
estes módulos diretamente sobre o app ativo: a base ainda difere da produção v95.

## O que o adaptador executa

- Valida vídeo MP4 e áudio WAV antes do primeiro envio, ambos abaixo de 20 MB.
- Envia os bytes por multipart para `/v3/assets`, sem publicar URLs da aplicação.
- Cria uma tarefa em `/v3/lipsyncs` com `mode` speed ou precision, referências de
  assets e sem geração de outra voz. Música e mudança dinâmica de duração ficam
  desativadas para conservar a fala aprovada. A saída ainda é conferida por ffprobe.
- Salva o identificador da tarefa e consulta `/v3/lipsyncs/{id}`.
- Retorna aos passos existentes do FFmpeg para mux, legendas e montagem final.
- O protocolo de upload não garante sigilo no armazenamento do fornecedor. Assets
  podem ter URL no HeyGen; a aplicação descarta essa URL de origem e não a exibe.

Narração sem personagem falando não faz nenhum upload/chamada ao HeyGen. O fluxo
recebe cenas já produzidas. Não cria avatares, novas cenas visuais ou biblioteca
persistente de personagens nesta extensão. Animais e personagens estilizados não
estão validados para lip sync. A qualidade com rostos humanos também requer teste
real autorizado. Não confundir áudio decodificável com validação de idioma/boca.

## Segurança e cobranças

A escolha do fornecedor, modo e identidade da chave é persistida no orçamento e
no fingerprint. Uma coluna aditiva `provider_binding` mantém jobs anteriores no
Sync. Um executor HeyGen não pega, aprova nem repete tarefas criadas para Sync.
Antes de cada upload e POST é reconferida a autorização da reserva. Cada etapa usa
um Idempotency-Key derivado da conta/chave, job e hashes de vídeo/áudio. Não há retry
pago automático nem fallback para outro fornecedor/modelo depois de uma falha.

O journal marca o envio antes da chamada externa. Em resultado desconhecido,
cancelamento após envio ou falha do fornecedor, fica em conferência: não libera
saldo que talvez tenha sido consumido. Assets já enviados podem permanecer na
conta do fornecedor. Não existe limpeza remota automática nesta entrega.

A tabela de preços do Sync NÃO pode ser usada para HeyGen. O host precisa fornecer
`tariff.synchronizationProvider='heygen'` e `tariff.synchronizationMode` iguais ao
modo escolhido, além das tarifas-teto verificadas em micro-BRL. A conciliação
financeira continua pendente no executor base; consumo fica held até comprovação.
Não habilitar para assinantes sem fechar esse fluxo. Não há preço/câmbio inventado.

## Configuração privada na VPS principal

`python3 ops/lia-heygen/configure-heygen.py` aceita somente root em `srv1901029`.
Ele pede a chave HEYGEN em entrada oculta, faz UMA consulta autenticada
`GET https://api.heygen.com/v3/api_keys/self`, confere status, validade e escopos:
`lipsync:write`, `assets:write`, `account:read`.
É uma consulta de metadados: não envia mídia nem testa geração/saldo.

Somente depois de digitar `SALVAR_HEYGEN`, cria:

```
/etc/vitrinecity/lia-heygen/connection.json
```

Diretórios privados (0700), arquivo root-only (0600), travessia sem symlinks,
criação atômica e sem sobrescrever configuração anterior. Nunca imprimir o arquivo,
a chave ou colocá-los no Git. Falha de escopo/autenticação mostra um código filtrado,
não a resposta do fornecedor. Uma chave ampla gera aviso; recomenda-se restrita.

O cadastro é da conta Vitrine City 1, modo inicial precision (SEM execução). A chave
ElevenLabs existente e a amostra de áudio NÃO são lidas ou alteradas. Não há alteração
de .env, Compose, Docker, banco, firewall ou reinício de serviços. Se o arquivo já
existir, parar; não apagá-lo para contornar a proteção.

Resultado esperado: `HEYGEN_CONFIG_SAVED_CHAT_NOT_ACTIVATED`.
Os campos `deployed`, `chatActivated` e `realLipSyncVerified` permanecem false.

## Montagem futura na aplicação reconciliada

`setupLiaVideoPostProduction` aceita `lipSyncProvider:'heygen'` e um
`heygenConnectionFile` somente do servidor. `loadHeyGenConnection` mantém a chave
fora do DTO e valida usuário e expiração a cada uso. O setup permanece inerte
quando enabled não for true. A configuração precisa de montagem somente-leitura
para o processo; não embutir credenciais na imagem Docker.

A integração do carregamento de ElevenLabs, acesso da conta, voz, preços e hosts
de saída continua responsabilidade do host. Usar os controles reais de autenticação
e carteira, não um saldo separado. `allowedHeyGenOutputHosts` exige destinos exatos
revisados, sem aceitar qualquer hostname do navegador. Downloads reaproveitam
TLS/DNS público fixado e rejeitam redirects e endereços privados.

Ainda falta antes da ativação do chat: montagem sobre server.js reconciliado, cartão
de aprovação e entrega, conciliação, teste real autorizado e atualização/rollback
da mesma imagem de produção. O cadastro não substitui essas etapas.

## Testes reproduzíveis

No diretório `app`, com as dependências do lockfile:

```sh
node --test --test-concurrency=1 scripts/test-lia-heygen.mjs scripts/test-lia-heygen-flow.mjs scripts/test-lia-postproduction.mjs scripts/test-lia-video-audio-editing-plan.mjs
```

Na raiz, testes de arquivos root-only:

```sh
sudo -H python3 ops/lia-heygen/test-configure-heygen.py
```

HTTP de ElevenLabs e HeyGen é simulado; arquivos, FFmpeg, ffprobe, Express e SQLite
nos testes de fluxo são reais. Mídia é artificial: tom de áudio e quadros cinza.
Os 41 testes unitários HeyGen e 27 de configuração passaram localmente. O ambiente
local desta entrega não dispõe de Express/better-sqlite3 ou Docker; fluxo e regressões
são executados no GitHub Actions. O resultado de CI deve ser consultado na revisão
exata antes de alegar aprovação. O teste de 60s usa seis trechos de 10s. O planejador
atual aceita projetos com pelo menos 10s, não 5s; corrigiu-se a fixture inicial que
violava essa regra sem enfraquecer a validação de produção.

## Documentação oficial verificada em 2026-09-21

- https://developers.heygen.com/reference/get-current-api-key
- https://developers.heygen.com/docs/api-key-permissions
- https://developers.heygen.com/reference/upload-asset
- https://developers.heygen.com/reference/create-lipsync
- https://developers.heygen.com/reference/get-lipsync

Não há chamada paga real nem implantação em produção nesta entrega.
