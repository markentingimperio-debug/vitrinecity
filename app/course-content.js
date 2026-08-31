import { GROWTH_COURSES } from './course-content-growth.js';

export const ORIGINAL_COURSES = Object.freeze({
  'geladinhos-gourmet': Object.freeze({
    description: 'Aprenda a planejar sabores, calcular custos, produzir com higiene e vender geladinhos gourmet com lucro.',
    audience: 'Quem deseja começar uma renda extra com alimentos congelados',
    lessons: Object.freeze([
      {
        slug: '1-negocio-e-seguranca', title: '1. Planejamento e segurança dos alimentos', duration: '22 min',
        objective: 'Organizar a produção e aplicar cuidados básicos de higiene e conservação.',
        sections: [{ title: 'Comece de forma profissional', paragraphs: [
          'Defina público, capacidade diária, local de produção e canais de venda antes de comprar muitos ingredientes. Começar com três sabores facilita o controle de qualidade, estoque e aceitação.',
          'Use água potável, utensílios higienizados, cabelo protegido e mãos lavadas. Separe ingredientes crus, embalagens e produtos prontos. Consulte as exigências da vigilância sanitária e da prefeitura do seu município antes de comercializar.'
        ]}, { title: 'Frio e identificação', paragraphs: [
          'Mantenha os produtos congelados, evite descongelar e congelar novamente e identifique cada lote com sabor, data de produção e validade definida por responsável capacitado. Ingredientes alergênicos devem ser informados claramente.'
        ]}],
        checklist: ['Escolher três sabores iniciais', 'Higienizar área e utensílios', 'Criar etiqueta de lote', 'Verificar regras sanitárias locais'],
        activity: 'Desenhe o fluxo da sua produção, do recebimento dos ingredientes ao congelamento.'
      },
      {
        slug: '2-base-e-sabores', title: '2. Base, textura e criação de sabores', duration: '25 min',
        objective: 'Padronizar uma base e testar sabores sem desperdício.',
        sections: [{ title: 'Ficha de teste', paragraphs: [
          'Registre para cada teste as quantidades, rendimento, tamanho da embalagem, tempo de congelamento e avaliação de sabor e textura. Use balança e medidores; receitas apenas “no olho” dificultam repetir o resultado.',
          'Faça pequenos lotes e altere somente uma variável por vez. Ingredientes diferentes mudam doçura, consistência e custo, por isso toda substituição precisa de um novo teste.'
        ]}, { title: 'Linha inicial', paragraphs: [
          'Monte uma linha equilibrada: um sabor clássico, um sabor com fruta e um sabor especial. Só anuncie ingredientes realmente usados e não faça alegações de saúde sem respaldo técnico.'
        ]}],
        checklist: ['Pesar ingredientes', 'Registrar rendimento', 'Testar uma variável por vez', 'Selecionar três sabores'],
        activity: 'Crie uma ficha de teste e compare duas versões do mesmo sabor com cinco avaliadores.'
      },
      {
        slug: '3-custo-e-preco', title: '3. Custo, preço e margem', duration: '24 min',
        objective: 'Calcular o custo unitário e formar um preço sustentável.',
        sections: [{ title: 'Custo completo', paragraphs: [
          'Some ingredientes, embalagem, etiqueta, energia estimada, perdas, entrega, taxas de pagamento e mão de obra. Divida o total apenas pela quantidade de unidades aprovadas para venda.',
          'O preço deve cobrir o custo, despesas do negócio e margem. Compare com o mercado, mas não copie preços sem conhecer a estrutura do concorrente.'
        ]}, { title: 'Exemplo de cálculo', paragraphs: [
          'Se um lote custa R$ 48 e rende 40 unidades vendáveis, o custo direto é R$ 1,20 por unidade. Acrescente despesas, perdas e margem antes de definir o preço final. Recalcule sempre que um insumo mudar.'
        ]}],
        checklist: ['Listar todos os custos', 'Medir perdas', 'Calcular custo unitário', 'Definir margem e preço'],
        activity: 'Calcule o custo de um lote real e simule preços para venda unitária e kits.'
      },
      {
        slug: '4-embalagem-e-venda', title: '4. Embalagem, cardápio e vendas', duration: '21 min',
        objective: 'Apresentar o produto com clareza e criar ofertas simples.',
        sections: [{ title: 'Embalagem que informa', paragraphs: [
          'Use embalagem apropriada para alimentos e congelamento. Informe nome do produto, ingredientes, alergênicos, conteúdo, conservação, identificação do produtor e demais dados exigidos pela legislação aplicável.',
          'Fotografe o produto em boa luz e monte um cardápio com sabores, preços, formas de pagamento, região de entrega e prazo para encomenda.'
        ]}, { title: 'Ofertas', paragraphs: [
          'Crie kits com quantidade e preço transparentes. Use encomendas para festas, pontos parceiros e entrega em rota. Evite produzir grandes estoques antes de validar a demanda.'
        ]}],
        checklist: ['Escolher embalagem adequada', 'Preparar identificação', 'Fotografar sabores', 'Criar cardápio e kits'],
        activity: 'Monte um cardápio de uma página com três sabores e duas opções de kit.'
      },
      {
        slug: '5-plano-de-lancamento', title: '5. Plano de lançamento em sete dias', duration: '18 min',
        objective: 'Realizar um lançamento pequeno, medir resultados e melhorar.',
        sections: [{ title: 'Sete dias de execução', paragraphs: [
          'Dia 1: escolha sabores. Dia 2: faça testes. Dia 3: calcule custos. Dia 4: prepare embalagem e fotos. Dia 5: divulgue a pré-venda. Dia 6: produza os pedidos. Dia 7: entregue e colete avaliações.',
          'Registre unidades produzidas, vendidas, perdidas, ticket médio, lucro estimado e sabores mais pedidos. Use os dados para decidir o próximo lote.'
        ]}, { title: 'Crescimento seguro', paragraphs: [
          'Aumente variedade e volume apenas depois de dominar padronização, conservação e margem. Crescer com controle protege o cliente e o caixa.'
        ]}],
        checklist: ['Abrir pré-venda', 'Produzir conforme pedidos', 'Registrar vendas e perdas', 'Coletar avaliações'],
        activity: 'Monte seu calendário de lançamento e uma meta realista para o primeiro lote.'
      }
    ])
  }),
  'logo-no-canva': Object.freeze({
    description: 'Crie uma marca clara e um logotipo funcional no Canva, com versões prontas para redes sociais e impressão.',
    audience: 'Empreendedores que precisam criar ou organizar a identidade visual do negócio',
    lessons: Object.freeze([
      {
        slug: '1-estrategia-da-marca', title: '1. Estratégia antes do desenho', duration: '18 min',
        objective: 'Definir posicionamento, público e personalidade da marca.',
        sections: [{ title: 'Briefing essencial', paragraphs: [
          'Antes de abrir o Canva, responda: o que a empresa vende, para quem, qual diferença deseja comunicar e quais três palavras devem descrever a marca. Um logotipo não resolve um posicionamento confuso.',
          'Pesquise referências do segmento para entender padrões, mas não copie símbolos, nomes ou composições. Verifique a disponibilidade do nome e considere uma busca de marca no INPI antes de investir na divulgação.'
        ]}],
        checklist: ['Definir público', 'Escolher três atributos', 'Reunir referências', 'Verificar o nome'],
        activity: 'Escreva um briefing de cinco linhas para sua marca.'
      },
      {
        slug: '2-cores-e-fontes', title: '2. Cores e fontes que combinam', duration: '20 min',
        objective: 'Escolher uma paleta legível e uma combinação tipográfica consistente.',
        sections: [{ title: 'Menos é mais', paragraphs: [
          'Escolha duas cores principais e uma de apoio. Teste contraste em fundo claro e escuro e não dependa apenas da cor para transmitir informação.',
          'Use uma fonte de destaque e outra de leitura, ou apenas uma família com variações de peso. Evite fontes decorativas em textos pequenos.'
        ]}],
        checklist: ['Selecionar três cores', 'Anotar códigos das cores', 'Escolher até duas fontes', 'Testar no celular'],
        activity: 'Monte uma página com paleta, fontes e exemplos de contraste.'
      },
      {
        slug: '3-construcao-no-canva', title: '3. Construção do logotipo no Canva', duration: '27 min',
        objective: 'Criar uma composição simples, alinhada e reconhecível.',
        sections: [{ title: 'Nome e símbolo', paragraphs: [
          'Comece pelo nome em texto, ajuste espaçamento e alinhamento e só então avalie um símbolo. O símbolo deve apoiar a identificação, não competir com o nome.',
          'Use grades e guias para manter proporção. Elementos do Canva podem ter regras de licenciamento; confira os termos aplicáveis e evite usar um elemento comum como marca exclusiva sem adaptação e verificação.'
        ]}],
        checklist: ['Criar versão somente com nome', 'Testar símbolo opcional', 'Alinhar elementos', 'Conferir licenças'],
        activity: 'Crie três rascunhos e escolha um usando legibilidade, simplicidade e adequação como critérios.'
      },
      {
        slug: '4-versoes-do-logo', title: '4. Versões para cada situação', duration: '19 min',
        objective: 'Preparar versões principal, horizontal, reduzida e monocromática.',
        sections: [{ title: 'Sistema de marca', paragraphs: [
          'Uma marca precisa funcionar em perfil de rede social, fachada, etiqueta e documento. Prepare versão principal, versão horizontal, símbolo ou iniciais e opções em uma cor.',
          'Reduza o arquivo até o tamanho de um ícone. Se o nome desaparecer ou os detalhes virarem manchas, simplifique a composição.'
        ]}],
        checklist: ['Versão principal', 'Versão horizontal', 'Versão reduzida', 'Versão em uma cor'],
        activity: 'Aplique cada versão em um avatar, uma etiqueta e um cabeçalho.'
      },
      {
        slug: '5-exportacao', title: '5. Exportação correta', duration: '17 min',
        objective: 'Exportar arquivos adequados para tela, transparência e impressão.',
        sections: [{ title: 'Arquivos finais', paragraphs: [
          'Use PNG para imagem com boa definição e, quando o plano permitir, fundo transparente. PDF para impressão preserva melhor textos e formas. Guarde o arquivo editável e uma cópia de cada versão.',
          'Não aumente um arquivo pequeno esperando recuperar qualidade. Para produção gráfica, confirme formato, cores e sangria com a empresa responsável.'
        ]}],
        checklist: ['Exportar PNG', 'Exportar PDF', 'Guardar editável', 'Nomear arquivos claramente'],
        activity: 'Crie uma pasta final com todas as versões e formatos.'
      },
      {
        slug: '6-manual-rapido', title: '6. Manual rápido da marca', duration: '20 min',
        objective: 'Documentar regras para manter a identidade consistente.',
        sections: [{ title: 'Uma página de regras', paragraphs: [
          'Registre versões permitidas, cores, fontes, área de proteção e exemplos do que não fazer. Inclua fundos autorizados e tamanho mínimo.',
          'Esse guia ajuda funcionários, parceiros e fornecedores a produzir materiais sem deformar, recolorir ou esconder a marca.'
        ]}],
        checklist: ['Listar cores e fontes', 'Definir área de proteção', 'Mostrar usos incorretos', 'Salvar guia em PDF'],
        activity: 'Monte um manual de uma página no Canva.'
      },
      {
        slug: '7-aplicacao-pratica', title: '7. Aplicação e revisão final', duration: '21 min',
        objective: 'Testar a marca em materiais reais antes de publicar.',
        sections: [{ title: 'Teste de realidade', paragraphs: [
          'Aplique o logotipo em foto de perfil, post, cartão, embalagem e fachada simulada. Peça para pessoas do público dizerem o nome que leram e o tipo de negócio que imaginaram.',
          'Revise ortografia, proporções, contraste e direitos de uso. Faça ajustes antes de atualizar todos os canais da empresa.'
        ]}],
        checklist: ['Testar cinco aplicações', 'Ouvir o público', 'Revisar ortografia', 'Publicar versões finais'],
        activity: 'Crie um painel com cinco aplicações e registre os ajustes necessários.'
      }
    ])
  }),
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

const COURSE_COVERS = Object.freeze({
  'geladinhos-gourmet': '/assets/courses/geladinhos-gourmet.png',
  'logo-no-canva': '/assets/courses/logo-no-canva.png',
  'ia-para-pequenos-negocios': '/assets/courses/ia-para-pequenos-negocios.png',
  'canva-para-lojas': '/assets/courses/canva-para-lojas.png',
  'vendas-pelo-whatsapp': '/assets/courses/vendas-pelo-whatsapp.png',
  'precificacao-e-lucro': '/assets/courses/precificacao-e-lucro.png',
  'shopee-do-zero': '/assets/courses/shopee-do-zero.png',
  'videos-curtos-que-vendem': '/assets/courses/videos-curtos-que-vendem.png'
});

function enrichLesson(lesson) {
  const steps = (lesson.checklist || []).map((item, index) => ({
    title: `Passo ${index + 1}`,
    instruction: item,
    evidence: index === (lesson.checklist?.length || 0) - 1
      ? 'Revise o resultado e guarde uma cópia para comparar sua evolução.'
      : 'Execute este passo antes de avançar e anote qualquer dúvida.'
  }));
  return {
    ...lesson,
    steps,
    practicalExample: `Aplicação guiada: ${lesson.activity}`,
    completionCriteria: `A aula está concluída quando você executar os ${steps.length} passos e entregar a atividade prática.`,
    videoGuide: { needed: false, reason: 'A leitura prática, os passos e o exercício formam uma aula completa. Vídeo complementar pode ser adicionado sem bloquear o aprendizado.' }
  };
}

export function originalCourse(slug) {
  const course = ORIGINAL_COURSES[slug] || GROWTH_COURSES[slug] || null;
  if (!course) return null;
  return {
    ...course,
    coverUrl: COURSE_COVERS[slug] || '',
    methodology: 'Aprenda, execute o passo a passo, produza a atividade e marque a aula como concluída.',
    lessons: course.lessons.map(enrichLesson)
  };
}
