# Vitriny Spatial API v1

## Objetivo

A Spatial API v1 separa a experiência 3D da definição de cidades e chunks. Ela permite que o Vitriny Multiverse cresça para várias cidades sem transformar a Central Plaza em um mapa monolítico.

## Cidades iniciais

| ID | Nome | Estado | Status |
| --- | --- | --- | --- |
| `vitrine-city` | Vitrine City | GO | active |
| `silvania` | Silvânia | GO | preview |
| `anapolis` | Anápolis | GO | preview |
| `goiania` | Goiânia | GO | preview |

`preview` significa que o mundo procedural e o contrato de API existem, mas não significa que todas as integrações comerciais da cidade estejam ativas.

## Hierarquia

```text
Vitriny Brasil
  Brasil (br)
    Goiás (go)
      Cidade
        Distrito
          Chunk x,z
            edifícios procedurais
```

As rotas espaciais continuam independentes das URLs HTML canônicas:

```text
/v/br/go/silvania
/v/br/go/anapolis/commerce
/v/br/go/goiania/social
```

## Endpoints

```text
GET /api/spatial/v1
GET /api/spatial/v1/worlds
GET /api/spatial/v1/cities
GET /api/spatial/v1/cities/:cityId
GET /api/spatial/v1/cities/:cityId/districts
GET /api/spatial/v1/cities/:cityId/districts/:districtId
GET /api/spatial/v1/cities/:cityId/chunks/:x/:z
```

Filtros públicos suportados em `/cities`: `country`, `region` e `status` (`active` ou `preview`).

## Chunks determinísticos

O endpoint de chunk não grava milhares de malhas no banco. Ele usa `worldKey + seed + chunk x,z` para reconstruir os edifícios de forma determinística. O mesmo chunk, na mesma versão, produz a mesma estrutura.

Coordenadas de chunk são inteiros limitados entre -2048 e 2048. O `chunkSize` inicial é 128 unidades.

## Segurança e privacidade

A API expõe apenas metadados públicos e geometria procedural. Ela não expõe:

- prospecção administrativa;
- usuários ou sessões;
- pagamentos, carrinho ou carteira;
- tokens e segredos;
- localização pessoal em tempo real.

Presence e Telemetry possuem contratos separados e `no-store`; a Spatial API pode usar cache público porque seus dados são declarativos/determinísticos.

## Evolução

A próxima fase pode mover o registro de cidades para PostgreSQL sem alterar o contrato `/api/spatial/v1`. Presence pode migrar para Redis e chunks podem ganhar object cache/CDN quando o volume justificar.
