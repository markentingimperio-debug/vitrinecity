# OpenAI Luna, Terra e Astra — preparação isolada

O adaptador `app/vitriny-neural/providers/openai-paid-chat.js` aceita os aliases exatos `gpt-5.6-luna`, `gpt-5.6-terra` e `gpt-6-astra`, mediante seleção explícita do servidor. O modelo padrão continua `gpt-4o-mini` e `enabled` continua `false`. Nenhuma rota, automação, variável de produção ou cobrança é ativada por esta alteração.

Escolha alinhada ao pedido inicial por um GPT atual e econômico e ao pedido posterior de poder escolher modelos ou esforços maiores quando a tarefa exigir, com preço correspondente ao modelo mais 15% e saldo pré-pago. A chave existente foi aceita em uma consulta de modelos somente leitura (HTTP 200), e os três aliases estavam disponíveis. Chaves da API não são específicas de um modelo; não foi necessário criar ou substituir a credencial. Essa consulta não verificou saldo nem fez geração paga. O seletor automático de tarefas e sua integração com a carteira ainda não estão ligados por esta entrega.

Na documentação consultada em 14/09/2026, Luna publica USD 0,20 por milhão de tokens de entrada comum, USD 0,02 de entrada em cache e USD 1,20 de saída. Terra publica USD 2 / 0,20 / 12, e Astra USD 10 / 1 / 50 nas mesmas categorias. Estes valores são referência datada, não um registro de preços ativo. Cada categoria usa o custo do modelo escolhido multiplicado por 1,15 uma única vez, antes da conversão para reais; escrita de cache e contexto longo precisam de tratamento específico descrito abaixo. Não alterar `OPENAI_MODEL` global: ele também influencia outros fluxos existentes da plataforma.

## Contrato limitado

- Um POST à origem oficial, texto somente, sem ferramentas, mídia, streaming, fallback ou reenvio automático.
- `reasoningEffort` é uma configuração imutável do construtor no servidor, nunca um campo aceito por mensagem do cliente. O hash do corpo resolve exatamente os mesmos valores padrão, incluindo `reasoning_effort`. Uma autorização para outro modelo ou menor esforço não autoriza uma troca.
- Luna e Terra aceitam `none`, `low`, `medium`, `high`, `xhigh` e `max`; o padrão próprio deste adaptador é `none`. Astra aceita `low`, `medium`, `high`, `xhigh` e `max`, com padrão `low`; `none` é rejeitado. Esses padrões conservadores não afirmam quais são os padrões do provedor.
- O fluxo anterior 4o-mini não recebe `reasoning_effort` e rejeita uma configuração explícita de esforço. Modelos de resposta precisam pertencer à mesma família selecionada. Snapshots não verificados dos três modelos novos são rejeitados.
- Limites anteriores preservados: até 32 mensagens, 16.000 caracteres por mensagem; corpo padrão de 65.536 bytes, teto configurável de 262.144 bytes; saída padrão de até 1.024 tokens, teto configurável de 16.384. São limites próprios do adaptador, não a capacidade máxima anunciada do modelo.
- Reservas, identidade, contexto e limite de saída continuam vinculados ao permit de uso único validado pelo servidor imediatamente antes do envio. Após timeout ou resultado incerto, manter reserva e recibo para conferência.
- Entrada em cache não é cobrada novamente como entrada comum. Para os três modelos novos, `prompt_tokens_details.cache_write_tokens` precisa informar explicitamente o número zero; ausência, null, número não zero ou tipo inválido mantêm o custo desconhecido. `image_tokens` pode estar ausente em um pedido de texto, mas, se presente, somente o número zero é aceito; null ou qualquer valor/tipo diferente retém o recibo para conferência. Modalidades não suportadas também permanecem sem preço conhecido.
- Consumo reportado acima de 272.000 tokens de entrada fica retido para conferência, preservando o recibo e os contadores recebidos, inclusive em uma resposta HTTP de erro. O total `completion_tokens` já inclui os tokens de raciocínio: eles não são somados novamente ao custo nem ao teto de saída.

## Antes de usar com clientes

1. Vincular uma tarifa e câmbio datados para cada modelo à política de acréscimo único de 15% já preparada no módulo separado. Reservar o custo máximo do modelo/esforço escolhido antes de cada envio; uma escolha mais cara exige sua própria cotação, hash e autorização. O adaptador não contém preços nem calcula débitos.
2. Verificar o recibo efetivo e a política de cache do modelo: a documentação descreve escrita em cache a 1,25 vez a tarifa de entrada, substituindo a cobrança de entrada comum, não se somando a ela. Ausência de um campo de escrita no recibo não comprova custo zero; esta entrega não implementa sua conciliação financeira.
3. Integrar o ciclo durável, consentimento, reserva por cliente, limites, débito único e tratamento de consumo desconhecido. Custos internos não devem debitar carteiras de clientes.
4. Validar uma chamada paga somente quando houver autorização e orçamento específicos. Disponibilidade em `GET /models` não comprova geração nem faturamento compatível.

Referências do contrato: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) e [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), consultadas pela equipe em 14/09/2026. Testes usam respostas sintéticas, não tarifas ou recibos comerciais reais.
