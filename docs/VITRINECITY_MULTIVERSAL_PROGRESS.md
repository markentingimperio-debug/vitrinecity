# VitrineCity Multiversal — Diário Permanente de Progresso

Este arquivo é a fonte oficial de retomada da construção espacial/Multiversal. Cada etapa concluída deve registrar aqui: estado, evidências, commits, testes, riscos e próximo passo.

## Regra de preservação

- **PR #144 / `feat/vitriny-spatial-core-v1` é a linha espacial canônica.**
- O PR #145 (`feat/vitrinecity-multiversal-core`) é tratado como trabalho complementar de inventário, portal, hardening e experimentação; não deve criar uma segunda cidade 3D paralela.
- Funcionalidades úteis do #145 devem ser portadas seletivamente para o #144 após comparação e testes.
- Nenhum deploy amplo deve substituir a árvore da VPS antes da reconciliação GitHub × produção.
- Uma etapa só é considerada concluída quando código + teste/evidência + registro neste diário estiverem versionados.

## Convenção de estado

- **CONCLUÍDO NO GIT** — implementação versionada e teste relevante aprovado.
- **EM VALIDAÇÃO** — implementação existe, mas CI, integração, Quality Gate ou E2E ainda está pendente.
- **PRODUÇÃO CONFIRMADA** — validado na VPS/site após reconciliação com Git.
- **PENDENTE** — ainda não implementado.

---

## 2026-09-07 — Recuperação da linha espacial original

**Estado:** CONCLUÍDO NO GIT / produção não alterada nesta retomada.

### Decisão

Durante a retomada do projeto foi identificado que o PR #144 já continha a fundação espacial/Multiversal mais avançada do repositório. A continuidade passa a ocorrer sobre essa arquitetura, evitando a duplicação criada inicialmente no PR #145 durante a recuperação do chat perdido.

### Base preservada no PR #144

- World Router e rotas espaciais;
- Chunk Engine;
- cidade procedural determinística;
- perfis de qualidade LITE, STANDARD e ULTRA;
- Central Plaza e núcleo Vitriny Neural;
- multicidade e portais intermunicipais;
- City Identity e landmarks por cidade;
- skyline, vegetação, iluminação e mobiliário procedural;
- Premium Ring e registry de zonas premium;
- Presence em tempo real com heartbeat, TTL e SSE agregado;
- telemetria espacial por cidade/distrito;
- Spatial API v1;
- bridge `spatial.aggregate` com Vitriny Neural;
- runtime adaptativo/LOD por desempenho;
- fallback HTML para dispositivos/navegadores sem experiência 3D adequada.

### Distritos integrados ao ecossistema

1. Commerce;
2. Social;
3. Creator;
4. Food;
5. Education;
6. Entertainment;
7. Business;
8. Services.

As integrações públicas mantêm denylist para rotas administrativas, checkout, pagamentos, carteira e outras áreas transacionais. A cidade espacial atua como interface/orquestração, não como substituta das regras de negócio dos módulos.

### Cidades presentes na linha #144

- Vitrine City — `active`;
- Silvânia — `preview`;
- Anápolis — `preview`;
- Vianópolis — `preview`;
- Goiânia — `preview`.

---

## 2026-09-07 — Correção das luzes distritais e proteção do corredor

**Estado:** CONCLUÍDO NO GIT.

### Implementação

- Commit `4bdfa9310b651bf324a3ce7f021d2a716ed5ecf1` — preserva luzes distritais fora do corredor;
- Commit `91d074aafd446e17959cca093e71a4d94874d70d` — protege o corredor e as oito identidades de distrito por teste.

A luz que coincidia com o `transit-forecourt` passou a ser reposicionada de forma determinística em vez de descartada. O corredor intermunicipal continua livre e os oito distritos permanecem representados.

---

## 2026-09-08 — Vianópolis integrada à arquitetura espacial canônica

