# Lia: filas duráveis e preparação de API paga

## Escopo desta etapa

Continuação do chat privado publicado no PR 183. Base de produção preservada:
`4c70f60948c5b17352de3ba602e2b709fca66092`, incluindo a atualização pública de
Analytics e da assistente comercial feita após o PR 183.

- Fila persistente, com limites separados para chat, imagem e vídeo.
- Integração da fila somente ao chat local que já passou pelos controles de
  habilitação e qualificação. Não altera nem aprova modelos.
- Estado `queued` adicionado ao contrato existente, com acompanhamento e
  cancelamento na interface. Não promete prazo, posição ou percentual fictício.
- Adaptador isolado de respostas OpenAI, desativado por padrão, com autorização
  server-side, limite de saída e recibo separado da resposta.

## Contrato e responsáveis

O módulo `app/public/neural-chat-contract.js` é o contrato canônico compartilhado
entre o backend privado, a interface e os testes. A equipe do chat é consumidora;
a equipe do engine é provedora; o integrador desta entrega resolve alterações.
Os caminhos, a autenticação e os campos existentes dos recibos são preservados.
Os identificadores são strings opacas. `queued` significa salvo, ainda não
despachado; `running` significa uma execução iniciada. Estados finais não dão
permissão para repetir uma chamada paga. A chave de idempotência permanece a mesma
nas tentativas de recuperar um envio incerto.

O resumo opcional `status.queue` contém `enabled`, `pending`, `running`,
`requiresReview` e `unresolved`, limitado ao proprietário autenticado. Recibos
e resumos passam por validação do contrato antes de serem enviados pelo servidor.
Um histórico inválido não comprova conclusão de uma geração.

## Limites de segurança

- Conteúdo de usuários/anexos não concede ferramentas, permissões ou crédito.
- Reiniciar um processo pode retomar um pedido ainda não despachado, mas não
  reenviar uma operação de resultado desconhecido.
- Cancelar na interface não prova cancelamento no fornecedor nem custo zero.
- Capacidade desconhecida ou não configurada não autoriza paralelismo ilimitado.
- Uma fila capaz de armazenar 50 pedidos não comprova capacidade do fornecedor
  para gerar 50 vídeos simultâneos.
- Testes de API usam respostas simuladas; não fazem chamadas pagas reais.
- Limite inicial conservador: uma execução de chat por vez, uma por conta e
  uma por provedor. Imagem e vídeo ficam com processamento desabilitado.

## Recuperação de uma operação desconhecida

Pedido já despachado sem resposta final continua retendo a capacidade. O aviso de
conferência não é um botão de repetir. Não editar estados diretamente no banco,
apagar a fila nem presumir que timeout significa cancelamento no fornecedor.
A reconciliação de pedido já despachado precisa de prova de resposta final,
identidade exata da operação e conferência dos valores antes de liberar reserva.
A prova de ausência de despacho só libera um pedido ainda na fase de reserva,
nunca um estado já despachado ou desconhecido.
Nesta etapa não há rota pública para forçar essa liberação. Sem a prova, o estado
permanece pendente de revisão; isso é deliberado e deve ser informado ao operador.

## Verificação sem gasto

O teste `app/scripts/test-neural-paid-credit-flow.mjs` conecta, em memória e com
tarifas fictícias identificadas, o adaptador, o cálculo e a carteira. Verifica
despacho único, acréscimo exato de 50%, débito único de um recibo conhecido e retenção
de reserva em caso de resposta desconhecida. Não é comprovação de checkout,
cotação real, autorização comercial ou geração paga em produção.

Também foram verificados 50 pedidos simulados, concorrência com conexões e
processos independentes usando SQLite, recuperação sem reenvio, isolamento por
conta, revogação antes do despacho e conclusão protegida contra processos antigos.
O teste HTTP usa Express e o engine reais, com inferência controlada; a interface
foi examinada no Chrome em seis larguras, incluindo celulares de 320 a 412 px.

## Ainda não ativado nesta entrega

O conector OpenAI não está ligado a uma rota pública de cobrança. A carteira de
Créditos IA e o cálculo de acréscimo de 50% do PR 183 continuam isolados: faltam
admissão/consentimento transacional, compra verificada, reconciliação de recibos e
validação financeira ponta a ponta antes da ativação paga.

Imagem e vídeo permanecem indisponíveis no novo chat. A existência de acesso ao
Kling Studio não é uma conta da API comercial. Em 14/09/2026, a inspeção do servidor
confirmou a chave OpenAI presente, mas não as credenciais comerciais Kling. Não
foram expostas nem alteradas chaves. Também não foram modificados saldos,
pagamentos, anúncios, publicações, permissões de modelos ou as condições jurídicas.

A consulta autenticada somente de metadados `GET /v1/models/gpt-4o-mini`, feita
na VPS em 14/09/2026, retornou HTTP 200 e a identidade esperada. Isso confirma
acesso aos metadados do modelo; não comprova saldo, limite de geração,
funcionamento de uma resposta paga ou autorização para cobrar clientes.

O modo de produção `shadow` é preservado: a interface pode guardar a conversa,
mas continua informando que as respostas estão em preparação enquanto não há um
modelo autorizado e qualificado. O atendimento comercial público da Lia é outro
fluxo e permanece preservado.

## Fontes do adaptador

Consulta da documentação oficial em 14/09/2026:
- https://developers.openai.com/api/reference/resources/chat

Não existe tabela de preços nova nem câmbio presumido nesta etapa. Uma resposta
incompleta, recusa ou erro de rede não é interpretada como geração gratuita.
