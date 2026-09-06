# Busca integrada da Vitrine

A página `/pesquisar.html` reúne sites, vídeos, sugestões e negócios publicados. A página `/buscar.html` e suas APIs existentes permanecem disponíveis. Apenas o formulário da página inicial aponta para a nova busca.

## Funcionamento

- SearXNG privado consulta Google, Bing, DuckDuckGo, Yahoo, Brave, Qwant, Startpage, Mojeek, Wikipedia e YouTube. Uma fonte pode bloquear ou não responder; os resultados disponíveis continuam aparecendo com título, resumo, domínio e link direto de destino. A API conserva a origem técnica, mas a interface não exige escolher um buscador.
- Não usa OpenRouter, modelo de IA ou cobrança por consulta de IA. Consome recursos e banda da VPS; não garante disponibilidade de todos os buscadores.
- Sugestões externas e locais; resultados externos deduplicados, filtros de sites/vídeos, paginação e consultas relacionadas quando fornecidas pelas fontes.
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

Os títulos continuam sendo links diretos. Botões adicionais abrem um visualizador modal com a logo fornecida pelo administrador, fonte, original em outra aba e sugestões dos resultados locais já carregados. Não há requisições extras de publicidade nem IA no visualizador. Não há gravação de histórico, rastreamento de reprodução, cópia de vídeos ou proxy de páginas externas.

O administrador indicou `https://www.youtube.com/@agrotecnica362` em 06/09/2026. O canal Agrotécnica aparece em “Da nossa equipe”, separado da relevância da busca, com link externo explícito. Não há importação automática de vídeos ou afirmação de métricas/temas não verificados.

- **Ler na Vitrine:** versão textual de quatro guias/artigos próprios explicitamente permitidos e páginas públicas `/ofertas/:slug`. Não aceita parâmetros de consulta, ações, autenticação ou rotas administrativas. A leitura é carregada sob a própria origem, sem cookies, com redirecionamentos proibidos, timeout de 10 segundos e máximo de 500 KB. HTML é analisado em template inerte e reconstruído com tags permitidas, limite de texto/nós/profundidade e sem scripts, imagens, estilos, formulários ou atributos ativos. A fonte completa permanece acessível para fotos, compras e interações. Não indexa novas páginas automaticamente.
- **TikTok:** URLs canônicas públicas `/@autor/video/ID` recebem player oficial, somente após clicar em “Carregar player”. Sem autoplay, download, script externo no documento principal ou cobertura dos controles. Indisponibilidade, restrição e remoção dependem da fonte; o link original fica sempre disponível. Links encurtados não são resolvidos nem incorporados automaticamente.
- **YouTube / Shorts:** mesma confirmação antes de consultar `/api/search/video-eligibility`. Usa apenas `YOUTUBE_API_KEY` já configurada no ambiente ou credenciais administrativas existentes; nenhuma chave é criada/alterada. Só permite player se a API oficial confirmar explicitamente `madeForKids: false` e `embeddable: true`. Campo ausente, quota, falha ou configuração ausente mantêm o original. Usa `youtube-nocookie.com`, referer de origem e player mínimo de 200 px; isso não significa ausência de compartilhamento de dados nem garantia de reprodução.
- **Instagram / Kwai / outros sites:** prévia textual da busca e original, sem incorporar uma página inteira nem inventar um endpoint de player. Instagram possui caminho oficial oEmbed/SDK, ainda não validado neste visualizador. Não foi confirmado um player público documentado do Kwai. Não prometer reprodução universal.

O endpoint de elegibilidade YouTube valida IDs e parâmetros, aceita apenas o provedor fixo, limita JSON a 32 KB, timeout a 8 segundos, concorrência a 2, visitantes a 15/minuto, cache a 100 entradas por 10 minutos e falhas a 30 segundos. Guarda local de 100 tentativas/dia UTC por processo (também conta falhas; reinicia com o processo). Quotas reais do projeto prevalecem. Não adiciona API paga, cobrança ou dependência; compartilha a cota da chave existente.

Publicidade existente continua na página de busca, separada de resultados orgânicos. O modal não exibe nossos anúncios. Banners sobre/ao redor de players terceiros não foram liberados: dependem de regras do provedor, rede de anúncios e valor independente do conteúdo. Abertura de leitor não é tratada como venda, view confirmada do vídeo ou nova impressão de publicidade. Ao fechar, remove o iframe e cancela a leitura; volta ao botão acionado, sem refazer a busca. Não usa cookies/storage adicionais.

Referências verificadas:
- TikTok player oficial: https://developers.tiktok.com/docs/en/embed-player
- YouTube público infantil: https://developers.google.com/youtube/v3/guides/made_for_kids_status
- YouTube políticas: https://developers.google.com/youtube/terms/developer-policies
- Meta oEmbed oficial (opção futura, não implementada): https://github.com/facebook/meta-embeds-for-wordpress

Testes: `node app/scripts/test-search-reader.mjs`, `node app/scripts/test-search-video-eligibility.mjs`, `npm run test:search` dentro de app; testes gerais por `ops/verify-release.sh`. Regressão de navegador isolada: 12 casos de sanitização, foco/Escape, 360 px, originais, filtros, carregamento voluntário e falha fechada do YouTube. Reprodução real dos provedores deve ser verificada separadamente: testes com respostas simuladas não comprovam disponibilidade de um vídeo.

Cloudflare: configure SEARCH_AI_CLOUDFLARE_KEY, SEARCH_AI_CLOUDFLARE_ACCOUNT_ID e SEARCH_AI_CLOUDFLARE_DAILY=100. Inclua cloudflare em SEARCH_AI_FREE_PROVIDERS somente após confirmar Workers Free. Modelo fixo: @cf/meta/llama-3.1-8b-instruct-fp8-fast, com até 512 tokens de saída. O token deve ter somente Workers AI Read/Edit na conta selecionada. Não requer Worker público nem alteração de DNS. A cota do provedor é compartilhada pela conta; ao esgotar, o serviço gratuito rejeita chamadas. O módulo tenta outro provedor habilitado e mantém a busca normal quando todos esgotam. Testes cobrem o formato nativo da resposta, falhas nas duas direções, limites e validação do ID da conta.

