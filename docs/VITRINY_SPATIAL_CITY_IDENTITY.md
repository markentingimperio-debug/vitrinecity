# Vitriny Spatial · City Identity v1

## Objetivo

Dar a cada cidade do Vitriny Multiverse uma linguagem espacial própria sem duplicar regras de marketplace, social, pagamento ou logística. A identidade é uma camada visual/declarativa e não afirma reproduzir a arquitetura física real do município.

## Contrato

Cada cidade possui:

- `themeId`: identificador estável do tema;
- `tagline`: conceito curto exibível no HUD;
- `palette`: background, fog, ground, road, accent e secondary;
- `landmark`: marco espacial declarativo com id, nome, tipo, altura, raio e detalhe.

A Spatial API v1 expõe `identity` junto do registro público da cidade. O cliente valida cores, textos e tipos de landmark antes de aplicar o tema. Se a API estiver offline, usa um fallback local conhecido; strings remotas nunca viram CSS arbitrário.

## Identidades iniciais

| Cidade | Tema | Marco espacial |
| --- | --- | --- |
| Vitrine City | Neural Nexus | Vitriny Neural Spire |
| Silvânia | Cerrado Gardens | Coroa do Cerrado |
| Anápolis | Connected Axis | Arco Conector |
| Goiânia | Green Metropolis | Órbita Metropolitana |

Esses conceitos são identidades digitais do produto, não réplicas urbanísticas oficiais.

## Renderização

O explorer aplica a paleta validada ao ambiente, HUD, chão e vias e materializa um landmark 3D específico por cidade. O nível geométrico do marco respeita os perfis Lite, Standard e Ultra: aparelhos simples recebem menos segmentos e efeitos, enquanto dispositivos mais capazes recebem anéis e detalhes adicionais.

A camada `Environment v1` já consome a identidade para gerar skyline temático, vegetação, iluminação, mobiliário e uma zona Premium Ring. O plano é determinístico por cidade e perfil; o renderer usa `InstancedMesh` para reduzir draw calls das categorias repetitivas.

Os landmarks atuais são procedurais e declarativos: `spire`, `crown`, `arch` e `orbital`. Eles funcionam como assinatura visual da cidade sem controlar regras de negócio.

## Segurança e escala

- somente quatro IDs de cidade conhecidos são aceitos no cliente v1;
- somente cores hexadecimais `#RRGGBB` entram no tema;
- landmark kind usa enum fechado (`spire`, `crown`, `arch`, `orbital`);
- descritores Environment validam tipos, coordenadas e dimensões antes de renderizar;
- fallback offline nunca ativa comércio de cidade em preview;
- o tema pode ser cacheado porque não contém informação pessoal;
- a identidade fica separada de Presence e telemetria.

## Próximos passos

1. LOD por distância para skyline e vegetação;
2. iluminação por período do dia sem rastrear localização individual;
3. mobiliário e linguagem visual por distrito;
4. zonas premium patrocináveis com inventário espacial controlado;
5. novas cidades por registry versionado, mantendo validação e fallback;
6. usar métricas agregadas para otimizar desempenho, nunca para alterar identidade cultural automaticamente.
