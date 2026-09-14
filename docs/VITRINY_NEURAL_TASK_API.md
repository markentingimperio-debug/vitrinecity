# Vitriny Neural — chat de tarefas, piloto local

## O que esta entrega implementa

Atualização: o controle opt-in de planos/créditos e a medição por tentativa estão descritos em [VITRINY_NEURAL_AI_CREDITS.md](VITRINY_NEURAL_AI_CREDITS.md). Ele substitui a allowlist por períodos explícitos quando habilitado e separa uso desconhecido de zero. Continua sem cobrança automática, preços em reais ou integração de pagamento de plano de IA. As limitações abaixo sobre faturamento exato do piloto original não equivalem a ausência do novo ledger.

O administrador e as lojas autorizadas enviam um comando em português, sem escolher modelo ou tipo de tarefa. Um modelo local qualificado decide entre rascunho de site/código, texto/roteiro e pedido não suportado. O motor valida cada ação, mantém versões dos arquivos em SQLite e mostra o resultado para revisão humana.

Isto é uma API própria de orquestração e um chat de rascunhos. Não é um novo modelo fundacional, treinamento de pesos, computação quântica ou uma réplica do Codex. Não incorpora pesos ou prompts privados de outros fornecedores. A redução de custos ainda precisa ser medida com hardware, consumo, qualidade e volume reais; não há garantia de economia de 90% ou de eficácia de 100%.

| Pedido | Comportamento desta versão |
| --- | --- |
| “Crie um site para minha loja” | Produz arquivos de rascunho, incluindo `index.html`; não executa, testa nem publica o site |
| “Crie um roteiro de divulgação” | Produz texto revisável |
| “Crie uma imagem de cachorro” | Deve identificar ferramenta ausente e bloquear, sem inventar imagem |
| “Edite e publique um vídeo” | Não suportado neste piloto |
| “Entre no site e corrija o sistema” | Não há navegador, shell, GitHub ou deploy disponíveis ao modelo |

`draft_ready` significa somente “rascunho disponível”, não “resultado correto”, “testado” ou “publicado”. Os testes determinísticos validam o motor e suas barreiras; não comprovam que um modelo real classifica todas as intenções ou escreve código correto.

## Integração existente reutilizada

- A instância de `mountJarvis(...).neural.service` fornece registry, qualificações e banco. Não há um segundo núcleo Neural.
- `task-engine.js` controla passos, escopo, cotas e versões. `task-protocol.js` contém nosso contrato fixo de ações.
- `skills/registry.js` filtra `localOnly` e `allowedProviders` antes de consultar disponibilidade; preferências e avaliação não anulam essas restrições. Falhas podem tentar outro local qualificado, nunca o fallback remoto nesta API.
- O adaptador compatível com Chat Completions recebe o protocolo fixo por opção interna `taskProtocol: 'draft-v1'`. O conteúdo do usuário não vira instrução de sistema nem escolhe essa opção.
- `tasks-api.js` usa autenticação administrativa ou o acesso existente do portal da loja, com pedido aprovado, perfil ativo e MFA quando habilitado. O escopo é derivado no servidor; não se associa propriedade de loja por e-mail.
- `neural-workspace.html` mostra histórico, acompanhamento, cancelamento, cotas e downloads. O chat administrativo possui link no painel Neural. Para lojistas, o caminho é `/neural-workspace.html?store=REFERENCIA`, com token digitado e mantido somente em memória. Não coloque token em URLs. A autenticação de segundo fator é concluída no portal existente.

## Configuração de homologação

O recurso é desabilitado por padrão. Esta alteração não o ativa nem publica em produção.

```dotenv
VITRINY_NEURAL_ENABLED=1
VITRINY_NEURAL_MODE=advisory
VITRINY_NEURAL_TASKS_ENABLED=1
VITRINY_NEURAL_TASKS_STORES=referencia-da-loja-piloto
VITRINY_NEURAL_TASKS_DAILY=10
VITRINY_NEURAL_TASKS_TIMEOUT_MS=120000
```

