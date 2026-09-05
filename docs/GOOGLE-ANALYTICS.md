# Google Analytics da VitrineCity

Propriedade verificada: **Vitrine City**, `551657228`; fluxo web `15500793460`;
ID público de medição `G-0V9KJQMH0V`. Não é uma chave secreta e não exige alteração do `.env`.

## Coleta e privacidade

- Google carrega somente em `vitrinecity.com`/`www.vitrinecity.com`, nas rotas públicas explicitamente permitidas em `app/public/measurement-policy.js`.
- Exige `vc_analytics_consent=accepted` **e** nova escolha `vc_google_analytics_consent_v1=accepted`. Uma autorização antiga da medição interna não autoriza silenciosamente o novo fornecedor.
- Modo de consentimento básico: nenhuma requisição ao Google antes da autorização; publicidade, personalização e Google Signals desativados nesta tag.
- Cada carregamento autorizado envia um `page_view` manual. Títulos são genéricos, detalhes públicos são agrupados; consultas livres, fragmentos, campos de formulário, caminhos privados do referenciador e páginas de conta/administração não são enviados.
- Somente identificadores UTM e `gclid` restritos a letras/números/hífen/underscore e 160 caracteres podem compor a URL medida. Não coloque dados pessoais em parâmetros de campanha.
- **Métrica otimizada foi desativada no fluxo web em 05/09/2026**, para impedir captura automática de formulários, pesquisas, links e mudanças de histórico e evitar duplicação de visualizações. Não reativar sem nova revisão.
- A opção “Preferências de privacidade”, nas páginas públicas medidas, permite escolher “Só essenciais”. O sinal documentado `ga-disable-G-0V9KJQMH0V` bloqueia a coleta posterior na página já aberta. Não apaga dados históricos do Google nem cookies já criados.
- Os eventos internos de cadastro/CTA continuam separados. Não há importação de conversões para Google Ads, alterações de lances, públicos ou campanhas.

## Verificação e limites

1. Rodar `node --test scripts/test-analytics-consent.mjs scripts/test-google-analytics.mjs` dentro de `app`; depois executar `ops/verify-release.sh` em imagem isolada.
2. O build executa `prepare-public-highlights.js` para incluir o carregador nas páginas estáticas permitidas; o middleware cobre HTML público dinâmico. Inclusão idempotente.
3. No navegador, confirmar ausência de `googletagmanager.com`/`google-analytics.com` antes de aceitar. Depois confirmar tag com o ID correto e `g/collect` de `page_view`, sem dados privados.
4. Abrir o relatório **Tempo real** da propriedade `551657228`, distinguindo a visita controlada (`utm_source=codex_validation`) de tráfego comercial. Relatórios comuns podem demorar a processar.

Cliques de anúncios não equivalem a sessões medidas: recusa de cookies, bloqueadores e saída antes do carregamento reduzem a contagem. Visitas anteriores à instalação não são recuperadas retroativamente.

## Reversão

Preservar a imagem anterior e aplicar rollback somente do serviço `app`, sem excluir volumes, alterar credenciais ou remover o executor. A configuração de métrica otimizada do fluxo é independente do código; manter desativada é seguro caso se retire a tag. Registrar qualquer futura alteração dela separadamente.

## Conversões confirmadas — extensão de 05/09/2026

A página efetivamente usada pelos anúncios, `/porque-vitrinecity.html`, entrou na lista de medição, assim como `/ofertas`. Ela já tinha o carregador interno, mas não a autorização de carregamento da tag Google.

Conversões exigem ainda uma **nova escolha explícita**: `vc_conversion_measurement_consent_v1=accepted`. Consentimento anterior apenas para visitas não autoriza a ampliação. O aviso descreve visitas, cadastros, contatos comerciais e compras.

