# GPT-5.6 Luna — preparação isolada

O adaptador `app/vitriny-neural/providers/openai-paid-chat.js` aceita o alias exato `gpt-5.6-luna`, mediante seleção explícita do servidor. O modelo padrão continua `gpt-4o-mini` e `enabled` continua `false`. Nenhuma rota, automação, variável de produção ou cobrança é ativada por esta alteração.

Escolha alinhada ao pedido do administrador por um GPT atual e econômico. A chave existente foi aceita em uma consulta de modelos somente leitura (HTTP 200), e Luna estava disponível. Chaves da API não são específicas de um modelo; não foi necessário criar ou substituir a credencial. Essa consulta não verificou saldo nem fez geração paga.

Na documentação consultada em 14/09/2026, o modelo publica USD 0,20 por milhão de tokens de entrada comum, USD 0,02 de entrada em cache e USD 1,20 de saída. Estes valores são referência datada, não um registro de preços ativo. Acrescentar 15% corresponde a USD 0,23, USD 0,023 e USD 1,38, respectivamente, antes da conversão para reais; escrita de cache e contexto longo precisam de tratamento específico descrito abaixo. Não alterar `OPENAI_MODEL` global: ele também influencia outros fluxos existentes da plataforma.

## Contrato limitado

- Um POST à origem oficial, texto somente, sem ferramentas, mídia, streaming, fallback ou reenvio automático.
- Luna recebe `reasoning_effort: "none"`, incluído no hash exato do corpo autorizado. Esse parâmetro não é adicionado ao fluxo anterior 4o-mini.
- Modelos de resposta precisam pertencer à mesma família selecionada. Snapshots Luna não verificados são rejeitados.
- Limites anteriores preservados: até 32 mensagens, 16.000 caracteres por mensagem; corpo padrão de 65.536 bytes, teto configurável de 262.144 bytes; saída padrão de até 1.024 tokens, teto configurável de 16.384. São limites próprios do adaptador, não a capacidade máxima anunciada do modelo.
- Reservas, identidade, contexto e limite de saída continuam vinculados ao permit de uso único validado pelo servidor imediatamente antes do envio. Após timeout ou resultado incerto, manter reserva e recibo para conferência.
- Entrada em cache não é cobrada novamente como entrada comum. Para Luna, `prompt_tokens_details.cache_write_tokens` precisa informar explicitamente o número zero; ausência, null, número não zero ou tipo inválido mantêm o custo desconhecido. Modalidades não suportadas também permanecem sem preço conhecido. Consumo reportado acima de 272.000 tokens de entrada fica retido para conferência, preservando o recibo e os contadores recebidos.

## Antes de usar com clientes

1. Vincular cotação e câmbio datados à política de acréscimo único de 15% já preparada no módulo separado. O adaptador não contém preços nem calcula débitos.
2. Verificar o recibo efetivo e a política de cache do modelo: a documentação descreve escrita em cache a 1,25 vez a tarifa de entrada, substituindo a cobrança de entrada comum, não se somando a ela. Ausência de um campo de escrita no recibo não comprova custo zero; esta entrega não implementa sua conciliação financeira.
3. Integrar o ciclo durável, consentimento, reserva por cliente, limites, débito único e tratamento de consumo desconhecido. Custos internos não devem debitar carteiras de clientes.
4. Validar uma chamada paga somente quando houver autorização e orçamento específicos. Disponibilidade em `GET /models` não comprova geração nem faturamento compatível.

Referência do contrato: [documentação oficial GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), consultada pela equipe em 14/09/2026. Testes usam respostas sintéticas, não tarifas ou recibos comerciais reais.
