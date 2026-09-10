# Seleção de provedores de IA

Para usar a chave OpenAI já cadastrada sem remover a chave OpenRouter:

```dotenv
AI_TEXT_PROVIDER=openai
AI_MEDIA_PROVIDER=openai
OPENAI_DIRECT_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=gpt-image-2
AI_VIDEO_PROVIDER=google
GOOGLE_VIDEO_MODEL=veo-3.1-lite-generate-preview
# Configure GEMINI_API_KEY somente no ambiente privado do servidor.
```

`auto` ou variável ausente preserva a escolha anterior. Seleção explícita inválida, chave ausente ou modelo incompatível bloqueiam a operação; não há troca silenciosa para outro provedor. Credenciais ficam no servidor e cada chave só pode ser enviada ao seu próprio domínio.

| Fluxo | Com seleção OpenAI |
| --- | --- |
| IA Gestora, atendimento, agentes, sínteses e serviços | Responses API direta, modelo de texto configurado, `store:false` |
| Artigos, revisão editorial, planos e capítulos de livros | Mesmo cliente de texto, sem fallback OpenRouter |
| Capas editoriais e Web Stories | Image API direta; preserva o validador existente de imagens |
| Capas e ilustrações de livros; Fábrica Neural | Image API direta pelo adaptador de mídia |
| Novos vídeos | Google Veo direto quando AI_VIDEO_PROVIDER=google e GEMINI_API_KEY estiver configurada; sem OpenRouter |
| Script manual de anúncio | Mesmo provedor selecionado; duração incompatível bloqueada antes de enviar |
| Jobs antigos de vídeo e imagem | Origem preservada; sem reenvio ou consulta no provedor novo |
| Vídeos e imagens já gerados/publicados | Arquivos, recibos de publicação e distribuição existentes preservados |
| Consulta de crédito OpenRouter | Não executada com mídia OpenAI; o painel não infere saldo OpenAI |

As únicas migrações acrescentam `video_provider` em `viral_quiz_scenes` e `video_provider`/`image_provider` em `admin_media_projects`, com padrão `openrouter` para as linhas existentes. Nenhum job é recriado, liberado ou convertido. Novos roteiros de vídeo podem ser preparados, mas a aprovação para geração fica bloqueada enquanto o vídeo estiver indisponível.

O painel distingue **configurada** de resultado observado. O histórico de saúde registra operações de texto e imagem por provedor no processo atual; presença de chave não comprova conexão ou sucesso. As mudanças não ativam outros contêineres, filas ChatbotX ou fallback externo do modelo Neural local.

Google Veo usa uma seleção independente das imagens: `AI_VIDEO_PROVIDER=google`. A chave Gemini não é usada para texto nem imagens. O padrão é `veo-3.1-lite-generate-preview`, com 720p, áudio sempre ativo, orientação 9:16 ou 16:9 e duração de 4, 6 ou 8 segundos. Vídeos maiores precisam de cenas compatíveis e montagem; não se envia um pedido de 30 ou 65 segundos ao Google. A API exige acesso e faturamento próprios; presença de chave ou assinatura Flow não comprova disponibilidade. Referência: [Veo API](https://ai.google.dev/gemini-api/docs/veo).

Cada criação faz um único POST e persiste a operação original. Cada consulta faz um único GET da mesma operação. Falha incerta de submissão não provoca reenvio pago. Downloads validam origem, redirecionamentos, endereço público, limite de bytes e assinatura MP4; a chave só acompanha a requisição ao domínio oficial da API. Selecionar Google não converte nem reenvia jobs OpenRouter anteriores. `AI_VIDEO_PROVIDER=disabled` desativa novas gerações; `auto` herda o provedor de imagens. Sem seleção Google, a mídia OpenAI continua sem geração de vídeo Sora.

Validação automática usa respostas simuladas, banco temporário e bloqueio de rede externa nos testes de servidor. Em produção, em 10/09/2026, a IA Gestora respondeu usando OpenAI e consultou uma página pública; a Editora Digital retomou a fila já habilitada e gerou 12 capas PNG válidas, todas mantidas em revisão. A geração real Google Veo ainda depende da verificação de acesso da conta e de um vídeo de teste concluído.
