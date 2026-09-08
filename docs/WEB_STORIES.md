# Web Stories da VitrineCity

As Web Stories são guias visuais completos, publicados em `/stories`, que conectam conteúdos, produtos e serviços já disponíveis na VitrineCity. O painel fica em `/admin-web-stories`. A rotina diária prepara e revisa conteúdos com a IA gestora, publica os que passam pelas verificações e registra as pendências dos demais.

Este documento descreve a implementação. Não confirma que a rotina está ativa em produção, que uma fonte específica continua disponível ou que o Google indexou uma história.

## Fontes e elegibilidade

O adaptador lê novamente o catálogo público a cada consulta. Não importa clientes, contatos, pedidos, pagamentos ou dados internos de vendedores para a redação.

| Categoria do painel | Fontes reais consultadas | Condições principais |
| --- | --- | --- |
| Produtos e ofertas | Produtos do marketplace e catálogo de afiliados | Produto ativo, disponível, com preço válido e loja publicada; quando existe controle de estoque, quantidade positiva. Oferta de afiliado publicada, disponível, com link verificado e plataforma permitida. |
| Serviços e cursos | Pacotes públicos de serviços e cursos prontos para acesso público | Respeita os indicadores de disponibilidade e a situação atual do curso no catálogo administrado. |
| Notícias | Artigos publicados e assuntos encontrados no Google Trends Brasil | Notícias precisam de evidências recentes de pelo menos duas famílias editoriais distintas antes da geração automática. |
| Receitas | Artigos publicados da categoria receitas | Conteúdo completo, imagem válida e informações suficientes para dez páginas úteis. |
| Esportes | Artigos publicados e assuntos esportivos do Trends | Usa as mesmas exigências de evidência das notícias. |
| Tendências | Outros artigos publicados e assuntos classificados pela pesquisa | Um assunto em alta serve para descoberta; seu título não comprova fatos. |

A biblioteca já contém as fotos de **bolo de cenoura**, **bowl de frango** e **fricassê de frango**, em `app/public/assets/recipes/`. Essas receitas podem aproveitar os artigos existentes, desde que estejam publicados e completos. A presença de uma foto na biblioteca, por si só, não cria uma receita, não torna um artigo público e não garante aprovação automática.

### Receitas estruturadas: preservar o preparo completo

A implementação local prepara as telas diretamente do corpo da receita publicada, em vez de pedir à IA que resuma os ingredientes e o preparo. Esta descrição documenta o código e seus testes; não confirma que essa alteração já esteja publicada no domínio.

Esse caminho aplica-se a artigos da categoria receitas (`kind: article`, grupo `recipes` ou portal `receitas`). O texto, após normalizar espaços, precisa ter entre **550 e 1600 caracteres**, com seções identificáveis de **Ingredientes:** e **Preparo:** ou **Modo de fazer:**. HTML, URLs, estrutura desconhecida, texto insuficiente ou conteúdo que não caiba nos limites mantém a tentativa pendente antes da primeira chamada de texto. O sistema não inventa ingredientes nem elimina etapas para fazer a receita caber.

Todas as palavras do corpo da receita, incluindo medidas, temperatura, tempo e cuidados informados, permanecem na ordem original. O conteúdo é distribuído em 7 a 17 telas de preparo, com 35 a 100 caracteres por tela, além da capa e de duas telas finais: **10 a 20 páginas** no total, pelo menos 650 caracteres e o mesmo limite de leitura de 180 caracteres realmente exibidos por página. Apenas os espaços entre palavras são normalizados.

A primeira chamada de IA pede somente título, descrição e orientação para a imagem, com orçamento de 700 tokens; eventuais páginas devolvidas pelo modelo não substituem o preparo preservado. A resposta `insufficient` continua interrompendo a tentativa. Uma segunda chamada recebe a receita e todas as telas completas para revisão independente. A orientação distingue a diagramação fiel desse artigo interno de reprodução indevida de terceiros, sem presumir autoria, licença ou exclusividade. Originalidade, fundamentação, completude e os demais critérios continuam exigindo aprovação explícita. Metadados inventados, reprovação, cancelamento ou mudança da origem impedem a geração da imagem e a publicação.

### Apresentação da cidade e das lojas

