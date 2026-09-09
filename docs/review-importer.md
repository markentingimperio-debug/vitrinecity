# Importação de avaliações de produtos

Acesso administrativo: `/admin-avaliacoes` (atalhos em Administração e Gestão de lojas).

O importador recebe CSV, TSV ou JSON com avaliações reais. O link da Shopee identifica o anúncio de origem; não há extração automática nem contorno de CAPTCHA. Fotos são aceitas em `photos`, como lista de URLs no JSON ou URLs separadas por `|` no CSV (até 5 por avaliação, CDNs originais cf.shopee.com.br e down-br.img.susercontent.com). Vídeos não são importados. O filtro padrão importa somente notas 4 e 5; a prévia contabiliza as avaliações fora do filtro.

1. Escolha um produto e informe o link completo da Shopee, ou informe `product_id` e `source_url` em cada linha para vários produtos.
2. Envie o arquivo (até 2 MB / 2.000 avaliações por lote) ou cole seu conteúdo.
3. Confira a prévia, os produtos correspondentes e os erros. Corrija todo erro antes de continuar.
4. Confirme a correspondência e publique. O servidor revalida duplicatas no momento da gravação.

Campos obrigatórios: `author` (nome público), `rating` (inteiro de 1 a 5), `date` (data original em AAAA-MM-DD, opcionalmente com horário). `body` pode ficar vazio para avaliações só com estrelas. Opcionais: `review_id`, `title`, `variation`. Datas sem fuso são interpretadas no horário de Brasília. Não incluir e-mail, telefone ou dados de pedidos.

JSON aceita uma lista de avaliações, `{ "reviews": [...] }`, `{ "data": { "ratings": [...] } }` ou `{ "products": [{ "product_id": 12, "source_url": "https://shopee.com.br/product/390179975/23698375162/", "reviews": [...] }] }`. Nomes alternativos da Shopee: `author_username`, `rating_star`, `ctime`, `comment`, `cmtid`, `model_name`. Quando presentes, `itemid` e `shopid` devem corresponder ao link.

As fotos ficam em `marketplace_review_photos` com o lote responsável. É possível acrescentar fotos a uma avaliação existente sem duplicá-la, preservando os dados originais para a correspondência. Repetir a importação não repete as fotos. Ocultar um lote de fotos não oculta avaliações de outro lote. As imagens são exibidas por suas URLs originais e dependem da disponibilidade do CDN.

Cada avaliação importada recebe origem, nome público, variação, ID externo (quando disponível) e impressão digital para deduplicação. Uma origem não pode ser vinculada a dois produtos locais. A importação não cria usuários nem marca compra verificada na VitrineCity. O total público representa as avaliações efetivamente publicadas; não reproduz o total histórico da Shopee.

As prévias expiram em 24 horas e são vinculadas ao administrador que as criou. A gravação é atômica e uma repetição da mesma publicação não duplica dados. Lotes publicados podem ser ocultados/restaurados sem excluir o histórico ou alterar avaliações nativas. As ações ficam em `marketplace_review_import_audit`.

Tabelas adicionais: `marketplace_review_imports`, `marketplace_review_product_links`, `marketplace_review_sources`, `marketplace_review_import_audit`. Avaliações são gravadas na tabela já existente `marketplace_product_reviews`, com `user_id=NULL`, `verified_purchase=0` e data original. Nenhuma tabela existente é recriada.

Testes: `npm run test:reviews` (validação, deduplicação, autenticação, origem, expiração, transação, visibilidade, renderização pública). Executar em ambiente isolado, sem montar dados de produção.
