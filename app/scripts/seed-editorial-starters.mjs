import Database from 'better-sqlite3';
import path from 'node:path';

const dataDir=process.env.DATA_DIR||'/data';
const db=new Database(path.join(dataDir,'vitrinecity.db'));
const articles=[
  {id:'starter-recipe-fricasse',slug:'fricasse-de-frango-cremoso-facil',portal:'receitas',title:'Fricassê de frango cremoso e fácil',summary:'Uma receita prática de fricassê com frango desfiado, creme de milho e cobertura dourada para o almoço em família.',image:'/assets/recipes/fricasse-frango.jpg',body:`Tempo aproximado: 50 minutos. Rendimento: 6 porções.

Ingredientes: 600 g de peito de frango cozido e desfiado; 1 lata de milho escorrido; 1 caixa de creme de leite; 200 g de requeijão; meia xícara do caldo do cozimento do frango; 1 cebola pequena picada; 2 dentes de alho; 1 colher de sopa de azeite; 150 g de muçarela; sal, pimenta-do-reino e cheiro-verde a gosto; batata-palha para finalizar.

Preparo: aqueça o azeite e refogue a cebola e o alho. Acrescente o frango, tempere com sal e pimenta e misture até ficar bem envolvido. Bata no liquidificador o milho, o creme de leite, o requeijão e o caldo até formar um creme liso. Junte esse creme ao frango, cozinhe por três a cinco minutos e finalize com cheiro-verde.

Transfira para uma travessa, cubra com a muçarela e leve ao forno preaquecido a 200 °C por cerca de 20 minutos, ou até borbulhar e dourar. Coloque a batata-palha somente na hora de servir para preservar a crocância.

Dicas: cozinhe o frango completamente antes de desfiar e não deixe ingredientes perecíveis fora da geladeira. A textura pode ser ajustada com pequenas quantidades do caldo. Sirva com arroz branco e salada. Para congelar, faça isso sem a batata-palha e aqueça completamente antes de consumir.`},
  {id:'starter-recipe-cake',slug:'bolo-de-cenoura-com-cobertura-de-chocolate',portal:'receitas',title:'Bolo de cenoura com cobertura de chocolate',summary:'Bolo caseiro de cenoura com massa macia e uma cobertura simples de chocolate para acompanhar o café da tarde.',image:'/assets/recipes/bolo-cenoura.jpg',body:`Tempo aproximado: 1 hora. Rendimento: 12 fatias.

Ingredientes da massa: 3 cenouras médias descascadas e cortadas; 3 ovos; 1 xícara de óleo; 2 xícaras de açúcar; 2 e meia xícaras de farinha de trigo; 1 colher de sopa de fermento químico. Para a cobertura: 4 colheres de sopa de chocolate em pó; 4 colheres de sopa de açúcar; 2 colheres de sopa de manteiga; meia xícara de leite.

Preparo: aqueça o forno a 180 °C e unte uma forma média. Bata no liquidificador as cenouras, os ovos e o óleo até obter uma mistura uniforme. Em uma tigela, misture o açúcar e a farinha. Adicione o líquido aos poucos e mexa somente até incorporar. Por último, acrescente o fermento delicadamente.

Asse por aproximadamente 35 a 45 minutos. O tempo varia conforme o forno; faça o teste do palito no centro e retire quando ele sair sem massa crua. Espere amornar antes de desenformar.

Para a cobertura, leve todos os ingredientes ao fogo baixo, mexendo até engrossar levemente. Espalhe sobre o bolo ainda morno. Use utensílios secos, conserve o bolo coberto e, em dias quentes, mantenha sob refrigeração se a cobertura levar leite. A farinha deve ser medida sem compactar para evitar uma massa pesada.`},
  {id:'starter-recipe-bowl',slug:'bowl-brasileiro-de-frango-arroz-feijao-e-legumes',portal:'receitas',title:'Bowl brasileiro de frango, arroz, feijão e legumes',summary:'Uma refeição colorida e prática que combina frango grelhado, arroz, feijão, verduras e legumes assados.',image:'/assets/recipes/bowl-frango.jpg',body:`Tempo aproximado: 45 minutos. Rendimento: 4 porções.

Ingredientes: 500 g de filé de frango; 2 xícaras de arroz cozido; 2 xícaras de feijão cozido e escorrido; 1 cenoura em cubos; 1 cabeça pequena de brócolis; 1 cebola roxa em pétalas; tomates-cereja; folhas verdes; azeite; limão; alho; páprica; sal e pimenta a gosto.

Preparo: tempere o frango com alho, limão, páprica, sal e pimenta. Deixe descansar sob refrigeração enquanto prepara os legumes. Distribua cenoura, brócolis e cebola em uma assadeira, tempere com um fio de azeite e asse a 200 °C até ficarem macios e levemente dourados.

Aqueça bem o arroz e o feijão. Grelhe o frango em frigideira quente, virando para dourar os dois lados, até que esteja completamente cozido no centro. Deixe repousar alguns minutos e corte em fatias.

Monte cada tigela com arroz, feijão, legumes assados, folhas higienizadas, tomate e frango. Finalize com limão e um pequeno fio de azeite. As quantidades podem ser adaptadas ao apetite e às necessidades individuais. Para transportar, mantenha folhas e molho separados e conserve os alimentos refrigerados até o consumo.`},
  {id:'starter-sports-calendar',slug:'como-acompanhar-campeonatos-e-organizar-o-calendario',portal:'esportes',title:'Como acompanhar campeonatos sem perder jogos importantes',summary:'Um método simples para organizar calendários, horários e fontes oficiais dos campeonatos que você acompanha.',image:'/assets/editorial/esportes-calendario.jpg',body:`Quem acompanha mais de um time ou modalidade sabe que horários podem mudar e partidas podem se sobrepor. A forma mais segura de organizar a rotina é começar pelas tabelas divulgadas pelas entidades responsáveis pela competição e pelos canais oficiais das equipes.

Escolha apenas as competições que realmente deseja acompanhar e registre cada uma em uma agenda digital. Crie um calendário separado para esportes, use uma cor por modalidade e ative lembretes com antecedência. Assim, alterações não se confundem com compromissos pessoais.

Antes de compartilhar horário, estádio ou transmissão, confirme a informação em fonte oficial. Sites de resultados são úteis para consulta rápida, mas podem demorar para refletir mudanças determinadas pela organização, pela televisão ou por questões de segurança.

Outra alternativa é acompanhar resumos e análises depois da partida. Isso reduz a pressão de assistir tudo ao vivo e permite selecionar conteúdos de melhor qualidade. Para crianças e adolescentes, responsáveis podem ajudar a equilibrar o tempo de tela com estudo, descanso e atividade física.

O objetivo é transformar o esporte em lazer organizado. Uma agenda simples, notificações moderadas e fontes confiáveis evitam desinformação e tornam a experiência mais agradável.`},
  {id:'starter-tech-phone',slug:'passos-praticos-para-proteger-seu-celular',portal:'tecnologia',title:'Passos práticos para proteger seu celular',summary:'Configurações simples ajudam a reduzir riscos de perda de conta, invasão e exposição de informações pessoais no smartphone.',image:'/assets/editorial/tecnologia-celular.jpg',body:`O celular reúne conversas, fotos, documentos, contas bancárias e acesso a redes sociais. Por isso, a proteção deve começar com bloqueio de tela forte, atualização do sistema e cuidado com os aplicativos instalados.

Use senha longa ou código difícil de adivinhar e mantenha biometria apenas como complemento. Ative a autenticação em duas etapas nas contas principais, dando preferência a aplicativos autenticadores ou chaves de acesso quando disponíveis. Guarde os códigos de recuperação em lugar seguro e separado do aparelho.

Revise permissões de câmera, microfone, localização, contatos e arquivos. Um aplicativo de lanterna ou edição simples não deve receber acesso desnecessário. Instale programas somente pelas lojas oficiais e desconfie de links recebidos por mensagem, mesmo quando parecem enviados por conhecidos.

Configure localização e apagamento remoto, faça cópias de segurança regulares e evite usar redes Wi-Fi abertas para operações sensíveis. Nunca informe códigos recebidos por SMS ou aplicativo a terceiros. Empresas legítimas não precisam desse código para cancelar uma compra ou proteger sua conta.

Em caso de perda ou roubo, bloqueie a linha, altere as senhas mais importantes e comunique rapidamente as instituições financeiras. Segurança digital não depende de uma única ferramenta: ela resulta de pequenas práticas repetidas.`},
  {id:'starter-ai-business',slug:'como-usar-inteligencia-artificial-com-revisao-humana',portal:'inteligencia-artificial',title:'Como usar inteligência artificial com revisão humana',summary:'Pequenos negócios podem usar IA para rascunhos e organização, mantendo pessoas responsáveis pela conferência e pela decisão final.',image:'/assets/editorial/ia-revisao-humana.jpg',body:`Ferramentas de inteligência artificial podem ajudar a organizar ideias, criar primeiros rascunhos e resumir informações, mas não substituem a responsabilidade de quem publica, vende ou atende o cliente. O melhor uso começa com uma tarefa pequena e critérios claros de revisão.

Uma loja pode pedir sugestões de legenda, perguntas frequentes ou estrutura de catálogo. Antes de usar o resultado, uma pessoa deve conferir preços, prazos, características do produto, linguagem da marca e regras aplicáveis. Informações inventadas ou desatualizadas precisam ser removidas.

Dados pessoais, documentos de clientes, senhas e informações comerciais sigilosas não devem ser enviados sem uma política adequada e sem entender como a ferramenta trata esses dados. Sempre prefira exemplos fictícios quando estiver apenas testando um processo.

Registre qual conteúdo foi produzido com apoio de IA e quem fez a revisão. Em temas jurídicos, médicos, financeiros ou técnicos de alto impacto, procure profissionais qualificados e fontes oficiais. A IA pode auxiliar a pesquisa, mas não deve tomar sozinha decisões que afetem direitos ou segurança.

O ganho real vem da combinação entre velocidade e responsabilidade: a ferramenta prepara, a equipe verifica, adapta e assume a decisão final. Esse fluxo reduz erros e preserva a confiança do público.`},
  {id:'starter-entertainment-movie',slug:'como-organizar-uma-noite-de-cinema-em-casa',portal:'entretenimento',title:'Como organizar uma noite de cinema em casa',summary:'Ideias simples para escolher o filme, preparar o ambiente e transformar uma sessão em casa em um momento especial.',image:'/assets/editorial/noite-cinema.jpg',body:`Uma boa noite de cinema em casa não depende de equipamentos caros. O ponto de partida é combinar o horário, o público e o tipo de filme. Se houver crianças, confira a classificação indicativa e escolha uma duração adequada à rotina da família.

Monte uma lista curta com três opções e faça uma votação rápida. Verifique previamente em quais serviços cada título está disponível e se o acesso está incluído na assinatura. Evite começar a procura somente na hora marcada, pois isso costuma consumir boa parte da sessão.

No ambiente, reduza luzes que refletem na tela, organize assentos confortáveis e mantenha o volume em nível que preserve a audição e respeite os vizinhos. Legendas podem ajudar na compreensão sem exigir som alto. Faça um teste de internet antes e deixe o filme carregado.

Pipoca, frutas cortadas, sanduíches pequenos e água são opções práticas. Considere alergias e restrições alimentares dos convidados e mantenha alimentos perecíveis refrigerados até servir. Um intervalo planejado é útil em filmes longos.

Depois, cada pessoa pode comentar sua cena favorita ou dar uma nota. O mais importante não é reproduzir uma sala comercial, mas criar um momento confortável, acessível e compartilhado.`}
];
const insert=db.prepare(`INSERT INTO editorial_articles(id,trend_id,slug,portal,title,summary,body,image_url,sources_json,status,published_at,updated_at) VALUES(@id,NULL,@slug,@portal,@title,@summary,@body,@image,'[]','published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,portal=excluded.portal,title=excluded.title,summary=excluded.summary,body=excluded.body,image_url=excluded.image_url,status='published',published_at=COALESCE(editorial_articles.published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP`);
const run=db.transaction(()=>articles.forEach(article=>insert.run(article)));
run();
console.log(`Conteúdos iniciais publicados: ${articles.length}`);
