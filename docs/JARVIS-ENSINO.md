# Ensino supervisionado do Jarvis

Rodada posterior: [piloto Microsoft de conhecimento revisado](JARVIS-MICROSOFT.md), com fontes MIT, avaliação v1 reprovada e v2 reduzida a dois temas. Esse lote não cria um conector automático nem contrata serviços.

O administrador autorizou ensinar a IA e continuar em rodadas até a próxima manhã. Em 06/09/2026, foi adotado provisoriamente o prazo de 08h de Brasília (11:00 UTC), com pergunta enviada para confirmar a interpretação de “amanhã cedo”. Uma resposta posterior do administrador prevalece.

Isso amplia a memória consultável. Não é ajuste de pesos, treinamento contínuo do Qwen, cópia das conversas do administrador ou ampliação das permissões do modelo. O material só contém fatos do código e da documentação próprios, revisados pelo operador.

## Primeiro material

`ops/jarvis/curriculum-20260906.json` contém oito conhecimentos novos: buscar empresas, consultar leads, preparar convites, acompanhar funil, distinguir cliques/vendas de afiliados, diagnosticar integrações, interpretar Analytics e entender o piloto orgânico. Corrige também um fato da memória inicial: o catálogo é administrado em `/admin-vendas-afiliadas.html`; `/admin-afiliados.html` é a tela de campanhas de vídeos. Essa correção também foi aplicada ao texto de bootstrap para novas instalações.

Não ensina preços, estoque, faturamento, saldo ou conexões como se fossem informações ao vivo. Os registros novos têm fontes, versão conferida e validade até 06/10/2026. Listagem de prospecção limitada a 300 registros não representa todo o banco; preparação de convite não comprova envio; cliques não comprovam vendas. Esses limites são parte do conhecimento, não autorizações para coletar ou enviar mensagens.

## Procedimento do operador

O utilitário `app/scripts/jarvis-curriculum.mjs` não é uma rota HTTP nem uma ferramenta do Jarvis. Ele exige acesso administrativo à VPS e aprovação explícita no comando para alterar a memória. Usa o operador de sistema (actor_id 0), sem se passar por uma conta administrativa de pessoa, e registra eventos de rascunho e aprovação com o identificador do material. A autorização e as fontes ficam no material versionado.

Modos:

- `plan PACK.json BANCO.db`: somente leitura; informa inserções/correções e duplicatas preservadas.
- `evaluate PACK.json BANCO-DE-PRODUCAO.db`: ensaio em banco inteiramente em memória; o banco real é aberto somente para confirmar que Jarvis não está pausado nem processando uma consulta. Usa somente a rede privada e o modelo local, uma pergunta por vez, limite de 25 segundos por requisição de avaliação. Ainda pode haver disputa momentânea pelo modelo entre a checagem e uma consulta do usuário; rodadas devem ser curtas.
- `apply PACK.json BANCO.db --confirm-reviewed BACKUP-ABSOLUTO.db`: valida o material, verifica conflitos, faz backup online novo, confere integridade e importa em transação. Executar sob `/tmp/vitrinecity-codex-deploy.lock`, com imagem/código conferidos, sem rede e com somente os mounts necessários.

O Dockerfile não copia `app/scripts`; montar o utilitário e o JSON revisados como somente leitura ao executar a imagem já testada. Nos ensaios, montar o volume real como somente leitura. Na importação autorizada, somente o volume do banco precisa de escrita. Não mostrar credenciais ou sessões.

Nunca reaplicar sem executar `plan`: se não há operações, não importar nem fazer backup repetido. Fonte, título ou corpo já existente impedem duplicação. Documentos alterados ou arquivados pelo administrador não são reativados. Uma correção exige o conteúdo, origem, autoria de sistema, estado e revisão esperados; conflito exige inspeção manual. O utilitário não inicializa o núcleo sobre o banco real e, portanto, não marca consultas concorrentes como interrompidas nem altera configurações. Só escreve em `jarvis_documents` e `jarvis_events`. Não há exclusão.

## Avaliação honesta

Definição: `.claude/evals/jarvis-ensino-inicial.md`. Teste determinístico: `app/scripts/test-jarvis-curriculum.mjs`. Comparação usa a memória inicial reproduzida e o mesmo algoritmo/modelo; depois aplica o material no banco descartável.

No teste de recuperação, a fonte esperada passou de presente em 1/9 para 9/9 perguntas, todas em primeiro lugar depois do material. Isso mede cobertura da memória, não precisão de respostas generativas. No primeiro ensaio completo do modelo, houve seis respostas geradas e três retornos explícitos de trechos; o teste que exigia nove gerações falhou. Os nove conteúdos não são nove acertos do modelo. A ferramenta passou a registrar separadamente cobertura, geração, fallback e verificações de termos, porque o fallback é parte explícita do contrato do Jarvis. Falta de citação foi identificada como motivo de retorno de trechos em perguntas repetidas. Omissão de detalhes relevantes continua uma limitação a acompanhar.

O ensino também revelou que trechos de documentos curtos podiam começar no meio do texto, cortando contexto ou uma rota. O núcleo agora preserva o documento inteiro quando cabe no limite de 1.800 caracteres e evita começar no meio de uma palavra nos textos longos. Não foram removidas verificações de citação ou de limite do modelo para fazer os testes parecerem melhores.