**Estado:** CONCLUÍDO NO GIT / produção não alterada.

### Implementação

Vianópolis foi incorporada como quinta cidade, em `preview`, sem remover Goiânia e sem criar uma segunda engine Multiversal.

A integração cobre:

- registry multicidade;
- `worldKey` e rota canônica;
- identidade visual e landmark Portal do Cerrado;
- ambiente procedural;
- fallback do cliente;
- portais intermunicipais e checkpoints de retorno;
- Spatial API;
- Premium Zones;
- telemetria/Presence agregadas;
- sinais agregados da Vitriny Neural.

### Correção de Premium Zones

A primeira execução do release após a expansão para cinco cidades revelou que `premium-zone-registry.js` ainda mantinha uma allowlist de quatro cidades. A correção preservou a política rígida e apenas adicionou `vianopolis` como cidade conhecida.

Commits principais:

- `29545682da12b45b0ec3cef140a1289765a01e4c` — reconhece Vianópolis nas Premium Zones;
- `c2ed20a37c17cb5d6c1e696c9b90c92a1fed6dd4` — cobertura de regressão das Premium Zones de Vianópolis.

Cidades arbitrárias continuam rejeitadas e slots `reserved` não expõem patrocinador.

---

## 2026-09-08 — Contexto cross-module seguro por cidade

**Estado:** CONCLUÍDO NO GIT / produção não alterada.

### Objetivo

Propagar a cidade selecionada para os módulos existentes sem transformar `city`/`cidade`, URL ou armazenamento local em fonte de autorização.

### Implementação

- `30d524a33e453fd3e8965b25ec2eb07701a7ee0c` — camada `vitriny-spatial-city-context.js`;
- `d41b24a6d3b4e4291d3c852a2a7e5264bedc650f` — testes de contexto e hardening;
- `f4882cc285db31bf7ce86c2b46259936f4cd397c` — runtime do contexto no explorador;
- `b07584b70c420466da004339eddce5377eaabce7` — HUD “Ecossistema da cidade”;
- `57939c3145317f4081727ef02cccfeef83f2fe2e` — syntax checks no release gate;
- `49e1b9242fc308ee953a4cef376a72f1bc27483c` — teste de wiring do HUD;
- `050583ea486230c3353a6503057f19ef9b3d80d2` — endpoint read-only `/api/spatial/v1/context`;
- `06bd4517869bba62708c1a4d7437e9c2e0c2790f` — cobertura da API de contexto.

### Contrato

O contexto usa `contextMode: navigation-only`.

Em cidades `preview`:

- Social: navegação contextual disponível;
- Mapa real: navegação contextual disponível;
- Marketplace: indisponível para operação local;
- Entregas: indisponível para operação local.

Na Vitrine City `active`, os quatro destinos são habilitados como navegação.

O cliente não consegue tornar uma cidade preview operacional apenas informando `cityStatus=active`: o frontend cruza o status com o catálogo canônico e o backend deriva as capacidades do registry espacial.

Rotas administrativas, `/api`, checkout, pagamentos e carteiras permanecem na denylist de contexto público.

---

## 2026-09-08 — Vitriny Neural cross-city

**Estado:** CONCLUÍDO NO GIT / produção não alterada.

A arquitetura do PR #144 já possuía `spatial.aggregate`, que envia apenas contagens agregadas por distrito, cidade e runtime. Por isso os eventos individuais `multiversal.place-visit`, `multiversal.realm-transition` e equivalentes experimentados no PR #145 não foram portados.

A decisão preserva menor exposição de dados e evita uma segunda taxonomia concorrente de eventos.

- Commit `2023048b014963a531ab24023f090b0b3b395af5` adiciona regressão explícita para agregados de Vianópolis.
- O teste exige presença/eventos agregados de Vianópolis e dedupe key `spatial:<bucket>:city:vianopolis`.

### Evidência CI do head `2023048b014963a531ab24023f090b0b3b395af5`

