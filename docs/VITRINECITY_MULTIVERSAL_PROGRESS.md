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

### Distritos já integrados ao ecossistema

1. Commerce;
2. Social;
3. Creator;
4. Food;
5. Education;
6. Entertainment;
7. Business;
8. Services.

As integrações públicas mantêm denylist para rotas administrativas, checkout, pagamentos, carteira e outras áreas transacionais. A cidade espacial atua como interface/orquestração, não como substituta das regras de negócio dos módulos.

### Cidades já presentes na linha #144

- Vitrine City;
- Silvânia;
- Anápolis;
- Goiânia.

Vianópolis, que aparecia na retomada do #145, deverá ser acrescentada posteriormente ao registry do #144 sem remover Goiânia ou reconstruir a arquitetura multicidade.

---

## 2026-09-07 — Diagnóstico do CI do PR #144

**Estado:** EM VALIDAÇÃO.

### Evidência encontrada

No head anterior `49ee3fadb4024fc765d9e2b937ca301d72f5e21b`:

- workflow **Vitriny Neural**: aprovado;
- workflow **Verify release**: reprovado em um teste específico do ambiente espacial;
- navegação multicidade, rotas e testes anteriores ao ponto de falha estavam aprovados.

### Causa da falha

`test-vitriny-spatial-environment.mjs` esperava os 8 distritos representados em `LITE.districtLights`, mas recebia 7.

O gerador criava 8 luzes distritais. A luz do setor voltado ao `transit-forecourt` caía dentro do corredor reservado aos portais intermunicipais e era descartada por `safeTransitPoint()`. A regra de segurança estava correta ao manter o corredor livre; o erro era perder a identidade visual de um distrito em vez de reposicioná-la.

---

## 2026-09-07 — Correção das luzes distritais e proteção do corredor

**Estado:** EM VALIDAÇÃO CI.

### Implementação

- Commit `4bdfa9310b651bf324a3ce7f021d2a716ed5ecf1` — `fix(spatial): preserva luzes distritais fora do corredor`
  - adiciona reposicionamento determinístico somente quando uma luz distrital cair dentro do corredor intermunicipal;
  - mantém o corredor `transit-forecourt` desobstruído;
  - preserva as oito identidades de distrito em todos os perfis.

- Commit `91d074aafd446e17959cca093e71a4d94874d70d` — `test(spatial): protege corredor e oito distritos`
  - exige exatamente 8 distritos no perfil LITE;
  - exige 8 luzes distritais no LITE;
  - verifica que nenhuma luz distrital de LITE/ULTRA invade a área do corredor;
  - preserva teste de determinismo do ambiente.

### CI atual

No head `91d074aafd446e17959cca093e71a4d94874d70d`, os workflows **Vitriny Neural** e **Verify release** foram disparados automaticamente e estão aguardando/conduzindo validação no momento deste registro.

---

## Relação PR #144 × PR #145

### Manter no #144

- arquitetura espacial principal;
- World Router/chunks;
- cidade procedural;
- multicidade e portais;
- Presence/telemetria;
- Spatial API;
- integrações de distritos;
- bridge espacial com Vitriny Neural;
- adaptive LOD e renderização do ambiente.

### Avaliar para portar do #145

- inventário consolidado do ecossistema;
- diário/checkpoint de retomada;
- hardening adicional de URLs/DOM/origens onde fizer sentido;
- contexto de cidade para módulos legados;
- métricas cross-realm complementares;
- Vianópolis como cidade adicional;
- quaisquer testes que cubram lacunas reais sem duplicar arquitetura.

### Não portar como sistema paralelo

- segundo servidor Multiversal independente se a Spatial API já resolver a mesma função;
- segunda cidade Three.js separada da engine espacial do #144;
- segundo registry de universos concorrente com districts/worlds do Spatial Core.

---

## Próxima sequência

1. Confirmar CI do head `91d074a...`.
2. Corrigir qualquer falha residual sem ampliar escopo.
3. Comparar PR #145 por domínio e portar apenas o que não existe no #144.
4. Adicionar Vianópolis ao registry multicidade do #144, mantendo as cidades existentes.
5. Propagar contexto de cidade para Social, Marketplace, Mapa e Entregas usando a arquitetura espacial já existente.
6. Ampliar sinais seguros da Vitriny Neural com métricas cross-district/cross-city, sem automatizar pagamentos ou ações destrutivas.
7. Executar validação mobile/WebGL e jornadas E2E.
8. Reconciliar GitHub × VPS.
9. Só depois planejar publicação da experiência espacial como entrada oficial da VitrineCity.