Na segunda rodada completa, o modelo gerou uma explicação incorreta sobre o piloto orgânico, confundindo o guia digital com eventos presenciais. A presença de uma citação válida não impediu essa invenção: a resposta foi reprovada na revisão semântica, antes de importar o material. O texto foi esclarecido com base na mesma documentação, sem incorporar a invenção. Três perguntas sobre o assunto foram repetidas, incluindo duas formulações novas. Todas recuperaram a fonte em primeiro lugar e geraram uma explicação coerente com o guia digital; duas incluíram a URL, enquanto a pergunta geral sobre a finalidade do guia recebeu uma resposta correta sem a URL. Tempos: aproximadamente 8–11 segundos. Essa amostra não garante que o erro nunca voltará a ocorrer. Continuar a revisão humana e testar dúvidas inéditas; não usar apenas citação ou correspondência de palavras como atestado de correção.

Verificação local desta versão: 71 scripts de regressão passaram; os testes de memória e de importação verificaram conflitos, reaplicação sem duplicatas, preservação de registros arquivados e de consultas em andamento, além de transação sem alterações parciais. Testes de infraestrutura e saúde após publicação devem ser registrados separadamente dos ensaios em memória.

Os resultados desta amostra são específicos: não comprovam precisão geral nem rentabilidade. Novas rodadas devem testar variações inéditas de perguntas e repetir algumas perguntas de controle, sem esconder falhas, fazer buscas pagas, incorporar respostas como fatos ou alterar o modelo para decorar apenas o teste.

## Janela noturna

A automação existente da Gestora foi temporariamente direcionada ao Jarvis, sem criar uma automação duplicada. Rodadas horárias, até quatro conhecimentos novos/correções por rodada, com checagem de atividade anterior e saúde. O relatório final deve consolidar material aprovado, respostas reais, retornos de trechos, problemas e limites; depois restaurar a rotina permanente, preservando frequência e preferência de notificações. A execução dessas rodadas depende de o ambiente do Codex continuar disponível e conectado. O serviço de inferência na VPS é independente desse agendamento.

### Lote de busca pública — rodada de 05:52 UTC

`ops/jarvis/curriculum-busca-20260906.json` adiciona dois assuntos: como pesquisar sites, vídeos e lojas; e por que um resultado de rede social não representa conta conectada, feed privado ou integração com preço/estoque ao vivo. Fontes próprias verificadas no commit `c90f384`, com validade até 06/10/2026. A definição prévia está em `.claude/evals/jarvis-busca-20260906.md`.

Ensaio com cópia da memória publicada de 11 documentos, em banco descartável: cobertura das quatro perguntas novas passou de 0/4 para 4/4, todas em primeiro lugar. A recuperação das nove perguntas anteriores permaneceu 9/9; pergunta sem fonte sobre faturamento futuro continuou sem resposta inventada. Aplicação repetida gerou zero operações. Houve uma síntese coerente sobre o filtro de cidade e três retornos explícitos de trechos com as informações corretas (página da busca e limites das redes), em aproximadamente 7,5–12,9 segundos. Isso demonstra ampliação de conteúdo consultável, não quatro acertos de geração nem melhoria da taxa do modelo: as perguntas são diferentes da primeira rodada. Não foram relaxadas proteções nem repetidas as perguntas apenas para obter uma geração.

Este lote altera somente conteúdo e documentação. A importação usa o utilitário já testado, backup novo e eventos de aprovação do operador; não requer rebuild ou reinício do aplicativo. Os registros de execução devem confirmar separadamente a importação real e os totais após aplicação. O utilitário `gh` permanece indisponível neste ambiente; operações autorizadas de revisão/versionamento usam o conector GitHub, sem instalar ferramentas ou extrair credenciais.

### Clareza sobre aprendizado — rodada de 06:53 UTC

Um ensaio de quatro perguntas coloquiais encontrou fontes em 3/4 casos: duas sínteses coerentes (lista salva e convite que não foi enviado automaticamente), um fallback correto (preço atual não garantido) e uma ausência de fonte. A dúvida “o jarvis aprende sozinho tudo que converso com ele?” não encontrou o documento de ensino. O núcleo recusou responder em vez de inventar, mas a recuperação lexical não alcançou uma informação já existente.

`ops/jarvis/curriculum-aprendizado-20260906.json` esclarece apenas esse documento de sistema, preservando seu título e assunto. A redação explicita aprender/conversar e distingue memória revisada de pesos do modelo; não cria um registro duplicado nem altera o código de busca. O importador exige exatamente o corpo, fonte, estado aprovado, autoria de sistema e revisão 1 originais. Edições administrativas fazem a correção abortar. A validade do texto revisto é 06/10/2026.

Antes da importação, a pergunta que falhou e duas formulações novas foram testadas uma vez cada com a cópia de 13 conhecimentos em memória: cobertura 2/3 antes, 3/3 após, sempre em primeiro lugar. Duas sínteses negaram corretamente aprendizagem automática por conversa; a terceira devolveu o trecho completo sobre cadastro, revisão e aprovação. Tempos aproximados: 8,0s, 6,4s e 10,1s. As 13 perguntas dos dois lotes anteriores preservaram a fonte esperada; a pergunta de faturamento futuro continuou sem fontes. Isso corrige uma lacuna observada de vocabulário, não demonstra compreensão geral de erros de escrita nem elimina limitações do modelo. Critérios definidos previamente em `.claude/evals/jarvis-aprendizado-20260906.md`. Nenhum ajuste de pesos, prompt, permissões ou validação de citações.
