# Vitriny Neural — Arquitetura escalável

## Objetivo

Transformar a inteligência da VitrineCity em uma camada separável, observável e portável. O núcleo deve poder começar no mesmo servidor da aplicação e migrar depois para infraestrutura própria, GPU dedicada, PostgreSQL, filas distribuídas, object storage e vector database sem reescrever a lógica de aprendizagem.

## Princípios

1. **Event-driven:** toda aprendizagem nasce de eventos explícitos, versionados e idempotentes.
2. **Storage adapter:** a lógica do Vitriny Neural não conhece SQLite diretamente. O storage atual é um adaptador substituível.
3. **Separação de hot path e learning path:** requisições do usuário não esperam por treinamento ou análise pesada.
4. **Aprendizagem por sinais e recompensa:** métricas agregadas viram sinais; hipóteses viram lessons; resultados confirmam ou rejeitam hipóteses.
5. **Baixo risco automático, alto risco supervisionado:** ranking e recomendações podem usar testes limitados; pagamentos, exclusões, segurança e mudanças destrutivas exigem aprovação.
6. **Portabilidade:** dados do aprendizado devem ser exportáveis em formatos abertos e reproduzíveis.
7. **Observabilidade:** eventos, tentativas, dead letters, sinais, lessons, versões e decisões ficam auditáveis.
8. **Sem segredos na memória:** tokens, chaves e credenciais são bloqueados na ingestão.

## Camadas

```text
VitrineCity
  ├─ Marketplace
  ├─ Vitriny Social
  ├─ Busca / Ranking
  ├─ Ads
  ├─ Growth
  ├─ IA Gestora
  └─ Agentes
        │ eventos
        ▼
Vitriny Neural Core
  ├─ Event Ingestion
  ├─ Queue / Leasing
  ├─ Signal Aggregation
  ├─ Learning / Rewards
  ├─ Experiments
  ├─ Memory / RAG
  ├─ Model Router
  └─ Audit / Checkpoints
        │
        ├─ SQLite hoje
        ├─ PostgreSQL depois
        ├─ Redis Streams / Kafka para alto volume
        ├─ Object Storage para datasets
        └─ Vector Store para memória semântica
```

## Ciclo de aprendizagem

```text
evento -> agregação -> sinal -> hipótese -> teste -> recompensa -> lesson -> ranking/modelo
```

Exemplos de eventos:

- `content.view`
- `content.completed`
- `search.query`
- `search.click`
- `product.view`
- `cart.added`
- `order.paid`
- `ad.impression`
- `ad.click`
- `campaign.conversion`
- `platform.error`
- `agent.action`
- `ai_manager.recommendation`
- `code.deploy`
- `experiment.exposure`
- `experiment.outcome`

## Frequências

O sistema pode observar em tempo real, mas não deve treinar pesos de modelo a cada segundo.

- segundos: ingestão de eventos;
- 1 minuto: agregação rápida e detecção de anomalias;
- 5–15 minutos: ranking, tendências e recomendações;
- hora: análise de padrões e experimentos;
- dia: consolidação de lessons e memória;
- semana: preparação de dataset e avaliação de possível fine-tuning/LoRA.

## Simbiose com a IA Gestora

O Vitriny Neural deve poder registrar perguntas e propostas para a IA Gestora sem permitir que uma IA aprove a outra cegamente.

Fluxo recomendado:

1. Neural detecta padrão.
2. Gestora revisa evidência e contexto.
3. Neural transforma parecer em hipótese testável.
4. Experimento limitado mede resultado.
5. Resultado vira recompensa.
6. Lesson entra na memória com confiança atualizada.

Regra sugerida:

- confiança < 0,60: somente observação;
- 0,60–0,85: pedir análise da Gestora;
- 0,85–0,95: teste controlado;
- >= 0,95 + evidência verificada + baixo risco: pode ser aprovado automaticamente;
- qualquer ação financeira, destrutiva, de segurança ou de produção crítica: aprovação humana.

## Escala por estágio

### Estágio 1 — VPS atual

- Node.js
- SQLite WAL
- workers no mesmo host
- fila em `neural_events`
- modelo local opcional

### Estágio 2 — serviços separados

- aplicação web continua na VPS
- Vitriny Neural em serviço próprio
- PostgreSQL para eventos/lessons
- Redis Streams para fila
- GPU separada para modelos

### Estágio 3 — alto volume

- Kafka ou equivalente para eventos
- consumidores independentes por domínio
- object storage para datasets e mídia
- vector database para RAG
- workers autoscaláveis
- model gateway com múltiplos provedores/modelos

### Estágio 4 — plataforma distribuída

- múltiplas regiões
- feature store
- experiment platform
- online/offline ranking
- treinamento periódico versionado
- canary rollout e rollback automático

## Contrato de storage

O core depende apenas dos métodos:

- `init`
- `enqueueEvent`
- `claimEvents`
- `ackEvent`
- `failEvent`
- `recordSignal`
- `addLesson`
- `transitionLesson`
- `status`

Isso permite criar depois `postgres-store.js`, `redis-stream-store.js` ou outro adaptador sem alterar a lógica de negócio.

## Migração sem perda de aprendizado

Antes de migrar:

1. congelar ingestão por poucos segundos ou usar dual-write;
2. exportar eventos, sinais, lessons, checkpoints e auditoria;
3. validar contagens e checksums;
4. iniciar novo storage em modo shadow;
5. comparar resultados dos dois caminhos;
6. trocar leitura/escrita para o novo backend;
7. manter rollback por janela definida.

Os checkpoints permitem retomar consumidores sem reprocessar toda a história.

## Regras permanentes de segurança

- nunca guardar segredos em eventos ou lessons;
- dados pessoais devem ser minimizados ou pseudonimizados;
- nenhuma lesson pode autorizar pagamento, transferência, exclusão destrutiva ou mudança de segurança;
- mudanças de código seguem branch -> testes -> PR -> revisão -> deploy;
- modelos externos não recebem dados privados sem política explícita;
- toda automação relevante deve ter auditoria e caminho de rollback.

## Arquivos iniciais

- `app/vitriny-neural/core.js`: lógica independente de storage;
- `app/vitriny-neural/sqlite-store.js`: implementação local inicial;
- `app/scripts/test-vitriny-neural.mjs`: teste do contrato básico.

A próxima integração deve conectar os principais eventos da VitrineCity ao `ingest()` e expor um painel administrativo de saúde, fila, lessons e experimentos.
