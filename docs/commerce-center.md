# Central de lojas, custos e rentabilidade

Admin: `/admin-commerce.html` ou menu **Lojas, custos e rentabilidade**.

## Disponível nesta entrega

- Leitura privada dos totais de pedidos já importados em Clientes e recompra.
- CSV de custos com prévia, confirmação administrativa, identidade exata por plataforma/loja/SKU/variação/data, valores ausentes como `null` e versões históricas preservadas.
- Observações auditadas com fonte e período, persistidas exclusivamente na base privada. Não são um feed em tempo real e não são somadas entre fontes.
- Autorização Google separada das contas Search Console/YouTube, somente leitura, com PKCE e retorno vinculado à sessão administrativa. A leitura da planilha não altera o documento nem autoriza escrita.

## Dependências de conexão

- **Shopee**: aplicativo aprovado da empresa e autorização oficial da loja. Configurar `COMMERCE_SHOPEE_PARTNER_ID`/`COMMERCE_SHOPEE_PARTNER_KEY` de forma privada e `COMMERCE_SHOPEE_ENABLED=true` somente depois de registrar o callback `/api/admin/commerce/shopee/callback`. Fluxo atual brasileiro `https://open.shopee.com.br/auth`, state vinculado à sessão administrativa; confirmação criptografada de identidade BR. O conector de pedidos não está implementado nesta versão. Ads/chat possuem acesso separado: não prometer a partir desse login.
- **Kwai Shop Brasil**: confirmar parceria e documentação brasileira. Não usar a API social chinesa do Kuaishou para pedidos do Brasil.
- **UpSeller**: importação de arquivos existente; API sujeita à aprovação individual do fornecedor. Não reutilizar cookies do navegador.
- **Google Sheets**: configurar o cliente OAuth, habilitar Sheets API, registrar `${SITE_URL}/api/admin/commerce/sheets/callback` como URI de retorno e habilitar `COMMERCE_GOOGLE_OAUTH_ENABLED=true` somente após essa configuração. A reutilização do cadastro do aplicativo Google não reutiliza tokens: a nova autorização solicita `spreadsheets.readonly`. Os tokens permanecem criptografados na base. Não configurar o recurso como ativo sem teste real com a planilha.

Planilha autorizada no código: o documento de custos explicitamente fornecido pelo administrador. Leituras limitadas a `Precificacao`, `Configuracoes` e `Dashboard`; nenhum Drive inteiro, exportação de contatos ou escrita externa.

## Dados e decisões

Os valores históricos da planilha sem SKU são **referências**, não custos automaticamente aplicados aos pedidos atuais. Reembolsos, taxas, frete, impostos, custos por variação e período precisam ser conciliados para validar lucro. A central não movimenta dinheiro, não faz trading e não altera preços, estoque ou orçamentos de anúncios.

CSV: `plataforma;loja;sku;variacao;produto;preco;custo;embalagem;data_base`.
Use `shopee` ou `kwai`, data ISO e valores monetários em reais. Custo vazio é pendente, não zero. Identificadores não são derivados de nomes de pessoas ou produtos. Até 1.000 linhas / 512 KB por lote. Importações divergentes na mesma data-base exigem revisão, não sobrescrevem o histórico.

## Verificação e reversão

Executar `node --test scripts/test-commerce-center.mjs scripts/test-commerce-sheets-oauth.mjs scripts/test-commerce-shopee-oauth.mjs scripts/test-admin-commerce.mjs`, testes de autenticação/recompra existentes e smoke de HTML/API com e sem sessão. Antes da publicação guardar referência/imagem da versão saudável; sem migrações destrutivas. Em reversão, restaurar o código/imagem anterior, preservando as novas tabelas e dados importados.

O login do vendedor acontece no domínio oficial da Shopee, não em um formulário de senha da VitrineCity. A experiência final será "Conectar Shopee → entrar e autorizar na Shopee → voltar ao painel". Esse fluxo exige o cadastro do aplicativo previamente aprovado; abrir a Central do Vendedor não significa sincronização autorizada. Referência: [Shopee — Authorization and Authentication](https://open.shopee.com/developer-guide/20).
