# Neural: encaminhamento de conteúdo e diagnóstico do modelo

## Correção implementada, ainda isolada

Continuação explícita do pedido de correção, após a avaliação descrita em
[NEURAL_RESPONSE_CORRECTION_20260914.md](NEURAL_RESPONSE_CORRECTION_20260914.md).
Não representa liberação do modelo para autonomia, conteúdo público ou deploy.

O formulário **Converse com uma habilidade** convertia qualquer pedido de
marketing em `growth.diagnose`. Agora exige a seleção explícita de uma das seis
ações existentes. Não há inferência de intenção por palavras-chave. A seleção
não executa chamadas; abrir a página também não. Entrada inválida é rejeitada.
O seletor não altera o chat de tarefas `/tasks`, que tem outro fluxo.

Além disso, `growth.content-plan` recebia `requireMeasurementPlan: true` e uma
instrução de experimento, métrica e condição de parada. A habilidade agora
desativa essa exigência somente para conteúdo, e o provedor pede a entrega no
formato solicitado. As outras cinco ações mantêm a orientação de medição.
Proteções de execução, orçamento, qualificação, conteúdo não confiável e
contrato JSON de tarefas permanecem. Instruções de texto não garantem veracidade.

## Evidência de código

- Regressão de instrução reproduzida antes da correção e aprovada depois.
- Sete novos testes UI/habilidade: ação escolhida chega à capacidade correta,
  as seis opções, validações, ausência de envio na abertura/seleção, outras áreas,
  solicitação única em andamento e renderização de saída não confiável como texto.
- Testes incluídos na cadeia `test:neural:readiness`, chamada por `test:neural`.
- `test:neural` completo aprovado localmente; depois da integração do teste novo,
  `test:neural:readiness` teve 46/46 aprovados. Revisão independente sem defeito
  funcional identificado. `git diff --check` limpo.
- Na revisão anterior `58a0cda`, os três checks GitHub passaram. Isso não é
  declaração de aprovação do CI de um commit posterior.

## Diagnóstico de instalação e geração

O SHA256 do arquivo instalado Qwen3-1.7B-Q8_0 é
`061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a`, igual ao
[arquivo oficial](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/blob/main/Qwen3-1.7B-Q8_0.gguf).
`/apply-template` confirmou os papéis system/user e quebras de linha corretas.
Não foi encontrada evidência de arquivo corrompido ou perda da mensagem system.

Duas configurações recomendadas pela Qwen foram experimentadas em dois casos
de desenvolvimento já conhecidos. Foram quatro chamadas, não uma qualificação:
non-thinking (.7/.8/top-k20/min-p0, 512 tokens) e thinking (.6/.95/top-k20/min-p0,
2048 tokens). A mudança conjunta de modo, amostragem e orçamento impede atribuir
causalidade a um único parâmetro. Não foram adotadas na configuração da aplicação.

Thinking melhorou a ressalva sobre custos desconhecidos no cálculo de margem,
mas ainda interpretou o pedido em separação como situação pessoal do cliente.
Non-thinking manteve alegação falsa de envio e conclusão indevida de lucro líquido.
Fonte dos parâmetros: [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B).

## Comparação controlada do encaminhamento

Três pedidos sintéticos definidos por agente independente antes da execução,
três seeds (11, 29, 47) por versão, 18 chamadas sequenciais. Mesmos dados,
modelo, temperatura .2, orçamento 400 e ausência de thinking. Ordem das versões
alternada. Critérios e IDs dos testes não foram enviados ao modelo. O conjunto
é diagnóstico editorial, não substitui o benchmark de 20 casos nem concede
qualificação. Nenhum peso foi treinado.

| Caso | Antes | Depois |
| --- | --- | --- |
| Legenda em até duas frases, somente fatos fornecidos | 0/3 | 3/3 |
| Três pautas editoriais distintas | 2/3 com ressalvas | 0/3 |
| Texto de produto em duas linhas, sem benefícios inventados | 0/3 | 0/3 |

As legendas anteriores traziam metas/experimentos extras; o candidato entregou
as duas frases. Os calendários antigos aprovados tinham pautas distintas, mas
omitiam os detalhes práticos; os critérios prévios não exigiam repetir todos.
Os calendários novos repetiram pautas ou introduziram benefícios/qualidade não
confirmados. Nos três textos de produto novos, o modelo trocou capa de almofada
por almofada, omitiu enchimento não incluso e inventou benefícios. Logo, a
correção do encaminhamento não resolveu a confiabilidade factual.

| Medição | Antes (9 chamadas) | Depois (9 chamadas) |
| --- | --- | --- |
| Duração somada | 100.970 ms | 78.726 ms |
| Tokens de entrada | 4.128 | 4.605 |
| Tokens de saída | 1.191 | 808 |
| Tokens totais | 5.319 | 5.413 |

Todos os recibos completos, todas as respostas `stop`. Menor duração não
significa menor consumo total nem garante desempenho futuro. A revisão foi por
agente, não aprovação humana; não altera `semanticQualityVerified` nem políticas.

## Evidências e produção

Artefatos guardados no `outputs` da tarefa operacional:

- `neural-generation-probe-20260914.mjs` e `neural-generation-probe-results-20260914.jsonl`.
- `neural-content-comparison-20260914.mjs` e `neural-content-comparison-results-20260914.jsonl`.
- Archives baseline/candidate e logs `neural-content-tests-windows-20260914.log`
  e `neural-content-readiness-20260914.log`.

O manifesto preserva hashes dos três arquivos executados, modelo e imagem do
servidor. Baseline `58a0cda3f23a8eb93b52e4c390376113a1342faf`. O arquivo growth
do candidato foi normalizado de CRLF para LF após empacotar; igualdade de código
ignorando somente quebras de linha foi verificada. Provedor e contrato coincidem.

Às 13:42:11 UTC, produção em `dd5d1077db45dc2c014d154f5e8d46a0b13f693c`, sem
alterações rastreadas; app e modelo saudáveis, sem reinício, health público e
interno HTTP 200. Container de comparação encerrado, lock liberado. Nenhum
volume ou dado removido, credencial alterada, envio ou publicação.

Após esse resultado, o administrador pediu novamente a correção imediata no
contexto da pergunta de autorização para avaliar um modelo maior. Foi iniciada
somente a preparação isolada do Qwen3-4B-Instruct-2507-Q8_0: sem substituição do
modelo atual, API paga, alteração de orçamento, qualificação ou autonomia em
produção. A avaliação foi concluída sem promoção; resultados e encerramento em
[NEURAL_MODEL4B_EVALUATION_20260914.md](NEURAL_MODEL4B_EVALUATION_20260914.md).