O catálogo também admite `city:vitrine-city`, na categoria Tendências, e `store:<referência>`, na categoria Serviços e cursos. São fontes com identidades próprias (`city` e `store`), sem criar cópias dos artigos ou das páginas comerciais existentes. A história da cidade leva à página inicial; a história de uma loja leva ao endereço canônico `/loja/:referência/:nome`.

A fonte da cidade requer o diretório público configurado em `createWebStorySources({publicDir})`. Ela relê a descrição, o título, a nota de acesso e a imagem da home real, e reaproveita as descrições do guia público `CITY_GUIDE_ITEMS`. Não extrai formulários, scripts, informações de visitantes ou texto de páginas arbitrárias. O texto mantém o acesso público à visita e orienta a consultar a disponibilidade de entregas; não transforma presença visual de um prédio em confirmação de operação. A imagem da home é identificada como conceitual pela própria página. Se a home deixa de existir, a fonte deixa de ser retornada.

As lojas precisam estar publicadas em `store_profiles`. O adaptador seleciona apenas nome, descrição, cidade/estado, imagem pública e nomes dos canais válidos; não entrega e-mails de proprietários, observações administrativas, pedidos ou contatos brutos à IA. Os produtos mencionados passam pelo mesmo filtro do catálogo de produtos, incluindo publicação da loja, disponibilidade, preço e estoque quando controlado. A apresentação pode citar até doze itens atuais, com seus caminhos internos. Uma loja publicada sem produtos pode continuar sendo apresentada a partir da descrição real, sem inventar um catálogo.

Lojas são fontes comerciais: alterações na descrição, identidade, imagem ou nos itens citados invalidam o snapshot comercial antigo; retirada da publicação remove a elegibilidade. Uma descrição curta ou uma foto inadequada continua sujeita aos mesmos bloqueios de conteúdo e imagem. O adaptador não completa informações ausentes para atingir dez páginas. Acrescentar essas fontes não ativa a automação nem gera conteúdo fora da quota.

O Google Trends é consultado pelo RSS público do Brasil. A pesquisa aceita apenas uma lista explícita de publicadores, recusa redirecionamentos e endereços de rede privada e limita tempo e tamanho das respostas. Uma evidência válida contém texto efetivamente recuperado, endereço, família editorial, data da consulta e hash do trecho. São necessárias **duas famílias editoriais distintas**, com consulta recente de até 24 horas; dois subdomínios do mesmo grupo não contam como duas fontes independentes. Falta de acesso, texto insuficiente ou fonte não permitida mantém a história pendente. Não há contorno de paywall nem publicação de notícia baseada apenas em título, popularidade ou resumo inventado.

## Formato e imagens

Os limites de páginas são decisões do produto, incluindo o mínimo de dez solicitado para a VitrineCity. Não são uma exigência de dez páginas atribuída ao Google.

| Regra | Preparação automática | Edição manual |
| --- | --- | --- |
| Número de páginas | 10 a 20 após encaixe do texto | 10 a 40 |
| Texto | Páginas distintas e pelo menos 650 caracteres no conjunto; limites menores na capa e nas duas páginas finais | Até 130 caracteres por bloco, com conteúdo completo no conjunto |
| Título | 8 a 65 caracteres | Até 90 caracteres |
| Descrição | 30 a 160 caracteres | 30 a 160 caracteres |
| Leitura na página | A publicação automática conta o texto realmente exibido, incluindo marca, crédito, contador e botões, e rejeita páginas acima de 180 caracteres | A prévia permite revisar composição, legibilidade e conteúdo antes de publicar |

Uma história automática aprovada solicita **uma imagem conceitual de IA**, depois das verificações de fonte, redação e revisão. Essa imagem é reutilizada nas páginas; não existe geração de uma imagem nova por página nem repetição oculta da solicitação. A orientação exclui texto embutido, logotipos, rostos de pessoas reais e aparência de prova documental de um acontecimento.

Produtos, serviços, cursos, ofertas e lojas também precisam de **uma foto real do catálogo**, exibida na segunda página. A imagem conceitual não substitui essa fotografia nem comprova características do produto. Os créditos diferenciam `Ilustração IA` de `Foto do catálogo`. Uma foto inexistente, inacessível ou pequena mantém a preparação pendente.

