# Contribuição Pix na oração

O apoio voluntário fica imediatamente depois do texto da oração. A pessoa escolhe R$0,50, R$1, R$2, R$3 ou R$5 e informa seu e-mail para gerar um Pix na mesma página. O QR Code e o código Copia e Cola vêm do Mercado Pago. A alternativa Checkout Pro continua disponível.

## Integração

- `POST /api/prayer-support/pix`: `requestKey`, `accepted:true`, `amountCents`, `payerEmail`. Usa a mesma conta Mercado Pago verificada da contribuição existente; não usa a credencial nem o registro de compra de lotes.
- `GET /api/prayer-support/orders/:reference`: exige `X-Support-Token`; reconcilia o pagamento no provedor a cada 15 segundos no máximo. Uma resposta de criação perdida pode ser recuperada pela referência externa sem outro POST ao provedor.
- O registro de apoio continua separado de vendas, moedas, matrículas e comissões. Gerar um Pix não confirma recebimento. A confirmação exige pagamento de produção com valor, moeda, recebedor, referência e método corretos.
- O e-mail é enviado somente ao Mercado Pago para o pagamento e não é salvo no navegador nem em texto no registro de apoio. Não há inscrição automática ou consentimento de marketing.
- A validade solicitada é 30 minutos. Código vencido não é interpretado como pagamento, e o relógio local não inventa um cancelamento.
- Falhas e cliques repetidos preservam a referência. Enquanto uma contribuição estiver pendente, o navegador não inicia outra modalidade. A alternativa Checkout Pro pode ser escolhida antes da criação ou depois de rejeição/cancelamento confirmado.

Referências oficiais: [Pix Payments API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix), [meios de pagamento](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/payment-methods/get).

Em 12/09/2026, a consulta autenticada de meios de pagamento da conta retornou Pix ativo, mínimo R$0,01 e sem campos adicionais indicados. Essa consulta não cria cobrança e não prova liquidação financeira.

## Verificação

Os testes usam banco temporário e respostas simuladas, sem enviar pagamentos. As verificações de produção devem registrar separadamente geração real do QR, visibilidade na página e confirmação financeira. Nunca pagar uma contribuição só para validar a tela.

O release é compatível com os registros anteriores: novas colunas opcionais, modalidade antiga `checkout` como padrão e URLs antigas preservadas. Reversão de código não exige apagar dados de apoio.
