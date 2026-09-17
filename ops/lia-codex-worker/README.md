# LIA Codex Worker

Worker interno da LIA para integrar `@openai/codex-sdk` em uma VPS separada.

A versão inicial é fail-closed: carrega o SDK, valida workspaces Git e expõe health/dry-run, mas não executa nenhuma tarefa paga. O endpoint `/v1/run` permanece bloqueado até uma fase posterior em que o Gateway emita uma autorização de orçamento.

Controles iniciais:
- bind somente em `127.0.0.1:8790`;
- autenticação por token interno;
- nenhum `OPENAI_API_KEY` é criado pelo instalador;
- `LIA_CODEX_EXECUTION_ENABLED=0` por padrão;
- workspaces restritos a `/opt/lia/workspaces`;
- produção, web search e acesso de rede desativados nesta fase.