| Evento GA4 | Critério |
| --- | --- |
| `sign_up` | Cadastro da conta/cliente efetivamente criado pelo servidor; erros e conta duplicada não contam. |
| `generate_lead` | Inscrição de lead/comunidade salva ou contato com assunto comercial. Suporte, denúncias e honeypots não viram conversões comerciais GA4. |
| `begin_checkout` | Pedido de marketplace salvo e checkout do provedor criado; não significa venda. |
| `purchase` | Pedido do comprador autenticado com pagamento aprovado, evento de pagamento verificado e checkout recente com opt-in. |
| `refund` | Reembolso integral/chargeback confirmado do mesmo pedido, somente se esse navegador tiver registrado a compra. |

O cabeçalho `X-VC-Measurement` contém somente recibo mínimo de uma ação bem-sucedida. A consulta autenticada de pedidos fornece `measurementReceipts`; o observador não envia formulário nem lista de pedidos ao Google. O valor de compra é o subtotal dos produtos; frete separado. IDs de produtos são numéricos e o identificador de transação é derivado, sem expor referência operacional, cliente, endereço, e-mail, telefone, CPF, título livre ou dados de pagamento.

O checkout agora preserva a primeira origem conhecida no relatório interno. O endpoint público de eventos rejeita `lead`, `checkout_start`, `purchase` e `signup_confirmed`: os nomes confirmados são reservados ao servidor. Falha da medição opcional não interrompe cadastro, checkout ou webhook.

### Limites importantes

- Google continua ausente em páginas de conta e pedidos. Nelas, recibos mínimos ficam no navegador e são enviados **na próxima página pública permitida**. Se o cliente não consultar o pedido aprovado ou não retornar a uma página pública, GA4 não recebe essa compra; o registro financeiro interno continua sendo a fonte de verdade.
- Não é Measurement Protocol servidor-a-servidor; não há novo segredo nem exportação retroativa. Checkout elegível por sete dias, fila de até 100 recibos e histórico de até 200 marcadores com retenção lógica de sete dias, purgados no uso. Bloqueadores, armazenamento indisponível e saída do navegador podem impedir entrega.
- Deduplicação por recibo no navegador; Web Locks serializa abas quando suportado. Sem Web Locks é melhor esforço. Marcação significa tentativa de envio, não confirmação de recebimento. `transaction_id` estável permite a deduplicação de compra no GA4. Nenhuma garantia de entrega exatamente uma vez.
- Nesta etapa, compras GA4 abrangem marketplace; créditos, cursos, lotes, assinaturas e pacotes de vídeo não foram conectados ao novo fluxo. Reembolsos parciais não são exportados.
- Não executar cadastros ou pagamentos fictícios na produção para validar eventos. Testes financeiros usam SQLite descartável e rede externa desativada.
- Marcação de eventos-chave na interface Google, importação para Ads e validação de vendas comerciais reais são etapas distintas; não inferir ROI/ROAS do sucesso do teste.

### Auditoria de campanha (somente leitura)

Consulta Meta, conta VitrineCity/Ricardo Cb, intervalo 28/08–05/09/2026: as campanhas Vitrine Social (`120246430688420741`) e Goiânia (`120246502624520741`) levam à mesma página acima. Ambas usam `utm_campaign=cidade_digital_trafego` e `utm_content=anuncio_01`. Isso impede separar as duas por essas etiquetas. Os anúncios não foram alterados.

Proposta para revisão no próximo ajuste de campanha: usar `utm_campaign=vc_120246430688420741&utm_content=ad_120246430688410741` na primeira e `utm_campaign=vc_120246502624520741&utm_content=ad_120246502624530741` na segunda, mantendo `utm_source=meta&utm_medium=paid_social`. Não atribuir cliques antigos ao GA instalado posteriormente nem misturar a propriedade Agrotécnica com Vitrine City.

Testes adicionais: `test-conversion-measurement.mjs`, `test-measurement-receipts.mjs` e os testes de consentimento/GA4; todos incluídos automaticamente em `npm run test:release`.

Referências oficiais: [eventos recomendados GA4](https://developers.google.com/analytics/devguides/collection/ga4/reference/events) e [e-commerce GA4](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce).
