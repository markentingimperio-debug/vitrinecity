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

**Estado:** PENDENTE / obrigatório antes de deploy.

A árvore efetiva da VPS precisa ser reconciliada com GitHub antes de qualquer publicação ampla. A reconciliação deve ser somente leitura até preservar snapshot e identificar diferenças.

Não fazer:

- `git reset --hard` na VPS;
- limpeza abrangente de arquivos/containers;
- restauração de banco antigo sobre dados novos;
- cópia da árvore Git por cima de `/opt/vitrinecity` sem diff e backup.

A integração disponível nesta sessão não expõe shell/arquivos da VPS, portanto a reconciliação de `/opt/vitrinecity` ainda não foi executada nem simulada.

---

## Próxima sequência

1. Validar mobile/WebGL e jornadas E2E da experiência espacial, incluindo fallback e HUD city-aware.
2. Reconciliar GitHub × VPS conforme issue #146 quando houver acesso de leitura ao runtime/arquivos do servidor.
3. Registrar branch/commit da VPS, diferenças rastreadas/não rastreadas e arquivos exclusivos sem expor segredos.
4. Preservar snapshot/tag/imagem saudável antes de qualquer alteração operacional.
5. Consolidar diferenças válidas em branch revisável e executar `ops/verify-release.sh` no candidato reconciliado.
6. Validar `/api/health`, páginas públicas e jornadas críticas.
7. Só então avaliar merge do PR #144, entrada oficial na home e deploy do Multiversal.
