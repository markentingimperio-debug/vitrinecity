# Vitrines pessoais e repasse de comissões externas

## Decisões do usuário — 08/09/2026

O cadastro de afiliado gera uma página pessoal com o catálogo publicado e links exclusivos por produto. O parceiro divulga sua vitrine ou um produto específico. O repasse pretendido será uma parte da comissão efetivamente recebida pela VitrineCity, após validação, e não um percentual adicional do preço do produto. O usuário definiu expressamente **50% do valor total da comissão daquela venda para o parceiro, antes de descontar custos da VitrineCity**. A resposta não ativa pagamentos nem confirma permissão dos programas externos.

## Implementação da divulgação

- A página `/parceiros/:code` é renderizada automaticamente pelo código ativo do participante, incluindo participantes existentes. Não expõe nome completo, e-mail ou telefone.
- `/painel-divulgacao.html` consulta somente os produtos e contagens do afiliado autenticado, com busca indexada, plataformas, categorias, paginação, copiar e compartilhamento nativo iniciado pelo usuário.
- `/indicar/:code/:slug` abre a página própria do produto com a indicação. O contexto acompanha o botão de compra e os produtos relacionados. `/ir/:code/:slug` valida novamente parceiro/produto e redireciona para o link oficial de afiliado cadastrado, sem inventar parâmetros externos.
- Contagens diárias por parceiro/produto: visualização da vitrine, visualização de produto e clique de saída. Sem cookies de visitante ou gravação de IP, e-mail, identificador de navegador ou histórico de navegação. Limitação em memória e exclusão de agentes conhecidos de prévia reduzem ruído. Não são visitantes únicos nem vendas verificadas.
- `/admin-parceiros.html` permite acompanhar os códigos e suas contagens; exige autorização administrativa. Exportação de privacidade inclui os agregados do participante.
- Contas/afiliados suspensos e ofertas não publicadas, indisponíveis ou com destinos inválidos não podem usar o redirecionamento pessoal de compra.

## Repasse financeiro — não ativado por estes links

Fluxo pretendido: indicação identificada → pedido reportado pela plataforma → comissão validada → comissão recebida pela VitrineCity → saldo de repasse disponível → pagamento registrado. Cancelamentos/estornos exigem ajustes auditáveis; conciliação e pagamentos devem ser idempotentes e preservar evidências e histórico da regra aceita.

Base de cálculo definida: comissão total aprovada da venda × 50%, antes de custos da VitrineCity. O recebimento e a conciliação são condições de liberação, não uma autorização para reduzir a base ao lucro líquido. Retenções ou custos não devem ser abatidos automaticamente da base acordada. Não descontar custos arbitrários ou alterar retroativamente a regra. Valores em centavos; nenhum crédito financeiro originado apenas por clique. Prazos, mínimo, retenções aplicáveis e mecanismo de pagamento precisam ser definidos antes da oferta de remuneração.

A operação depende da permissão do programa para parceiros remunerados e de uma referência que identifique a venda no relatório/API. Sub ID não é, por si só, autorização para subafiliação. Sem essa referência, a VitrineCity conhece seus cliques, mas não pode atribuir com segurança uma compra externa a uma pessoa.

Fontes primárias: [Shopee — geração de links e Sub IDs](https://help.shopee.com.br/portal/10/article/128461-Passo-a-Passo-para-Gerar-Seus-Links-de-Afiliado-ou-ID-de-produto), [Shopee — validação de comissões](https://help.shopee.com.br/portal/10/article/163057-Entenda-o-Processo-de-Valida%C3%A7%C3%A3o-das-Comiss%C3%B5es), [Mercado Livre — janela de atribuição](https://www.mercadolivre.com.br/l/afiliados-janela-de-atribuicao). As fontes consultadas não confirmam autorização geral do modelo de repasse proposto. Nenhuma mensagem a plataformas, campanha ou pagamento foi executado.