- **Vitriny Neural #383: SUCCESS**;
- **Verify release #385: SUCCESS**;
- build da aplicação: aprovado;
- build do runtime de live studio: aprovado;
- testes isolados de aplicação/live studio: aprovados.

---

## 2026-09-08 — Fechamento técnico para implantação Multiversal

**Estado:** CONCLUÍDO NO GIT / produção não alterada.

### Verificação do release sweep

Foi confirmado que `app/scripts/test-platform-release.mjs` já executa automaticamente todos os arquivos `test-*.mjs` do diretório de scripts, exceto o smoke público dependente de rede. Portanto a cobertura existente de mobile/WebGL, fallback clássico, HUD city-aware e jornada Multiversal → mapa real já faz parte do gate isolado do PR.

### Smoke pós-deploy Multiversal

Foi adicionado `app/scripts/smoke-vitriny-multiversal.mjs`, exposto como `npm run test:smoke:multiversal`. O smoke usa `BASE_URL` e valida, sem alterar dados:

- `/api/health`;
- páginas públicas Multiversal e mapa real;
- Spatial API v1;
- Vitrine City como cidade `active`;
- Vianópolis como `preview`, mantendo Marketplace e Entregas desabilitados;
- Premium Zones com estados permitidos e sem exposição de patrocinador em slot `reserved`;
- rejeição de cidade desconhecida.

O contrato do smoke é protegido por `test-vitriny-multiversal-smoke-contract.mjs`, que roda no release sweep offline e valida sintaxe, endpoints obrigatórios, timeout, `no-store` e regras de isolamento.

Commits principais:

- `c6363e49dc9fbd936fbc61881794ec48d3a8529d` — smoke pós-deploy Multiversal;
- `b1ea34aee4a4525cdf2791b061bc4a7b07ac3d98` — comando `test:smoke:multiversal`;
- `99a09f1ce5fa197ac0678584e1e8fa94bd3079b3` — teste do contrato do smoke;
- `fcaa58c62fe9b950bd1223acec47e2709199915b` — smoke independente do estado comercial das Premium Zones;
- `1f8558d6e48a84af7cf1e6f44a393589244b213b` — hardening final do contrato do smoke.

### Evidência CI do head funcional `1f8558d6e48a84af7cf1e6f44a393589244b213b`

- **Vitriny Neural #403: SUCCESS**;
- **Verify release #405: SUCCESS**;
- build da aplicação: aprovado;
- build do live-studio: aprovado;
- release sweep e contrato do smoke: aprovados.

O smoke de rede não é executado dentro do CI isolado porque depende do runtime implantado. Ele é o primeiro gate após a reconciliação/deploy controlado.

---

## Relação PR #144 × PR #145

### Mantido no #144

- arquitetura espacial principal;
- World Router/chunks;
- cidade procedural;
- multicidade e portais;
- Presence/telemetria;
- Spatial API;
- integrações de distritos;
- bridge espacial agregada com Vitriny Neural;
- adaptive LOD e renderização ambiental;
- contexto city-aware de navegação.

### Portado seletivamente do #145

- conceito de contexto de cidade para módulos legados;
- compatibilidade com parâmetro `cidade`;
- hardening de URLs internas;
- checkpoint/diário de retomada;
- testes que cobrem lacunas reais.

### Não portado como sistema paralelo

- segundo servidor Multiversal independente;
- segunda cidade Three.js separada da engine espacial do #144;
- segundo registry de universos concorrente com districts/worlds;
- eventos individuais de visita/transição quando os agregados existentes já atendem o aprendizado de baixo risco.

---

## Bloqueio operacional — issue #146

**Estado em 08/09/2026:** reconciliação de leitura executada; snapshot e publicação ainda pendentes.

A árvore efetiva da VPS precisa ser reconciliada com GitHub antes de qualquer publicação ampla. A reconciliação deve ser somente leitura até preservar snapshot e identificar diferenças.

Não fazer:

