# Conhecimento público do ecossistema — 8 de setembro de 2026

O lote `ops/jarvis/curriculum-ecossistema-20260908.json` prepara dez conhecimentos públicos revisados sobre cidade, recursos pessoais, descontos, afiliados, busca, entregas e capacidades reais da IA. A validade é 08/10/2026. O arquivo não comprova importação na memória nem publicação das alterações da cidade.

## Conteúdo e evidência

- Visita pública à cidade, organização em seis grupos e retorno à apresentação.
- Conta para recursos pessoais; autenticação separada de consentimento para campanhas.
- Recompensas com desconto de até 30% em cursos elegíveis e avatar; cotação, saldo e vencimento confirmados no servidor.
- Parceiros: regra de 50% da comissão externa total, repasse após confirmação/recebimento; cliques não comprovam vendas.
- Resultados internos relevantes antes das sugestões externas, sem inserir promoções alheias à busca.
- Base VC Entregas visualmente presente; situação operacional consultada no endpoint público de disponibilidade, sem fixar atividade ou implantação na memória. Configuração habilitada não comprova uma entrega real concluída.
- Programação: análise, proposta de patch e plano de testes; listar um arquivo não lê seu conteúdo nem executa comandos.
- Mídia: capacidade declarada exige provider especializado real; modelo de texto não comprova geração de imagem.
- Análises baseadas em evidências, sem inventar saldo, métricas, causalidade ou estado operacional.
- Conhecimento revisado não é fine-tuning nem aprendizagem automática de conversas.

Cada documento lista os arquivos próprios usados como fonte. O campo `verifiedCommit` registra a base da revisão de trabalho: o operador deve conferir as alterações e atualizar para a revisão final de código antes de importar em produção. Informações de implementação não devem ser anunciadas como serviço publicado apenas porque estão neste lote.

## Ponte limitada para a Neural

`app/vitriny-neural/approved-platform-knowledge.js` faz somente leitura. Aceita apenas os dez documentos do manifesto `public-platform-curriculum-manifest.js`, com título/fonte exatos, hash SHA-256 do corpo conferido, autoria de sistema (`updated_by=0`), estado aprovado e validade exata não vencida. Alterações no corpo, título, fonte ou validade exigem novo manifesto revisado. Edição administrativa, rascunho, arquivamento e expiração retiram o documento desta ponte.

Não consulta a memória administrativa inteira, documentos de clientes, saldos, sessões, mensagens, conversas, candidatos web ou lessons experimentais. Mesmo outro documento aprovado não passa pela lista autorizada. A leitura não cria tabelas, não aprova conteúdo e não replica documentos para outro banco. Antes da importação do lote, retorna zero fontes; a ausência de conhecimento não interrompe a skill.

`bootstrap.js` liga essa recuperação ao registry. Antes da chamada ao provider, a Neural seleciona até três fontes relacionadas à tarefa, limitadas a 3.900 caracteres no total. O payload distingue `platformKnowledge` da tarefa e inclui fonte, revisão, validade e identificador de citação. Um campo homônimo enviado pelo solicitante não substitui o conteúdo revisado. O prompt do adaptador informa que tarefas e trechos são dados, não instruções ou autorizações. A ponte acrescenta contexto; não valida semanticamente toda resposta do modelo e não concede novas ferramentas.

A política de execução, autenticação administrativa e separação do Jarvis público continuam existentes. Providers de texto configurados pelo ambiente não passam a gerar imagens. Os estados de modelos e a disponibilidade efetiva devem ser conferidos no serviço; esta alteração não configura chaves, não chama serviços externos e não compra créditos.

## Validação e publicação

`app/scripts/test-vitriny-neural-platform-knowledge.mjs` avalia o material num banco em memória. Verifica 12 perguntas, fonte esperada em primeiro lugar, idempotência, integridade do manifesto, exclusão de dados privados, estado/validade, adulteração de fonte/corpo, substituição de contexto pelo solicitante, leitura sem mutação e recusa de imagem quando só há provider de texto. Exercita também os payloads reais das sete skills: `task` em programação, `prompt` em mídia, `question` em pesquisa, `objective` em crescimento/comércio/ranking e `message` em atendimento. Os providers são simulados e o mock de mídia não cria arquivo; cobertura de recuperação e contrato não é uma medição de precisão generativa.

