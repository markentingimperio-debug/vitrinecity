# Clientes e recompra

O painel `/admin-recompra` reúne importação de pedidos próprios do UpSeller, histórico de clientes, distribuição de compras por cidade/estado e rascunhos de campanhas. Requer a autenticação administrativa existente.

## Uso

1. Em **Regiões para anúncios**, use **Ver demonstração fictícia** para experimentar cidade/estado sem gravar clientes. A consulta fictícia de comércios também é local, com vínculos previamente inventados.
2. Exporte pedidos de suas lojas no UpSeller com plataforma, loja, número do pedido, ID/nome do comprador, data, valor, pagamento, CEP, cidade e estado. Inclua produtos e contatos disponíveis.
3. Escolha a loja da VitrineCity, envie CSV/TSV/JSON/XLSX ou cole as células, revise a prévia e confirme. Lotes de até 10.000 linhas e 3 MB. XLSX é interpretado no navegador, com biblioteca local; planilhas com fórmulas ou várias abas preenchidas são rejeitadas.
4. Analise compras pagas por região/período. A exportação regional contém somente totais. O endereço histórico de entrega não comprova localização atual nem identifica compradores na Meta.
5. Clientes podem usar `/recompra` para vincular uma compra pelo número do pedido, plataforma, loja e CEP. O vínculo não revela contatos da origem. Para participar de campanhas de e-mail, precisam escolher as ofertas e confirmar o endereço da conta.
6. Prepare um rascunho. A exportação de e-mail reavalia preferências da loja e globais e inclui o link de saída. Use um provedor que processe os links de saída e respeite a lista atual no momento de enviar.

## Regras da implementação

- Identidade de origem: plataforma + loja externa + ID do comprador. Sem ID, cada pedido fica separado. Nome/endereço não são critérios de união de pessoas.
- Pedido: plataforma + loja externa + identificador do pedido. Reimportação atualiza sem somar o valor novamente. Itens repetidos idênticos são ignorados; divergências impedem o lote.
- Telefones mascarados/ausentes permanecem indisponíveis. Contatos conflitantes são sinalizados e bloqueados para campanhas; o valor anterior é preservado.
- Importar um contato não cria autorização. Cancelamentos de pedidos são aplicados na próxima importação.
- Vincular compras tem limite de tentativas. Confirmações de e-mail são de uso único, vinculadas à conta/endereço e expiram em 30 minutos.
- Saída sem login usa token assinado, revoga os canais da loja e invalida confirmações pendentes. Supressão administrativa preserva o histórico.
- Prévia expira em 1 hora; seus dados são removidos ao confirmar ou na limpeza de prévias vencidas na próxima importação. Eventos registram ações/contagens e resumos criptográficos dos contatos.
- Preferências e compras vinculadas aparecem na exportação de dados da conta. O fluxo de solicitações de exclusão continua pela central de privacidade existente.
- Bibliotecas XLSX: ExcelJS 4.4.0, licença em `app/public/vendor/exceljs-LICENSE.txt`.

## Limites atuais

Não há sincronização automática com UpSeller, enriquecimento por CPF/redes sociais, envio de anúncios, envio de campanhas de e-mail ou conexão de WhatsApp neste módulo. O único e-mail enviado pelo módulo é a confirmação solicitada pelo próprio cliente, se SMTP estiver disponível. A demonstração não consulta a internet e não grava clientes fictícios na base.

Anúncios por localização podem alcançar clientes e outras pessoas da região. Para anunciar exclusivamente para uma lista, é necessário verificar a permissão para usar os dados, as regras do marketplace e os requisitos da plataforma de anúncios; a correspondência de contatos não é garantida. Nenhum envio à Meta foi implementado.

## Verificação

`node --test scripts/test-customer-retention.mjs` cobre importação, duplicação, divergências, autenticação/origem, vínculo, consentimento, confirmação, portabilidade, descadastro, reexportação, cancelamento e relatórios agregados. Execute com as dependências do app em Node 22. O teste usa banco em memória, destinatários `example.test` e envio de e-mail simulado.

Também foram conferidos os fluxos visuais de importação, totais regionais, demonstração por cidade e público sem autorização. O leitor XLSX foi conferido com máscara, valor monetário e limite de expansão do arquivo.