As imagens aceitas são PNG, JPEG ou WebP locais validados, com pelo menos 640 pixels em cada lado, limites de arquivo e de dimensões. A exceção são fotos reais de catálogo com pelo menos 640 × 360 pixels: elas aparecem inteiras, com `object-fit: contain`, sem esticar nem cortar o produto. Fotos remotas de catálogo passam pelo importador restrito já existente; o editor não aceita uma URL arbitrária para o FFmpeg. O cartaz é recortado em 900 × 1200, preservando a proporção, e reutilizado por hash. O logo deve ser quadrado, com pelo menos 96 pixels. O seletor oferece miniaturas, busca e aplicação às demais páginas somente quando essa opção é escolhida.

Quando `OPENAI_API_KEY` está configurada, as histórias usam `gpt-image-2` pela API de imagens da OpenAI, em 1024 × 1536 e qualidade média. Sem essa chave, usam o modelo de imagem configurado no OpenRouter. É uma escolha antes da chamada, sem repetição entre provedores em caso de falha. A conexão OpenAI foi validada com uma geração real em 8 de setembro de 2026; o modelo padrão do OpenRouter devolveu 404 nessa verificação.

O encaixe automático redistribui frases e palavras inteiras que excedem uma tela, preservando a sequência do conteúdo. A versão encaixada passa pela revisão independente antes de qualquer geração de imagem. Não há corte de informação nem preenchimento repetitivo para atingir dez páginas.

Nas novas histórias, o botão da **última página** leva à página relacionada dentro da VitrineCity. O texto padrão acompanha o assunto: **Ver modo de preparo** em receitas, **Ver oferta** em produtos e afiliados, **Visitar loja**, **Ver curso**, **Ver serviço**, **Explorar cidade** ou **Ler matéria completa** em artigos, notícias, esportes e assuntos do Trends. “Ver oferta” indica acesso à ficha publicada; não afirma que há desconto. Descontos, cupons e preços promocionais só podem ser anunciados quando confirmados na fonte.

O editor pode ajustar o texto do botão, com até 30 caracteres, ou optar por um convite adicional à home. Esse convite começa desmarcado nas novas histórias. Quando habilitado, o destino do assunto passa à penúltima página e a última leva à página principal `/`. Botões já salvos, incluindo a escolha explícita da home ou a remoção de um botão, são preservados na edição e na recriação. A atualização automática também considera esses botões no orçamento de texto antes de gerar a imagem.

A identificação do vínculo de afiliado acompanha a página do botão da oferta. As fontes consultadas ficam acessíveis em `/stories/:slug/fontes`; essa página complementar recebe `noindex,follow`. O convite final não deve esconder ingredientes, etapas de preparo ou fatos centrais para provocar cliques: a informação essencial continua na própria história.

Para um assunto novo do **Google Trends**, a preparação inclui também uma página própria em `/artigo/:slug`, com endereço descritivo, título e descrição correspondentes à história. O artigo tem entre **900 e 3000 caracteres**, em parágrafos, e precisa se sustentar nas mesmas evidências consultadas. A revisão de IA analisa tanto a história quanto esse artigo. O botão final **Ler matéria completa** leva ao artigo do assunto, salvo a opção explícita de manter um convite adicional à home.

O artigo relacionado recebe a imagem da capa e as referências consultadas. Artigo e Web Story são publicados **na mesma transação**: uma falha não deixa apenas um deles publicado. Reprovação ou texto incompleto não publica nenhum dos dois. Artigos, produtos e serviços que já possuem página pública continuam usando sua página existente, sem criar outra cópia. Os artigos gerados com a identidade `story-companion:` ficam fora da seleção automática de novas fontes, impedindo uma cadeia de histórias sobre histórias.

## Rotina diária e controle de custo

Em uma base nova, a automação começa **pausada**. Os padrões são seis tentativas por dia, às 09:00 no fuso `America/Sao_Paulo`, com as seis categorias selecionadas. O painel permite escolher entre 1 e 24 tentativas, uma hora de 0 a 23 e ao menos uma categoria. A ativação requer a configuração da IA gestora. Configurações já salvas são preservadas nas reinicializações; uma atualização de código não reativa uma rotina pausada.

