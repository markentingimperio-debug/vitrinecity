# Vitriny Spatial · Environment v1

## Objetivo

Adicionar identidade urbana escalável às cidades do Vitriny Multiverse sem modelar cada objeto manualmente e sem misturar a camada 3D com regras de negócio.

## Pipeline

```text
City Registry
  -> City Identity
  -> Environment Planner
  -> Spatial API /environment
  -> Client Validator
  -> Three.js Environment Renderer
```

O planner é determinístico por `city.seed + profile`, então a mesma cidade e o mesmo perfil geram o mesmo skyline e mobiliário. A API só publica descritores; o navegador continua responsável pela materialização gráfica.

## Camadas

- `skyline`: edifícios temáticos periféricos;
- `vegetation`: árvores, jardins, copas e palmeiras declarativas;
- `lights`: iluminação urbana leve ao redor da Central Plaza;
- `furniture`: bancos, quiosques e assentos de mobilidade;
- `zones`: Central Plaza, pátio intermunicipal e Premium Ring.

## Perfis

### LITE

Poucos objetos e geometrias simples. Prioriza celulares básicos e menor número de draw calls.

### STANDARD

Densidade intermediária para celulares modernos e notebooks.

### ULTRA

Skyline, vegetação e iluminação mais densos para desktop e hardware forte.

O renderer usa `InstancedMesh` nas categorias repetitivas para manter draw calls baixos mesmo quando a cidade ganha densidade visual.

## Identidades iniciais

- Vitrine City: skyline tecnológico/neural;
- Silvânia: cidade-jardim com maior presença de Cerrado e terraços;
- Anápolis: eixo urbano de mobilidade e negócios;
- Goiânia: metrópole verde com torres e áreas ajardinadas.

Essas linguagens são identidades digitais da plataforma e não pretendem reproduzir literalmente a arquitetura real das cidades.

## API

```text
GET /api/spatial/v1/cities/:cityId/environment?profile=LITE|STANDARD|ULTRA
```

A resposta é pública, cacheável e não contém informações pessoais.

## Segurança

- IDs de cidade e perfis são validados;
- coordenadas e dimensões possuem limites;
- tipos de objetos usam enums fechados no cliente;
- descritores remotos não executam código nem CSS arbitrário;
- cidade `preview` continua sem comércio local ativo;
- a camada Environment não toca checkout, pagamentos, autenticação, permissões ou estoque.

## Próximas etapas

1. iluminação por período do dia sem depender de localização individual;
2. mobiliário por distrito;
3. zonas premium patrocináveis como inventário espacial controlado;
4. LOD por distância para skyline e vegetação;
5. descarte e pré-carregamento de ambiente por região;
6. telemetria agregada de FPS para ajuste automático de densidade.
