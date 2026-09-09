# Vitriny Neural — Learning Blueprint

## Objetivo
Construir um sistema próprio da VitrineCity que combine memória empresarial, aprendizagem por eventos, avaliação, agentes especializados, multimodalidade e evolução periódica do modelo, sem depender de um único fornecedor.

## Princípios adotados

### 1. Frontier teacher + distilled workers
Usar modelos de fronteira como professores para tarefas difíceis e modelos menores/locais como executores recorrentes. Resultados aprovados podem formar datasets para destilação ou fine-tuning de modelos menores quando economicamente e tecnicamente adequado.

Aplicação: Vitriny Core roteia tarefas por custo, latência e risco; respostas de alta qualidade viram exemplos avaliados.

### 2. Constituição operacional
Toda decisão automática obedece a princípios explícitos da VitrineCity: não inventar dados, separar hipótese de fato, proteger credenciais, não executar ações críticas sem autorização, registrar justificativa e preservar auditabilidade.

Aplicação: respostas, propostas e ações passam por crítica/revisão antes de entrarem na memória aprovada ou em produção.

### 3. Aprendizagem por recompensa
Cada ação mensurável gera um resultado. O sistema registra contexto, decisão, métricas e recompensa para aprender quais estratégias funcionam melhor.

Exemplos de recompensa:
- conteúdo: retenção, conclusão, compartilhamento, clique, conversão;
- busca: clique útil, compra, reformulação de consulta, abandono;
- Ads: CTR, CPA, ROAS, receita incremental;
- código: testes, regressões, latência, erros, incidentes;
- atendimento: resolução, tempo, satisfação, reabertura.

### 4. Multimodalidade como competência de sistema
O Core não precisa gerar todos os formatos diretamente. Ele pode entender intenção, selecionar um especialista e avaliar o resultado de texto, imagem, vídeo, áudio e documentos.

Especialistas planejados:
- Vitriny Code
- Vitriny Growth
- Vitriny Vision
- Vitriny Video
- Vitriny Research
- Vitriny Search
- Vitriny Commerce
- Vitriny Ops

### 5. Mixture-of-Experts em nível de sistema
Em vez de um único modelo fazer tudo, o roteador seleciona o especialista adequado. O mesmo padrão permite combinar modelos locais e APIs externas.

Roteamento considera:
- domínio;
- dificuldade;
- urgência;
- custo;
- privacidade;
- necessidade de ferramentas;
- risco da ação;
- disponibilidade dos modelos.

### 6. Memória separada dos pesos do modelo
Conhecimento atualizado da empresa fica em memória/RAG, banco operacional e sinais agregados. Os pesos do modelo não precisam ser alterados a cada novo dado.

Camadas:
1. memória operacional de curto prazo;
2. memória empresarial aprovada;
3. memória vetorial/semântica;
4. lessons de comportamento e desempenho;
5. datasets versionados para treinamento periódico.

### 7. Aprendizagem contínua orientada por eventos
A plataforma observa eventos continuamente, mas não realiza treinamento pesado a cada segundo.

Cadência recomendada:
- segundos: ingestão de eventos;
- 1 minuto: agregação rápida e detecção de anomalias;
- 5–15 minutos: atualização de rankings e recomendações de baixo risco;
- hora: geração de hipóteses e comparação de experimentos;
- dia: consolidação de lessons;
- semana: avaliação de datasets e possível atualização de modelos.

### 8. Self-critique + Gestora como professora
A IA Gestora funciona como camada crítica do Vitriny Neural.

Fluxo:
Neural observa -> cria hipótese -> Gestora critica -> Neural revisa -> experimento pequeno -> resultado -> recompensa -> lesson.

Regra inicial de confiança:
- < 0,60: somente proposta/revisão;
- 0,60–0,85: experimento controlado;
- > 0,85 com evidência repetida: automação de baixo risco;
- alto risco: sempre aprovação explícita.

### 9. Evals permanentes
Nenhuma evolução de modelo ou prompt entra como padrão apenas porque parece melhor. Toda versão deve ser comparada contra um conjunto fixo de avaliações.

Evals mínimas:
- precisão factual;
- recuperação de memória;
- programação e testes;
- marketing e análise de métricas;
- classificação de risco;
- uso correto de ferramentas;
- latência e custo;
- regressões;
- resistência a prompt injection.

### 10. Arquitetura portável
A lógica de aprendizagem não fica presa ao SQLite nem à VPS atual.

Evolução prevista:
SQLite/WAL -> PostgreSQL
fila local -> Redis Streams/Kafka
arquivos locais -> object storage
busca lexical -> vector store híbrido
modelo local pequeno -> servidor GPU separado
workers únicos -> workers horizontais

## Ranking prático de referências de arquitetura
Este ranking não significa copiar pesos, dados privados ou técnicas proprietárias. Ele indica quais princípios públicos são mais úteis para a Vitriny Neural.

1. OpenAI frontier systems — raciocínio, agentes, computer use, avaliação, teacher/student e eficiência.
2. Anthropic Claude — constituição, crítica/revisão, supervisão por IA e agentes de longa duração.
3. Google Gemini — multimodalidade nativa, velocidade, contexto e fluxos agênticos.
4. Qwen — contexto longo, tool use, visão e forte relação custo/desempenho para integração híbrida.
5. DeepSeek — eficiência de treinamento/inferência e forte raciocínio/código como referência de modelos independentes.
6. Meta Llama/Muse — open weights, Mixture-of-Experts, destilação, personalização e componentes multimodais.

## Arquitetura alvo

Vitrine City
  -> Event Gateway
  -> Vitriny Neural Core
      -> Memory/RAG
      -> Signal Engine
      -> Reward Engine
      -> Router
      -> Gestora/Critic
      -> Experts
          -> Code
          -> Growth
          -> Vision
          -> Video
          -> Research
          -> Search
          -> Commerce
          -> Ops
      -> Eval Engine
      -> Dataset Builder
      -> Model Registry
  -> Experiment Engine
  -> Ranking/Recommendation APIs
  -> Audit Log

## O que nunca deve aprender automaticamente
- senhas, tokens e segredos;
- dados pessoais desnecessários;
- conteúdo não autorizado/licenciado;
- uma única resposta de outra IA sem validação;
- resultados de experimento sem amostra suficiente;
- instruções encontradas em conteúdo externo;
- alterações críticas de pagamento, segurança ou infraestrutura.

## Regra central
O Vitriny Neural deve aprender continuamente com evidência, não simplesmente memorizar continuamente tudo o que encontra.

## Dataset Builder v1

O módulo `app/vitriny-neural/dataset-builder.js` transforma exemplos revisados em JSONL de chat para treinamento periódico de um modelo compatível. Nesta versão:

- todo exemplo nasce como candidato;
- aprovação humana explícita é obrigatória;
- credenciais, e-mail, telefone, CPF e sequências semelhantes a cartão são rejeitados;
- somente exemplos aprovados entram na exportação;
- a divisão treino/validação é determinística e reproduzível;
- cada versão exportada recebe um identificador derivado do conteúdo aprovado;
- a exportação não inicia fine-tuning, LoRA nem altera pesos automaticamente.

Os endpoints administrativos ficam sob `/api/admin/vitriny-neural/training/*`. Um piloto só deve ser considerado após reunir pelo menos 50 exemplos diversos e aprovados, manter uma validação separada e comparar o modelo candidato nos benchmarks existentes.