- `git reset --hard` na VPS;
- limpeza abrangente de arquivos/containers;
- restauração de banco antigo sobre dados novos;
- cópia da árvore Git por cima de `/opt/vitrinecity` sem diff e backup.

A reconciliação por SSH identificou `/opt/vitrinecity` em `2c97fd10a60235f7a5656d68f4c577769417a69c`, com alterações rastreadas e staged vazias. Os arquivos não rastreados de agentes e de mapas devem ser preservados. O aplicativo usa volumes persistentes separados. A comparação com o container encontrou somente transformações de HTML explicadas pela preparação pública da imagem; nenhum código executável exclusivo sem correspondência foi encontrado.

Há diferença entre o ambiente configurado no Compose e o ambiente efetivo do app na chave `ASAAS_API_KEY`. Nenhum valor foi registrado. A publicação deve preservar o valor efetivo do container saudável, sem alterar credenciais financeiras. Ambos os provedores de IA têm chaves configuradas; o guard de saída agora considera as duas e exige origem HTTPS autorizada.

## Revisão visual e integração do mapa — 08/09/2026

- Referências: os dois vídeos enviados pelo usuário foram examinados em quadros distribuídos pela duração; a referência de lojas tem vidro, interiores quentes, fachadas escuras, paisagismo e iluminação dourada.
- World Gate redesenhado, com navegação HTML que permanece disponível se o 3D falhar.
- Praça, lojas modeladas, skyline, sombras, reflexos e materiais locais CC0. A fidelidade visual ainda está em revisão; não é declarado equivalente aos vídeos de referência.
- Torre VitrineCity com diretório para 31 áreas administrativas existentes, sem mudança de autenticação ou permissões.
- Base VC Entregas em cada uma das cinco cidades. Todas as bases visuais estão explicitamente em implantação; não habilitam entregas locais.
- Catálogos do mapa e marketplace unidos por referência. Confirmados no catálogo público: Agrotecnica, Centro Educacional VitrineCity, Sertaneja Moda Country e Beemi — Agência Shopee. As duas últimas não apareciam no catálogo restrito a produtos disponíveis.
- Outdoors urbanos com promoções/campanhas existentes e painéis nos telhados das lojas com seus próprios produtos. Links do item exibido levam às páginas correspondentes. Lojas sem catálogo mantêm apresentação e destino reais.
- Botões nas entradas levam às páginas públicas das lojas. Interiores 3D passam a exibir imagens dos produtos e movimento coerente com a câmera.
- Recomendação apresentada: Distrito de Afiliados separado, com prédios por plataforma e Centro Educacional como academia. Esse distrito ainda não foi implementado neste checkpoint.

Validação parcial: `npm test` e `npm run test:release` passaram na revisão anterior desta sessão (127 scripts de release). As alterações posteriores em outdoors próprios, interiores, bases e botões de entrada precisam de nova rodada final e verificação visual no desktop/celular. A prévia local lê catálogos públicos, bloqueia escrita e simula campanhas pagas vazias; não registra impressões pagas reais.

Nada desta revisão foi implantado em produção até este checkpoint. Não houve mudança de banco, cobrança, ativação de campanha ou de operação local.

---

## Próxima sequência

1. Reconciliar GitHub × VPS conforme issue #146 quando houver acesso de leitura ao runtime/arquivos do servidor.
2. Registrar branch/commit da VPS, diferenças rastreadas/não rastreadas e arquivos exclusivos sem expor segredos.
3. Preservar snapshot/tag/imagem saudável antes de qualquer alteração operacional.
4. Consolidar somente diferenças válidas em branch revisável e executar `ops/verify-release.sh` no candidato reconciliado.
5. Implantar de forma controlada somente após a reconciliação aprovada.
6. Executar `BASE_URL=<runtime> npm run test:smoke:multiversal` e o smoke público legado.
7. Confirmar `/api/health`, páginas públicas, jornadas críticas e rollback saudável antes de entrada oficial na home.

