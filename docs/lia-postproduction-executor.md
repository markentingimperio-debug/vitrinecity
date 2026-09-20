# LIA: executor de voz, sincronização e edição

## Estado desta entrega

Implementação executável, opt-in e sem ativação automática. O import não chama APIs.
Não é mais somente o planejador do PR #217: o executor chama os contratos HTTP de
ElevenLabs e Sync, processa arquivos com FFmpeg/ffprobe reais, persiste o andamento
em SQLite e oferece endpoints autenticados para rascunho, aprovação, consulta,
cancelamento, prévia privada, legendas e revisão humana.

**Não foi publicado na VPS e não está montado no server.js nem no cartão do chat.**
A base do PR #217 ainda deriva do PR #216/main, não da imagem reconciliada em produção.
Por exemplo, `coin-wallet-adapter.js` da produção não existe nessa base. Não execute
um checkout de main para integrar esta extensão. O módulo `setup.mjs` é o ponto de
ligação, a ser chamado somente depois de reconciliar a aplicação e a carteira.

## O que executa

1. Recebe o roteiro aprovado por cena, duração, idioma, voz e cenas já produzidas.
2. Confere autorização da conversa, dono dos arquivos e licença da voz.
3. Copia as cenas para diretório privado, vincula hashes ao orçamento e não gasta
   com o simples rascunho. A leitura não cria outro job nem reserva outra quota no
   Studio do PR #216.
4. Após aprovação exata e reserva única, gera voz no ElevenLabs com timestamps,
   `language_code=pt`/`en`, mesma voz e contexto anterior/seguinte.
5. Mede áudio com ffprobe. Fala longa pede revisão: não é cortada nem acelerada.
6. Normaliza cena e áudio; usa o Sync apenas para cenas com um personagem visível
   previamente aprovado. Upload direto privado de arquivos menores que 20 MB.
7. Salva o identificador Sync antes de consultar o resultado. Recomeçar o processo
   não dispara outro POST. Resposta de POST desconhecida fica em conferência.
8. Remuxa a voz aprovada, concatena cenas, grava legendas opcionais e exporta MP4.
9. Confere duração, dimensões, streams, decodificação e áudio não inteiramente mudo.
10. Devolve prévia privada para revisão humana de idioma, texto, personagem e boca.

O teste de 60 segundos utiliza seis cenas de 10 segundos e entrega um arquivo.
O executor aceita até 60 cenas nesta versão; cada cena tem 1 a 15 segundos, segundo
o contrato do planejador. Não promete que qualquer gerador aceite todas essas durações.
A ponte do Studio usa as cenas existentes; **não implementa um novo gerador visual**.

## Componentes

- `providers.mjs`: ElevenLabs timestamps; Sync multipart/poll; download HTTPS com
  host permitido exato, DNS público IPv4 fixado, sem redirecionamento ou credenciais.
- `media.mjs`: arquivos privados, hashes, ffprobe, normalização, áudio, legendas,
  montagem e verificação final. Sem shell ou filtro enviado pelo cliente.
- `executor.mjs`: SQLite, revisão imutável, reserva vinculada, lease, cancelamento,
  journal por etapa e prevenção de repetição paga.
- `http.mjs`: endpoints sob `/api/neural/chat/postproduction`; sessão existente,
  mesma origem, marcador CSRF, isolamento de usuário e suporte a Range no MP4.
- `studio-source.mjs`: consulta `lia_video_jobs`/`lia_video_scenes` do PR #216 por
  dono e cena `scene_1`, `scene_2` etc.; não gera novos clipes.
- `coin-billing.mjs`: adapta a carteira canônica já existente na produção. Não
  concede saldo e não cria outra carteira. Orçamento em micro-BRL, inteiros.
- `setup.mjs`: composição das dependências, inerte por padrão, sem ler chaves do chat.

## Integração no host

Usar `setupLiaVideoPostProduction` com o app, SQLite, middlewares de autenticação,
carteira canônica da instalação reconciliada, pasta de cenas, pasta privada,
política de acesso da conta/conversa e perfis de voz autorizados no servidor.
Somente o host pode fornecer credenciais, tarifas e a lista de destinos de download.
Nenhum endpoint aceita esses valores do navegador.

