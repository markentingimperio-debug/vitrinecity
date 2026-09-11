// These examples are intentionally public samples. The full lessons stay private.
export const COURSE_DEMONSTRATIONS = Object.freeze({
  'vendas-pelo-whatsapp': {
    heading: 'Veja como uma conversa vira um próximo passo claro',
    intro: 'Experimente uma aula curta: responda ao pedido, explique a oferta e acompanhe o cliente com contexto.',
    lessonSlug: '3-roteiros-de-atendimento',
    outcomes: ['Organizar perfil, catálogo e etapas do atendimento', 'Escrever ofertas e respostas para dúvidas de preço', 'Criar uma rotina de acompanhamento e medir pedidos'],
    scenarios: [
      {
        title: '1. Responder a um pedido de orçamento',
        context: 'Uma pessoa procurou uma loja de canecas. A resposta precisa explicar o produto e esclarecer a entrega.',
        before: 'Temos sim. R$ 29,90.',
        messages: [
          { speaker: 'Cliente', text: 'Olá! Quanto custa a caneca? Vocês entregam?' },
          { speaker: 'Loja', text: 'Olá! Aqui é da Loja Exemplo. A caneca de cerâmica de 350 ml custa R$ 29,90. Você quer uma unidade ou um kit?' },
          { speaker: 'Cliente', text: 'Uma unidade, para presente.' },
          { speaker: 'Loja', text: 'Certo! Posso conferir o frete e o prazo para o seu CEP? Depois te envio o total antes de confirmar o pedido.' }
        ],
        explanation: 'A loja identifica o produto, informa o preço e faz uma pergunta útil. O frete e o prazo ficam sujeitos à consulta, sem promessa inventada.',
        task: 'Troque o produto, a capacidade e o preço pelos dados verdadeiros da sua oferta. Termine com apenas uma pergunta que ajude a atender.'
      },
      {
        title: '2. Responder quando o cliente diz “está caro”',
        context: 'O cliente compara ofertas. Entenda a diferença antes de oferecer desconto.',
        messages: [
          { speaker: 'Cliente', text: 'Achei caro. Vi outra por menos.' },
          { speaker: 'Loja', text: 'Entendo. Você está comparando uma caneca da mesma capacidade e material? Esta é de cerâmica, com 350 ml. Posso te mostrar os detalhes para você avaliar.' },
          { speaker: 'Cliente', text: 'A outra era menor. Pode mostrar.' },
          { speaker: 'Loja', text: 'Claro. Vou enviar a foto e as medidas. Se preferir algo de menor valor, também posso verificar as opções disponíveis.' }
        ],
        explanation: 'A resposta acolhe a dúvida e compara características verificáveis. Ela não diminui o concorrente nem promete um desconto que a loja não pode cumprir.',
        task: 'Liste duas diferenças reais da sua oferta. Escreva uma resposta sem usar “é melhor” ou “vale a pena” como única justificativa.'
      },
      {
        title: '3. Retomar um orçamento sem pressionar',
        context: 'A pessoa pediu um orçamento e combinou que poderia receber um retorno.',
        messages: [
          { speaker: 'Loja', text: 'Olá! Aqui é da Loja Exemplo. Você pediu o orçamento da caneca para presente. Ainda posso ajudar com alguma dúvida sobre o produto ou a entrega?' },
          { speaker: 'Cliente', text: 'Vou deixar para outra hora.' },
          { speaker: 'Loja', text: 'Combinado. Obrigado pelo retorno! Quando precisar, é só chamar.' }
        ],
        explanation: 'Retomar com contexto facilita o reconhecimento. Respeitar o “agora não” evita insistência; campanhas para outros produtos precisam de autorização própria.',
        task: 'Escreva uma retomada com o motivo do contato e uma pergunta. Defina em qual etapa você encerrará o acompanhamento.'
      }
    ]
  },
  'canva-para-lojas': {
    heading: 'Transforme uma divulgação vaga em uma oferta clara',
    intro: 'Veja a ordem das informações antes de abrir o Canva: produto, condição e uma próxima ação.',
    lessonSlug: '2-modelo-de-post',
    outcomes: ['Definir cores e fontes para a loja', 'Organizar posts, Stories e catálogos', 'Revisar informações e exportar as peças'],
    scenarios: [{
      title: 'Uma oferta que dá para entender de primeira',
      context: 'A loja quer divulgar uma caneca. Compare as duas mensagens do exemplo.',
      before: 'SUPER PROMOÇÃO! MUITAS NOVIDADES! CHAME AGORA!!!',
      example: 'CANECA DE CERÂMICA\n350 ml · 1 unidade\nR$ 29,90\nConsulte cores, frete e disponibilidade pelo WhatsApp.',
      explanation: 'O nome aparece primeiro, tamanho e quantidade explicam a oferta, e o preço fica fácil de encontrar. No Canva, use uma foto própria nítida, até duas fontes e contraste entre fundo e texto.',
      task: 'Monte um post com essas quatro informações usando seu produto real. Veja em tamanho de celular: dá para identificar o produto e o preço sem ampliar?'
    }]
  },
  'ia-para-pequenos-negocios': {
    heading: 'Veja um pedido à IA com contexto e limites',
    intro: 'Uma amostra de como transformar uma tarefa vaga em uma resposta que você consegue revisar e usar.',
    lessonSlug: '2-prompt-pratico',
    outcomes: ['Escrever prompts com contexto, tarefa e formato', 'Preparar conteúdo e respostas com revisão humana', 'Escolher uma tarefa do negócio e acompanhar a aplicação'],
    scenarios: [{
      title: 'Da instrução genérica ao texto útil',
      context: 'Vamos criar a descrição de uma caneca usando apenas informações fornecidas pela loja.',
      before: 'Faça um anúncio incrível que venda muito.',
      example: 'Contexto: sou uma pequena loja de presentes.\nTarefa: escreva uma descrição de até 45 palavras.\nDados confirmados: caneca de cerâmica, 350 ml, R$ 29,90 por unidade.\nLimites: não invente cores, estoque, benefícios ou prazo de entrega.\nFormato: produto, características, preço e convite para consultar a entrega.',
      result: 'Caneca de cerâmica de 350 ml por R$ 29,90 a unidade. Consulte as cores disponíveis e as condições de entrega com a loja antes de finalizar seu pedido.',
      explanation: 'O resultado é um exemplo escrito para esta aula, não uma resposta gerada ao vivo. Compare cada afirmação com os dados de entrada. Remova qualquer característica que você não possa confirmar.',
      task: 'Escolha um produto e preencha os quatro blocos do prompt. Use dados comerciais públicos e revise a resposta antes de publicar.'
    }]
  },
  'logo-no-canva': {
    heading: 'Comece seu logo por um briefing de quatro linhas',
    intro: 'Defina o que a marca precisa comunicar antes de escolher símbolo, cor ou fonte.',
    lessonSlug: '1-estrategia-da-marca',
    outcomes: ['Preparar um briefing e escolher referências', 'Criar e testar versões da marca', 'Organizar arquivos e um manual simples'],
    scenarios: [{
      title: 'Um briefing para uma loja de presentes',
      context: 'Loja fictícia usada apenas para praticar a decisão visual.',
      example: 'Nome: Loja Exemplo\nPúblico: pessoas que procuram presentes para o dia a dia\nPersonalidade: acolhedora e simples\nAplicações: foto de perfil, etiqueta pequena e catálogo digital',
      explanation: 'A aplicação em uma etiqueta pequena pede um nome legível. Comece com o nome em uma fonte clara e teste em preto e branco. Um símbolo que só funciona grande pode não servir ao uso principal.',
      task: 'Preencha o briefing da sua marca e teste o nome em tamanho de foto de perfil. Confira se continua legível sem zoom.'
    }]
  },
  'geladinhos-gourmet': {
    heading: 'Monte uma ficha para testar um sabor',
    intro: 'Organize ingredientes, rendimento e observações antes de transformar um teste em produto de venda.',
    lessonSlug: '2-base-e-sabores',
    outcomes: ['Planejar produção e cuidados com os alimentos', 'Registrar testes, custos e apresentação', 'Organizar cardápio e lançamento'],
    scenarios: [{
      title: 'A ficha que permite repetir um teste',
      context: 'Este exemplo mostra o registro de produção; não é uma receita ou uma definição de validade.',
      example: 'Sabor e versão: coco · teste 01\nData e responsável: preencher\nIngredientes, marcas e quantidades: preencher\nRendimento real e volume por unidade: medir\nEmbalagem e custo total do lote: registrar\nTextura, sabor e alterações para o próximo teste: anotar',
      explanation: 'Mudar vários ingredientes ao mesmo tempo dificulta saber o que funcionou. Registre a primeira versão, altere um ponto e compare. Cuidados sanitários, conservação e validade precisam ser definidos adequadamente para a produção.',
      task: 'Crie sua ficha e preencha os campos com um teste real. Não anuncie rendimento, composição ou validade que ainda não foram confirmados.'
    }]
  },
  'precificacao-e-lucro': {
    heading: 'Veja por que margem e acréscimo são diferentes',
    intro: 'Acompanhe uma conta simples e confira quanto sobra em uma venda hipotética.',
    lessonSlug: '2-preco-e-margem',
    outcomes: ['Mapear custos e despesas por produto', 'Calcular preço e comparar canais de venda', 'Revisar kits, descontos e resultado semanal'],
    scenarios: [{
      title: 'Um preço calculado passo a passo',
      context: 'Exemplo didático: custo unitário de R$ 10, taxas de 10% sobre a venda e margem desejada de 30%. Os percentuais são fictícios.',
      example: 'Preço = 10 ÷ (1 − 0,10 − 0,30)\nPreço arredondado = R$ 16,67\nTaxa aproximada = R$ 1,67\nSobra após esse custo e essa taxa = R$ 5,00',
      explanation: 'R$ 5,00 corresponde a aproximadamente 30% do preço. Somar 40% ao custo daria R$ 14,00 e não produziria a mesma margem. Outros custos ou despesas que não entraram no exemplo ainda precisam ser descontados.',
      task: 'Liste todos os seus custos e consulte as taxas reais do seu canal. Refaça a conta com os seus números e confira o resultado, sem copiar os percentuais do exemplo.'
    }]
  },
  'shopee-do-zero': {
    heading: 'Revise um anúncio antes de colocá-lo no ar',
    intro: 'Uma amostra da preparação de um anúncio: o cliente precisa entender exatamente o que vai receber.',
    lessonSlug: '3-anuncio-que-converte',
    outcomes: ['Planejar produto, estoque e operação', 'Criar anúncios e calcular custos por canal', 'Organizar envio, atendimento e rotina de melhoria'],
    scenarios: [{
      title: 'Um título e uma conferência de embalagem',
      context: 'Caneca fictícia para praticar clareza. O exemplo não reproduz um anúncio de outra loja.',
      before: 'Caneca linda top promoção presente imperdível',
      example: 'Caneca de Cerâmica 350 ml · 1 Unidade\n\nAntes de publicar:\n• Foto corresponde à variação selecionada?\n• Capacidade e material foram conferidos?\n• Descrição informa o que acompanha?\n• Peso e medidas incluem a embalagem de envio?\n• Preço considera as tarifas atuais da conta?',
      explanation: 'Características verificáveis ajudam o cliente a comparar. O anúncio precisa corresponder ao item enviado. Consulte as regras atuais da Central do Vendedor para categoria, imagens e informações obrigatórias.',
      task: 'Revise um produto seu usando a lista. Peça a outra pessoa para dizer o que receberia ao ler apenas o anúncio.'
    }]
  },
  'videos-curtos-que-vendem': {
    heading: 'Veja um roteiro de demonstração de 30 segundos',
    intro: 'Planeje o que mostrar e o que falar antes de gravar pelo celular.',
    lessonSlug: '2-roteiro-pratico',
    outcomes: ['Escolher uma ideia e escrever o roteiro', 'Gravar e editar com clareza pelo celular', 'Planejar publicações e acompanhar as ações'],
    scenarios: [{
      title: 'Produto, demonstração e uma chamada',
      context: 'Roteiro ilustrativo para uma caneca. Ajuste o tempo à sua fala e às características reais do produto.',
      example: '0–5 s · Mostrar a caneca inteira: “Procurando uma caneca para o café do dia a dia?”\n5–15 s · Mostrar alça e acabamento: “Esta é de cerâmica e tem capacidade de 350 ml.”\n15–25 s · Mostrar o produto ao lado da embalagem: “Confira de perto os detalhes e o que acompanha.”\n25–30 s · Encerrar com uma ação: “Abra a página para consultar o preço e a entrega.”',
      explanation: 'Cada trecho tem uma função. A demonstração ocupa a maior parte do vídeo e a chamada pede uma só ação. Mostre o produto real e revise as informações antes da gravação.',
      task: 'Adapte o roteiro para seu produto, leia com cronômetro e grave uma tomada de teste. O curso é em texto: este exemplo é um roteiro, não uma videoaula.'
    }]
  }
});

export const COURSE_LANDING_SLUGS = Object.freeze(Object.keys(COURSE_DEMONSTRATIONS));

// The same worked sample also appears in the matching private lesson.
export function demonstrationSections(courseSlug, lessonSlug) {
  const demo = COURSE_DEMONSTRATIONS[courseSlug];
  if (!demo || demo.lessonSlug !== lessonSlug) return [];
  return demo.scenarios.map(scenario => ({
    title: `Exemplo resolvido: ${scenario.title}`,
    paragraphs: [
      `Exemplo didático. ${scenario.context}`,
      ...(scenario.before ? [`Resposta a melhorar: ${scenario.before}`] : []),
      ...(scenario.messages || []).map(message => `${message.speaker}: ${message.text}`),
      ...(scenario.example ? [scenario.example] : []),
      ...(scenario.result ? [`Resultado ilustrativo: ${scenario.result}`] : []),
      `Entenda a escolha: ${scenario.explanation}`,
      `Sua vez: ${scenario.task}`
    ]
  }));
}