O utilitário existente `app/scripts/jarvis-curriculum.mjs` conserva os modos `plan`, `evaluate` e `apply`. A opção de relógio injetado nas funções exportadas permite testar datas fixas; a linha de comando continua usando o relógio real. `evaluate` na linha de comando chama o modelo local e deve ser uma rodada deliberada, separada dos testes determinísticos.

Antes de aplicar o lote real: revisar o commit final e as fontes, executar `plan` somente leitura e seguir o procedimento de backup/importação em `docs/JARVIS-ENSINO.md`. `apply` exige a confirmação do operador e backup novo; esta implementação não o executa contra produção. Depois da importação, confirmar o total de documentos elegíveis no status da Neural e testar algumas perguntas novas, registrando síntese, fallback, fontes e erros separadamente.

### Comandos do operador

Na imagem revisada, montar `app/scripts/jarvis-curriculum.mjs` em `/app/scripts/jarvis-curriculum.mjs` e o JSON em `/review/curriculum-ecossistema-20260908.json`, ambos somente leitura. O Dockerfile não inclui esse utilitário no aplicativo publicado. Os comandos abaixo pressupõem esses caminhos; o banco do volume é `/data/vitrinecity.db`.

```sh
node /app/scripts/jarvis-curriculum.mjs plan /review/curriculum-ecossistema-20260908.json /data/vitrinecity.db
node /app/scripts/jarvis-curriculum.mjs evaluate /review/curriculum-ecossistema-20260908.json /data/vitrinecity.db
node /app/scripts/jarvis-curriculum.mjs apply /review/curriculum-ecossistema-20260908.json /data/vitrinecity.db --confirm-reviewed /data/recovery-backups/before-jarvis-ecossistema-20260908-v1.db
```

`plan` é o dry-run: banco somente leitura, sem inferência. `evaluate` também monta o banco real somente leitura, mas usa a rede privada do modelo local `jarvis-model`; são 12 perguntas sequenciais, sujeitas a síntese ou fallback, com checagem de pausa/consulta concorrente. Sua comparação reproduz a memória inicial em banco descartável, não o conjunto completo de documentos de produção; a recuperação no conjunto real deve ser conferida depois. Revisar as respostas, sem tratar a simples presença de termos como acerto semântico.

Executar `apply` sob o lock existente `/tmp/vitrinecity-codex-deploy.lock`, com imagem conferida, rede desabilitada e somente o volume de dados gravável; o utilitário não adquire esse lock sozinho. O alvo do backup precisa ser novo; se já existir, escolher outro nome explícito e preservar o anterior. Se `plan` já mostrar zero operações, não reaplicar.

Num banco que ainda não recebeu este lote, o resultado esperado é dez operações `create`, nenhum `correct` e nenhum registro antigo alterado. A importação adiciona dez documentos aprovados, revisão 2, autoria de sistema e validade 08/10/2026; registra vinte eventos (rascunho/aprovação). Não altera `jarvis_settings`, sessões, contas, permissões, configurações Neural nem tabelas de clientes. Uma nova execução de `plan` deve retornar zero operações. O status administrativo `/api/admin/vitriny-neural/status` deve mostrar `knowledge.approvedAvailable: 10`, `readOnly: true` e `weightTraining: false` quando o código novo estiver ativo e todos os documentos forem elegíveis. Duplicatas ou conhecimento previamente editado são preservados pelo importador: investigar diferenças no plano sem forçar atualização.

## Próxima evolução

Uma indexação semântica, integração de contexto privado por conta ou acesso a arquivos do repositório exige projeto próprio de autorização e avaliação. Não usar a aprovação de candidatos web como promoção automática a fatos públicos. O próximo ciclo de baixo risco é revisar novos fatos próprios, atualizar o manifesto e repetir os testes, preservando as fontes e a validade anteriores.
