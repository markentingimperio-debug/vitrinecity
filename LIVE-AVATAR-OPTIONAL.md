# LiveAvatar: configuração opcional, fora do atendimento

Estado em 12/09/2026: **não conectado à VitrineCity e não ativado**. A direção do trabalho mudou para buscar uma alternativa mais econômica. Nenhuma conta foi contratada, chave real configurada, sessão iniciada ou crédito consumido por este módulo.

- `app/live-avatar-admin.js` não está importado nem registrado em `server.js`. Importar o arquivo isoladamente também não faz rede. O schema local só é criado se a factory for chamada.
- Os modelos do painel estão em `app/optional-integrations/live-avatar/`, fora do diretório público. `/admin-live-avatar.html` e `/api/admin/live-avatar/*` **não são rotas implementadas no servidor atual**.
- Não existe SDK, vídeo, microfone, token de sessão, transmissão ou ligação ao widget público. Um contexto salvo no site do provedor ou o login por Google não equivale a esta conexão API.

O código opcional permite, se uma retomada for autorizada, registrar configuração administrativa protegida com a criptografia existente da plataforma. Preserva a chave anterior quando o campo é deixado vazio, exige revisão atual para salvar e nunca devolve a chave. A consulta explícita utiliza somente GETs fixos oficiais: créditos, avatar, contexto e voz. Não usa endpoints de sessão, embed, geração ou cobrança. Resultado antigo não sobrescreve uma configuração alterada; consultas simultâneas/seguidas respeitam reserva e intervalo locais.

Uma eventual montagem exige importar `setupLiveAvatarAdmin` com os middlewares reais `requireAdmin` e `sameOriginOnly`, `encryptSocialToken`/`decryptSocialToken`, adicionar as páginas à proteção administrativa antes de servi-las e copiar deliberadamente os modelos para o diretório público. Os IDs reais e a chave devem vir da conta escolhida. A transmissão e seu orçamento precisam de implementação e testes próprios antes de ativar atendimento; os indicadores deste módulo sempre mantêm `liveEnabled:false`, `transmission:'not_tested'` e `sessionStarted:false`.

Verificação isolada: `node --test scripts/test-live-avatar-admin.mjs`, com banco em memória, AES-GCM real, servidor HTTP local e respostas fictícias do provedor. Não demonstra compatibilidade ao vivo com uma conta real nem qualidade de voz/transmissão.

Documentação oficial consultada: [OpenAPI](https://docs.liveavatar.com/openapi.json), [ciclo da sessão FULL](https://docs.liveavatar.com/docs/full-mode/lifecycle), [eventos de fala](https://docs.liveavatar.com/docs/full-mode/events) e [sandbox](https://docs.liveavatar.com/docs/sandbox-mode). O sandbox oficial usa um avatar de demonstração por aproximadamente um minuto; ele não substitui a identidade da Lia e não foi iniciado aqui.
