# Busca integrada da Vitrine

A página `/pesquisar.html` reúne sites, vídeos, sugestões e negócios publicados. A página `/buscar.html` e suas APIs existentes permanecem disponíveis. Apenas o formulário da página inicial aponta para a nova busca.

## Funcionamento

- SearXNG privado consulta Google, Bing, DuckDuckGo, Yahoo, Brave, Qwant, Startpage, Mojeek, Wikipedia e YouTube. Uma fonte pode bloquear ou não responder; os resultados disponíveis continuam aparecendo com título, resumo, domínio e link direto de destino. A API conserva a origem técnica, mas a interface não exige escolher um buscador.
- Não usa OpenRouter, modelo de IA ou cobrança por consulta de IA. Consome recursos e banda da VPS; não garante disponibilidade de todos os buscadores.
- Sugestões externas e locais; resultados externos deduplicados, filtros de sites/vídeos, paginação e consultas relacionadas quando fornecidas pelas fontes.
- Página inicial e `/pesquisar.html` compartilham autocomplete com debounce de 220 ms e exibição progressiva: uma fonte lenta não bloqueia a outra. A primeira sugestão oficial precede até quatro expressões gerais disponíveis, evitando que produtos ocupem toda a lista.
- No celular, a lista é rolável e se posiciona na área visível acima ou abaixo do campo; toque, setas, Enter e Escape são suportados. Blur e nova digitação cancelam sugestões antigas; sem JavaScript, o formulário GET da página inicial continua disponível. Teste: `node app/scripts/test-search-autocomplete.mjs`.
- Busca local por termos sem acentos, cidade, lojas publicadas e produtos ativos. Avaliações verificadas influenciam a classificação; publicidade é separada.
- Cache em memória, limite por visitante, limite de consultas concorrentes, timeout e limite de tamanho da resposta. O serviço SearXNG não publica porta na internet. O texto pesquisado é enviado às fontes externas, inclusive nas sugestões.

## Configuração

Crie `.env.search` com permissão 600 e `SEARXNG_SECRET=` seguido de um segredo aleatório de pelo menos 32 bytes. Nunca publique esse arquivo. O arquivo `docker-compose.search.yml` é um complemento ao Compose existente:

```sh
docker compose -f docker-compose.yml -f docker-compose.search.yml up -d search
docker compose -f docker-compose.yml -f docker-compose.search.yml up -d --build --no-deps app
```

Para persistir o complemento nos comandos normais, instale-o como `docker-compose.override.yml` somente se não existir outro override. Caso exista, faça a mesclagem preservando a configuração anterior. Não substitua a configuração de produção pela do GitHub sem comparar as alterações locais.

## Validação e reversão

```sh
cd app
npm run test:search
npm test
node --check server.js
node --check public/search.js
```

Antes da implantação, copie os arquivos afetados e preserve a imagem atual do aplicativo. Não altere os volumes de dados. Suba e teste o buscador privado antes de atualizar o aplicativo. Verifique `/api/health`, página inicial, busca antiga, login, loja, produtos, mapa e nova busca com uma consulta real. Se a aplicação falhar, restaure os arquivos e a imagem anteriores. Falhas de uma fonte de pesquisa devem produzir resultados parciais ou links diretos, sem afetar as páginas existentes.

Os testes automatizados usam respostas controladas para validar falhas, cache e segurança. Não substituem o teste real dos provedores na VPS. Em 05/09/2026, a consulta real `como fazer bolo` retornou 39 resultados no serviço privado, com Bing, Brave e YouTube presentes e algumas fontes indisponíveis.

## Plataformas e redes

Resultados relevantes da Vitrine aparecem antes da web. Cursos ativos são incluídos automaticamente. Para indexar receitas, notícias, esportes e artigos próprios já publicados, ou ofertas de afiliado aprovadas, o catálogo opcional `/data/search-content.json` aceita uma lista com `title`, `description`, `keywords`, `kind`, `url` e `status: "published"`. Tipos: `recipe`, `news`, `sports`, `article`, `affiliate`. Conteúdos próprios devem usar caminhos públicos sob `/receitas/`, `/noticias/`, `/esportes/`, `/artigos/` ou `/conteudo/`; o catálogo não cria essas páginas. URLs afiliadas devem ser os links HTTPS legítimos da conta. A oferta recebe identificação de afiliado e `rel=sponsored`. Não há links ou afiliações fictícias cadastradas. O arquivo permanece no volume de dados e alterações válidas são recarregadas sem reiniciar.

Filtros Compras (Mercado Livre e Shopee), Redes sociais (Kwai, Instagram e TikTok) e seletor individual restringem a consulta aos domínios oficiais e filtram URLs retornadas. São resultados públicos indexados, não uma integração com catálogos privados, preços em tempo real ou feeds autenticados. Domínios parecidos de terceiros não passam pelo filtro. A interface apresenta o domínio de destino, não o nome do buscador intermediário.

