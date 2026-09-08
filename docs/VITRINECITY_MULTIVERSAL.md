# VitrineCity Multiversal

## Visão

A VitrineCity Multiversal é a camada de navegação e orquestração que conecta as experiências já existentes da VitrineCity. O objetivo não é criar vários produtos isolados, mas permitir que cidade digital, mapa real, Vitriny Social, marketplace, logística, educação e Vitriny Neural funcionem como universos interligados de um mesmo ecossistema.

## Princípio de arquitetura

**Um usuário, uma identidade, vários universos.**

Cada universo é uma experiência especializada com uma rota de entrada, contexto próprio e capacidades específicas. A transição entre universos deve preservar identidade, sessão, cidade selecionada e, progressivamente, contexto de navegação.

### Camada 1 — Portal Multiversal

Implementação inicial em `/multiversal.html`.

Responsabilidades:

- catálogo dos universos disponíveis;
- busca e filtros;
- deep link via `?universo=<slug>`;
- persistência local do último universo visitado;
- navegação para módulos já existentes sem duplicar funcionalidades.

Universos iniciais:

| Universo | Rota | Papel |
| --- | --- | --- |
| Centro Vitrine 2.5D | `/cidade-25d-demo.html` | exploração da cidade digital |
| Mundo Real | `/mapa-real.html` | geolocalização e empresas físicas |
| Vitriny Social | `/social.html` | descoberta e relacionamento |
| Mercado & Lojas | `/loja.html` | comércio e marketplace |
| Vitrine Entregas | `/entregas.html` | logística local |
| Centro Educacional | `/centro-educacional.html` | cursos e conhecimento |
| Vitriny Neural | `/jarvis-public.html` | inteligência e assistência |
| Navegação | `/navegar.html` | rotas e transição entre cidades |

### Camada 2 — Contexto compartilhado

Próxima evolução: criar um contexto comum de sessão para que a troca de universo preserve:

- `userId` autenticado;
- `cityId`/cidade ativa;
- `realmId`/universo ativo;
- entidade em foco, por exemplo loja, produto, pessoa ou pedido;
- origem da jornada;
- consentimentos e preferências aplicáveis.

O contexto deve ser mantido no servidor para dados de negócio. `localStorage` é usado apenas no MVP para conveniência de navegação, nunca como fonte de verdade para autorização, saldo, pedidos ou identidade.

### Camada 3 — Registry de universos

Migrar a lista estática do MVP para um registry do backend. Estrutura conceitual:

```text
multiversal_realms
  id
  slug
  title
  category
  entry_path
  image_path
  status
  city_scope
  capabilities
  created_at
  updated_at
```

Endpoints previstos:

```text
GET  /api/multiversal/realms
GET  /api/multiversal/context
POST /api/multiversal/transition
```

`POST /api/multiversal/transition` deve registrar apenas telemetria e contexto permitido; a autorização do destino continua sendo responsabilidade do módulo de destino.

### Camada 4 — Multicidade

O mesmo universo poderá existir em várias cidades sem copiar a aplicação. A cidade vira contexto:

```text
/multiversal.html?cidade=silvania-go
/multiversal.html?cidade=anapolis-go
/multiversal.html?cidade=vianopolis-go
```

A expansão deverá usar dados por cidade para lojas, eventos, entregas, destaques e conteúdo social, mantendo um núcleo de aplicação único.

## Integração com Vitriny Neural

A Vitriny Neural deve atuar como orquestradora e não como substituta dos módulos. Exemplos de ações futuras:

- sugerir o universo mais adequado para a intenção do usuário;
- levar uma busca de produto do Social para uma loja relevante;
- levar uma compra confirmada para o acompanhamento de entrega;
- recomendar empresas próximas no mapa real;
- manter contexto sem expor dados de um módulo a outro além do necessário.

A execução continua submetida aos gates de política, autenticação e orçamento de ação já existentes na Vitriny Neural.

## Jornada de referência

```text
Vitriny Social
      ↓
Centro Vitrine 2.5D
      ↓
Loja / Marketplace
      ↓
Pagamento
      ↓
Vitrine Entregas
      ↓
Mapa / acompanhamento
      ↓
Social / relacionamento pós-compra
```

## Fases de implementação

### Fase 1 — Portal navegável

Status: iniciado nesta branch.

- [x] criar identidade visual Multiversal;
- [x] conectar módulos existentes em cards de universo;
- [x] busca e filtros;
- [x] deep link por slug;
- [x] continuar último universo;
- [x] layout responsivo e acessível;
- [ ] adicionar entrada oficial na home após validação.

### Fase 2 — Contexto e telemetria

- [ ] registry backend;
- [ ] transições instrumentadas;
- [ ] contexto de cidade compartilhado;
- [ ] métricas de entrada, saída e conversão entre universos;
- [ ] integração com ranking e recomendações.

### Fase 3 — Multicidade

- [ ] seletor de cidade único;
- [ ] catálogo e destaques por cidade;
- [ ] lojas e serviços geolocalizados;
- [ ] feeds sociais locais;
- [ ] logística e disponibilidade por raio/cidade.

### Fase 4 — Orquestração Neural

- [ ] recomendação automática de universo;
- [ ] jornadas cross-realm assistidas;
- [ ] personalização segura por contexto;
- [ ] otimização contínua por métricas de retenção e conversão.

## Critérios de segurança e evolução

1. Não duplicar autenticação, pagamentos, pedidos ou autorização no Portal Multiversal.
2. Não confiar em parâmetros de URL ou `localStorage` para privilégios.
3. Manter cada módulo responsável por validar acesso às próprias ações.
4. Adicionar novos universos por registry/configuração, evitando novos forks da aplicação.
5. Medir transições e conversões antes de automatizar decisões de navegação pela IA.
