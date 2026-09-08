# Web Stories editoriais

Implementação inicial: **artigos internos publicados**. Não gera automaticamente histórias de produtos ou cursos, não usa IA, não publica em lote e não envia URLs ao Google.

## Fluxo

`/admin-web-stories` → escolher artigo → montar rascunho → editar páginas → salvar/abrir prévia → percorrer páginas → confirmar revisão e direitos → publicar.

- Autenticação administrativa e `sameOriginOnly` em todas as alterações; prévia também autenticada, `noindex,nofollow`, sem cache.
- Um rascunho por artigo; máximo de 200 histórias e 4–40 páginas. O modelo mantém todas as palavras do corpo do artigo. Textos longos são rejeitados, nunca cortados silenciosamente. Cada página permite até 130 caracteres, além da identificação e paginação.
- Textos de páginas, descrição acessível e imagem podem ser editados e reordenados. Só a última página tem CTA opcional, limitado ao artigo original e às fontes. Não há links externos ou anúncios afiliados neste primeiro fluxo.
- O botão “Escolher imagem” abre uma galeria com miniaturas e busca por assunto. Mostra apenas capas de artigos publicados e imagens editoriais/receitas distribuídas com o site; não enumera uploads privados. A aplicação a todas as páginas exige uma opção explícita. Endereço manual fica em “Opção avançada”. A capa genérica da cidade aparece identificada para o revisor escolher uma imagem relacionada ao assunto.
- Publicação exige prévia da mesma revisão e duas confirmações explícitas. Revisões otimistas impedem sobrescrita de outra aba. Uma publicação esperando imagens não desfaz uma retirada concorrente.
- Rascunho e snapshot publicado são separados. Se o artigo for alterado, é necessário recriar/revisar o rascunho; o snapshot anterior permanece. Se o artigo deixar de estar publicado, a história sai da navegação, página pública e sitemaps (cache público máximo de 60 segundos; sitemap geral mantém seu cache existente de 300 segundos).
- A revisão humana deve confirmar narrativa completa, qualidade, contexto e direitos. Validação técnica não verifica a veracidade nem concede licença de imagem.

## Formato e imagens

`/stories/:slug` renderiza AMP Story com canonical próprio, metadados, JSON-LD, imagem de capa 3:4, logo, texto sem HTML e páginas estáticas acessíveis. `/stories` é a galeria pública. As rotas AMP definem `res.locals.vcAmpStory=true`, impedindo a injeção de scripts comuns, PWA e anúncios pelo middleware. O build de HTML estático já ignora arquivos administrativos; AMP é gerado dinamicamente.

As imagens são locais em `/assets/`, `/uploads/store-assets/` ou `/uploads/generated-videos/`, JPEG/PNG/WebP, até 8 MB e 40 milhões de pixels, pelo menos 640 pixels em cada lado. Caminhos remotos, escapes de diretório e symlinks para fora da raiz são recusados. Metadados de dimensões são lidos no servidor. O FFmpeg já presente no Docker recorta a imagem da primeira página para uma capa JPEG 900×1200 em `DATA_DIR/web-stories`; não estica a imagem nem insere texto nela. URLs da capa usam hash do conteúdo. Processo sem shell, apenas protocolo local, limite de 20 segundos e duas conversões simultâneas. É preciso revisar o recorte na prévia.

URLs absolutas são aceitas somente quando a origem normalizada coincide exatamente com `SITE_URL`, sem credenciais, consulta, fragmentos ou escapes de caminho. Elas são convertidas em caminhos locais antes da leitura e da gravação. Domínios alternativos, inclusive `www` se não for a origem configurada, permanecem bloqueados.

Auditoria somente de dados públicos em 08/09/2026: a amostra de 18 artigos de `/api/discover` retornou 10 referências à capa genérica `/assets/vitriny-city-master.jpg` e 8 capas `/uploads/generated-videos/editorial-*.png`. Todos os 9 arquivos distintos responderam 200 a HEAD; os PNGs tinham 2,0–3,5 MB. Leitura limitada dos cabeçalhos confirmou JPEG 1672×941 na capa genérica e PNG 1822×1024 numa capa editorial. Não se leu conta, banco privado ou artigo não publicado, nem se publicou qualquer conteúdo real. Não foi observado `/uploads/editorial`; o gerador existente também grava em `generated-videos`, portanto não se ampliou a permissão para um diretório não confirmado.

Tabelas novas e aditivas: `editorial_web_stories` (rascunho, snapshot, revisões) e `editorial_web_story_events` (auditoria administrativa). Nenhum dado existente é migrado ou publicado automaticamente. Os arquivos de capas não são removidos na retirada, para preservar referências a snapshots; limpeza futura deverá respeitar as histórias que os usam.

## Google / Search Console

- Publicações entram em `/sitemap-stories.xml`, no sitemap geral existente e no índice `/sitemap-index.xml`; `lastmod` usa a publicação real da versão. `robots.txt` declara o sitemap específico.
- É possível enviar o índice de sitemaps manualmente no Search Console e inspecionar o endereço da história. O painel não envia nada e não usa a Indexing API.
- O filtro de aparência Web Stories depende de dados de impressão, conforme a documentação. Não há garantia de indexação/exibição nem afirmação de que a propriedade atual já possui esse relatório.

Fontes oficiais consultadas em 08/09/2026:

- https://developers.google.com/search/docs/appearance/enable-web-stories
- https://developers.google.com/search/docs/appearance/web-stories-creation-best-practices
- https://developers.google.com/search/docs/appearance/web-stories-content-policy
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://amp.dev/documentation/components/amp-story
- https://amp.dev/documentation/components/amp-story-page-outlink
- https://support.google.com/webmasters/answer/17011259?hl=en
- https://support.google.com/webmasters/answer/9012289?hl=en

## Validação

`node --test scripts/test-web-stories.mjs scripts/test-web-story-image-picker.mjs` cobre autenticação/CSRF, privacidade do rascunho/prévia, revisão obrigatória, snapshots, fonte alterada/retirada, XSS/URLs, normalização da origem, conteúdo mínimo, concorrência, sitemaps, dimensões reais de arquivos locais e seletor visual. O seletor tem casos de seleção, aplicar a todas, fechamento, catálogo vazio e resposta atrasada descartada. São 17 cenários, incluindo o teste opcional com FFmpeg.

Para verificar também o preparo real de imagem, defina `WEB_STORY_FFMPEG_TEST=1` com `ffmpeg` no PATH. Esse cenário foi executado localmente e passou: saída JPEG 900×1200, reaproveitada pelo hash. A fixture e todos os dados ficam em diretório temporário e não são publicados.

Para reproduzir a validação AMP, defina `WEB_STORY_VALIDATOR_FIXTURE` com um caminho de arquivo temporário ao executar os testes e depois execute `npx --yes --package=amphtml-validator amphtml-validator --format=text <arquivo>`. O validador oficial atual retornou **PASS** na fixture gerada. A ferramenta é apenas de verificação e não foi adicionada às dependências da aplicação.

Ainda requer revisão visual móvel/desktop e teste de ponta a ponta com sessão administrativa no ambiente integrado antes da disponibilização. Não houve deploy nem envio ao Google por esta implementação.
