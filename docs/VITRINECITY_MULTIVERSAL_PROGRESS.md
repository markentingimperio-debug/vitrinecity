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

- `test-multiversal-core.mjs` — passou no release sweep anterior.
- `test-multiversal-ui.mjs` — passou no release sweep anterior.

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

**Estado:** EM VALIDAÇÃO.

### Conclusão

- Multiversal passou a emitir eventos seguros para a Vitriny Neural:
  - `multiversal.enter`;
  - `multiversal.city-change`;
  - `multiversal.place-visit`;
  - `multiversal.realm-transition`.
- Eventos não carregam dados pessoais brutos nem `sourcePath` para aprendizado.
- Política Neural permanece com pagamentos e ações destrutivas desabilitados para automação.
- Workflow específico da Vitriny Neural passou no head anterior do PR.

### Correção do release

O primeiro `Verify release` executou 101 testes: 100 passaram e apenas `test-multiversal-neural.mjs` falhou. A falha era **determinismo do teste**, não comportamento funcional: a consulta ordenava eventos por UUID (`id`), embora UUID não represente ordem de inserção.

Correção aplicada no commit:

- `f0c7ba8dfe65278cd796d81fc5644775ba0ebfc8` — `fix(multiversal): estabiliza ordem do teste Neural`
- O teste agora ordena os eventos por `rowid`, preservando a sequência real de ingestão.

### Pendente imediato

- Confirmar novo `Verify release` após o commit de correção.
- Corrigir/validar o SonarCloud Quality Gate antes de declarar a branch integrável.

---

## Próxima sequência autorizada

1. Fechar `Verify release` e Quality Gate.
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
