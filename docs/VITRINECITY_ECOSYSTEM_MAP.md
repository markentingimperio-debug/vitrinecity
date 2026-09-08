# Mapa do Ecossistema VitrineCity

Data da revisão: 2026-09-07
Branch de trabalho: `feat/vitrinecity-multiversal-core`

## Objetivo

Este documento separa três coisas que não devem ser confundidas:

1. **Existe no Git** — há código/arquivo versionado.
2. **Há evidência técnica** — existem testes, CI, documentação operacional ou validação registrada.
3. **Produção confirmada** — há evidência recente de que o fluxo está rodando na VPS/ambiente público.

A regra para continuar o Multiversal é reutilizar o que já existe, nunca reconstruir um módulo apenas porque ele ainda não foi ligado ao portal Multiversal.

## Legenda

- **A — implementado + cobertura automatizada relevante:** há código e testes dedicados/release-gated.
- **B — implementado, mas exige validação E2E/externa:** código existe e pode ter testes parciais; dependências reais ou jornada completa ainda precisam comprovação.
- **C — fundação/experimental:** arquitetura e componentes existem, mas não devem ser tratados como produto final.
- **D — novo nesta branch:** implementação Multiversal ainda aguardando CI e revisão.

## Inventário por domínio

| Domínio | Principais componentes encontrados | Evidência no Git | Estado Git | Produção confirmada | Próximo passo |
| --- | --- | --- | --- | --- | --- |
| Núcleo web/backend | `app/server.js`, SQLite WAL, usuários, sessões, permissões, APIs, páginas públicas | `npm test`, `test-platform-release`, workflow `Verify release` | A | Parcial | preservar como núcleo; não fragmentar sem necessidade |
| Autenticação e administração | login, sessão, MFA/TOTP, auditoria, painel `admin.html` e várias telas administrativas | `test-admin-auth.mjs`, privacy/security tests | A | Parcial | validar jornadas autenticadas antes de deploy Multiversal |
| Cidade 2.5D | `cidade-25d-demo.html/css/js`, prédios clicáveis, busca, filtros, zoom, arraste, ativos visuais | implementação funcional no Git; assets dedicados | B | Página/HTML já teve validação parcial, não toda a interação | transformar em um dos universos; não recriar |
| Cidade explorável / 3D / passeio virtual | `cidade-exploravel*`, `cidade-3d*`, `cidade-premium.html`, `passeio-virtual.html`, Three.js | código e assets presentes | B | Não comprovada integralmente nesta revisão | consolidar qual experiência vira oficial por cidade |
| Mapa real e navegação | `mapa-real.*`, `navegar.*`, `waze-navigation.js`, geolocalização de lojas | `test-waze.mjs` e rotas/backend existentes | A/B | Página mapa teve HTTP 200 em validação anterior; integrações externas precisam nova checagem | usar como universo Mundo Real e Mobilidade |
| Vitriny Social | `social.html`, perfil, chat, stories/posts/follows/likes/comments/notificações, realtime | `test-social-accessibility`, `test-social-moderation`, `test-social-chat-auth`, `test-social-realtime` | A | Página `/social` validada HTTP 200; fluxo completo não foi reexecutado aqui | integrar cidade ativa ao feed e descoberta |
| Descoberta / feed / recomendação | `descobrir*`, `discovery-search.js`, renderer/enhancements, ranking social | `test-discovery-search`, `test-discover-security`, testes de ranking/Neural | A/B | Parcial | fazer cidade e universo virarem sinais de contexto |
| Marketplace e lojas | `loja.html`, `marketplace-public.js`, `store_profiles`, produtos, páginas de loja/produto, painel lojista | `test-marketplace-public`, legal, seller operations, product details | A | `/loja` validado HTTP 200; compra real não validada na última operação registrada | ligar marketplace ao Multiversal sem alterar checkout |
| Pagamentos / Mercado Pago | lotes, créditos, pedidos, reconciliação, marketplace seller accounts, Pix/checkout | testes de pricing, seller operations, marketplace; lógica extensa no backend | B | pagamento real não deve ser assumido como validado apenas pelos testes isolados | manter no núcleo e validar sandbox/produção por fluxo antes de mudança |
| Carteira e créditos Ads | `wallets`, ledger, lotes de crédito, `ad_campaigns`, Vitrine Ads, store ads | `test-ads-pricing`, `test-store-ads*`, `test-vitrine-ads-ui` via release sweep | A/B | Parcial | expor no Multiversal apenas como destino, sem mover regra financeira |
| Entregas locais | `local-delivery.js`, jobs, ofertas, tracking, histórico de localização, eventos | `test-local-delivery`, delivery realtime/reviews/backend/UI | A/B | `/entregas` validado HTTP 200; jornada real completa não confirmada | conectar compra -> entrega -> mapa mantendo backend atual |
| Entregadores | `entregador.html`, courier applications, sessions, dispatch, ledger e saques | `test-courier-*`, dispatch e operations API | A/B | Não confirmada integralmente | manter como subuniverso operacional de Entregas |
| Frete nacional / fulfillment | `marketplace-shipping.js`, `melhor-envio-fulfillment.js`, OAuth/config | testes de shipping e Melhor Envio | A/B | integração externa precisa estado atual | não duplicar no Multiversal; apenas encaminhar contexto |
| Cursos / Centro Educacional | `centro-educacional.html`, cursos gerenciados, matrículas, progresso, certificados, arquivos privados | estrutura backend e frontend presentes | B | página teve HTTP 200; compra/progresso/certificado não revalidados nesta revisão | usar como universo Educação |
| Afiliados | catálogo, comissões, campanhas, conteúdo de afiliado, páginas e painel | `test-affiliate-catalog`, pages, indexnow e outros testes release-gated | A/B | Parcial | conectar aquisição e atribuição entre universos sem alterar comissão |
| Busca / metabusca / IA de busca | `metasearch.js`, `search-ai.js`, `search-content.js`, autocomplete, reader, imagens/capas | `test:search` + vários `test-search-*` varridos pelo release test | A | Produção atual não confirmada aqui | incorporar cidade/universo ao ranking da busca |
| SEO / IndexNow / sitemap | `indexnow.js`, sitemap, robots, Google Search admin, affiliate IndexNow | `test-indexnow`, testes de SEO/search relacionados | A/B | Google Search sem histórico confirmado na operação de 05/09 | continuar, mas não declarar conexão Google ativa sem nova evidência |
| Analytics / conversão / aquisição | `analytics.js`, `admin-analytics.js`, conversion measurement, organic acquisition | testes de consentimento, measurement, acquisition e plano de crescimento | A | Parcial | padronizar eventos de transição Multiversal e funil cross-realm |
| Conteúdo / publicação digital | `digital-publisher.js`, editorial, artigos, livros, seeds, painel de conteúdos | alguns testes de segurança/descoberta; não toda a produção editorial | B | Parcial | manter como motor de conteúdo do ecossistema |
| Fábrica de crescimento / quizzes | `fabrica-crescimento.html`, `admin-quizzes.html`, trend radar, scripts/seeds | testes de trend/business/growth relacionados variam por módulo | B | Não confirmada integralmente | mapear automações antes de conectar publicação multicanal |
| Prospecção de empresas | `business-prospecting.js`, `admin-prospeccao.html`, oportunidades | `test-business-prospecting.mjs` | A/B | Parcial | usar cidade ativa para priorizar prospecção local |
| Live Studio | `live-studio.js`, `admin-live.*`, `ops/live-studio/*`, relay/worker | workflow executa testes Python de worker e relay; `test-live-studio.mjs` | A/B | stack real depende das integrações externas | manter serviço separado e expor como capacidade do ecossistema |
| Instagram live direto | `instagram-live-direct.js` | `test-instagram-live-direct.mjs` | B | permissões Meta estavam com falha em 05/09 | não tratar como operacional até nova validação da Meta |
| Métricas externas | Facebook, Instagram, YouTube, TikTok, Google, Kwai em `external-social-metrics.js` | testes dedicados + painel de saúde | A para lógica / B para conectividade | em 05/09: Meta falhou; YouTube/TikTok tinham dados antigos; Google/Kwai sem histórico | revisar credenciais/permissões antes de uso operacional |
| Jarvis | `jarvis-core.js`, `jarvis-public.js`, `jarvis-research.js`, UI/admin e currículo | várias suítes `test-jarvis-*` | A/B | depende de modelo/provider e configuração real | manter como interface/capacidade, ligado à Vitriny Neural |
| Vitriny Neural | core, SQLite store, policy gate, skills, providers, learning loop, benchmarks, web research | workflow e relatório de avaliação; stress, segurança, fallback e storage testados | C forte / fundação pronta | não deve ser tratada como IA final; precisão semântica real ainda não medida | integrar eventos do ecossistema e benchmarks reais gradualmente |
| Agentes | `admin-agentes.html`, sales agent engine, Neural skills e bridges | testes distribuídos por agentes/Jarvis/Neural | B/C | Não confirmada integralmente | catalogar agentes ativos antes de lhes dar ações cross-realm |
| Crypto Matrix / Binance | observabilidade crypto, painel, scripts demo/local | `test-crypto-matrix`, `test-binance-local` | C/B | não assumir operação financeira real | manter separado do Multiversal comercial até validação específica |
| Jurídico / privacidade / idade | legal review, políticas marketplace, privacy, exclusão de dados, age verification | `test-legal-review`, marketplace legal, privacy rights, age verification | A | parcial | preservar gates em qualquer nova jornada Multiversal |
| PWA / mobile | manifest, service worker, install script, ícones, acessibilidade social | smoke/accessibility e validações móveis pontuais | B | teste anterior em 390 px foi parcial | executar smoke visual do Multiversal antes de publicar |
| Infraestrutura | Docker Compose, Caddy, backups SQLite, recovery docs, workflows CI | `Verify release`, `ops/verify-release.sh`, healthchecks | A para processo de teste | produção e Git tiveram divergência documentada em 05/09 | reconciliar estado real da VPS antes de qualquer deploy amplo |
| Chatbotx / WhatsApp | rede/container externos, WuzAPI e páginas/grupos | configuração e health references presentes | B | healthcheck do builder tinha falso negativo por `curl` ausente em 05/09 | validar stack separado; não reiniciar junto com Multiversal |
| Multiversal Core | `multiversal.html/css/js`, `multiversal-server.js`, cidades e realms, Caddy route e serviço Docker | ainda sem suíte dedicada nesta branch | D | não publicado | adicionar testes, CI e revisão; depois integrar entrada oficial |

