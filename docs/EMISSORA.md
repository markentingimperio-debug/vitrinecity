# Emissora VitrineCity

A página pública `/emissora` reúne notícias, receitas, esportes e entretenimento publicados na plataforma. Oferece busca, filtros, paginação de doze matérias e links para as galerias existentes de Web Stories, música e cinema. Não inicia players nem gera conteúdo ao receber uma visita.

O prédio próprio fica ao sul da praça, na posição x=50, z=230, e usa geometrias e materiais compartilhados. O guia, a porta e o clique levam à mesma página. A antena é uma característica arquitetônica, sem indicação de transmissão ao vivo.

O endpoint público `/api/emissora/conteudos` aceita `categoria`, `q` e `page`. Retorna somente título, resumo, categoria, imagem pública local, datas e endereço da matéria publicada. Inclui artigos relacionados às Web Stories; não consulta seus rascunhos. A busca aceita até 120 caracteres e ignora diferenças de acento/caixa. Parâmetros inválidos retornam 400; indisponibilidade retorna 503 sem detalhes internos.

A interface preserva filtros no endereço e no histórico do navegador, ignora respostas de buscas anteriores e permite tentar novamente após falha. Imagens ausentes usam uma apresentação gráfica editorial sem simular fotografia da matéria. O endereço canônico não contém `.html`; o endereço com `.html` continua funcionando com o mesmo canônico, pelo mecanismo existente de aliases. A página integra o sitemap geral.

Verificação específica: `node --test scripts/test-emissora.mjs scripts/test-emissora-ui.mjs scripts/test-vitriny-emissora-building.mjs`. A suíte cobre publicação/privacidade, parâmetros, paginação, cancelamento e respostas fora de ordem, links, lote e entrada do prédio. QA de navegador deve conferir filtros, uma matéria, celular, guia e porta antes de publicar.
