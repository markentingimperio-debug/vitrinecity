# Planos e créditos de IA — controle comercial preparado, sem cobrança automática

## Entrega e limites

Esta alteração adiciona um catálogo de planos imutáveis, períodos de acesso por loja, franquias, reservas e extrato de créditos de IA. O consumo informado pelo modelo pode descontar a franquia sem misturar as moedas de anúncios. Não cria preços em reais, não cadastra cartões, não chama Mercado Pago e não cobra clientes.

As assinaturas existentes de `lot_orders` são de lojas/prédios. Sua autorização ou aprovação NÃO é comprovante de pagamento de um plano de IA. A concessão nesta versão é manual, administrativa e auditada. Ainda é necessário definir preços e regras comerciais, implementar checkout e processar recibos de pagamento/renovação/estorno verificados antes de comercializar assinatura automática.

O gerador continua limitado a rascunhos de sites/código/texto. Não surgem ferramentas de imagem, vídeo, navegador, execução de código ou publicação nesta entrega. A metrologia aqui é de texto; mídia exigirá unidades e adaptadores próprios. Tokens e créditos internos não são dinheiro e não representam, sozinhos, custo de infraestrutura nem margem.

## Habilitação controlada

`VITRINY_NEURAL_BILLING_ENABLED=0` por padrão. Não houve alteração de ambiente ou deploy nesta entrega. Não há planos, preços, franquias ou conversões predefinidas.

Quando o administrador habilitar o controle em homologação, deve criar um plano e conceder explicitamente um período à loja pelo painel `/neural-billing.html`. A configuração de tarefas/Neural e as qualificações do modelo continuam obrigatórias. Neste modo, lojas autenticadas precisam de período ativo; estar na antiga allowlist de piloto não dispensa plano. Quando o controle comercial estiver desligado, permanece a allowlist de piloto anterior. Tarefas administrativas não debitam carteiras de lojistas e continuam sujeitas aos limites operacionais.

Cada plano contém:

| Campo | Significado |
| --- | --- |
| `code`, `name` | Identificador imutável e nome |
| `monthlyCredits` | Franquia nominal concedida por período |
| `taskReserveCredits` | Valor máximo de créditos reservado ao iniciar uma tarefa |
| `inputCreditsPer1000` | Conversão de tokens de entrada para créditos |
| `outputCreditsPer1000` | Conversão de tokens de saída para créditos |

Os valores são inteiros, validados no servidor. Alterar uma tabela de conversão exige um novo código de plano. Os períodos e reservas mantêm cópias das regras originais: uma mudança futura não reprecifica uso passado. Um período possui início inclusivo e fim exclusivo, em epoch milissegundos, com duração máxima de 366 dias. Não há pró-rata, renovação automática, acúmulo automático nem transferência de saldo entre períodos. O nome `monthlyCredits` não força uma cobrança mensal: quem concede deve escolher datas coerentes com o acordo comercial.

## Medição, reserva e liquidação

1. Ao iniciar uma tarefa, uma transação SQLite valida plano, prazo, saldo, cotas e concorrência, reserva `taskReserveCredits` e reivindica a tarefa. Não há inferência se essa reserva falhar.
2. Antes de cada tentativa de modelo, grava-se um identificador único e o estado `started`. Falhas dessa gravação impedem chamada e fallback.
3. Ao concluir ou falhar, grava-se o evento terminal. `known:true` exige dois números inteiros seguros de tokens, entrada e saída. Ausência, `null`, números negativos ou strings não são consumo zero confirmado.
4. A soma de entrada e saída inclui tentativas medidas, inclusive resposta tardia após cancelamento. Credenciais, instruções e respostas completas não entram no extrato de cobrança.
5. Com todas as tentativas medidas, a liquidação desconta o consumo e libera a reserva excedente, uma única vez. A fórmula é `ceil(totalEntrada × taxaEntrada / 1000) + ceil(totalSaida × taxaSaida / 1000)`: arredondamento por direção no total da tarefa, não a cada chamada. Usa-se aritmética inteira.
6. Se houver consumo desconhecido, tentativa pendente ou consumo superior à reserva, o estado fica `review_required`. A reserva é mantida; não há cobrança acima dela, saldo negativo ou suposição de gratuidade. Não se inicia outra inferência depois de consumo desconhecido ou de atingir o teto.

Saldo disponível do período = franquia concedida − créditos debitados − reservas ainda abertas. Uma nova tentativa deliberada é uma nova tarefa, sujeita a nova reserva e cotas. Repetir requisição com a mesma chave e conteúdo não duplica concessão ou consumo; reusar chave com conteúdo diferente retorna conflito.

