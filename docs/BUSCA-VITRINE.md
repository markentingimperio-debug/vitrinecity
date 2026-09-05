# Busca integrada da Vitrine

A página `/pesquisar.html` reúne sites, vídeos, sugestões e negócios publicados. A página `/buscar.html` e suas APIs existentes permanecem disponíveis. Apenas o formulário da página inicial aponta para a nova busca.

## Funcionamento

- SearXNG privado consulta Google, Bing, DuckDuckGo, Yahoo, Brave, Qwant, Startpage, Mojeek, Wikipedia e YouTube. Uma fonte pode bloquear ou não responder; os resultados disponíveis continuam aparecendo com atribuição.
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

Os testes automatizados usam respostas controladas para validar falhas, cache e segurança. Não substituem o teste real dos provedores na VPS.

Referências: https://docs.searxng.org/dev/search_api.html e https://docs.searxng.org/admin/installation-docker
