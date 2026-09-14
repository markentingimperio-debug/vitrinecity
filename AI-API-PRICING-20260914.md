# Créditos IA: acréscimo aprovado de 15%

Decisão explícita do administrador em 14/09/2026: cobrar do cliente o custo de cada API utilizada acrescido de 15%, substituindo os 50% anteriormente preparados.

## Regra única

Preço do consumo do cliente = custo confirmado da API convertido para reais × 1,15.

- Multiplicador exato `23/20`, política auditável `ai-credit-policy-v2`.
- Mesmo cálculo para tokens de chat e orçamentos confirmados de imagem/vídeo, independentemente do fornecedor. Prompts, roteiros e pesquisas que utilizem uma API seguem a categoria do consumo efetivamente informado; não há tarifa arbitrária por nome de tarefa.
- Acréscimo aplicado uma única vez, não novamente na compra/conversão do saldo em créditos. Por exemplo: custo de API equivalente a R$ 1,00 gera preço de R$ 1,15, não R$ 1,3225.
- Não há taxa extra, preço mínimo, spread adicional ou tarifa de provedor inventada nesta mudança. Câmbio e tarifas precisam vir de registros confirmados e datados, mantidos no servidor.
- Precisão racional inteira, arredondamento somente no resultado final em microBRL. Não arredondar cada token ou etapa para centavos, nem cada fração para um crédito inteiro.
- Uso desconhecido ou orçamento ausente/expirado continua bloqueado, nunca tratado como custo zero. Créditos de pacote, moeda e saldo promocional não são automaticamente equivalentes.
- Consumo da produção interna da empresa é custo interno separado, sem débito em carteiras dos clientes.

## Estado desta alteração

O administrador também autorizou selecionar modelos mais potentes e maior esforço quando a tarefa exigir, sempre com preço proporcional à API do modelo efetivamente utilizado e o mesmo acréscimo de 15%. A autorização não transforma todos os modelos em uma tarifa fixa: trocar modelo/esforço muda o corpo autorizado e exige cotação/reserva compatível antes do envio. Uma resposta ou instrução do modelo não pode ampliar seu próprio orçamento. Tentativas com consumo incerto não devem ser repetidas automaticamente.

Todo uso de IA faturável ao cliente deve consumir somente o saldo pré-pago de Créditos IA que ele adquiriu: reservar o teto antes do consumo, conciliar o custo confirmado uma única vez e liberar o restante. Sem saldo disponível para a reserva, não iniciar a chamada paga nem criar saldo negativo. Isso inclui cada consumo confirmado em tarefas com mais de uma etapa, sem reaplicar margem sobre um preço que já recebeu os 15%. Créditos reservados para uma tarefa não podem ser gastos por outra simultaneamente. Este é o requisito do ciclo comercial; não comprova que compra de créditos e cobrança pública estejam conectadas.

O calculador `app/vitriny-neural/ai-credit-pricing.js` continua isolado: não chama APIs, não acessa banco, não reserva nem debita saldo. A carteira monetária e a cobrança de mídia para clientes ainda não estão conectadas. Atualizar o multiplicador não ativa vendas, APIs, geração ou pagamentos.

Nenhum saldo, compra, recibo, reserva ou orçamento histórico é recalculado. Um futuro integrador deve preservar a política aceita na reserva/recibo existente; a versão v2 identifica os novos cálculos. Validade, regras de reembolso, planos locais de IA, Ads e outras moedas da plataforma permanecem inalterados.

Antes de ativar: validar chave/acesso dos provedores, tarifas e câmbio efetivos, orçamento aprovado, consumo durável sem duplicação, recibo, entrega privada, débito idempotente e teste real expressamente autorizado. O valor de 100 créditos por real permanece uma proposta técnica, não uma oferta publicada.

## Resultado econômico

Acréscimo de 15% sobre o custo corresponde a aproximadamente 13,04% do preço de venda antes de outras despesas. Não é promessa de lucro líquido. Custos de pagamento, tributos, câmbio contratado e operação devem ser monitorados; nenhum aumento adicional está autorizado por este documento.
