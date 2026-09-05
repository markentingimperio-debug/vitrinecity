# Captação orgânica — primeiro ciclo

## Decisão e posicionamento

Em 5/9/2026, o administrador delegou a escolha da estratégia. Foco inicial: pessoas que estão começando com plantas em vasos. A consulta agregada ao catálogo publicado encontrou 8 produtos em Adubos, 3 em Terras e Substratos, 2 em Controle Natural e 1 em Correção do Solo. Isso sustenta um piloto de jardinagem, não comprova demanda ou lucratividade.

Proposta: ajudar o visitante a observar sua planta antes de comprar insumos. Entregar um checklist aberto e conectar uma necessidade concreta a conteúdo, produtos e participação voluntária na comunidade. Ângulo: “Antes de comprar outro adubo, observe seu vaso”. Não prometer cura, viralização, retorno financeiro ou superioridade não demonstrada.

## Pesquisa e hipótese

Pesquisa primária consultada em 5/9/2026:

- [Google Business Profile](https://www.about.google/business/services/): descoberta por intenção local e informações de empresas. Não implica elegibilidade de um negócio exclusivamente online para cadastrar um endereço no Maps.
- [OLX](https://www.olx.com.br/): busca e categorias organizam a descoberta de produtos. Diferenciação proposta: começar com um problema específico, em vez de tentar disputar todas as categorias.
- [Hotmart Marketplace](https://hotmart.com/pt-br/marketplace): catálogo de aprendizagem. Diferenciação proposta: ligar a orientação introdutória à oferta de insumos e à comunidade da VitrineCity.
- [RHS — plantas de interior](https://www.rhs.org.uk/plants/types/houseplants/growing-guide): diferenças entre espécies e condições de cultivo justificam um checklist de observação, sem receita universal. Guia revisado para não aplicar estações britânicas automaticamente ao Brasil.
- [Google — conteúdo útil](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): conteúdo criado para ajudar pessoas. Um guia original com fontes, não milhares de páginas repetidas para manipular buscas.

Hipótese a validar, não resultado: iniciantes que encontram uma orientação útil podem continuar no catálogo ou criar conta. Ainda não há entrevistas, volume de busca validado ou previsão de conversão. Dúvidas recebidas voluntariamente devem orientar a segunda pauta.

## Implementação

- Guia `/guias/plantas-em-vasos.html`, acessível sem login, com checklist local, impressão/PDF e compartilhamento iniciado pelo leitor.
- Ligação da página inicial e inclusão no sitemap; indexação e posição no Google não são garantidas.
- Painel `/admin-captacao.html`: relatório agregado protegido, gerador de links e kit editorial de 14 dias.
- Links diferentes por canal e peça: `utm_source`, `utm_medium`, `utm_campaign=plantas_vasos`, `utm_content`.
- Instagram/TikTok/Kwai: demonstração curta própria. Instagram/Facebook: carrossel. YouTube: demonstração mais completa e Short. Blog: proposta editorial individual, condicionada à concordância do parceiro. Todos os textos são rascunhos, não publicações enviadas.
- APIs só serão integradas quando houver um destino confirmado, permissão da conta e finalidade concreta. Nenhuma nova conta, assinatura ou integração externa foi criada neste ciclo.

## Medição e critério de continuidade

Baseline anterior ao piloto: 219 sessões registradas nos últimos 30 dias, 203 sem UTM, 13 etiquetadas whatsapp/group e 3 meta/paid_social. Isso não representa pessoas únicas, todo o tráfego ou conversões verificadas de campanhas. Sem UTM não significa necessariamente acesso direto. Não misturar estes dados com o Google Analytics.

A medição interna usa consentimento opcional existente. O identificador e a primeira origem passam a ser guardados apenas após aceitação. Referrer novo limitado à origem (sem caminho/consulta); primeira página sem query. Negativa de consentimento não impede acesso ao guia, loja ou cadastro. Nenhum conteúdo de formulário vai para o novo relatório. Os registros anteriores não são alterados.

Cadastro confirmado é um evento gerado somente pelos dois endpoints de cadastro após sucesso. Exige sessão conhecida e sinal de aceite opcional; falha de medição não falha o cadastro. O relatório conta sessões com cadastro, não número de pessoas. Não inventa conversões históricas. Eventos públicos não aceitam `signup_confirmed`.

Janela móvel de 7/30 dias pelo início da sessão e eventos até a consulta, em UTC; máximo 10 mil sessões recentes e 30 grupos por tabela, com alerta de truncamento. Uso de mesma aba pode durar mais que 30 minutos: não equivale à definição de sessão do GA4. Busca/referrer são inferências, UTMs são autodeclaradas. Robôs e testes podem afetar resultados.

Ao fim do ciclo, comparar visitas por peça, clique no próximo passo e sessões com cadastro. Pouca exposição pede ajuste da distribuição; visitas sem ação pedem ajuste de pertinência/clareza do destino. Não declarar vencedor com poucos casos. Receita, lucro e ROAS exigem reconciliação de pedidos e custos e não são estimados neste painel.

## Operação e segurança

Sem mudanças de cobrança, políticas jurídicas, credenciais, estrutura de dados ou campanhas pagas. Nenhuma mensagem em massa, extração de integrantes de grupos ou postagem automática. A entrega técnica não substitui gravação de material próprio, revisão e execução editorial nos canais autorizados.

Testes: `node scripts/test-organic-acquisition.mjs`, `node scripts/test-analytics-consent.mjs` e suíte isolada `bash ops/verify-release.sh APP_IMAGE LIVE_STUDIO_IMAGE`. Rollback: reaplicar a imagem saudável anterior e o commit anterior, sem restaurar ou apagar banco; não há migração nesta versão.
