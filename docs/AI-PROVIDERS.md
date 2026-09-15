# Seleção de provedores de IA

Para usar a chave OpenAI já cadastrada sem remover a chave OpenRouter:

```dotenv
AI_TEXT_PROVIDER=openai
AI_MEDIA_PROVIDER=openai
OPENAI_DIRECT_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=gpt-image-2
AI_VIDEO_PROVIDER=kling_studio
KLING_HOME=/var/lib/vitrinecity-kling
KLING_VIDEO_MODEL=kling-video-v3_0
# A conexão OAuth do Kling fica em um volume privado, fora do repositório.
```

`auto` ou variável ausente preserva a escolha anterior. Seleção explícita inválida, chave ausente ou modelo incompatível bloqueiam a operação; não há troca silenciosa para outro provedor. Credenciais ficam no servidor e cada chave só pode ser enviada ao seu próprio domínio.

| Fluxo | Com seleção OpenAI |
| --- | --- |
| IA Gestora, atendimento, agentes, sínteses e serviços | Responses API direta, modelo de texto configurado, `store:false` |
| Artigos, revisão editorial, planos e capítulos de livros | Mesmo cliente de texto, sem fallback OpenRouter |
| Capas editoriais e Web Stories | Image API direta; preserva o validador existente de imagens |
| Capas e ilustrações de livros; Fábrica Neural | Image API direta pelo adaptador de mídia |
| Novos vídeos manuais | Kling Studio quando `AI_VIDEO_PROVIDER=kling_studio` e a conexão OAuth for verificada; sem OpenRouter |
| Fábrica viral automática | Bloqueada para Kling antes de consultar a fila, aprovar ou reservar uma geração; não consome créditos |
| Script legado de anúncio de 30 s | Bloqueado para Kling; a primeira versão usa apenas clipes manuais no painel administrativo |
| Jobs antigos de vídeo e imagem | Origem preservada; sem reenvio ou consulta no provedor novo |
| Vídeos e imagens já gerados/publicados | Arquivos, recibos de publicação e distribuição existentes preservados |
| Consulta de crédito OpenRouter | Não executada com mídia OpenAI; o painel não infere saldo OpenAI |

As migrações anteriores de mídia acrescentaram `video_provider` em `viral_quiz_scenes` e `video_provider`/`image_provider` em `admin_media_projects`, com padrão `openrouter` para as linhas existentes. Kling reutiliza esses campos, sem nova migração. Nenhum job é recriado, liberado ou convertido. Novos roteiros de vídeo podem ser preparados, mas a aprovação para geração fica bloqueada enquanto o vídeo estiver indisponível.

O painel distingue **configurada** de resultado observado. O histórico de saúde registra operações por provedor no processo atual; presença de configuração não comprova conexão ou sucesso. Para Kling, `kling_studio_account` registra a verificação de conta e `kling_studio_video` registra as operações de vídeo. As mudanças não ativam outros contêineres, filas ChatbotX ou fallback externo do modelo Neural local.

## Kling Studio: conexão persistente e geração manual