Uma lista de lojas vazia habilita somente o administrador. A lista é uma autorização manual de piloto, NÃO uma verificação de contratação de plano de IA. Não vender acesso automático com base nela. `shadow` não executa tarefas.

Configure o servidor local existente por `VITRINY_NEURAL_MODEL_ORIGIN`/`VITRINY_NEURAL_MODEL_NAME` ou pelas opções `JARVIS_LOCAL_MODEL`. Confira que o destino é realmente seu servidor privado. A marca `local` é metadado administrativo, não prova de localização nem firewall; uma URL remota marcada incorretamente pode enviar dados para fora. Exigir bloqueio de saída e allowlist de destinos na infraestrutura antes de operar com dados privados.

Antes de liberar o piloto:

1. Verificar licença do modelo escolhido, capacidade de inferência, memória, latência e suporte a cancelamento do servidor. Não são instalados pesos por esta PR.
2. Executar o benchmark real pelo painel Neural autenticado, que persiste a qualificação no banco usado pelo serviço. `npm run benchmark:neural` é um diagnóstico separado: imprime um relatório, mas não persiste essa autorização.
3. O provedor precisa estar habilitado, ser local e possuir qualificação elegível para `code.plan`; para roteiros, também `growth.content-plan`. O `modelName` configurado deve corresponder exatamente ao registro. Se mudar modelo, alias, pesos ou endpoint, refazer o benchmark; o alias não é uma impressão digital dos pesos.
4. Executar casos reais de tarefas curtas no chat administrativo em homologação. O benchmark genérico não cobre sozinho o protocolo de arquivos; revisar roteamento, conteúdo, segurança e tempo de conclusão.
5. Liberar uma loja piloto e repetir os casos, incluindo acesso cruzado, cancelamento, falhas e recuperação. Manter aprovação humana dos artefatos.

Um provedor não qualificado retorna `task_provider_unqualified`; não retirar a barreira ou inventar uma qualificação para fazê-lo passar. Nos testes locais os registros artificiais existem apenas nos bancos descartáveis das fixtures.

## API

Bases: `/api/admin/vitriny-neural/tasks` e `/api/store-portal/:reference/neural/tasks`.

| Método / sufixo | Função |
| --- | --- |
| `GET /status` | Habilitação, ferramentas, limites e consumo do escopo |
| `GET /` | Últimas 50 tarefas do escopo |
| `POST /` | Cria tarefa com `instruction` e `idempotencyKey` |
| `GET /:id` | Estado, passos, arquivos e resultado |
| `POST /:id/run` | Inicia tarefa pendente; repetição não reexecuta |
| `POST /:id/cancel` | Cancela e propaga aborto da inferência |
| `GET /:id/file?path=index.html` | Download autenticado de texto, sem renderização |

Mutações exigem autenticação, `Content-Type: application/json`, `X-Neural-Request: 1` e origem permitida. Lojistas enviam `X-Store-Token`; o corpo não aceita `scope`, modelo, ferramenta, URL de provedor, políticas ou opções de avaliação. O token legado é removido antes de chamar o motor. Respostas privadas usam `Cache-Control: no-store`.

Exemplo de corpo para criação:

```json
{
  "instruction": "Crie um site simples para minha loja de jardinagem.",
  "idempotencyKey": "pedido-jardinagem-0001"
}
```

Criar retorna `201`, repetição idêntica `200`, e iniciar retorna `202`. A mesma chave com instrução diferente é conflito `409`. Uma execução terminal não é repetida automaticamente; uma nova tentativa deliberada exige uma nova tarefa e nova cota. O chat faz criação e início sequencialmente e acompanha o estado; não existe um worker de replay após reinício.

## Limites e segurança

