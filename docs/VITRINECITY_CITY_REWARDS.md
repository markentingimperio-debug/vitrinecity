# Recompensas, avatar e créditos

Decisões: avatar R$ 10 por 30 dias, renovação manual; moedas de jogos como desconto de até 30% (até R$ 3 no avatar) e até 30% em cursos próprios disponíveis. Avatar básico gratuito. Sem saque ou rendimento. Padrão configurável inicial: 100 moedas/R$ 1, limite diário 100 moedas, validade de 60 dias. A conversão foi comunicada como suposição configurável, não resposta expressa do usuário.

O servidor valida a colheita ou coleta e concede apenas ganho líquido da ação. Saldo inicial e tempo enviados pelo cliente não geram recompensas. Progresso e lote de recompensa são gravados na mesma transação. Reservas de desconto usam primeiro lotes com vencimento próximo. Preço, pontos, cotação e termos são revalidados no checkout.

Abertura de preferência não equivale a pagamento. Benefício só é liberado por pagamento consultado no provedor, com referência, valor e moeda exatos; webhook exige assinatura válida. Reenvios não renovam o avatar novamente. Reembolso e contestação revogam acesso e devolvem moedas sem estender o vencimento original. Uma aprovação tardia sem moedas suficientes fica em revisão; atendimento pode resolver o pagamento no provedor e reconciliar, sem conceder saldo artificial.

Resposta incerta ao criar pagamento mantém reserva e pedido. Pessoa e administrador podem conferir o pedido novamente; consulta só aceita o pagamento da referência correspondente, com limite de uma consulta a cada 30 segundos por pedido. Sem pagamento confirmado na busca completa após 72 horas, pedido não pago expira e libera sua reserva. Pedidos pagos não reabrem checkout. Mais de um pagamento aprovado exige atendimento. Nenhuma cobrança nem reembolso real foi executado no desenvolvimento.

Créditos ADS são carteira distinta. Novas compras seguem 60 dias; compras antigas de 90 dias e vencimentos já gravados são preservados. Termos preservam direitos legais aplicáveis. O programa não promete rendimento, resgate em dinheiro ou repasse financeiro de moedas.

Testes com servidor completo e provedor simulado verificam: sessão, proteção de origem, colheita concorrente única, adulteração de horário e recompensa, preferência no valor correto, webhook assinado, rejeição de valor incorreto, repetição, consulta e reversão. Testes unitários cobrem arredondamento, 30%, limite diário, renovação, expiração e preservação dos contratos antigos. Novas tabelas são aditivas; rollback deve preservar o banco atual.
