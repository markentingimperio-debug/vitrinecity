# Processamento observacional de eventos espaciais

## Escopo e decisão de ativação

Implementação revisável, **desabilitada por padrão**. A versão em produção em
11/09/2026 às 14h06 UTC era `8874ff3`; a leitura somente de metadados encontrou
754 eventos `spatial.aggregate` e cinco eventos de skills pendentes, todos sem
tentativas. A captura existia, mas `workBatch` não tinha um consumidor integrado.
Sinais do observador social são independentes dessa fila.

Este processamento não é treinamento de modelo nem comprovação de melhoria.
Ele transforma somente agregados espaciais em sinais numéricos com recibos,
sem API de IA, rede, publicação, mensagens, pagamentos, lessons ou aprovações.
Os modos e critérios do Neural continuam intactos.

**Ativar em produção exige revisão e aprovação específica.** A entrega de código
não altera ambiente nem consome a fila histórica. A flag opcional
`VITRINY_NEURAL_SPATIAL_EVENTS_ENABLED=1` só tem efeito quando a Neural também
está habilitada e seu modo não é `disabled`. Não mudar `shadow` para ativar.
Não oferecer um botão de drenagem manual ou inicialização imediata no deploy.
Além da flag, a Central precisa estar habilitada e sem pausa. Política ausente,
inacessível ou pausada bloqueia o lote sem consumir tentativas. O agendamento
permanece disponível para respeitar uma retomada autorizada no próximo tick;
esse módulo não altera a política. O controle é relido dentro da transação.

## Contrato e prova

- Lotes de até 25 eventos por minuto, com limite interno máximo e transação
  SQLite `immediate`: selecionar pendentes, gravar sinais e confirmar eventos
  no mesmo bloco síncrono. Não há espera de rede dentro da transação.
- Apenas `spatial.aggregate` com origem `spatial`; cidades/distritos vêm das
  listas do código e o runtime permitido é `multiverse-render`. O canal também
  precisa corresponder à entidade.
- Outros tipos, origens e estados ficam intocados, inclusive os cinco eventos
  antigos de skills. Nenhuma conclusão de skill vira aprendizado.
- Valores ausentes, strings, nulos, negativos ou não finitos não viram zeros.
  Eventos espaciais inválidos ficam para revisão, com erro sanitizado e sem
  reenvio automático. Erro de banco desfaz a transação inteira.
- O recibo em `outcome_json` identifica sinais realmente gravados. Um evento
  só vira `processed` junto com essa gravação. Repetição/reinício não duplica.
- Metadados são reconstruídos com campos permitidos. Não copiar conversas,
  contexto de skills, `actorHash`, payload livre ou credenciais.
- `service.status().spatialEvents` informa ativação, execução e contagens. Está
  disponível no endpoint administrativo autenticado existente, com `no-store`.

## Limites da interpretação

`activeCount` é presença simultânea de sessões naquele instante, não pessoas
únicas. `eventCount` é um snapshot de contadores mantidos por buckets móveis.
Não somar snapshots consecutivos nem somar cidades e distritos como públicos
independentes. Isso duplicaria atividade observada.

Os dados históricos só guardam `windowMinutes`, não os limites dos buckets.
Por isso os sinais usam `occurredAt` como observação pontual e guardam a janela
**nominal** em metadados; não inventam um intervalo exato nem atualizam a data
da observação antiga para a data de processamento.

`byFps` conta todos os tipos de evento do tracker, enquanto `renderSamples`
conta somente `render_sample`. Não dividir um pelo outro, não calcular uma
porcentagem de qualidade a partir deles e não contar os grupos FPS como
visitantes. A origem é telemetria do cliente, não medição independente.

## Verificação isolada e ativação futura

1. Executar `npm run test:neural:spatial-events` e `npm run test:neural` em `app`.
   Os testes usam SQLite temporário/em memória e fixtures, sem dados reais.
2. Revisar o diff e a CI. A branch tem como base a branch real de produção,
   `feat/city-architecture-20260910`, e não o `main` desatualizado.
3. Antes de qualquer ativação aprovada: conferir tarefas concorrentes, versão,
   imagem, pausas e flag atuais; adquirir o bloqueio compartilhado de deploy
   e preparar recuperação própria. Não reutilizar backups antigos.
4. Na eventual publicação, manter o consumidor desligado até aprovação. Após
   habilitação autorizada, esperar o tick normal, sem forçar a fila. Verificar
   recibos e sinais dos primeiros eventos e os cinco eventos de skills intactos.
5. Comparar o custo de escrita e a latência real antes de ampliar o lote. Não
   interpretar essa implementação como fila de IA, capacidade ilimitada ou
   primeira revisão diária da Lia.

Recuperação: desabilitar o consumidor aprovado e restaurar somente código/imagem
se necessário. Preservar sinais, recibos, eventos e banco atual; não reverter um
banco inteiro, reenfileirar eventos processados ou apagar observações.
