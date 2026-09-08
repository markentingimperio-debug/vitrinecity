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
