const lesson = (slug, title, duration, objective, sections, checklist, activity) => Object.freeze({
  slug, title, duration, objective, sections, checklist, activity
});

export const GROWTH_COURSES = Object.freeze({
  'precificacao-e-lucro': Object.freeze({
    description: 'Aprenda a calcular custo, formar preço, proteger a margem e descobrir quais produtos realmente deixam lucro.',
    audience: 'Lojistas, vendedores online, prestadores de serviço e produtores',
    lessons: Object.freeze([
      lesson('1-custo-real', '1. Descubra o custo real', '24 min', 'Mapear custos sem esquecer taxas e despesas invisíveis.', [
        { title: 'Custo não é só matéria-prima', paragraphs: ['Some matéria-prima, embalagem, etiqueta, mão de obra, perdas, frete subsidiado, comissões, impostos e taxas de pagamento. Custos esquecidos viram lucro apenas no papel.', 'Separe custos variáveis, que crescem com cada venda, dos fixos, como aluguel e sistemas. Rateie os fixos por uma quantidade mensal realista, sem usar uma meta otimista como se já fosse venda garantida.'] },
        { title: 'Ficha por produto', paragraphs: ['Crie uma ficha para cada item e registre unidade de compra, quantidade usada e custo por unidade vendida. Atualize quando fornecedor, embalagem ou taxa mudar.'] }
      ], ['Listar custos variáveis', 'Listar custos fixos', 'Calcular perdas', 'Criar ficha do produto'], 'Calcule o custo completo do produto que você mais vende.'),
      lesson('2-preco-e-margem', '2. Preço, margem e lucro', '26 min', 'Formar preço usando margem desejada e despesas proporcionais.', [
        { title: 'A conta correta', paragraphs: ['Quando taxas e margem são percentuais sobre a venda, não basta somá-las ao custo. Use: preço = custo total em reais dividido por 1 menos a soma dos percentuais. Se custo é R$ 10 e taxas mais margem somam 40%, o preço-base é R$ 16,67.', 'Margem é a parcela do preço que sobra; markup é o multiplicador aplicado ao custo. Confundir os dois pode reduzir o resultado esperado.'] },
        { title: 'Teste de realidade', paragraphs: ['Compare o preço calculado com concorrência, valor percebido e capacidade de compra do cliente. Se ficou alto, reduza custo, aumente valor ou mude a oferta; não apague despesas da planilha.'] }
      ], ['Somar percentuais', 'Calcular preço-base', 'Comparar com mercado', 'Definir preço mínimo'], 'Calcule preço mínimo, preço ideal e preço promocional de um produto.'),
      lesson('3-marketplaces', '3. Precificação em marketplaces', '25 min', 'Incluir comissão, tarifa fixa, publicidade e promoções.', [
        { title: 'Cada canal tem uma conta', paragraphs: ['Um produto pode precisar de preços diferentes na loja física, site e marketplace. Consulte sempre a tabela oficial vigente do canal e simule comissão, tarifa fixa, frete, antecipação, imposto, cupom e anúncio.', 'Não use regras antigas recebidas por mensagem como referência permanente. Plataformas alteram políticas; registre a data de cada taxa na planilha.'] },
        { title: 'ROAS e margem', paragraphs: ['Publicidade deve caber na margem. Calcule quanto pode gastar para gerar uma venda sem ficar no prejuízo. Produtos de margem baixa exigem anúncio mais eficiente ou venda em kit.'] }
      ], ['Conferir taxas oficiais', 'Incluir publicidade', 'Simular cupons', 'Definir gasto máximo por venda'], 'Simule a mesma venda em dois canais e compare o lucro líquido.'),
      lesson('4-kits-e-promocoes', '4. Kits, descontos e promoções', '21 min', 'Criar ofertas sem destruir a margem.', [
        { title: 'Desconto com limite', paragraphs: ['Defina o preço mínimo antes de criar cupom. Um desconto só funciona se a venda adicional compensar a margem perdida. Registre prazo, estoque e objetivo da campanha.', 'Kits podem diluir tarifa fixa, aumentar ticket e facilitar o frete, mas precisam ser calculados item por item. Produtos encalhados não devem esconder prejuízo no conjunto.'] },
        { title: 'Escada de ofertas', paragraphs: ['Tenha uma opção de entrada, uma principal e uma de maior valor. Mostre com clareza quantidade e economia real, sem preços de referência artificiais.'] }
      ], ['Calcular piso do desconto', 'Montar um kit', 'Definir prazo', 'Medir ticket e lucro'], 'Crie um kit e compare seu lucro com duas vendas separadas.'),
      lesson('5-painel-de-lucro', '5. Painel semanal de lucro', '20 min', 'Acompanhar vendas, margem e caixa para decidir melhor.', [
        { title: 'Indicadores essenciais', paragraphs: ['Acompanhe faturamento, custo dos produtos vendidos, taxas, publicidade, imposto estimado, lucro e margem. Separe lucro de saldo bancário: parte do caixa será usada para repor estoque e pagar compromissos.', 'Analise por produto. Um item campeão de faturamento pode consumir caixa, enquanto outro menor sustenta a margem do negócio.'] },
        { title: 'Rotina de decisão', paragraphs: ['Toda semana escolha ações objetivas: reajustar, negociar fornecedor, criar kit, reduzir anúncio ineficiente ou priorizar item lucrativo. Preserve histórico para comparar antes e depois.'] }
      ], ['Registrar vendas', 'Calcular lucro por produto', 'Comparar margem', 'Escolher uma ação semanal'], 'Monte uma tabela semanal e identifique o produto de maior lucro, não apenas o mais vendido.')
    ])
  }),
  'shopee-do-zero': Object.freeze({
    description: 'Estruture sua operação na Shopee, publique anúncios claros e conquiste as primeiras vendas com controle de custos e atendimento.',
    audience: 'Iniciantes que desejam vender produtos físicos pela internet',
    lessons: Object.freeze([
      lesson('1-planejamento', '1. Produto, público e planejamento', '22 min', 'Escolher uma oferta viável antes de abrir anúncios.', [
        { title: 'Validação básica', paragraphs: ['Defina quem compra, qual problema o produto resolve, custo, peso, embalagem, prazo e margem. Produtos frágeis, pesados ou com restrição precisam de planejamento logístico e regulatório.', 'Pesquise resultados dentro da plataforma para observar faixa de preço, apresentação e avaliações. Use a pesquisa para encontrar oportunidades, não para copiar textos ou imagens.'] },
        { title: 'Regras vigentes', paragraphs: ['Consulte a Central do Vendedor e as políticas oficiais antes de cadastrar. Categorias, tarifas, documentos e produtos permitidos podem mudar.'] }
      ], ['Definir público', 'Calcular custo', 'Verificar logística', 'Ler políticas oficiais'], 'Preencha uma ficha de viabilidade para três produtos e escolha um.'),
      lesson('2-conta-e-operacao', '2. Conta e operação organizada', '20 min', 'Preparar cadastro, estoque, embalagem e rotina de pedidos.', [
        { title: 'Base da loja', paragraphs: ['Use dados verdadeiros, identidade visual consistente e descrição objetiva. Configure endereço, envio e atendimento conforme as opções disponíveis na sua conta.', 'Separe espaço para estoque, conferência, embalagem e postagem. Crie códigos internos para reduzir troca de itens e registre entradas e saídas.'] },
        { title: 'Prazo e qualidade', paragraphs: ['Prometa apenas o que consegue cumprir. Atraso, cancelamento e produto divergente prejudicam cliente e desempenho da operação.'] }
      ], ['Completar cadastro', 'Organizar estoque', 'Definir código interno', 'Criar checklist de embalagem'], 'Simule um pedido do recebimento até a postagem.'),
      lesson('3-anuncio-que-converte', '3. Anúncio que explica e vende', '28 min', 'Criar título, imagens e descrição que reduzam dúvidas.', [
        { title: 'Título e imagens', paragraphs: ['Use nome do produto, característica principal, quantidade e aplicação relevante, sem repetir palavras ou prometer o que não entrega. A primeira imagem deve mostrar claramente o item e a variação.', 'Use fotos próprias ou licenciadas. Mostre escala, conteúdo da embalagem, detalhes e modo de uso quando aplicável. Não esconda limitações.'] },
        { title: 'Descrição útil', paragraphs: ['Explique para quem serve, benefícios objetivos, especificações, conteúdo, cuidados e o que acompanha. Revise medidas e informações técnicas.'] }
      ], ['Título claro', 'Imagem principal limpa', 'Fotos de detalhes', 'Descrição completa'], 'Reescreva um anúncio e peça a uma pessoa para dizer exatamente o que receberia.'),
      lesson('4-preco-frete', '4. Preço, frete e promoções', '24 min', 'Calcular a venda considerando todas as taxas.', [
        { title: 'Simulação atualizada', paragraphs: ['Consulte as tarifas oficiais da sua conta e inclua comissão, tarifa fixa, imposto, frete assumido, embalagem, devoluções esperadas e anúncios. Regras da plataforma mudam; revise antes de reajustar.', 'Monte kits somente depois de calcular peso, dimensões e margem. Uma oferta com preço atraente e prejuízo não é sustentável.'] },
        { title: 'Promoção com objetivo', paragraphs: ['Use cupom ou desconto para lançamento, recompra ou giro definido. Compare lucro por pedido antes e durante a campanha.'] }
      ], ['Atualizar taxas', 'Calcular embalagem', 'Conferir peso e dimensão', 'Definir preço mínimo'], 'Calcule o lucro líquido estimado de uma venda e de um kit.'),
      lesson('5-atendimento-envio', '5. Atendimento, envio e avaliações', '21 min', 'Entregar uma experiência confiável do pedido ao pós-venda.', [
        { title: 'Resposta e conferência', paragraphs: ['Responda com objetividade e não leve o cliente para fora da plataforma quando isso contrariar as regras. Antes de fechar a embalagem, confira produto, variação, quantidade e proteção.', 'Registre o processo com checklist. Em reclamações, mantenha tom profissional e use os canais oficiais de solução.'] },
        { title: 'Avaliações', paragraphs: ['Uma boa avaliação começa na correspondência entre anúncio e entrega. Não ofereça benefício proibido em troca de nota e não manipule avaliações.'] }
      ], ['Criar respostas-padrão', 'Conferir cada pedido', 'Proteger embalagem', 'Executar pós-venda permitido'], 'Crie um checklist de cinco pontos para reduzir erros de envio.'),
      lesson('6-primeiras-vendas', '6. Plano para as primeiras vendas', '23 min', 'Publicar, medir e melhorar sem depender de promessas rápidas.', [
        { title: 'Plano de 14 dias', paragraphs: ['Dias 1 a 3: preparar operação e anúncio. Dias 4 a 7: publicar e responder dúvidas. Dias 8 a 10: revisar cliques, conversão e preço. Dias 11 a 14: testar uma melhoria por vez.', 'Evite alterar tudo diariamente. Mudanças simultâneas impedem descobrir o que trouxe resultado. Não existe garantia de vendas; estoque, preço, reputação, demanda e execução influenciam o desempenho.'] },
        { title: 'Indicadores', paragraphs: ['Acompanhe visualizações, cliques, conversão, pedidos, cancelamentos, margem e retorno de anúncios. Priorize lucro e qualidade operacional.'] }
      ], ['Publicar anúncio completo', 'Responder dúvidas', 'Medir conversão', 'Testar uma melhoria'], 'Monte seu plano de 14 dias com uma meta de processo e uma meta de resultado.')
    ])
  }),
  'videos-curtos-que-vendem': Object.freeze({
    description: 'Grave vídeos curtos pelo celular com roteiro, demonstração e chamada para ação, sem precisar de equipamento caro.',
    audience: 'Lojistas, afiliados, criadores iniciantes e prestadores de serviço',
    lessons: Object.freeze([
      lesson('1-ideia-e-gancho', '1. Ideia e gancho nos primeiros segundos', '20 min', 'Transformar uma dor do cliente em abertura de vídeo.', [
        { title: 'Uma mensagem por vídeo', paragraphs: ['Escolha um problema, um produto e uma ação. O início deve mostrar rapidamente o resultado, a dúvida ou a situação que o público reconhece.', 'Evite introduções longas. Exemplos de estruturas: “Se você sofre com…”, “Antes de comprar…, veja isto” e “Três erros que fazem…”. Use apenas afirmações verdadeiras.'] },
        { title: 'Banco de ideias', paragraphs: ['Liste dúvidas de clientes, erros frequentes, comparações, bastidores, demonstrações e provas autorizadas. Cada pergunta pode virar um vídeo.'] }
      ], ['Escolher uma dor', 'Escrever gancho curto', 'Definir uma ação', 'Separar prova verdadeira'], 'Escreva dez ganchos para o produto que você mais vende.'),
      lesson('2-roteiro-pratico', '2. Roteiro de 15 a 60 segundos', '22 min', 'Criar roteiro simples com começo, demonstração e convite.', [
        { title: 'Estrutura G-D-C', paragraphs: ['Gancho prende atenção, demonstração entrega valor e chamada orienta o próximo passo. Escreva frases curtas e mostre o produto enquanto explica.', 'Para 30 segundos, reserve cerca de cinco para o gancho, vinte para mostrar e cinco para a chamada. Ajuste ao ritmo da fala sem acelerar de forma incompreensível.'] },
        { title: 'CTA específico', paragraphs: ['Peça uma ação adequada ao canal: comentar, salvar, seguir, abrir o produto ou enviar mensagem. Uma chamada clara funciona melhor que cinco pedidos diferentes.'] }
      ], ['Gancho', 'Demonstração', 'Prova', 'Uma chamada para ação'], 'Escreva um roteiro de 30 segundos e leia em voz alta com cronômetro.'),
      lesson('3-gravacao-celular', '3. Gravação profissional com celular', '25 min', 'Melhorar luz, áudio e enquadramento com recursos simples.', [
        { title: 'Preparação', paragraphs: ['Limpe a lente, grave na vertical, use luz de frente e escolha fundo organizado. Apoie o celular para evitar tremores e deixe espaço seguro para legendas e botões da plataforma.', 'Áudio claro é mais importante que cenário caro. Aproxime-se do aparelho, reduza ruídos e grave pequenas partes quando tiver dificuldade para falar tudo de uma vez.'] },
        { title: 'Demonstração honesta', paragraphs: ['Mostre textura, tamanho, embalagem e uso real. Não use antes e depois manipulado nem resultados impossíveis de comprovar.'] }
      ], ['Limpar lente', 'Usar luz frontal', 'Reduzir ruído', 'Gravar na vertical'], 'Grave três tomadas de cinco segundos: produto, uso e resultado observável.'),
      lesson('4-edicao-e-legendas', '4. Edição, ritmo e legendas', '24 min', 'Editar para clareza e retenção sem poluir a tela.', [
        { title: 'Cortes que ajudam', paragraphs: ['Retire pausas excessivas, repetições e trechos sem informação. Use aproximações e textos apenas para destacar pontos relevantes. Transições e efeitos devem servir à compreensão.', 'Adicione legendas revisadas, com contraste e tamanho legível. Confirme números, preço e ortografia antes de exportar.'] },
        { title: 'Direitos autorais', paragraphs: ['Use músicas, imagens e vídeos autorizados para uso comercial. As bibliotecas e regras variam por plataforma e tipo de conta; consulte os termos vigentes.'] }
      ], ['Cortar pausas', 'Revisar legendas', 'Conferir preço', 'Usar mídia autorizada'], 'Edite o roteiro anterior em até 35 segundos e teste sem som.'),
      lesson('5-publicacao-e-metricas', '5. Publicação e plano de conteúdo', '21 min', 'Publicar com consistência e aprender com os números.', [
        { title: 'Sequência semanal', paragraphs: ['Alterne demonstração, dica, comparação, bastidor, prova autorizada e oferta. Reaproveite a ideia, mas adapte texto, duração e chamada a cada plataforma.', 'Acompanhe retenção inicial, tempo assistido, cliques, conversas e vendas atribuídas. Muitas visualizações sem ação podem indicar público errado ou chamada fraca.'] },
        { title: 'Ciclo de melhoria', paragraphs: ['Teste um elemento por vez: gancho, capa, duração ou chamada. Repita estruturas vencedoras com novos temas sem copiar conteúdo de terceiros.'] }
      ], ['Planejar cinco vídeos', 'Publicar com consistência', 'Registrar métricas', 'Repetir formato vencedor'], 'Monte um calendário de sete dias e defina a métrica principal de cada vídeo.')
    ])
  })
});