A integração usa o cliente oficial `@klingai/cli-global`, fixado em `0.2.0`, e OAuth/MCP do Kling Studio. Esse caminho consome créditos pagos do Studio; ele não usa as unidades nem as credenciais da API empresarial. A autenticação é feita previamente pelo operador no CLI oficial. O servidor não abre login e não recebe senha, access key ou secret key pelo painel. Referência: [guia oficial do Kling MCP](https://kling.ai/app/mcp/guide).

O Compose monta o volume nomeado `kling_credentials` somente no serviço `app`, em `/var/lib/vitrinecity-kling`. No projeto Compose de produção `vitrinecity`, o volume é `vitrinecity_kling_credentials`. Configure `KLING_HOME` com esse caminho absoluto. A conexão OAuth autenticada deve ser provisionada pelo operador nesse volume, com diretório privado (`0700`) e arquivos de credencial privados (`0600`). Não copie o conteúdo para o Git, `.env`, imagem Docker, logs ou diretório público. O volume precisa permitir escrita para renovar a conexão e serializar o uso do CLI; recriar a aplicação preserva a conexão. Não remova esse volume durante uma atualização ou reversão.

Esta primeira versão permite apenas um clipe de texto para vídeo por ação explícita de um administrador. O modelo é `kling-video-v3_0`, em 1080p, sem áudio, uma saída e sem múltiplas cenas automáticas. O padrão é **5 segundos**, com estimativa de **40 créditos pagos** (8 créditos por segundo); o servidor aceita durações inteiras de **3 a 15 segundos** e formatos 9:16, 16:9 ou 1:1. O painel oferece durações compatíveis. Roteiros maiores precisam ser divididos e revisados antes de pedir clipes; não são reduzidos silenciosamente.

A configuração não libera a fila viral existente. O worker retorna antes de ler ou reservar jobs; aprovação viral e projetos vinculados a essa fila são bloqueados. A rota manual exige autenticação administrativa, projeto elegível, parâmetros válidos e consulta de conta antes de reservar a geração. O adaptador confirma novamente conta, capacidades e saldo antes do único comando pago. Não há orçamento diário nem geração automática habilitada para Kling.

`GET /api/admin/media-factory` consulta identidade, capacidades e saldo sem gerar vídeo. O painel mostra conexão observada, saldo informado e custo estimado. O campo de origem `availableRemainCredits` não discrimina créditos pagos e promocionais; por isso `usablePaidCredits` permanece `null` quando essa informação não está disponível. Um saldo total mostrado não comprova que todo ele seja utilizável pelo MCP. O provedor decide a elegibilidade final; saldo insuficiente ou conexão expirada bloqueiam a operação.

Cada pedido guarda o `generationId` original e um marcador de consulta ligado à conta, sem tokens. Consultar ou baixar exige a mesma identidade OAuth; trocar a conta não converte recibos existentes. O marcador `https://kling.ai/mcp#...` identifica o job localmente e nunca é usado como URL HTTP de polling. Falha incerta de criação exige reconciliação do recibo, sem reenviar automaticamente um comando pago. Uma trava abandonada após queda do processo só pode ser removida pelo operador depois de verificar que o processo anterior terminou.

Antes da liberação, verifique sem gerar: imagem da aplicação contém a versão fixada do CLI; volume correto está montado apenas no app; conta e capacidades são reconhecidas; texto e imagens continuam na OpenAI; `videoManualOnly` é verdadeiro; o worker viral não reservou jobs. O teste pago de um clipe é uma ação separada e explícita. Configuração, conexão verificada e vídeo concluído são estados distintos.

## Google Veo e recibos anteriores

Google Veo usa uma seleção independente das imagens: `AI_VIDEO_PROVIDER=google`. A chave Gemini não é usada para texto nem imagens. O padrão é `veo-3.1-lite-generate-preview`, com 720p, áudio sempre ativo, orientação 9:16 ou 16:9 e duração de 4, 6 ou 8 segundos. Vídeos maiores precisam de cenas compatíveis e montagem; não se envia um pedido de 30 ou 65 segundos ao Google. A API exige acesso e faturamento próprios; presença de chave ou assinatura Flow não comprova disponibilidade. Referência: [Veo API](https://ai.google.dev/gemini-api/docs/veo).

No Google, cada criação faz um único POST e persiste a operação original. Cada consulta faz um único GET da mesma operação. Falha incerta de submissão não provoca reenvio pago. Downloads validam origem, redirecionamentos, endereço público, limite de bytes e assinatura MP4; a chave só acompanha a requisição ao domínio oficial da API. Selecionar Google ou Kling não converte nem reenvia jobs de outro provedor. Os campos de origem e IDs antigos Google/OpenRouter permanecem preservados. `AI_VIDEO_PROVIDER=disabled` desativa novas gerações; `auto` herda o provedor de imagens. A mídia OpenAI continua sem geração de vídeo Sora.

Validação automática usa respostas simuladas, banco temporário e bloqueio de rede externa nos testes de servidor. Em produção, em 10/09/2026, a IA Gestora respondeu usando OpenAI e consultou uma página pública; a Editora Digital retomou a fila já habilitada e gerou 12 capas PNG válidas, todas mantidas em revisão. A geração real Google Veo ainda depende da verificação de acesso da conta e de um vídeo de teste concluído. A publicação da integração Kling deve verificar separadamente a conexão do volume de produção e o resultado de um clipe autorizado; testes simulados não comprovam consumo nem conclusão reais.

## Grupo de orações e distribuição comercial

O convite público confirmado fica em `app/public/oracao-do-dia-config.js`, no campo `PRAYER_PAGE_CONFIG.groupInviteUrl`; não depende de variável de ambiente nem solicita cadastro na página. O botão abre somente um convite HTTPS de `chat.whatsapp.com`. A participação é voluntária e a página informa a visibilidade de nome e telefone entre participantes.

Configure os JIDs privados dos grupos reservados em `WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS`, separados por vírgula, somente no ambiente privado. A lista exclui esses grupos do catálogo de destinatários comerciais, das prévias/publicações de produtos, da campanha de sitemap e dos agendamentos genéricos. Antes de reservar um envio, o worker cancela apenas agendamentos ainda pendentes para os grupos excluídos; envios históricos, recibos e submissões incertas são preservados. Uma lista malformada bloqueia a distribuição comercial até ser corrigida. A configuração não altera conversas nem impede o operador de enviar orações manualmente pelo WhatsApp. O convite público e o JID privado são identificadores distintos; não deduza um do outro.