## Rateio opcional de IA

Gemini, Groq e Cloudflare Workers AI podem explicar os trechos encontrados, somente quando o visitante pede. Não buscam páginas nem executam ferramentas. `/api/search/ai/status` informa se a função está configurada. Sem credenciais autorizadas, o botão fica oculto e nenhuma consulta de IA é feita.

No `.env` privado da VPS, configure `SEARCH_AI_GEMINI_KEY` e/ou `SEARCH_AI_GROQ_KEY` e confirme os provedores cujas contas permanecem no plano gratuito em `SEARCH_AI_FREE_PROVIDERS=gemini,groq`. Os padrões são Gemini 2.5 Flash Lite e Groq GPT OSS 20B. Confira disponibilidade e condições diretamente nas contas antes de habilitar. O software não consegue comprovar o plano de faturamento de uma chave; a ausência de cobrança depende também da configuração da conta no provedor. Não há cadastro, upgrade ou fallback pago automático.

Limites conservadores por dia: `SEARCH_AI_GEMINI_DAILY=20`, `SEARCH_AI_GROQ_DAILY=100`, ajustáveis à cota real. Distribuição proporcional à cota consumida, reserva persistida no SQLite antes da chamada, pausa após 429/erro, troca de provedor, cache de 10 minutos e no máximo 2 gerações concorrentes. Limites externos prevalecem. As contas não são multiplicadas para contornar quotas.

O pedido e até cinco trechos públicos são enviados ao provedor escolhido; o visitante recebe aviso antes de solicitar. Condições de retenção/treinamento dependem do plano do provedor. A resposta é exibida como texto, com links das fontes reais; pode conter erros. Credenciais, consultas e respostas não são registradas pelo módulo de IA. Apenas contadores diários persistem.

Validação do rateio: `npm run test:search` inclui fallback de 429, pausa, cache, limites por visitante, esgotamento diário, persistência após recriar o serviço e desativação sem confirmação do plano gratuito.

Referências: https://docs.searxng.org/dev/search_api.html e https://docs.searxng.org/admin/installation-docker

## Explorar sem perder a pesquisa (06/09/2026)

Vídeos e links de compartilhamento reconhecidos têm uma única ação de navegação: “Assistir no [fonte] · nova aba” ou “Abrir no [fonte] · nova aba”. O título desses resultados é texto, sem um segundo link para assistir. O navegador recebe um link nativo `target=_blank` com `rel="noopener noreferrer"`; a busca permanece na aba da VitrineCity. O navegador/dispositivo pode encaminhar a fonte para o aplicativo instalado. Não há player incorporado, confirmação intermediária nem consulta de elegibilidade para abrir vídeos.

Títulos de outros sites continuam sendo links diretos. “Prévia e relacionados” mostra apenas o trecho da busca; “Ler na Vitrine” abre conteúdo próprio permitido no visualizador com a logo fornecida pelo administrador, fonte, original em outra aba e sugestões locais já carregadas. Não há requisições extras de publicidade nem IA nesse visualizador. Não há gravação de histórico, rastreamento de reprodução, cópia de vídeos ou proxy de páginas externas.

O administrador indicou `https://www.youtube.com/@agrotecnica362`, `https://www.instagram.com/agrotecniica/` e `https://www.tiktok.com/@agrotecnica5` em 06/09/2026. Os canais Agrotécnica aparecem em “Da nossa equipe”, separados da relevância da busca, com links externos explícitos. Não há importação automática de vídeos ou afirmação de métricas/temas não verificados.

O site `https://adubonpkparaplantas.com.br/`, informado como próprio pelo administrador, aparece em “Nosso ecossistema”. É um link identificado, não importação, iframe, associação automática de contas ou alegação sobre estoque/preços.

A loja `https://shopee.com.br/agrotecnicavendas#product_list`, também informada pelo administrador, aparece como “Nossa loja na Shopee”, com `rel=sponsored noopener noreferrer`, identificação comercial e aviso para conferir condições na plataforma. Não é catálogo importado nem redirecionamento de afiliado inventado.

Por solicitação do administrador, produtos ativos relacionados à consulta da loja interna `official_agrotecnica` (página pública `/loja/official_agrotecnica/agrotecnica`) precedem os demais produtos, guias e afiliados na busca e nas recomendações do leitor. A prioridade é identificada como escolha da plataforma, não como melhor avaliação. Filtros de cidade, termos pesquisados e publicação permanecem obrigatórios; sem correspondência não são inventados produtos. O link da loja oficial permanece antes dos sites externos. A versão do ranking passa a `vitrine-local-v3-official-first`.

