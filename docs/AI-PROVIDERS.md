# Seleção de provedores de IA

Para usar a chave OpenAI já cadastrada sem remover a chave OpenRouter:

```dotenv
AI_TEXT_PROVIDER=openai
AI_MEDIA_PROVIDER=openai
OPENAI_DIRECT_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=gpt-image-2
```

`auto` ou variável ausente preserva a escolha anterior. Seleção explícita inválida, chave ausente ou modelo incompatível bloqueiam a operação; não há troca silenciosa para outro provedor. Credenciais ficam no servidor e cada chave só pode ser enviada ao seu próprio domínio.

| Fluxo | Com seleção OpenAI |
| --- | --- |
| IA Gestora, atendimento, agentes, sínteses e serviços | Responses API direta, modelo de texto configurado, `store:false` |
| Artigos, revisão editorial, planos e capítulos de livros | Mesmo cliente de texto, sem fallback OpenRouter |
| Capas editoriais e Web Stories | Image API direta; preserva o validador existente de imagens |
| Capas e ilustrações de livros; Fábrica Neural | Image API direta pelo adaptador de mídia |
| Novos vídeos e script manual de anúncio | Indisponíveis; nenhuma solicitação ao OpenRouter |
| Jobs antigos de vídeo e imagem | Origem preservada; sem reenvio ou consulta no provedor novo |
| Vídeos e imagens já gerados/publicados | Arquivos, recibos de publicação e distribuição existentes preservados |
| Consulta de crédito OpenRouter | Não executada com mídia OpenAI; o painel não infere saldo OpenAI |

As únicas migrações acrescentam `video_provider` em `viral_quiz_scenes` e `video_provider`/`image_provider` em `admin_media_projects`, com padrão `openrouter` para as linhas existentes. Nenhum job é recriado, liberado ou convertido. Novos roteiros de vídeo podem ser preparados, mas a aprovação para geração fica bloqueada enquanto o vídeo estiver indisponível.

O painel distingue **configurada** de resultado observado. O histórico de saúde registra operações de texto e imagem por provedor no processo atual; presença de chave não comprova conexão ou sucesso. As mudanças não ativam outros contêineres, filas ChatbotX ou fallback externo do modelo Neural local.

Limitação de vídeo: a OpenAI anunciou encerramento da API Sora em 24/09/2026, sem substituto indicado. Esta integração não cria novas gerações Sora. Referências oficiais: [descontinuações](https://developers.openai.com/api/docs/deprecations#2026-03-24-sora-2-video-generation-models-and-videos-api) e [parâmetros de imagens](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output).

Validação usa respostas simuladas, banco temporário e bloqueio de rede externa nos testes de servidor. Testes não enviam mensagens nem geram mídia paga. A verificação de texto real já autorizada foi uma única solicitação sintética; disponibilidade dos modelos de imagem foi consultada somente por GET. Não há geração real de imagem/vídeo validada nesta mudança.
