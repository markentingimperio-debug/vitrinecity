# Vitrine Coins — decisão de produto e condições de implantação

Decisão confirmada pelo administrador em 14/09/2026. Este documento registra a
regra aprovada; não declara que os saldos já foram migrados ou que a carteira
unificada está publicada.

## Regra aprovada

- Uma única moeda interna: **Vitrine Coins**.
- Manter a equivalência do Ads: **9,6 Vitrine Coins = R$ 1 de saldo interno**.
  Essa equivalência não promete que uma recarga antiga, após taxas contratadas,
  tenha creditado o seu valor bruto integral.
- Vitrine Coins compradas e conquistadas por tarefas usam a mesma denominação e
  equivalência. A origem é informação de auditoria, não uma segunda moeda.
- Usos: Ads, chat com IA, geração de imagens, geração de vídeos e **desconto em
  cursos**, preservando o limite atual de até 30% do preço do curso.
- Na confirmação posterior de 14/09/2026, o administrador escolheu **manter a
  taxa na recarga**, conforme o Ads. Esta escolha substitui a proposta anterior
  de recarga integral com acréscimo de 15% no uso da API para a carteira nova.
  Exemplo aprovado: recarga R$ 10, taxa R$ 1,50, saldo líquido R$ 8,50 = 81,6 Coins.
  O consumo de API utiliza seu custo comprovado convertido, sem outros 15% no uso.
  Preservar taxas históricas e impedir cobrança duplicada. Não reescrever preços
  de pedidos antigos ou reservas já confirmadas segundo regras anteriores.
- Tarefas só geram crédito após validação no servidor, uma vez por evento, com
  os limites existentes. XP, progresso e moeda inicial de jogos não viram saldo
  monetário automaticamente. Não criar novas recompensas ou campanhas de gasto
  sem definição de tarefa, valor, limite e controle de repetição.
- Preservar o valor econômico, histórico, titularidade, reservas, estornos e
  vencimentos contratados de todos os saldos anteriores. Não copiar quantidades
  nominais entre unidades diferentes.

## Integração necessária antes de anunciar carteira unificada

1. Usar uma unidade contábil exata que represente os centésimos de Coin do Ads e
   o micro-real do consumo de IA sem arredondar cada transferência. A apresentação
   deve aceitar frações de Coin e mostrar também o equivalente em reais.
2. Resolver a conta proprietária pelo servidor. Uma credencial de portal de loja
   não deve receber acesso implícito a toda a carteira pessoal de seu proprietário.
3. Conciliar lotes, reservas e registros legados antes da migração. Bloquear o
   corte se houver diferença de cobertura, titularidade ambígua ou pedido em voo
   que não possa ser preservado. Não apagar nem recriar saldos para corrigir isso.
4. Direcionar compras, recompensas, reservas e débitos de todos os serviços ao
   mesmo registro contábil; mudar rótulos ou somar telas não é unificação.
5. Preservar o teto de desconto dos cursos no servidor. O caminho legado
   `POST /api/courses/:slug/checkout-coins` hoje compra o curso integral e precisa
   ser substituído para novas compras, sem revogar matrículas anteriores.
6. Validar pagamentos, confirmação duplicada, concorrência entre Ads e IA,
   vencimento durante reserva, estornos, tarefas repetidas e recuperação após
   interrupção, com cópia isolada e sem chamadas pagas involuntárias.
7. Fazer implantação protegida, conferência dos saldos antes/depois e verificação
   da interface. Não ativar uma compra que prometa uso universal enquanto parte
   dos serviços continuar usando saldos independentes.

## Estado observado nesta revisão

- Ads: `wallets`, `credit_batches` e `wallet_ledger`; centésimos de crédito,
  equivalência 9,6 créditos/R$, com gestão de 15% no fluxo atual de recarga.
- Recompensas: `city_reward_batches`; conversão configurável, padrão de 100
  pontos/R$. Essa quantidade antiga não pode ser renomeada como 100 Coins novas
  sem conversão, pois alteraria o valor econômico.
- Integração nova de IA: reservas em microBRL e escopos de administrador/loja;
  código em revisão, distinto da carteira Ads e das recompensas.
