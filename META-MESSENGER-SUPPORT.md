# Atendimento Facebook e Messenger

Em 12/09/2026, a auditoria encontrou o aplicativo Meta ainda não publicado, zero eventos recebidos e ausência de assinatura `messages`. O aplicativo VitrineCity Gestora foi publicado no painel da Meta. Um comentário explicitamente identificado como teste recebeu resposta privada, agradecimento público e curtida, com os três recibos confirmados. Isso valida essa interação; não substitui a análise de permissões para todos os usuários e casos de uso.

## Messenger

`facebook-messenger.js` recebe mensagens de texto de `entry.messaging` somente depois da validação de assinatura do webhook compartilhado. Seleciona contas explicitamente, confirma a Página destinatária e o PSID remetente, ignora ecos e recibos e deduplica pelo identificador original da mensagem. Anexos sem texto não são interpretados como perguntas.

A configuração começa desativada e é independente dos comentários: `GET/PUT /api/admin/facebook-messenger`, com autenticação administrativa e mesma origem. `configure({enabled, autoReply, accountIds})` usa a mesma validação para operações autorizadas. A seleção admite uma conexão por Página e não altera conexões antigas.

O atendimento automático funciona em qualquer horário, limitado a 30 tentativas diárias no total e à janela de 24 horas da mensagem recebida. Usa histórico curto da própria conversa e somente links de conteúdo confirmado. A pausa global, a seleção de contas, a recusa da pessoa e a disponibilidade do conteúdo são revalidadas antes do envio.

A Send API usa `/{page-id}/messages`, `recipient.id` e `messaging_type: RESPONSE`. O recibo deve conter `message_id` e o `recipient_id` correto. Tentativas são reservadas antes do POST; resultados incertos permanecem retidos sem reenvio automático. A recuperação de interrupções é chamada explicitamente apenas na inicialização do servidor, nunca ao abrir a configuração.

## Operação e limites

- Assinar `messages` no aplicativo e nas Páginas selecionadas, preservando os campos existentes e o callback `/api/webhooks/social`.
- Manter a aprovação do atendimento antigo independente. A ativação do Messenger não libera campanhas de comentários sem revisão do conteúdo correspondente.
- As campanhas de comentários existentes continuam vinculadas a publicações específicas; não respondem retroativamente a todos os comentários antigos.
- Instagram Direct exige sua própria permissão e integração; habilitar Messenger não habilita Instagram Direct.
- Publicação do app, permissão no token e recibo de um teste são evidências diferentes. A avaliação de acesso avançado pela Meta não é aprovada pelo código da VitrineCity.

## Validação

`npm run test:facebook-messenger` cobre normalização, assinatura, destinatário, duplicidade, pausa, janela, confirmação de envio, recuperação de interrupções, contexto, catálogo e controles administrativos. Também integra `npm run test:social-comment-campaigns` e o teste geral. Os testes usam provedores simulados; os comprovantes operacionais devem registrar separadamente os envios reais.