**A reserva limita o débito ao cliente, não é um limite exato de tokens computados.** Uma chamada pode retornar custo acima do saldo reservado porque só se conhece a medição depois da resposta. Nesse caso, a execução para e exige conferência, sem cobrar automaticamente o excedente. Os limites de tokens de saída, tempo, passos e concorrência continuam necessários para conter o custo de infraestrutura.

Falha de conteúdo, código inválido ou cancelamento pode ter consumido processamento medido. A liquidação registra esse uso; isso não determina, por si só, uma política comercial de reembolso ou garantia de qualidade. Definir essa política antes de vender. A análise humana não pode inferir tokens exatos simplesmente do tamanho da resposta.

## Cancelamento, expiração e conciliação

- Cancelar uma chamada não elimina seu histórico. Enquanto a inferência estiver pendente, os créditos incertos permanecem reservados. Retorno tardio com medição completa pode liquidar a reserva, mas não produz novos arquivos após cancelamento.
- Expirar ou revogar um período impede novas chamadas autorizadas por ele. A liquidação do consumo anterior continua vinculada ao período original, não ao saldo de uma renovação posterior.
- Tarefas interrompidas não são reproduzidas automaticamente. O piloto segue previsto para um processo executor; não é uma fila distribuída com garantia de cancelamento remoto.
- A conciliação administrativa exige tarefa terminal e nenhuma chamada pendente conhecida no processo. Após reinício, se existir tentativa durável sem resposta, é necessário também aguardar a expiração da reserva operacional. Isso NÃO prova que o servidor remoto parou: o operador deve verificar o servidor de inferência antes de conciliar, registrar justificativa e informar débito final entre zero e o máximo reservado.
- A conciliação é auditada e idempotente. Eventos tardios permanecem no histórico e não geram uma segunda cobrança. Não apagar o ledger nem ajustar diretamente o banco para simular um pagamento.

## Painéis e API

O painel administrativo pode cadastrar planos, consultar lojas, conceder períodos, revogar acesso e conciliar tarefas. A página `/neural-billing.html?store=REFERENCIA` é somente leitura para lojistas e solicita o token do portal em memória, sem gravá-lo no navegador ou na URL. O chat mostra saldo, reserva e consumo, bloqueia envio sem plano/saldo e mantém histórico e downloads disponíveis.

Base administrativa: `/api/admin/vitriny-neural/billing`.

| Endpoint | Finalidade |
| --- | --- |
| `GET/POST /plans` | Consultar/cadastrar planos |
| `GET /stores/:reference/status` | Período e saldo da loja |
| `GET /stores/:reference/ledger` | Últimos 50 eventos do extrato |
| `GET/POST /stores/:reference/periods` | Consultar/conceder períodos |
| `POST /stores/:reference/periods/:id/revoke` | Revogar sem gerar estorno financeiro |
| `POST /stores/:reference/tasks/:id/resolve` | Conciliar reserva pendente após verificação |

Lojista: apenas `GET /api/store-portal/:reference/neural/billing/status` e `/ledger`. Autenticação do portal, perfil ativo, pedido da loja aprovado e MFA quando habilitado continuam aplicáveis. O escopo é derivado no servidor; o corpo não aceita saldo, usuário, escopo ou regras de modelo arbitrárias. Mutações administrativas exigem JSON, `X-Neural-Request: 1`, origem permitida e sessão administrativa. Respostas privadas usam `no-store`. A API financeira existente e os saldos Ads não são alterados.

O extrato é append-only pela interface implementada, não um log criptograficamente inviolável. O administrador do banco ainda pode modificá-lo. Aplicar controle de acesso, backups, retenção, monitoração e auditoria da infraestrutura antes da produção. Revisar também o uso de tokens legados em URLs do portal; o painel novo não os coloca em links.

## Testes e liberação

Execute em `app`: `npm run test:neural:billing` ou a suíte completa `npm run test:neural`.

Cobertura: arredondamento, planos imutáveis, snapshots, períodos sobrepostos/expirados/revogados, duas conexões/processos SQLite disputando saldo, idempotência, falhas do ledger, consumo ausente, fallback, cancelamento tardio, saldo insuficiente, estouro da reserva, conciliação, isolamento de lojas, CSRF, autenticação, DOM e servidor real com rede bloqueada e dados temporários.

Os testes de modelo são simulados: comprovam regras de registro e controle, não a precisão dos contadores de uma VPS real nem os custos reais de cada modelo. O painel foi validado com testes de DOM; a revisão visual em navegador e a homologação com modelo real ainda são necessárias.

Antes de cobrar: medir hardware/latência/custo por tarefa, validar as métricas do provedor, definir preços em reais e política de falhas/cancelamentos, integrar pagamento com confirmação idempotente dos períodos efetivamente pagos, testar inadimplência/estorno/renovação e realizar implantação supervisionada.
