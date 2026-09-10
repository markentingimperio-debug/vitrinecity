# Apoio voluntário da Oração do Dia

Implementação própria em `prayer-support.js`, com duas tabelas exclusivas e webhook exclusivo. Não utiliza pedidos de lotes, Ads, carteira de moedas, assinaturas, marketplace, comissão ou entrega de benefícios. A oração e a entrada no grupo independem do apoio.

## Recebedor e ativação

A conta central já existente foi consultada por GET autenticado, somente leitura, pelo responsável pela integração em 10/09/2026. O ID retornado foi `2293261177`, com nome comercial **AGROTECNICA CONSULTORIA E VENDAS**, site MLB/BR. Isso corresponde ao recebedor indicado explicitamente pelo usuário. Nenhuma chave foi copiada para este código/documento; nenhuma preferência ou cobrança real foi criada na validação.

Configuração esperada, somente após revisão/deploy:

```dotenv
PRAYER_SUPPORT_ENABLED=true
PRAYER_SUPPORT_BENEFICIARY="Agrotécnica Consultoria e Vendas"
PRAYER_SUPPORT_COLLECTOR_ID=2293261177
```

O módulo reutiliza `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET` existentes. Sem a flag explícita, fica desativado. Mesmo com a flag, exige nome/ID/chave/segredo e verifica o ID via GET autenticado de conta antes de permitir abrir o Checkout Pro. Verificações positivas são reutilizadas por até cinco minutos; uma preferência recebida também precisa informar exatamente o mesmo collector ID. Nome e ID são uma configuração administrativa, nunca valores enviados pelo navegador. Não há refresh OAuth ou nova conexão de conta neste módulo.

O endpoint oficial de conta usado no módulo é `https://api.mercadolibre.com/users/me`, conforme a documentação de credenciais. A verificação operacional de 10/09 usou `https://api.mercadopago.com/users/me`. Ambos devem identificar a conta configurada; uma falha de consulta mantém o apoio fechado.

Esta implementação **não altera a configuração de produção**. O segredo do webhook deve corresponder à aplicação Mercado Pago que emite as preferências. A URL pública de notificação é `/api/prayer-support/webhook`.

## Valores e confirmação

O servidor aceita somente **50, 100, 200, 300 ou 500 centavos**, quantidade um, BRL e apoio único. O valor padrão de apresentação é 500 centavos. O valor escolhido é gravado antes de chamar o provedor e conferido contra o pagamento recebido. Não há substituição automática de valor em caso de rejeição.

A referência oficial de meios de pagamento mostra `min_allowed_amount: 0.5` em um exemplo Visa. Isso não comprova a disponibilidade de R$0,50 para todos os meios, a conta real ou cada configuração de Checkout Pro. A aceitação dos cinco valores foi validada somente com simulação nesta entrega. Uma rejeição explícita do provedor informa que o valor não foi disponibilizado, sem afirmar cobrança ou enviar outro valor.

O botão da página deve informar o valor e o caráter opcional/único. O clique explícito envia `accepted:true`; o servidor não exige um checkbox adicional. O Mercado Pago apresenta a confirmação final. A página não coleta CPF, e-mail ou cartão neste fluxo.

## Contrato HTTP

- `GET /api/prayer-support/config`: `{amountsCents:[50,100,200,300,500],defaultAmountCents:500,amountCents:500,currency:"BRL",beneficiary,oneTime:true,enabled,reason}`. Credenciais, ID da conta e dados pessoais do provedor nunca são retornados.
- `POST /api/prayer-support/checkout`: corpo `{requestKey,amountCents,accepted:true}`, mesma origem, até cinco novas tentativas por IP em dez minutos. `requestKey` aleatória de 20–100 caracteres é persistida pelo navegador para impedir duplicação em retry. Resposta de abertura: `{reference,status,amountCents,currency,beneficiary,checkoutUrl,statusToken}`. URL de destino deve ser HTTPS em host oficial validado do Mercado Pago e caminho `/checkout/`.
- `GET /api/prayer-support/orders/:reference`: cabeçalho `X-Support-Token`. Retorna somente `{reference,status,amountCents,currency,beneficiary}`. A referência sozinha não revela o recibo. É leitura do registro local; não consulta o provedor a cada atualização da tela.
- `POST /api/prayer-support/webhook`: valida assinatura existente, ID assinado na URL e correspondência do ID do corpo. Busca o pagamento no provedor por GET; exige `live_mode:true`, referência de apoio, ID, moeda, valor exato e collector ID persistido. Respostas simuladas ou sem o indicador explícito de produção não atualizam o registro nem confirmam dinheiro real. O retorno do navegador nunca confirma pagamento.

Os três retornos de Checkout Pro apontam à mesma URL específica `/oracao-do-dia.html?apoio=retorno&ref=...`. Mesmo se o provedor acrescentar `status=approved`, o navegador deve ignorá-lo e consultar o recibo com o token guardado localmente.

## Falhas e acompanhamento

Uma repetição da mesma chave reutiliza a preferência pendente. A mesma chave com outro valor é recusada e informa a referência anterior. Uma resposta incerta mantém `creating` e devolve referência/token com HTTP 502; não inicia outra preferência em retry. Rejeição explícita 4xx do provedor gera `creation_rejected` com HTTP 422. Essas respostas não devem ser descartadas pela interface antes de guardar referência/token e mostrar a mensagem.

`approved` é confirmação somente após consulta autenticada do webhook. `pending`, `creating`, `authorized`, `in_process` e `in_mediation` não são confirmação. `rejected`, `cancelled`, `creation_rejected`, `partially_refunded`, `refunded`, `charged_back` e `review_required` têm mensagens próprias. Eventos repetidos são idempotentes. Uma mediação posterior, identificada por `date_last_updated` do provedor, suspende a confirmação; uma resolução posterior pode confirmá-la novamente. Depois de conhecer essa data, respostas anteriores, com a mesma data, sem data ou com data inválida não alteram o estado. Estornos e chargebacks continuam protegidos contra reaprovação. Duas aprovações diferentes para a mesma referência são registradas e marcadas para revisão; não geram dois benefícios, porque o apoio não gera benefícios.

O recebimento de eventos continua funcionando quando a flag de novos apoios é desativada. Registros `creating` sem resposta, pagamentos sem webhook, expiração pendente ou `review_required` precisam de conciliação administrativa com o Mercado Pago pela referência antes de concluir ou repetir o apoio. Não há cron de conciliação, reembolso automático ou painel administrativo novo nesta entrega.

## Validação local

`node --test scripts/test-prayer-support.mjs`: testes com SQLite em memória, servidor HTTP local e provedor inteiramente simulado. Cobrem cinco valores, recebedor, consentimento/origem/limite, clique duplicado, timeout, rejeição de valor, URL segura, recibo privado, assinatura, valor/moeda/conta, eventos repetidos e estornos. Nenhuma cobrança ou POST externo é executado pelo teste.

Também foram verificados a sintaxe de `server.js` e os testes existentes de recompensas; a montagem adiciona somente import e chamada de setup, sem editar os outros fluxos de pagamento.

## Fontes oficiais consultadas

- [Criar preferência de Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/create-preference/post): preferência, itens, `init_point`, `collector_id` e redirecionamentos.
- [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/credentials): consulta de conta por GET autenticado.
- [Notificações de Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/optional-notifications): assinatura e consulta do evento.
- [Consultar meios de pagamento](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/payment-methods/get): limites dependem do meio de pagamento; exemplo de mínimo 0,5.
