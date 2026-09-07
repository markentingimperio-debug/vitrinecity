# Vitriny Spatial Core v1

## Objetivo

Transformar a Vitrine City em uma interface espacial expansível sem substituir marketplace, social, pagamentos, logística ou Vitriny Neural. O 3D é uma camada de experiência; os serviços atuais continuam sendo a infraestrutura econômica e social.

## Princípios

1. **Cidade atual preservada** — a experiência existente vira o primeiro mundo e não é removida durante o rollout.
2. **Streaming espacial** — carregar somente o chunk atual e vizinhos.
3. **Mundo reconstruível por dados** — posição, template, loja e estado pertencem ao modelo de dados; não ao arquivo 3D.
4. **Procedural antes de manual** — edifícios repetíveis e determinísticos por categoria e seed.
5. **Render adaptativo** — Lite, Standard e Ultra conforme capacidade do dispositivo e FPS real.
6. **URLs indexáveis** — cada mundo/distrito/local mantém rota HTML/SEO paralela à navegação 3D.
7. **Vitriny Neural recomenda; não quebra física** — personalização muda destaque, rota, conteúdo e ranking sem reescrever o mundo arbitrariamente.

## Hierarquia espacial

```text
Multiverse
  World
    Country
      Region
        City
          District
            Chunk (x,z)
              SpatialEntity
                Building / Portal / POI / Event
```

Rotas canônicas começam em `/v`, por exemplo:

```text
/v/br/go/vitrine-city
/v/br/go/vitrine-city/commerce
/v/br/go/anapolis/commerce/loja-exemplo
```

## Componentes v1

### World Router

Resolve rota espacial e portais entre destinos. Portal é dado declarativo `from -> to`; não contém regra de pagamento, autenticação ou negócio.

### Chunk Engine

Converte posição `x,z` em chunk, calcula conjunto desejado em torno do usuário e produz `load/unload/keep`. O renderer é responsável por materializar e descartar os recursos Three.js.

### Device Profiler

Perfis:

- Lite: celular básico, raio reduzido, sem sombras e baixa densidade.
- Standard: celular moderno e notebooks.
- Ultra: desktop/WebGPU, maior distância e efeitos.

O perfil pode descer ou subir com base em FPS observado.

### Procedural City

Gera dimensões e variações determinísticas de edifícios a partir de `seed + id + categoria`. Um mesmo ID sempre produz o mesmo prédio. Isso permite reconstrução sem salvar malha duplicada para cada loja.

### Central Plaza

Primeiro espaço premium. O núcleo visual é `Vitriny Neural Core`, cercado por oito distritos: Commerce, Social, Creator, Food, Education, Entertainment, Business e Services.

### Commerce Live Layer

A camada Commerce já pode consultar `/api/marketplace/stores` e transformar lojas publicadas em edifícios espaciais determinísticos. A entidade 3D mantém somente referência, apresentação pública e coordenadas; catálogo, estoque, preço e regras continuam pertencendo ao marketplace.

Ao selecionar um edifício de loja, o usuário entra no showroom espacial isolado. O showroom consulta apenas APIs públicas do marketplace, filtra o catálogo pela referência da loja e materializa até 24 produtos como entidades clicáveis. A página pública HTML da loja e as páginas de produto continuam sendo a fonte canônica para SEO e compra.

### Spatial Session Return

Antes de atravessar um portal ou entrar em uma loja, o cliente salva em `sessionStorage` somente estado efêmero de navegação: mundo, rota espacial segura, distrito, alvo, posição, yaw, pitch e timestamp. O retorno ao explorador valida versão, origem lógica, idade máxima e denylist de rotas sensíveis antes de restaurar a posição.

Não são gravados token, senha, carrinho, pagamento, sessão autenticada ou dados pessoais nesse estado espacial.

## Integração futura com dados

Modelo alvo:

```text
worlds
regions
cities
districts
spatial_chunks
spatial_entities
building_templates
portals
spatial_events
```

`spatial_entities.business_ref` pode apontar para Store ID, Course ID, Event ID etc., sem copiar os dados de negócio.

## Integração com Vitriny Neural

A Neural recebe sinais agregados de navegação espacial e pode sugerir:

- distrito em destaque;
- portal recomendado;
- lojas relevantes;
- eventos próximos;
- pré-carregamento de chunks;
- nível de renderização quando houver pressão de desempenho.

Alterações de pagamentos, permissões, segurança e deploy continuam fora da autonomia espacial.

## SEO

O mundo 3D não substitui páginas indexáveis. Cada entidade comercial deve continuar com HTML renderizável, metadados, dados estruturados, canonical e links internos. A rota espacial é uma camada adicional de navegação.

## Roadmap

1. **Spatial Core v1** — World Router, chunks, device profiles, procedural buildings e Central Plaza.
2. **Renderer v1** — Three.js, câmera, LOD, ciclo load/unload e descarte de recursos.
3. **Central Plaza visual** — arquitetura premium e portais.
4. **Commerce District v1** — Store ID -> Building ID, lojas vivas, showroom 3D, produtos clicáveis e retorno à posição anterior.
5. **Spatial API** — cidades, chunks e entidades servidos por endpoint versionado dedicado quando o volume justificar.
6. **Presence** — presença agregada; depois avatares e WebSocket.
7. **Multicity** — Silvânia, Anápolis, Goiânia e expansão por demanda.
8. **WebGPU/VR** — somente após métricas provarem necessidade.

## Critério para produção

O Spatial Core entra primeiro como rota isolada/preview. A cidade atual só passa a depender dele depois de testes de FPS, memória, fallback Lite, navegação por teclado/toque, carregamento progressivo, SEO e rollback. Showrooms espaciais permanecem desacoplados de checkout e pagamentos: qualquer compra continua passando pelas rotas públicas e regras transacionais existentes.