## O que já pode ser considerado base reutilizável

Os blocos abaixo têm estrutura suficiente para serem tratados como componentes existentes do Multiversal, não novos projetos:

- identidade/conta;
- cidade 2.5D;
- Vitriny Social;
- mapa real e navegação;
- marketplace e lojas;
- pagamentos/carteira;
- entregas e entregadores;
- cursos;
- afiliados;
- busca/SEO;
- Ads/analytics;
- live e conteúdo;
- Jarvis/Vitriny Neural;
- administração, jurídico e segurança.

## Lacunas que devem ser tratadas antes de chamar algo de “pronto em produção”

### 1. Reconciliar GitHub x VPS

Existe documentação operacional informando que a VPS possuía mudanças locais e módulos que não estavam integralmente na `main` em 05/09/2026. Os commits posteriores no Git mostram evolução significativa, mas esta revisão não possui evidência suficiente para afirmar que a divergência foi zerada.

**Regra:** nenhum deploy amplo ou substituição da árvore da VPS deve acontecer antes de comparar o estado real do servidor com o candidato do Git.

### 2. Validar integrações externas no estado atual

A lógica interna pode estar testada enquanto o provedor externo está bloqueado, sem permissão ou com token expirado. Isso se aplica especialmente a Meta, OpenRouter, Google, Kwai, YouTube, TikTok, Melhor Envio e Mercado Pago.