- **Ler na Vitrine:** versão textual de quatro guias/artigos próprios explicitamente permitidos e páginas públicas `/ofertas/:slug`. Não aceita parâmetros de consulta, ações, autenticação ou rotas administrativas. A leitura é carregada sob a própria origem, sem cookies, com redirecionamentos proibidos, timeout de 10 segundos e máximo de 500 KB. HTML é analisado em template inerte e reconstruído com tags permitidas, limite de texto/nós/profundidade e sem scripts, imagens, estilos, formulários ou atributos ativos. A fonte completa permanece acessível para fotos, compras e interações. Não indexa novas páginas automaticamente.
- **TikTok:** URLs HTTPS canônicas públicas `/@autor/video/ID` abrem na fonte por uma única ação. Links curtos nos hosts exatos `vm.tiktok.com`, `vt.tiktok.com` e caminhos `/t/:token` recebem “Abrir no TikTok” quando o resultado não comprova que seja um vídeo. Não são resolvidos, carregados ou incorporados automaticamente.
- **YouTube / Shorts:** URLs HTTPS com ID válido em `watch?v=`, `shorts/`, `live/`, `embed/` e `youtu.be/` abrem diretamente no YouTube em outra aba. Não há player ou solicitação à API do YouTube nesse fluxo. Disponibilidade, login, classificação infantil e demais restrições são tratados pela plataforma original, sem contornos.
- **Instagram / Kwai:** URLs HTTPS em hosts exatos e caminhos `/reel/:id`, `/reels/:id` e `/short-video/:id` recebem a ação única de assistir, mesmo quando a busca as classifica como sites. Links curtos reconhecidos de `k.kwai.com` recebem “Abrir no Kwai” sem afirmação de reprodução. Perfis ou publicações de tipo desconhecido não são apresentados como vídeos apenas por pertencerem à rede.
- **Outras fontes:** um resultado marcado como `type: "video"` pela busca recebe uma única ação “Assistir na fonte” com URL HTTP(S) validada. Isso é navegação, não garantia de reprodução nem permissão de incorporação. Outros sites mantêm a prévia textual da busca, sem carregar a página externa dentro da Vitrine.

O endpoint de elegibilidade YouTube permanece no backend por compatibilidade, mas não é chamado pela interface de busca. A navegação dos vídeos não requer configuração nem alteração de chave. O módulo existente valida IDs e parâmetros, aceita apenas o provedor fixo, limita JSON a 32 KB, timeout a 8 segundos, concorrência a 2, visitantes a 15/minuto, cache a 100 entradas por 10 minutos e falhas a 30 segundos. Guarda local de 100 tentativas/dia UTC por processo (também conta falhas; reinicia com o processo). Quotas reais do projeto prevalecem. Não adiciona API paga, cobrança ou dependência; se consultado por outro cliente, compartilha a cota da chave existente e continua falhando fechado quando não há elegibilidade confirmada.

Publicidade da Vitrine permanece na própria aba da Vitrine, separada dos resultados orgânicos; não acompanha a aba do YouTube, TikTok ou outro site. O visualizador de leitura não exibe nossos anúncios nem players de terceiros. Abertura de link ou leitor não é tratada como venda, view confirmada do vídeo ou nova impressão de publicidade. Ao fechar o leitor, cancela a leitura e volta ao botão acionado, sem refazer a busca. O leitor não usa cookies/storage adicionais.

Referências verificadas:
- TikTok player oficial: https://developers.tiktok.com/docs/en/embed-player
- YouTube público infantil: https://developers.google.com/youtube/v3/guides/made_for_kids_status
- YouTube políticas: https://developers.google.com/youtube/terms/developer-policies
- Meta oEmbed oficial (opção futura, não implementada): https://github.com/facebook/meta-embeds-for-wordpress

Testes: `node app/scripts/test-search-reader.mjs`, `node app/scripts/test-search-video-eligibility.mjs`, `npm run test:search` dentro de app; testes gerais por `ops/verify-release.sh`. O teste do leitor cobre ação única com link nativo e nova aba, suporte com/sem dialog, Instagram/Reels e Kwai classificados como sites, links curtos sem prometer reprodução, rejeição de esquemas/hosts falsos, leitura própria e ausência de player/chamada à API. A navegação deve ser verificada também em navegador móvel. Testes simulados não comprovam disponibilidade ou reprodução do conteúdo na fonte externa.

Cloudflare: configure SEARCH_AI_CLOUDFLARE_KEY, SEARCH_AI_CLOUDFLARE_ACCOUNT_ID e SEARCH_AI_CLOUDFLARE_DAILY=100. Inclua cloudflare em SEARCH_AI_FREE_PROVIDERS somente após confirmar Workers Free. Modelo fixo: @cf/meta/llama-3.1-8b-instruct-fp8-fast, com até 512 tokens de saída. O token deve ter somente Workers AI Read/Edit na conta selecionada. Não requer Worker público nem alteração de DNS. A cota do provedor é compartilhada pela conta; ao esgotar, o serviço gratuito rejeita chamadas. O módulo tenta outro provedor habilitado e mantém a busca normal quando todos esgotam. Testes cobrem o formato nativo da resposta, falhas nas duas direções, limites e validação do ID da conta.

