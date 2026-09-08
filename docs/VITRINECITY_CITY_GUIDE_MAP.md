# Guia da cidade: funções da página inicial

Auditoria em 8 de setembro de 2026 de `app/public/index.html`, rotas de `app/server.js`, páginas públicas, diretórios da cidade e catálogos de afiliados. O catálogo reutilizável está em `app/public/vitriny-city-guide-core.js`. A organização apresenta os serviços de toda a VitrineCity; a presença de um atalho não declara que esse serviço esteja operacional em uma cidade de prévia.

## Organização

| Grupo | ID | Função |
| --- | --- | --- |
| Comprar | `comprar` | Pesquisa, catálogo, lojas, centros de compras e entrega local |
| Aprender | `aprender` | Cursos, aulas adquiridas e guia de jardinagem |
| Diversão e comunidade | `diversao` | Jogos, mini fazenda, música, cinema, social e conversas |
| Meu espaço | `meu-espaco` | Conta, pedidos, avatar, recompensas e preferências |
| Negócios e divulgação | `negocios` | Prédio digital, planos, Ads, afiliados, serviços e entregadores |
| Ajuda | `ajuda` | Orientação, Jarvis, contato, informações e consentimentos |

## Mapeamento da página inicial anterior

As URLs abaixo são os destinos verificados antes da adoção de apelidos sem `.html`. Os aliases podem preservar esses destinos sem alterar permissões, parâmetros ou âncoras.

| Função/destino anterior | Organização na cidade | Local de referência | Regra de acesso preservada |
| --- | --- | --- | --- |
| Pesquisa `/pesquisar.html?q=…` e sugestões | Comprar → Buscar na VitrineCity | Avenida de Compras | Consulta pública; pesquisa mantém seus próprios avisos sobre fontes externas |
| `/descobrir` | Comprar → Descobrir novidades | Avenida de Compras | Público |
| `/loja` e destaques dinâmicos `/produto/:id/:slug` | Comprar → Loja Oficial; Lojas e vitrines | Avenida de Compras | Lojas/produtos públicos; pedido/pagamento seguem autenticação existente |
| Produtos no letreiro alimentado por `/api/marketplace/products` | Busca e lojas, com destino original do produto | Prédio da respectiva loja | Público; nenhum preço, estoque ou promoção fictício é criado pelo guia |
| `/centro-educacional.html` e destaques `#slug` | Aprender → Centro Educacional | Centro Educacional | Catálogo público; aulas/materiais dependem da conta e matrícula |
| `/entregas` | Comprar → VC Entregas | VC Entregas | Catálogo público; disponibilidade depende dos dados reais da operação |
| `/guias/plantas-em-vasos.html` | Aprender → Comece seu jardim | Agrotécnica | Público e gratuito |
| `/jarvis-public.html` | Ajuda → Perguntar ao Jarvis | Torre VitrineCity | Interface pública, com limites próprios da pesquisa |
| `/vitriny-multiverse-explore.html?city=vitrine-city` | Entrada principal → Explorar a cidade | Entrada da cidade | Visita e navegação públicas; login reservado aos recursos pessoais como jogos, chat, pedidos e benefícios |
| `/cidade/avenida-premium` e destaque Sertaneja | Lojas e vitrines → registro real da Sertaneja | Prédio Sertaneja Moda Country | A avenida anterior continua uma rota pública; o novo guia usa o cadastro da loja para abrir o prédio/página atual |
| Instagram e mapa externos da Sertaneja | Página pública da loja e seus canais reais | Prédio Sertaneja Moda Country | Os links externos não entram no catálogo estático de destinos internos; preservar os canais cadastrados na loja |
| `/comprar-lote.html` | Negócios e divulgação → Quero meu prédio | Prédios disponíveis | Apresentação pública; cadastro, assinatura e envio de materiais mantêm o fluxo existente |
| `/para-empresas.html` | Negócios e divulgação → Planos para empresas | Torre VitrineCity | Público |
| `/solucoes.html` | Negócios e divulgação → Soluções para meu negócio | Torre VitrineCity | Público; contratação mantém seu fluxo existente |
| `/afiliados.html` | Negócios e divulgação → Programa de afiliados | Torre VitrineCity | Apresentação pública; cadastro/painel exigem conta e aceite dos termos |
| `/carteira.html` | Negócios e divulgação → VitrineCity Ads | Banco VitrineCity | Entrada existente; saldo/campanhas protegidos por conta |
| `/acessos.html` | Meu espaço → Entrar na minha área | Torre VitrineCity | Seletor público; cada papel conserva autenticação própria |
| `/porque-vitrinecity.html` | Ajuda → Por que ter a VitrineCity | Torre VitrineCity | Público |
| `/como-funciona.html` | Ajuda → Como funciona | Torre VitrineCity | Público |
| `/sobre.html` | Ajuda → Sobre a VitrineCity | Torre VitrineCity | Público |
| `/contato.html`, e-mail e WhatsApp do rodapé | Ajuda → Falar com a VitrineCity | Torre VitrineCity | Público; os canais estão na página de contato |
| `/termos-predio-digital.html` | Ajuda → Termos do prédio digital | Torre VitrineCity | Público |
| `/privacy.html` | Ajuda → Privacidade | Torre VitrineCity | Público |
| Formulário `#cadastro` → `POST /api/leads` | Ajuda → Receber ofertas da cidade | Torre VitrineCity | Público, mantém consentimento explícito e declaração 18+; abrir `/?inicio=1#cadastro` não cadastra a pessoa |
| Botão flutuante `/social` | Diversão e comunidade → Vitriny Social | Praça de convivência | Leitura pública; publicação e interações autenticadas conforme APIs existentes |
| Marca `/` | Ajuda → Página inicial | Entrada da cidade | `/?inicio=1` permite retornar à apresentação mesmo com preferência de entrada direta |

