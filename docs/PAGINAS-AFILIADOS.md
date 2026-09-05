# Páginas públicas dos produtos de afiliados

O catálogo `/ofertas` e as páginas `/ofertas/:slug` são gerados a partir dos
produtos existentes em `affiliate_catalog`. A mudança visual não insere produtos,
não altera links, preços, comissões ou disponibilidade e não muda o editor admin.

## Navegação

- Pesquisa `q` (até 160 caracteres), sem distinção de acentos ou maiúsculas.
  Todos os termos precisam aparecer nos campos descritivos do produto.
- Filtro `categoria` (até 80 caracteres) e filtro `plataforma`. As categorias são
  as cadastradas, sem inferir equivalências entre nomes diferentes.
- Trocar plataforma preserva pesquisa e categoria; “Limpar filtros” volta ao catálogo.
- Nenhum resultado oferece saída explícita; parâmetros repetidos ou não textuais
  são ignorados. Conteúdo e valores refletidos no HTML são escapados.

## Página individual

- Foto, título, categoria e loja; botão de compra antes da descrição completa.
- Descrição integral, cuidados e fonte consultada em seção própria; nenhuma
  avaliação, preço, desconto, estoque ou atributo do produto é inventado.
- A identificação de publicidade é exibida junto da ação de compra. O destino
  continua sendo o link cadastrado, com `sponsored noopener noreferrer`.
- Produtos pausados, indisponíveis ou com link quebrado não exibem botão externo.
  Rascunhos e identificadores inexistentes continuam retornando 404.
- Produtos relacionados vêm da mesma categoria; sem correspondência, são
  identificados somente como “Outros produtos da seleção”.
- Layout público separado em `affiliate-products.css`; sem novo script ou
  serviço de rastreamento, fonte remota, compra interna ou envio de mensagens.

## Verificação e publicação

`node app/scripts/test-affiliate-pages.mjs` testa os contratos com SQLite em memória
e integra a descoberta automática de `npm run test:release`. A prévia visual
`app/scripts/preview-affiliate-pages.mjs` usa somente dados de demonstração do
repositório, desativa monitores e substitui destinos de compra por âncoras locais.
Nunca executar uma prévia conectada ao banco/credenciais de produção.

Executar a suíte isolada e CI antes de publicar somente a aplicação, preservando
a imagem anterior para rollback. Não há migração nova ou alteração de conteúdo
do catálogo nesta entrega. Testar catálogo, filtros, produto, descrição e fonte
em larguras móveis e desktop; não clicar em compras reais na validação.