O limite conta **tentativas**, não publicações: resultados publicados, pendentes, falhos e interrompidos consomem a cota do dia. Executar uma rodada pelo painel também respeita a ativação, a configuração e a cota restante. O comando não cria um orçamento extra. Não existe recuperação ilimitada de dias perdidos.

O agendador usa SQLite para configurações, histórico, posição nas categorias e reserva temporária de trabalho. Processa as fontes sequencialmente, alterna as categorias selecionadas e prioriza fontes inéditas antes de atualizações. A reserva atômica impede dois processos de executarem simultaneamente a mesma rodada. Após interrupção, o histórico e a cota persistem; uma falha ou interrupção da mesma versão não é tentada novamente antes de 24 horas.

Pausar ou alterar a configuração invalida o trabalho em andamento. A publicação verifica novamente a reserva, a revisão da configuração, a origem e a ausência de edições concorrentes imediatamente antes de gravar. Uma chamada ao provedor já iniciada pode ter custo mesmo quando seu resultado é descartado.

Enquanto a automação de Web Stories está habilitada, o temporizador editorial legado do Radar de Tendências deixa de iniciar novas gerações automáticas. Isso evita duas rotinas produzindo conteúdos em paralelo. Essa proteção não apaga artigos nem desativa as ferramentas manuais; trabalho legado iniciado anteriormente pode precisar terminar sua chamada corrente.

## Publicação automática e revisão manual

A IA recebe dados públicos de origem como dados não confiáveis, sem obedecer a instruções contidas nos textos. Primeiro redige o conteúdo ou, nas receitas estruturadas, apenas os metadados do preparo já diagramado. Uma segunda chamada revisa a história completa contra a origem. Para publicar, os indicadores de fundamentação, originalidade, completude, ausência de repetição e equilíbrio comercial precisam ser aprovados, com risco baixo. Regras locais verificam formato, quantidade de páginas, números ausentes na origem, chamadas inadequadas, imagens e orçamento de leitura.

Essas verificações reduzem erros; não equivalem a verificação humana infalível nem a certificação do Google. Notícias e esportes usam os trechos pesquisados como evidência, não o título editorial como prova. Conteúdo insuficiente não deve ser esticado artificialmente para chegar a dez páginas.

Uma pendência aparece no histórico com uma razão legível. Nem toda pendência cria um rascunho: uma fonte sem foto, sem evidência ou sem conteúdo suficiente pode ser interrompida antes da redação. Quando existe rascunho, ele permanece disponível somente no painel. O fluxo manual continua com edição, prévia e confirmações editoriais antes de publicar.

Cada origem mantém uma identidade estável e uma única URL de história. A mesma versão publicada não é gerada outra vez. Uma mudança de conteúdo pode atualizar a história existente, dentro da cota diária. A versão editável e a versão pública são armazenadas separadamente:

- Uma revisão editorial pendente conserva a última versão pública aprovada.
- Mudanças na ficha comercial ocultam a versão comercial antiga até que uma atualização seja aprovada. Registrar um novo rascunho não torna a versão antiga visível novamente.
- Retirar a origem do catálogo público também retira sua história da página pública, da galeria e dos sitemaps.
- Uma retirada manual da história não é desfeita pela automação. Uma edição manual também não é substituída automaticamente.
- Uma edição, retirada, pausa ou mudança da origem durante a espera da IA vence a tentativa automática concorrente.
- O artigo criado para um assunto do Trends também mantém sua identidade e endereço nas atualizações. Uma edição manual de seu conteúdo impede sobrescrita automática. Retirar esse artigo da publicação oculta a Web Story correspondente e suas referências na galeria e nos sitemaps.

## Administração, privacidade e páginas públicas

O painel, a API administrativa e a prévia exigem autenticação administrativa com as proteções existentes de segundo fator. Escritas verificam a origem da requisição. Atualizações da configuração e dos rascunhos usam revisão otimista: uma edição baseada numa revisão antiga recebe conflito, em vez de sobrescrever a edição mais recente.

Estado, histórico e motivos da rotina são administrativos e usam `Cache-Control: no-store`. Não expõem credenciais do provedor ou detalhes brutos de erros externos. O adaptador de fontes seleciona campos públicos explicitamente; não fornece cadastros, sessões, dados pessoais ou pedidos à IA. Imagens já públicas do catálogo e arquivos gerados para publicação não devem receber conteúdo confidencial.

