# VitrineCity Multiversal — Diário Permanente de Progresso

Este arquivo é a fonte de retomada do projeto Multiversal. Ao concluir uma etapa, registrar aqui: estado, evidências, commit/PR, testes, riscos e próximo passo. Não considerar uma etapa encerrada sem este registro.

## Convenção de estado

- **CONCLUÍDO NO GIT**: código/documentação está versionado e testes relevantes passaram ou a evidência está registrada.
- **EM VALIDAÇÃO**: implementação existe, mas ainda há teste, Quality Gate, integração ou produção a validar.
- **PRODUÇÃO CONFIRMADA**: comportamento verificado na VPS/site após reconciliação GitHub × VPS.
- **PENDENTE**: ainda não implementado.

> Regra operacional: nunca usar “pronto em produção” apenas porque o arquivo existe no Git.

---

## 2026-09-07 — Retomada e preservação do ecossistema

**Estado:** CONCLUÍDO NO GIT / produção ainda não alterada.

### Conclusão

- Ecossistema existente foi tratado como base, não reconstruído.
- Inventário técnico consolidado em `docs/VITRINECITY_ECOSYSTEM_MAP.md`.
- Arquitetura Multiversal registrada em `docs/VITRINECITY_MULTIVERSAL.md`.
- Trabalho isolado na branch `feat/vitrinecity-multiversal-core`.
- PR de integração: `#145` (draft).
- Foi preservado o princípio de módulos independentes: Social, Marketplace, pagamentos/carteira, Entregas, Mapa/Navegação, Educação, Ads, Afiliados, Live, Jarvis e Vitriny Neural continuam usando suas implementações existentes.

### Risco conhecido

Há registro operacional anterior de divergência GitHub × VPS. Nenhum deploy do Multiversal deve substituir a árvore da VPS antes da reconciliação de produção.

---

## 2026-09-07 — Portal Multiversal e Core multicidade

**Estado:** EM VALIDAÇÃO.

### Conclusão

- Portal `/multiversal.html` criado.
- Registry inicial de universos centralizado no Multiversal Core.
- Serviço isolado `app/multiversal-server.js` criado.
- Serviço Docker separado e rota Caddy `/api/multiversal/*` adicionados.
- Cidades iniciais configuradas:
  - Silvânia/GO — piloto;
  - Anápolis/GO;
  - Vianópolis/GO.
- APIs de cidades, universos, contexto, eventos e transições implementadas.
- `localStorage` usado somente para conveniência de navegação; não é fonte de verdade para autorização, saldo, pagamento ou pedido.

### Testes

- `test-multiversal-core.mjs` — aprovado no release sweep.
- `test-multiversal-ui.mjs` — aprovado no release sweep.

---

## 2026-09-07 — Cidade Multiversal 3D

**Estado:** EM VALIDAÇÃO.

### Conclusão

- Cidade tridimensional WebGL/Three.js criada em `/cidade-multiversal-3d.html`.
- Câmera orbital, zoom, pinça, raycasting, prédios/portais clicáveis, HUD e fallback implementados.
- Núcleo Neural visual incluído.
- Atalhos antigos `cidade-3d.html` e `cidade-3d-viva.html` redirecionam para a nova experiência.
- A cidade 3D funciona como interface/orquestrador do ecossistema existente; não duplica checkout, sessões, carteira, pedidos ou permissões.

### Testes

- Sintaxe e presença dos destinos 3D cobertas por `test-multiversal-ui.mjs`.
- Validação visual/mobile real ainda pendente antes de produção.

---

## 2026-09-07 — Integração Vitriny Neural

**Estado:** CONCLUÍDO NO GIT / Quality Gate geral ainda em validação.

### Conclusão

- Multiversal passou a emitir eventos seguros para a Vitriny Neural:
  - `multiversal.enter`;
  - `multiversal.city-change`;
  - `multiversal.place-visit`;
  - `multiversal.realm-transition`.
- Eventos não carregam dados pessoais brutos nem `sourcePath` para aprendizado.
- Política Neural permanece com pagamentos e ações destrutivas desabilitados para automação.

### Correção do release