## 2026-09-08 — Contas, vitrines e Mini Fazenda

**Estado:** implementação e validação local concluídas; CI e publicação do candidato final pendentes.

- Decisão expressa do usuário: cidade e jogos exigem login; lojas, produtos e apresentação World Gate permanecem públicos. A conta existente é reutilizada, sem novo provedor de autenticação.
- Novo acesso `entrar-cidade.html` usa cadastro sem endereço/CPF obrigatório para a experiência, mantendo a política de maioridade já existente. Preferências de campanhas por e-mail e WhatsApp são opcionais, desmarcadas, registradas por canal e revogáveis em Minha conta. Nenhum envio ou trabalho de campanha é criado.
- Mini Fazenda própria para navegador: 5 fases, cenouras/milho/morangos, galinhas/vaquinha, moedas fictícias e 12 canteiros progressivos. Estado pertence à conta, salvo no SQLite; tempo e recompensas são calculados no servidor em transação. Exportação de privacidade inclui esse progresso.
- Migração aditiva: tabela `city_farm_progress` com chave do usuário e exclusão em cascata. Consentimentos usam a tabela já existente. Rollback de código pode deixar a nova tabela preservada; não restaurar banco antigo sobre dados novos.
- Avatar próprio com aparência local e câmera em terceira pessoa. Não há sincronização de posições entre jogadores; presença continua agregada. Colisões completas de exploração ainda não foram implementadas.
- Prédio de jogos na cidade e três fachadas demonstrativas disponíveis, ligadas aos planos existentes de espaço digital. Não representam venda de imóvel físico nem inventário comercial reservado.
- Fotos reais nas vitrines e painéis com destinos exatos. Endpoint de imagem aceita somente produto publicado e origens explícitas, fixa DNS público, limita bytes/cache/concorrência e prioriza original sobre miniatura WordPress quando disponível. A fotografia original não é alterada.
- Interface móvel com menu recolhido, botões de movimento e vitrine acessível também por lista. Imagens próximas são carregadas progressivamente. Os testes de viewport não equivalem a medição de desempenho em aparelhos físicos.

Evidências: `npm test` e release sweep com **132/132 scripts** passaram antes dos ajustes finais de enquadramento; testes direcionados desses ajustes passaram. Integração com servidor completo e banco descartável validou registro, sessão, proteção de páginas, comércio público, preferências, revogação, progresso e exportação. QA visual em 390 × 844 e 1440 × 900 validou login/cadastro, plantio, rega, retorno e colheita. Clique na foto do NPK 10-10-10 abriu `/produto/9/adubo-npk-10-10-10-liquido-concentrado-500-ml` real.

Limites visuais: cenário procedural estilizado; não equivale ao fotorrealismo das referências. A Mini Fazenda é primeira versão própria jogável. OpenFront, Solaris, Survev e Mindustry foram pesquisados; nenhum desses jogos externos foi incorporado ou apresentado como operacional.

Reconciliação atualizada: produção passou a `c7cfe8092f09da22c0aa64b94a4fd6ab925bb41b` (PRs 147/148 de afiliados e correção do qs). A versão espacial será integrada a essa base; não substituir alterações recentes com o snapshot antigo.

## 2026-09-08 — Centros de compras e Pulse Arena

**Estado:** candidato local validado, aguardando verificação isolada e publicação. A base `c7cfe80` foi integrada por `e478f68`; as três verificações do GitHub desse merge passaram.