## Funções já existentes acrescentadas ao guia

| Destino/ação | Grupo e local | Regra de acesso |
| --- | --- | --- |
| `/ofertas`, diretório `openCenters` → `/centros/mercadolivre`, `/centros/shopee`, `/centros/cakto`, `/centros/kiwify`, `/centros/tiktok` | Comprar · Avenida de Compras | Seleções públicas com identificação de links afiliados; departamentos dependem de produtos publicados |
| `/meus-cursos.html` | Aprender · Centro Educacional | Dados e materiais protegidos por conta/matrícula |
| `/vitriny-games.html`, `/vitriny-mini-fazenda.html` | Diversão e comunidade · Prédio de jogos | Jogos exigem login; evolução e recompensas têm validação no servidor |
| `/vitriny-music-arena.html`, `/vitriny-cinema.html` | Diversão e comunidade · Pulse Arena/Cinema | Experiência com login; catálogos públicos `/musicas` e `/cinema` continuam disponíveis; disponibilidade de reprodução depende do canal de origem |
| `openCityChat` | Diversão e comunidade · Praça de convivência | Abre o chat da cidade; salas e mensagens exigem conta e seguem moderação existente |
| `/chat-social.html` | Diversão e comunidade · Praça de convivência | Conversas privadas exigem conta e autorização por conversa |
| `/minha-conta.html`, `/pedidos.html` | Meu espaço · Torre/Avenida | Dados pessoais e pedidos exigem autenticação; nenhuma autorização é relaxada pelo guia |
| `openAvatar`, `/central-creditos.html`, `openCredits` | Meu espaço · Banco VitrineCity | Avatar básico e benefícios mantêm suas regras; saldo/resgates exigem conta; sem saque/rendimento |
| `/preferencias-comunicacao.html` | Meu espaço · Torre VitrineCity | Alteração das preferências exige a verificação existente da conta; separada da entrada na cidade |
| `/painel-divulgacao.html` | Negócios e divulgação · Torre VitrineCity | Dados do parceiro exigem conta e cadastro de afiliado |
| `/entregador.html` | Negócios e divulgação · VC Entregas | Cadastro/login próprio do entregador; o guia não promete corridas nem ativação local |

## Integração e limitações

- `href` fornece um destino que funciona sem o renderizador 3D; `action` identifica um botão ou painel existente. Quando os dois estão presentes, representam a página direta e a experiência equivalente na cidade. O integrador escolhe o controle apropriado, sem executar ambos no mesmo clique.
- `openCityChat` é a única ação nova do catálogo; o integrador deve abrir o painel de conversa já existente. Não há URL independente equivalente ao chat da cidade. `/chat-social.html` corresponde a outro sistema de conversas e tem entrada própria.
- `landmark` é uma referência de orientação. Não autoriza teleporte para um prédio inexistente em cidades de prévia. Os links globais devem permanecer disponíveis com contexto claro de que levam aos serviços da VitrineCity.
- `place` é a chave opcional de navegação para um prédio ou distrito já existente (`commerce`, `education`, `headquarters`, `games`, `music`, `cinema`, `credits`, `delivery`, `social`, `business`). A integração pode oferecer uma ação secundária para ver esse local. Várias funções podem compartilhar a Torre ou a Avenida; isso não cria um prédio independente para cada função. Agrotécnica é resolvida pelo registro real de lojas, sem coordenada fixa no catálogo.
- As lojas individuais devem ser acrescentadas a partir do registro espacial real, preservando referência, nome e destino. O módulo não fixa IDs de loja nem inventa URL de produto.
- O diretório administrativo da Torre continua separado. Seus 31 setores e controles de acesso existentes não viram atalhos primários para o público.
- A presença visual da base VC Entregas é independente da operação. Ao abrir o diálogo, consultar `/api/marketplace/local-delivery/availability` para informar a habilitação por cidade; a placa orienta a consultar entregas. Não fixar o estado como ativo ou em implantação na memória, nem usar a presença do prédio ou a configuração habilitada como prova de entrega real concluída. Prazo, disponibilidade e valor dependem do endereço e das condições do pedido.
- O catálogo descreve serviços existentes. Não anuncia academia, atendimento médico/nutricional ou outras funções futuras ainda não implantadas.
- Todos os caminhos estáticos listados têm arquivo público ou rota explícita correspondente. A auditoria de mapeamento não substitui os testes de navegação e de autenticação da integração final.