`setup.start()` inicia o worker com passos persistidos. `await setup.close()` é
necessário no shutdown antes de fechar o SQLite. O cartão do chat pode recuperar
os projetos por `GET /api/neural/chat/postproduction?conversationId=...`, sem reenviar.
Não foi alterado o frontend existente nesta entrega.

### Configuração necessária para um piloto real

- ELEVENLABS_API_KEY e SYNC_API_KEY armazenadas de forma privada pelo host.
- Perfil ElevenLabs licenciado, voiceId válido, modelo Flash v2.5 ou Turbo v2.5,
  idiomas e contas autorizados. Não usar Multilingual v2 com promessa de que
  `language_code` é aplicado: a documentação informa que ele não o suporta.
- Revisão humana de uma pessoa visível por cena antes de lip sync. Não há detector
  facial implementado. Animais, perfis obstruídos e grupos não têm garantia de boca.
- Hosts de saída realmente usados pela conta Sync, revisados individualmente.
  Lista vazia bloqueia download; não liberar qualquer domínio para contornar erro.
- FFmpeg/ffprobe atualizados, libx264/libass/AAC e fonte instalada localmente.
- Recursos/limites de disco e retenção avaliados antes de abrir para assinantes.
  Esta versão limita rascunhos ativos por conta, não substitui quotas de armazenamento.

### Custos e reservas

O host fornece tarifas-teto em micro-BRL: `speechMicroBrlPer1000Chars`,
`syncMicroBrlPerSecond`, `editingMicroBrl`, `version` e `reviewedAt` com até 7 dias.
Não existe preço de assinatura hard-coded nem câmbio inventado.

Reserva usa a carteira existente em transação SQLite. Antes de cada etapa o
executor reconfere autorização da reserva. Cancelamento sem nenhum POST registrado
libera a reserva. Havendo envio pago, inclusive resposta perdida ou cancelamento,
a reserva fica `held` para conciliação. Também fica em conferência após a entrega
até que os custos sejam comprovados: **esta entrega não implementa conciliação
financeira automática por fatura de ElevenLabs/Sync**. Não usar a tabela de preços
como se fosse recibo de consumo nem restaurar saldo automaticamente após consumo.

O serviço não consome novamente os minutos do PR #216. Definir antes da integração
se a pós-produção está incluída no plano ou se requer cotação separada, para não
cobrar duas vezes pelo mesmo escopo contratado.

## Estados e limites

`draft -> queued -> working / waiting_sync -> ready_for_review -> completed`.
Erros, recibos desconhecidos ou fala longa: `review_required`. Cancelamento:
`cancelled`. Respostas e códigos de erro não expõem tokens, caminhos ou URLs privadas.
O endpoint de revisão registra aceitação humana, sem fingir validação automática.
Não existe postagem automática nem autorização de publicação nesta extensão.

Não há retry automático de POST pago, mesmo que o provedor devolva erro. Polling
usa o ID registrado. Uma recuperação com recibo desconhecido exige conciliação
operacional, ainda sem interface administrativa nesta versão.

## Testes

No diretório app:

```sh
node --test --test-concurrency=1 scripts/test-lia-postproduction.mjs
node --test scripts/test-lia-video-audio-editing-plan.mjs
```

Testes locais usam Express, better-sqlite3, FFmpeg e ffprobe reais; HTTP de provedor
simulado, mídia artificial e ausência de chaves reais. A saída de áudio de teste é
um tom, NÃO uma validação de fala natural, português, sincronização labial real ou
identidade consistente do personagem. Os testes HTTP usam servidor local, não VPS.

## Fontes de contratos consultadas em 2026-09-20

- https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- https://sync.so/docs/api-reference/api/generate-api/create-with-files
- https://sync.so/docs/api-reference/api/generate-api/get
- https://sync.so/docs/developer-guides/sync-mode
- https://ffmpeg.org/ffmpeg-filters.html

Uma implantação de produção ainda exige reconciliar o host atual, ligar a interface,
configurar o piloto, passar CI e validar geração real autorizada. Não há instalador
que troque a VPS neste pacote. Nenhum dos comandos de testes acima publica o site.