- Até 8 chamadas por tarefa, no máximo 1.200 tokens solicitados por chamada, 30 segundos por etapa e 120 segundos por tarefa por padrão (configurável até 300 segundos).
- Por padrão 10 criações e 10 inícios por dia UTC por escopo; 100 criações e 100 inícios globais por dia. Backlog de outro dia também consome cota de execução. Cancelamento/falha não devolve consumo. `usage.dailyTasks/remaining` contabiliza criação; `dailyRuns/remainingRuns`, execução.
- Até 2 tarefas concorrentes e 1 por escopo. Cancelamento não libera imediatamente a reserva enquanto a chamada ao provedor continua pendente; respostas tardias não gravam arquivos e o aborto não inicia fallback.
- Piloto previsto para UM processo executor. Reservas SQLite não são garantia de isolamento de recursos entre múltiplos processos com inferências que ignoram aborto após expiração/reinício. Para escalar, implantar fila dedicada e cancelamento confirmado no servidor de inferência.
- 10 arquivos, 32 KiB por versão e 256 KiB acumulados por tarefa. Somente caminhos relativos e extensões de texto permitidas. São linhas inertes no banco, NÃO um sandbox de sistema operacional. Não há escrita de arquivos do servidor ou acesso aos dados de outra loja.
- Downloads recebem `attachment`, `text/plain`, `nosniff` e CSP restritiva. O chat não executa HTML/JS gerado. Um arquivo baixado ainda é código não confiável: revisar antes de abrir como página, executar ou publicar.
- Até 200 tarefas retidas por escopo e 2.000 globais. Não há expurgo automático nesta versão: ao atingir o teto, novas tarefas são bloqueadas. Definir exportação, retenção, recuperação e exclusão administrativa antes de escalar. Não apagar dados para contornar o limite durante o piloto.
- Textos privados não são inseridos automaticamente na memória compartilhada ou nos datasets. Padrões conhecidos de chaves são rejeitados, mas isso não é um detector completo de segredos. Não enviar credenciais no chat. O banco e seus backups precisam de proteção e política de retenção próprias.
- Uso de tokens reflete respostas devolvidas com sucesso; inferências canceladas, falhas e consumo interno do servidor podem não estar incluídos. Não usar este contador como faturamento exato.

## Verificação desta entrega

Na pasta `app`:

```sh
npm run test:neural
npm run test:neural:tasks
```

Cobertura: protocolo, criação/revisão/download de arquivos, classificação simulada de texto/site/indisponível, isolamento de lojas, CSRF, MFA, política local, qualificação por modelo, idempotência, cotas de criação/execução, cancelamento, timeout, respostas tardias, reinício sem replay, sanitização de erros, DOM do chat e smoke do `server.js` real. O smoke usa banco temporário e bloqueia conexões externas. A revisão visual em navegador remoto não foi concluída: o navegador bloqueou o endereço local do servidor de teste.

Os provedores desses testes são simulados. Nenhuma dessas execuções comprova qualidade de um modelo real, throughput da VPS, confiabilidade de serviços externos ou economia. Não foi feito deploy.

## Próximos marcos antes de vender autonomia ampla

1. Validar o modelo local real no protocolo e medir conclusão correta por categoria, latência p95, consumo por tarefa e correções humanas. Estabelecer um conjunto de aceitação separado dos exemplos de desenvolvimento; publicar resultados e falhas, não uma porcentagem presumida.
2. Conectar o entitlement de plano de IA por loja, revogação, ledger de consumo e limites comerciais; não basta ter uma loja ou estar na allowlist.
3. Criar executor de código isolado com diretório temporário, rede restrita, processos/memória/tempo limitados e evidências de testes. Só então acrescentar navegador e integração Git/PR, com credenciais específicas e aprovações.
4. Adicionar adaptadores reais de imagem/vídeo e contratos de jobs/artefatos, cancelamento e validação. Um modelo de texto não gera mídia por receber uma capability com esse nome.
5. Integrar OAuth e publicação nas redes com prévia, aprovação, idempotência e recibo verificável da plataforma. Um texto do modelo não é recibo de publicação.
6. Fazer implantação supervisionada, monitoramento e rollback antes de ampliar o piloto. Nenhum modelo pode prometer executar corretamente qualquer pedido.
