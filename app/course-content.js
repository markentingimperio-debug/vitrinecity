export const ORIGINAL_COURSES = Object.freeze({
  'ia-para-pequenos-negocios': Object.freeze({
    description: 'Use inteligência artificial para planejar ofertas, criar conteúdo e atender clientes com mais agilidade.',
    audience: 'Lojistas, prestadores de serviço e pequenos empreendedores',
    lessons: Object.freeze([
      {
        slug: '1-objetivo-e-processo', title: '1. IA com objetivo de negócio', duration: '18 min',
        objective: 'Escolher uma tarefa repetitiva e definir um resultado mensurável para a IA.',
        sections: [
          { title: 'Comece pelo problema', paragraphs: [
            'Inteligência artificial não substitui a decisão do empreendedor. Ela funciona melhor como assistente para organizar informações, gerar primeiras versões e acelerar tarefas que já possuem um objetivo claro.',
            'Escolha uma atividade simples: responder dúvidas frequentes, criar uma oferta semanal, preparar descrições ou montar um calendário de publicações. Registre quanto tempo você gasta hoje e qual resultado deseja melhorar.'
          ]},
          { title: 'Regra de segurança', paragraphs: [
            'Não envie senhas, documentos, dados bancários, informações médicas ou listas de clientes para ferramentas públicas. Revise preços, promessas, medidas e orientações técnicas antes de publicar qualquer resposta.'
          ]}
        ],
        checklist: ['Escolher uma tarefa repetitiva', 'Definir uma meta de tempo ou vendas', 'Separar dados que podem ser usados com segurança'],
        activity: 'Escreva: “Quero usar IA para reduzir de ___ para ___ minutos a tarefa de ___”.'
      },
      {
        slug: '2-prompt-pratico', title: '2. O prompt que gera resultado', duration: '22 min',
        objective: 'Montar instruções claras usando contexto, tarefa, restrições e formato.',
        sections: [
          { title: 'A estrutura C-T-R-F', paragraphs: [
            'Contexto explica quem é a empresa e para quem ela vende. Tarefa diz exatamente o que deve ser produzido. Restrições definem limites, como não inventar benefícios. Formato informa se a resposta deve ser roteiro, tabela, anúncio ou mensagem.',
            'Exemplo: “Somos uma loja de jardinagem para clientes iniciantes. Crie cinco mensagens de WhatsApp para divulgar terra vegetal. Não faça promessa de cura ou resultado garantido. Use até 50 palavras e finalize com uma pergunta.”'
          ]},
          { title: 'Melhoria em rodadas', paragraphs: [
            'Não tente resolver tudo em uma única mensagem. Peça uma primeira versão, informe o que ficou genérico e solicite ajustes específicos. Salve os prompts que funcionarem como modelos da empresa.'
          ]}
        ],
        checklist: ['Informar público e produto', 'Definir uma tarefa por vez', 'Proibir informações inventadas', 'Escolher o formato final'],
        activity: 'Crie um prompt C-T-R-F para o produto ou serviço que você mais vende.'
      },
      {
        slug: '3-conteudo-e-ofertas', title: '3. Conteúdo e ofertas em minutos', duration: '24 min',
        objective: 'Transformar uma oferta em conteúdo para diferentes canais.',
        sections: [
          { title: 'Uma ideia, cinco peças', paragraphs: [
            'Comece por uma oferta central: produto, benefício principal, prova disponível, preço e chamada para ação. A partir dela, gere um roteiro de vídeo, uma legenda, uma mensagem de WhatsApp, três títulos e uma lista de dúvidas frequentes.',
            'Evite publicar todas as versões sem revisão. Ajuste linguagem, condições da oferta, prazo, estoque e regras da plataforma em que o conteúdo será usado.'
          ]},
          { title: 'Calendário simples', paragraphs: [
            'Alterne educação, demonstração, prova, bastidores e oferta. Essa sequência evita transformar o perfil em um catálogo repetitivo e ajuda o cliente a entender por que o produto é útil.'
          ]}
        ],
        checklist: ['Confirmar preço e prazo', 'Usar somente provas verdadeiras', 'Adaptar para cada canal', 'Adicionar uma chamada para ação'],
        activity: 'Transforme uma oferta real em cinco conteúdos usando a sequência apresentada.'
      },
      {
        slug: '4-atendimento-assistido', title: '4. Atendimento assistido por IA', duration: '20 min',
        objective: 'Criar respostas rápidas sem perder o atendimento humano.',
        sections: [
          { title: 'Biblioteca de respostas', paragraphs: [
            'Liste as vinte perguntas mais frequentes sobre entrega, pagamento, tamanho, modo de usar e troca. Escreva respostas aprovadas e use a IA apenas para adaptar tom e tamanho.',
            'Quando houver reclamação, risco, dúvida técnica ou solicitação de dados pessoais, interrompa a automação e encaminhe para uma pessoa responsável.'
          ]},
          { title: 'Resposta em três partes', paragraphs: [
            'Uma boa resposta reconhece a dúvida, fornece uma orientação objetiva e termina com o próximo passo. Exemplo: “Entendi sua dúvida sobre o prazo. Para sua cidade, a estimativa aparece no checkout. Quer que eu envie o link do produto?”'
          ]}
        ],
        checklist: ['Mapear vinte perguntas', 'Aprovar respostas oficiais', 'Definir quando chamar uma pessoa', 'Nunca solicitar senha ou código'],
        activity: 'Prepare cinco respostas oficiais e teste variações curta, cordial e comercial.'
      },
      {
        slug: '5-plano-de-sete-dias', title: '5. Plano prático de sete dias', duration: '16 min',
        objective: 'Implantar uma rotina de IA e medir o ganho real.',
        sections: [
          { title: 'Execução', paragraphs: [
            'Dia 1: escolha a tarefa. Dia 2: crie o prompt. Dia 3: produza os materiais. Dia 4: revise. Dia 5: publique um teste. Dia 6: responda clientes. Dia 7: compare tempo, alcance, contatos e vendas.',
            'Mantenha somente aquilo que melhorou um indicador. A ferramenta deve simplificar o processo; se aumentou retrabalho, ajuste o prompt ou reduza o escopo.'
          ]},
          { title: 'Indicadores', paragraphs: [
            'Acompanhe tempo economizado, conteúdos aprovados sem retrabalho, conversas iniciadas, pedidos gerados e erros encontrados na revisão.'
          ]}
        ],
        checklist: ['Executar um teste pequeno', 'Registrar antes e depois', 'Revisar todo conteúdo', 'Guardar o prompt aprovado'],
        activity: 'Monte agora seu calendário de sete dias e escolha um indicador principal.'
      }
    ])
  }),
  'canva-para-lojas': Object.freeze({
    description: 'Crie uma identidade visual consistente e peças comerciais claras para redes sociais e WhatsApp.',
    audience: 'Lojas físicas, negócios locais e vendedores online',
    lessons: Object.freeze([
      {
        slug: '1-identidade-visual', title: '1. Identidade visual sem complicação', duration: '20 min',
        objective: 'Definir cores, fontes e estilo visual que facilitem o reconhecimento da loja.',
        sections: [{ title: 'O kit mínimo', paragraphs: [
          'Uma identidade funcional precisa de uma versão principal do nome, duas cores principais, uma cor de destaque e no máximo duas famílias de fontes. Consistência vale mais do que excesso de efeitos.',
          'Escolha cores com contraste suficiente e teste a leitura em uma tela pequena. O cliente deve reconhecer o nome, o produto e a oferta em poucos segundos.'
        ]}, { title: 'Organização no Canva', paragraphs: [
          'Crie uma pasta para a marca e subpastas para ofertas, educação, depoimentos e capas. Guarde uma página-modelo com as cores, fontes, logotipo e margens.'
        ]}],
        checklist: ['Definir duas cores principais', 'Escolher até duas fontes', 'Testar leitura no celular', 'Criar pasta da marca'],
        activity: 'Monte uma página de referência com o nome da loja, cores e fontes.'
      },
      {
        slug: '2-modelo-de-post', title: '2. Modelo de post que vende', duration: '24 min',
        objective: 'Criar um modelo reutilizável para produto e promoção.',
        sections: [{ title: 'Hierarquia da informação', paragraphs: [
          'Organize a peça nesta ordem: imagem do produto, benefício ou oferta, preço ou condição e chamada para ação. Informações secundárias devem ter menos destaque.',
          'Use espaço vazio para separar elementos. Bordas, sombras e adesivos devem apoiar a leitura, não competir com o produto.'
        ]}, { title: 'Fotografia', paragraphs: [
          'Prefira foto própria, iluminada e com fundo limpo. Não use imagens que prometam resultados irreais. Quando remover o fundo, revise as bordas antes de publicar.'
        ]}],
        checklist: ['Produto em destaque', 'Título curto', 'Preço conferido', 'Chamada para ação visível'],
        activity: 'Crie um modelo quadrado e duplique-o para três produtos diferentes.'
      },
      {
        slug: '3-stories-e-status', title: '3. Stories e Status do WhatsApp', duration: '18 min',
        objective: 'Adaptar a comunicação para o formato vertical.',
        sections: [{ title: 'Sequência de três telas', paragraphs: [
          'Tela 1 chama atenção com uma pergunta ou problema. Tela 2 apresenta produto e benefício. Tela 3 mostra condição e orienta o cliente a responder, clicar ou pedir o link.',
          'Mantenha textos afastados das bordas e dos botões da interface. Exporte em 1080 por 1920 pixels e teste em um celular antes de publicar.'
        ]}, { title: 'Movimento com propósito', paragraphs: [
          'Animações curtas podem destacar preço ou chamada, mas devem ser discretas. Evite transições rápidas, excesso de brilho e elementos que dificultem a leitura.'
        ]}],
        checklist: ['Formato 9:16', 'Uma mensagem por tela', 'Texto dentro da área segura', 'CTA na última tela'],
        activity: 'Crie uma sequência de três telas para uma oferta válida nesta semana.'
      },
      {
        slug: '4-catalogo-e-promocao', title: '4. Catálogo e promoção', duration: '22 min',
        objective: 'Montar páginas comerciais claras e confiáveis.',
        sections: [{ title: 'Página de produto', paragraphs: [
          'Inclua nome, foto, três benefícios objetivos, conteúdo ou quantidade, preço, condições e canal de compra. Não esconda restrições importantes em letras pequenas.',
          'Para promoções, registre data de início e fim, estoque ou condição aplicável. Revise ortografia e valores antes de exportar.'
        ]}, { title: 'Prova e confiança', paragraphs: [
          'Use avaliações verdadeiras com autorização e retire dados pessoais. Informações técnicas precisam corresponder ao rótulo, manual ou orientação profissional responsável.'
        ]}],
        checklist: ['Informações completas', 'Promoção com prazo', 'Provas autorizadas', 'Canal de compra correto'],
        activity: 'Crie uma página de catálogo com um produto, seus dados e um botão visual de contato.'
      },
      {
        slug: '5-exportacao-e-rotina', title: '5. Exportação e rotina semanal', duration: '16 min',
        objective: 'Publicar arquivos leves, legíveis e padronizados.',
        sections: [{ title: 'Formato correto', paragraphs: [
          'Use PNG quando precisar de melhor definição em peças com texto e JPG para fotografias leves. PDF é indicado para catálogo e impressão. MP4 é o formato mais compatível para animações.',
          'Nomeie arquivos com data, campanha e versão. Preserve um modelo editável e exporte cópias finais para publicação.'
        ]}, { title: 'Rotina', paragraphs: [
          'Separe um momento por semana para atualizar preços, duplicar modelos e agendar peças. Uma biblioteca de modelos reduz erros e acelera campanhas futuras.'
        ]}],
        checklist: ['Escolher formato adequado', 'Conferir tamanho do arquivo', 'Nomear a versão', 'Guardar modelo editável'],
        activity: 'Organize uma semana com três posts, três Stories e uma oferta para WhatsApp.'
      }
    ])
  }),
  'vendas-pelo-whatsapp': Object.freeze({
    description: 'Organize o WhatsApp comercial, conduza conversas e faça acompanhamento sem mensagens invasivas.',
    audience: 'Empreendedores, equipes de atendimento e vendedores',
    lessons: Object.freeze([
      {
        slug: '1-estrutura-profissional', title: '1. Estrutura profissional', duration: '19 min',
        objective: 'Preparar perfil, horários, catálogo e regras de atendimento.',
        sections: [{ title: 'Base de confiança', paragraphs: [
          'Use nome comercial reconhecível, foto nítida, descrição objetiva, horário e endereço ou site corretos. Configure mensagem de ausência sem prometer resposta imediata fora do expediente.',
          'Organize etiquetas como novo contato, orçamento enviado, aguardando cliente, pedido confirmado e pós-venda. Isso evita conversas esquecidas.'
        ]}, { title: 'Permissão e privacidade', paragraphs: [
          'Envie campanhas somente para pessoas que autorizaram o contato. Identifique a empresa, explique o motivo da mensagem e ofereça uma forma simples de parar de receber comunicações.'
        ]}],
        checklist: ['Perfil completo', 'Horário configurado', 'Etiquetas criadas', 'Consentimento registrado'],
        activity: 'Revise o perfil e crie as cinco etiquetas recomendadas.'
      },
      {
        slug: '2-oferta-clara', title: '2. Oferta clara em poucas linhas', duration: '21 min',
        objective: 'Apresentar valor sem enviar textos longos ou confusos.',
        sections: [{ title: 'Mensagem em quatro blocos', paragraphs: [
          'Use saudação, motivo do contato, benefício com condição verdadeira e pergunta de avanço. Exemplo: “Olá, Ana! Aqui é da Loja X. O produto que você consultou está disponível por R$__. Quer que eu confira o prazo para seu CEP?”',
          'Evite iniciar com vários links, imagens e áudios. Primeiro confirme a necessidade; depois envie apenas o material relevante.'
        ]}, { title: 'Perguntas de diagnóstico', paragraphs: [
          'Pergunte para quem é, qual necessidade, quantidade, prazo e local de entrega. Duas perguntas boas costumam ser mais úteis que uma apresentação extensa.'
        ]}],
        checklist: ['Identificar a empresa', 'Explicar o motivo', 'Informar condição verdadeira', 'Terminar com uma pergunta'],
        activity: 'Escreva uma oferta em até 60 palavras para seu produto principal.'
      },
      {
        slug: '3-roteiros-de-atendimento', title: '3. Roteiros de atendimento', duration: '25 min',
        objective: 'Conduzir interesse, objeção e fechamento com naturalidade.',
        sections: [{ title: 'Do interesse ao pedido', paragraphs: [
          'Depois de entender a necessidade, indique a opção adequada e explique o próximo passo. Confirme produto, quantidade, valor, entrega e forma de pagamento antes de concluir.',
          'Para objeção de preço, retome composição, conveniência ou diferença relevante sem atacar concorrentes. Se não houver encaixe, encerre com respeito.'
        ]}, { title: 'Áudio e tempo de resposta', paragraphs: [
          'Use áudio somente quando o cliente demonstrar preferência. Avise se precisar de tempo para consultar uma informação. Nunca invente uma resposta para parecer rápido.'
        ]}],
        checklist: ['Entender a necessidade', 'Indicar uma opção', 'Confirmar todos os dados', 'Registrar o estágio da conversa'],
        activity: 'Simule uma conversa com interesse, dúvida de preço e fechamento.'
      },
      {
        slug: '4-follow-up-e-pos-venda', title: '4. Follow-up e pós-venda', duration: '20 min',
        objective: 'Retomar conversas com respeito e aumentar recompra.',
        sections: [{ title: 'Acompanhamento útil', paragraphs: [
          'Faça a primeira retomada com contexto: “Você pediu informações sobre ___. Ainda posso ajudar?” Se não houver resposta, não transforme o acompanhamento em pressão diária.',
          'No pós-venda, confirme recebimento, envie orientação de uso e pergunte se ficou alguma dúvida. Solicite avaliação somente depois de entregar valor.'
        ]}, { title: 'Cupom e recompra', paragraphs: [
          'Segmente campanhas conforme interesse e histórico. Não ofereça o mesmo produto indiscriminadamente. Informe validade e condições do cupom com clareza.'
        ]}],
        checklist: ['Retomar com contexto', 'Limitar insistência', 'Orientar após a compra', 'Segmentar campanha'],
        activity: 'Crie mensagens para orçamento parado, pós-venda e recompra.'
      },
      {
        slug: '5-metricas-e-plano', title: '5. Métricas e plano de sete dias', duration: '17 min',
        objective: 'Acompanhar atendimento e melhorar conversão.',
        sections: [{ title: 'Números essenciais', paragraphs: [
          'Registre novos contatos, respostas, orçamentos, pedidos, valor vendido e tempo médio de primeira resposta. Compare por origem para descobrir quais campanhas geram clientes reais.',
          'A taxa de conversão pode ser calculada dividindo pedidos por conversas qualificadas. Analise também cancelamentos e motivos de perda.'
        ]}, { title: 'Plano', paragraphs: [
          'Dia 1: arrume o perfil. Dia 2: organize etiquetas. Dia 3: crie roteiros. Dia 4: atualize catálogo. Dia 5: faça acompanhamentos. Dia 6: execute pós-venda. Dia 7: revise métricas.'
        ]}],
        checklist: ['Registrar origem', 'Contar conversas qualificadas', 'Medir pedidos', 'Anotar motivos de perda'],
        activity: 'Crie uma tabela simples e acompanhe os indicadores por sete dias.'
      }
    ])
  })
});

export function originalCourse(slug) {
  return ORIGINAL_COURSES[slug] || null;
}