O primeiro `Verify release` executou 101 testes: 100 passaram e apenas `test-multiversal-neural.mjs` falhou. A falha era **determinismo do teste**, não comportamento funcional: a consulta ordenava eventos por UUID (`id`), embora UUID não represente ordem de inserção.

Correção aplicada:

- `f0c7ba8dfe65278cd796d81fc5644775ba0ebfc8` — `fix(multiversal): estabiliza ordem do teste Neural`
- O teste passou a ordenar eventos por `rowid`, preservando a sequência real de ingestão.

### Evidência CI após a correção

No head `3eeb21fcf7039e0a13c9f32305773d7b5f9c10b3`:

- workflow **Vitriny Neural**, run `#348`: **SUCCESS**;
- workflow **Verify release**, run `#350`: **SUCCESS**;
- suíte isolada completa: **SUCCESS**.

Portanto, a regressão funcional do Multiversal/Neural foi encerrada no Git.

---

## 2026-09-07 — Quality Gate SonarCloud e hardening

**Estado:** EM VALIDAÇÃO / bloqueia integração final.

### Evolução observada

No head `3eeb21fcf7039e0a13c9f32305773d7b5f9c10b3` o SonarCloud reportou:

- **Security Rating: E**;
- **Reliability Rating: C**;
- 6 apontamentos em código novo.

Após remover DOM dinâmico do portal e da cidade 3D, no head `4792931b8b3503e2436d7e2ed8f6d8b9fbe39f62`:

- **Security Rating: B**;
- **Reliability Rating: C**;
- 4 apontamentos.

### Hardening versionado

- `96a2a3693ae39ee82740ddcb9bbe94c6971f619f` — remove HTML dinâmico do Portal Multiversal e usa criação segura de nós DOM.
- `4792931b8b3503e2436d7e2ed8f6d8b9fbe39f62` — aplica o mesmo hardening à cidade WebGL 3D.
- `8843fba52db5d3da125c0e8a5e13293cc05763bd` — restringe destinos e imagens do portal à mesma origem.
- `068a6d48b642986b3807d1d8303c287025037c33` — restringe destinos e imagens da cidade 3D à mesma origem.
- `a0392d3608ccafd685793626cbd9b77b2cc96d5b` — remove salt de pseudonimização de fallback escrito no código, exige `VITRINY_NEURAL_PSEUDONYM_SALT` quando a captura Neural estiver habilitada, valida paths locais no backend, exige `Origin` nos POSTs e endurece shutdown.
- `7b02879ce72e72053147dcf81afaaf9fa61d4fe4` — adiciona regressão de DOM seguro e same-origin em `test-multiversal-ui.mjs`.
- `3f58903f2bb306a89092e17d662b11581ac1250a` — adiciona regressão de Origin obrigatório e paths locais em `test-multiversal-core.mjs`.

### Estado dos testes durante o hardening

- Vitriny Neural continuou passando após as mudanças de DOM e de core.
- O `Verify release` do head anterior ao último checkpoint estava em execução; não declarar o hardening concluído antes do novo resultado final.
- O SonarCloud do head após remoção de `innerHTML` melhorou Security de E para B, comprovando redução real da superfície apontada.

### Decisão

- CI funcional verde não será usado para ignorar o Quality Gate.
- Nenhum deploy será feito enquanto os apontamentos de segurança/confiabilidade não forem tratados ou tecnicamente justificados.
- Cada novo hardening recebe teste de regressão antes da continuidade da expansão multicidade.

---

## Próxima sequência autorizada

1. Fechar e registrar o Quality Gate do head atual.
2. Propagar contexto `cidade` de forma opt-in e compatível para:
   - Mapa Real;
   - Vitriny Social;
   - Marketplace;
   - Entregas.
3. Registrar cada integração neste arquivo no mesmo commit ou no commit imediatamente seguinte.
4. Criar métricas cross-realm e recomendações Neural de baixo risco.
5. Reconciliar GitHub × VPS antes de qualquer deploy que possa substituir código em produção.
6. Validar cidade 3D em mobile/WebGL e jornadas E2E.
7. Só então planejar entrada oficial na home e publicação.