- Não houve migração de saldos, alteração de pagamentos ou publicação da
  unificação nesta revisão.

## Conferência anterior à publicação — 14/09/2026

### Implementação atual em revisão

- Administrador informou US$ 14 pelo pacote de 100 unidades de vídeo e US$ 3,50
  pelo pacote de 1.000 unidades de imagem. Valores por unidade: US$ 0,14 e
  US$ 0,0035. A quantidade do pacote é unidade faturável, não número de arquivos.
- Carteira canônica em átomos: 10.000.000 átomos/Coin, 96 átomos/microBRL.
  Compras e tarefas compartilham lotes; não há outro débito de IA independente.
  O cálculo antigo de acréscimo no uso permanece somente para snapshots legados.
- Chat pessoal autenticado em `/neural-workspace.html?personal=1`, com orçamento,
  confirmação, fila persistente, resultado privado, player e download. Tokens de
  portal de loja não dão acesso à carteira pessoal. Sem saldo não há despacho.
- Dry-run de produção somente leitura: 40 lotes de tarefas, 301 pontos antigos
  correspondendo exatamente a 28,896 Coins; nenhum lote Ads ou IA a copiar, cinco
  recargas Ads pendentes preservadas como pedidos, sem tratá-las como saldo.
  Snapshot `edd85c4fd2869b60de8a53f6f957b8ef2a9d5d29881fb88af0a0c8526a84a0f1`.
- Testes simulam os provedores e pagamentos; não são comprovantes de consumo
  real. Nenhuma geração paga foi enviada durante estes testes.

### Segurança do corte e recuperação

- Antes de ativar: backup SQLite online íntegro, dry-run atual, build isolado,
  testes dos consumidores e ensaio com cópia de produção sem rede/credenciais.
- Após marcar a migração, o histórico antigo é imutável e **não acompanha gastos
  novos**. É proibido voltar ao binário anterior ou reativar débitos legados:
  causaria saldo duplicado. O servidor novo recusa iniciar com a flag unificada
  desligada se o marcador existir.
- Recuperação posterior ao corte deve manter a carteira canônica e desligar
  geração paga/novas recargas se necessário, com correção compatível adiante.
  Não restaurar o backup sobre transações recebidas depois do corte.
- Não reutilizar automaticamente snapshots cambiais com mais de sete dias;
  preços desatualizados bloqueiam novas gerações até atualização conferida.

### Registro anterior (superado pela implementação acima; ainda sem deploy)

- VPS reconferida no commit `085d1896853d37a16a412a9c11500df497caf5d1`, app saudável
  e `/api/health` público OK. Nenhum container foi recriado nesta conferência.
- Console autenticado da Kling, página `/dev/resource-pack-manage`, após concluir
  o carregamento: dois pacotes ativos, vídeo com 100/100 unidades e imagem com
  1.000/1.000 unidades, válidos até 14/10/2026. O primeiro estado da página em
  carregamento mostrava zero; esse estado transitório não é o resultado final.
- A tela de saldo em dinheiro mostra US$ 0; isso não invalida os pacotes ativos.
  A página de pacotes não informou o preço líquido da compra. Solicitada ao
  administrador a consulta de `Order History > Resource Package Orders`, sem
  compartilhar chave ou cartão. Não presumir preço de tabela como custo real
  de um pacote promocional.
- Estimativa de tabela para Kling 3.0, 720p, sem áudio: US$ 0,084/segundo,
  PTAX venda 14/09/2026 de R$ 5,1696/US$. Sem repetir a taxa no uso:
  5s = 20,8438272 Coins; 10s = 41,6876544 Coins; 15s = 62,5314816 Coins.
  Fontes: https://kling.ai/dev/pricing e
  https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do .
  São referências de cálculo, não tarifas finais publicadas ou cobranças reais.
- A integração paga em desenvolvimento ainda contém o modelo anterior de
  recarga integral/15% no uso e carteira independente por escopo. Não ativar suas
  flags de cobrança antes de adaptar o contrato, os testes, a titularidade e o
  livro-razão para a decisão atual de moeda única/taxa na recarga.
