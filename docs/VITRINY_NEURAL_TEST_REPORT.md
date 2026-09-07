# Vitriny Neural — Forced Evaluation Report

Data: 2026-09-07
Branch: `feat/jarvis-auto-learning-skills`

## Escopo
Este relatório registra os testes automatizados executados no GitHub Actions para a fundação do Vitriny Neural. Os números abaixo medem integridade do sistema, segurança, resiliência, roteamento de skills e comportamento da fila. Eles não representam ainda precisão semântica de um modelo de linguagem real.

## Resultado da suíte Neural
- Workflow `Vitriny Neural`: aprovado no commit de código `53baac7`.
- Avaliação determinística: 10/10 casos aprovados.
- Score de contrato e segurança: 1.00 (A+).
- Skills registradas: 7.
- Capacidades declaradas: 32.

Categorias avaliadas:
- integridade: 100%;
- resiliência: 100%;
- segurança: 100%;
- aprendizagem: 100%;
- cobertura de capacidades: 100%.

## Stress test em memória
- 5.000 eventos únicos ingeridos;
- 1.000 duplicados rejeitados corretamente;
- 4.995 eventos processados;
- 5 eventos enviados para dead-letter após falha permanente simulada;
- 20 eventos com falha transitória recuperados após retry;
- 27 rodadas de worker;
- aproximadamente 1,1 s no runner usado no teste.

## Stress test SQLite
- 3.000 eventos únicos;
- 600 duplicados rejeitados;
- 2.998 eventos processados;
- 2 dead-letters permanentes;
- 10 eventos recuperados por retry;
- 17 rodadas de worker;
- aproximadamente 0,53 s em SQLite in-memory no runner de CI.

## Falhas forçadas
O teste simulou um provider prioritário completamente indisponível. Após três falhas consecutivas, o circuit breaker abriu o circuito e o roteador passou a usar o provider saudável. O provider de fallback concluiu todas as tarefas testadas.

## Correção descoberta pelo stress test
A fila SQLite originalmente marcava falhas transitórias como `failed`, mas o worker só reclamava eventos `pending`, o que impediria retry real. A implementação foi corrigida para devolver falhas transitórias a `pending` até o limite de cinco tentativas; depois disso o evento vai para `dead_letter`.

## Segurança testada
A suíte verificou:
- rejeição de payload semelhante a credencial;
- bloqueio de ação de código fora da allowlist;
- bloqueio de tipo de mídia inválido;
- bloqueio de ação de growth inválida;
- bloqueio de pesquisa sem pergunta válida;
- exigência de aprovação explícita para lesson de revisão/alto risco;
- autoaprovação somente para lesson verificada, de baixo risco e alta confiança.

## Capacidades cobertas
- imagem, vídeo e áudio;
- engenharia de código;
- growth/marketing;
- pesquisa supervisionada;
- comércio/catálogo;
- atendimento;
- ranking/recomendação.

## Limite atual da medição
`semanticModelAccuracy` permanece não medido. A suíte usa providers sintéticos para provar roteamento, contratos e segurança. Para medir a qualidade real de raciocínio, código, marketing, pesquisa e multimodalidade será necessário conectar um modelo/provider real e rodar um benchmark com respostas esperadas e rubricas de avaliação.

## Situação da fundação
A fundação arquitetural v0.1 está pronta para integração controlada. Ela ainda não deve ser tratada como um produto final de IA, pois faltam os benchmarks semânticos contra modelos reais, integração com eventos de produção, ligação com a IA Gestora e implantação supervisionada.

## Critério para a próxima fase
A próxima fase deve medir separadamente:
1. precisão factual;
2. qualidade de código e taxa de testes aprovados;
3. qualidade de planos de marketing;
4. fidelidade a fontes em pesquisa;
5. qualidade de imagem/vídeo/áudio;
6. custo, latência e taxa de fallback por provider;
7. segurança contra prompt injection e uso indevido de ferramentas.