### 3. Executar jornadas E2E de alto valor

Prioridade de validação:

1. cadastro/login;
2. descoberta -> loja;
3. loja -> carrinho/checkout;
4. pagamento aprovado -> pedido;
5. pedido -> entrega;
6. entregador -> rastreio;
7. social -> loja -> conversão;
8. afiliado -> conversão;
9. curso -> compra -> progresso -> certificado;
10. Multiversal -> troca de cidade -> troca de universo.

## Ordem correta para seguir o Multiversal

### Etapa M1 — inventário

- [x] mapear os módulos existentes;
- [x] separar código existente de produção confirmada;
- [x] registrar riscos de integração externa;
- [x] registrar risco de divergência Git/VPS.

### Etapa M2 — core e multicidade

- [x] portal Multiversal inicial;
- [x] registry de universos;
- [x] cidades iniciais: Silvânia, Anápolis e Vianópolis;
- [x] serviço isolado `/api/multiversal/*`;
- [x] transições entre universos;
- [x] seletor de cidade no portal;
- [ ] suíte automatizada do Multiversal;
- [ ] validação de compatibilidade com as rotas existentes.

### Etapa M3 — contexto compartilhado

- [ ] propagar cidade ativa para Social, mapa, marketplace e entregas;
- [ ] registrar origem/destino de jornada sem duplicar autenticação;
- [ ] criar métricas de transição e conversão cross-realm;
- [ ] garantir que autorização financeira continue no módulo de destino.

### Etapa M4 — experiência multicidade real

- [ ] filtrar lojas por cidade;
- [ ] filtrar feed Social por cidade sem impedir conteúdo nacional;
- [ ] filtrar mapa e entregas por cidade/raio;
- [ ] permitir destaques e eventos locais;
- [ ] definir fallback quando cidade ainda não tiver conteúdo suficiente.

### Etapa M5 — orquestração Neural

- [ ] permitir à Neural recomendar um universo/cidade com base em intenção;
- [ ] manter ações financeiras, destrutivas e de segurança fora de autoexecução;
- [ ] medir efeito real antes de automatizar roteamento.

## Decisão de continuidade

A VitrineCity já é um ecossistema amplo. A prioridade não é criar mais módulos. A prioridade é:

1. consolidar estado real;
2. ligar módulos existentes;
3. medir as jornadas entre eles;
4. validar produção;
5. só então ampliar automação e escala.