- Quatro prédios independentes: Mercado Livre, Shopee Center, Cakto e Kiwify. Cada um tem logo oficial verificado e nome no topo e na fachada, paleta e detalhes arquitetônicos próprios. As imagens de marca são locais; origem e hashes estão em `app/public/assets/affiliate-brands/SOURCES.md`. O espaço é uma seleção afiliada independente da VitrineCity.
- Avenida com área livre de obstáculos de cenário, botão para percorrer os quatro prédios e entradas para `/centros/:plataforma`. A restrição de ocupação considera também o tamanho e a rotação dos prédios de fundo.
- Cada centro usa o catálogo existente: departamentos por categoria publicada, busca com índice FTS5, páginas de 24 produtos e destino na página própria `/ofertas/:slug`. Os painéis mostram até 12 produtos publicados da plataforma e abrem o produto exibido. Nenhum produto, preço, estoque ou link afiliado foi inventado.
- Snapshot público de QA: 22 Mercado Livre, 4 Shopee, 1 Cakto e 0 Kiwify. Kiwify mostra seleção em preparação. As quantidades mudam conforme novas publicações.
- Administração com busca, filtro por plataforma e paginação de 50 itens. Capacidade de cadastro aumentada para 50 mil; fixture de 10 mil valida índice, atualização, isolamento e paginação. Não é um resultado de teste de carga de produção. As APIs externas das plataformas e a importação em massa ficam para uma integração futura conforme acesso autorizado; nenhuma campanha ou compra de tráfego foi executada.
- Pulse Arena com identidade própria e players oficiais do vídeo YouTube `98ovJs-Ibd4` e da playlist Spotify `3d7eXh3ohl1YeaKHVCKNsU` fornecidos pelo usuário. Só carrega após escolha; não inicia áudio automaticamente; trocar ou fechar remove o player anterior. Spotify pode oferecer apenas prévias conforme o serviço. Não há download nem retransmissão própria de áudio.
- Cidade, jogos e arena exigem conta. Catálogos dos quatro centros e produtos permanecem públicos. A revogação de e-mail também desativa o consentimento legado de leads, mesmo se WhatsApp continuar permitido.

Validação: `npm test` e `npm run test:release` passaram, incluindo **135/135 scripts**. Ajustes finais de identidade/ocupação tiveram verificação direcionada. Navegador conferiu os quatro prédios, painéis com produtos reais e entrada no catálogo; viewport móvel confirmou logo e nome legíveis e catálogo sem rolagem horizontal. Os players oficiais e a interface móvel da arena foram conferidos; não foi necessário iniciar reprodução.

Reconciliação de leitura novamente confirmou produção `c7cfe8092f09da22c0aa64b94a4fd6ab925bb41b`, app saudável na imagem `sha256:0a5c9e20fd2dfe1e459020a812df4b7d13412a472d356539e6eb8e272b402b9f`. A única chave divergente de ambiente continua `ASAAS_API_KEY`; preservar o valor efetivo sem registrar seu conteúdo.

**Atualização operacional 13:46 UTC:** snapshot completo, imagem saudável e cópia consistente do banco preservados. A aparente diferença de `ASAAS_API_KEY` foi identificada como escape na serialização do Compose, não mudança de valor efetivo; nenhuma alteração de credenciais é necessária. Evidência detalhada em [VPS_MULTIVERSAL_RECONCILIATION_20260908.md](VPS_MULTIVERSAL_RECONCILIATION_20260908.md). Seguem verificação isolada e publicação apenas do app.

## 2026-09-08 — Atualização de estado e cidade viva

A PR #144 foi publicada no commit `b4b24803389d125a47dc376cc8895ea3639a013b`. As notas anteriores de publicação pendente são checkpoints históricos. Leitura atual confirmou app saudável e código limpo na VPS.

O candidato seguinte está na branch `feat/affiliate-partner-showcases`: prédios próprios para lojas, avenida com vida ambiente, HUD recolhível, portas, TikTok Shop, cinema, catálogo musical sem Spotify, chat moderado, vitrines pessoais de afiliados e recompensas parciais. Consulte `VITRINECITY_CITY_BUILDINGS_AUDIT.md` para a auditoria visual e `VITRINECITY_CITY_REWARDS.md` para regras, estados financeiros e validação. Este candidato ainda não está em produção neste checkpoint.