O documento público é renderizado exclusivamente a partir do snapshot publicado elegível. A galeria e os sitemaps aplicam a mesma regra de visibilidade. Prévia e rascunhos não aparecem nessas listagens. Texto, metadados e JSON-LD são escapados; os botões principais preservam destinos internos controlados pelo sistema.

As páginas AMP possuem canonical para a própria `/stories/:slug`, título, descrição, cartaz, logo, metadados Open Graph e dados estruturados `Article`, com as datas da publicação. Não usam o artigo de origem como canonical. Somente a resposta de uma história AMP pública válida retira `X-Frame-Options` e a diretiva CSP `frame-ancestors`, para compatibilidade com exibição externa; mantém `base-uri` e `object-src`. Painel, prévia, galeria e respostas de erro conservam as proteções pertinentes.

A integração exclui o documento AMP das injeções globais de banners, medição e scripts da aplicação. Histórias elegíveis entram no sitemap principal e em `/sitemap-stories.xml`, referenciado por `/sitemap-index.xml`. Os testes verificam essa separação com o servidor real e banco descartável.

## Testes e operação

Na pasta `app`:

```sh
npm run test:stories
npm test
npm run test:release
```

`test:stories` executa todos os arquivos `scripts/test-web-stor*.mjs` e `scripts/test-admin-web-stor*.mjs`: fontes, pesquisa, IA, agendador, publicação, seletor de imagens, interface administrativa e integração com o servidor. Os padrões incluem novos testes com esses prefixos. `npm test` termina executando `test:stories`, portanto o CI isolado existente em `ops/verify-release.sh` já inclui essa cobertura sem acrescentar outra chamada explícita ao comando. A verificação ampla já existente de `test:release` também descobre todos os scripts `test-*.mjs` e, por isso, volta a executá-los como parte da validação geral da plataforma.

Os testes usam dados descartáveis e provedores simulados. Não ativam a operação, não publicam no domínio e não exigem uma chave real de IA. O teste de conversão real pode ser habilitado em um ambiente com FFmpeg instalado:

```sh
WEB_STORY_FFMPEG_TEST=1 node --test scripts/test-web-stories.mjs
```

No PowerShell, configure essa variável somente no processo de teste. Essa rodada adicional tem o propósito específico de validar a conversão real, normalmente ignorada pela suíte sem a flag. Os testes de estrutura AMP não substituem o validador oficial: antes da publicação de alterações no renderizador, valide também um documento representativo com `amphtml-validator` e revise a apresentação no celular. Um resultado AMP válido não verifica direitos de imagem, veracidade, qualidade editorial ou indexação.

## Regras do Google e limites da proposta

O uso de IA não dispensa conteúdo útil, original, completo e correto. Publicar muitas páginas de baixo valor para obter tráfego pode caracterizar abuso de conteúdo em escala. Histórias exclusivamente publicitárias não atendem às políticas de Web Stories; links de afiliados devem ocupar uma parte limitada, com conteúdo substancial para o leitor. O direito de usar imagens e textos precisa existir independentemente de o arquivo estar acessível na internet.

Referências oficiais para revisão do produto:

- [Google Search: uso de conteúdo gerado por IA](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content).
- [Políticas de conteúdo de Web Stories](https://developers.google.com/search/docs/appearance/web-stories-content-policy).
- [Boas práticas de criação de Web Stories](https://developers.google.com/search/docs/appearance/web-stories-creation-best-practices).
- [Habilitar Web Stories na Pesquisa Google](https://developers.google.com/search/docs/appearance/enable-web-stories).
- [Especificação do componente amp-story](https://amp.dev/documentation/components/amp-story).
- [Validação de documentos AMP](https://amp.dev/documentation/guides-and-tutorials/learn/validation-workflow/validate_amp).

Acesso público, canonical, sitemap, metadados e AMP válido permitem descoberta técnica. **Não garantem indexação, posição na busca, exibição no Discover, tráfego ou vendas.** Acompanhamento de indexação usa as ferramentas da propriedade no Search Console; a automação não apresenta essas métricas como sucesso de uma geração.
