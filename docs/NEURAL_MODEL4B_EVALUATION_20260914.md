# Neural: avaliação isolada do modelo local 4B

## Resultado: não promovido

O administrador reiterou o pedido de correção imediata no contexto da avaliação
isolada de um modelo maior. Esta rodada não autorizou substituir o modelo em
produção, contratar API, aumentar orçamento nem liberar execução autônoma.

A correção de encaminhamento de conteúdo está em `3ee5976cf9e4964be97eb7c238360296a838aff4`,
na [PR 182, ainda em rascunho](https://github.com/markentingimperio-debug/vitrinecity/pull/182).
Os três checks dessa revisão (`neural-tests`, `production-dependencies` e
`isolated-tests`) passaram; consulta independente às 13:52:11 UTC. Isso comprova
os testes de código, não a qualidade semântica do modelo nem um deploy.
A suíte local `test:neural:readiness` foi repetida no encerramento: 46/46 testes
aprovados. Depois de `3ee5976`, esta rodada alterou somente documentação.

## Modelo e isolamento

- Modelo: Qwen3-4B-Instruct-2507, conversão Q8_0 de ggml-org.
- Arquivo: `qwen3-4b-instruct-2507-q8_0.gguf`, 4.280.403.520 bytes.
- SHA256 verificado: `ae916ede1c010a26955ee8ae2e908bf8815a3f135ec860439ab924701c69d5f1`.
- Download fixado na revisão `e92aed4`; [artefato e hash publicados](https://huggingface.co/ggml-org/Qwen3-4B-Instruct-2507-Q8_0-GGUF/blob/main/qwen3-4b-instruct-2507-q8_0.gguf).
- Servidor llama.cpp: `sha256:c363a67c08cb74cc9099590d88cd9948ee0c464cca03db40f9cb5c19d5376da9`.
- Código avaliado: archive de `3ee5976`, SHA256 `ec23445b2dfeecdb16dd4c1d43d0b7c6246de430c97537476329b0881b45a8df`.
- Rede Docker interna própria, sem portas publicadas e sem acesso à rede de
  produção. Apenas o modelo e um chamador temporário estavam nessa rede.
- Modelo: limite de 1,5 CPU/6 GiB, contexto 4.096, um slot, filesystem somente
  leitura, somente o arquivo de pesos montado. Chamador: 0,5 CPU/1 GiB.
- Sem volumes/banco/ambiente/credenciais da aplicação e sem fallback remoto.
  Chamadas sequenciais protegidas pelo lock do piloto, usando dados sintéticos.

O modelo original e a aplicação não foram reiniciados nem reconfigurados.

## Triagem semântica: três casos, três repetições

Seeds 11, 29 e 47; temperatura 0,2, sem thinking, parâmetros restantes do mesmo
servidor. Orçamento de 512 tokens para suporte/comércio e 400 para conteúdo.
São casos de desenvolvimento já conhecidos, não um conjunto cego nem o benchmark
de qualificação. Critérios e respostas esperadas não foram enviados ao modelo.

| Critério | Resultado | Observação |
| --- | --- | --- |
| Suporte fiel ao status, sem execução ou compromisso inventado | 0/3 | Todos informaram que não enviaram, mas prometeram acompanhamento/contato futuro sem confirmação e mudaram o status para uma ação futura. |
| Deduzir produto, comissão e frete, sem confundir sobra com lucro líquido | 3/3 | R$2 correto; custos ausentes explicitados. Uma resposta acrescentou outra medida antes de taxas/frete, desnecessária e potencialmente confusa. |
| Produto em duas linhas, fatos essenciais completos e sem novos benefícios | 0/3 | Todas omitiram capa de almofada e enchimento não incluso, acrescentando pureza, maciez, conforto ou segurança. Uma também não cumpriu as duas linhas. |

A revisão independente foi feita por agente. Não houve aprovação humana nem
mudança de `semanticQualityVerified`. O resultado 3/9 não é score de qualificação.
As nove chamadas retornaram `stop`, sem truncamento: uma resposta completa pode
continuar incorreta. O modelo maior melhorou o cálculo em relação à rodada 1.7B,
mas isso não sustenta sua promoção geral.

## Duas hipóteses de instrução examinadas e rejeitadas

Cada diagnóstico repetiu o mesmo caso de produto, com as mesmas três seeds,
fatos, capacidade, temperatura e orçamento da triagem. Não foram adicionadas
respostas-modelo, listas de palavras do teste ou fatos ao pedido.

1. **Pedido separado de contexto:** somente `growth.objective` saiu do JSON
   para prosa no mesmo papel user; o restante permaneceu como contexto JSON.
   Resultado: 0/3. Persistiram omissões e qualidades inventadas. Não aplicado
   ao runtime, a mensagens de clientes ou ao contrato de arquivos `draft-v1`.
2. **Retirada da regra antirrepetição:** o JSON original foi preservado e apenas
   a frase genérica “Não repita o pedido nem estas regras.” foi removida do
   system na cópia enviada pelo chamador diagnóstico. Resultado: 0/3, com os
   mesmos tipos de omissão e invenção. O prompt de runtime não foi alterado.

Essas tentativas não demonstram que a representação do pedido seja a causa da
falha. A investigação dessas duas hipóteses foi encerrada. Não foram rebaixadas
rubricas nem adicionados filtros específicos para fazer esse produto passar.

| Rodada | Chamadas | Tempo somado | Tokens de entrada | Tokens de saída |
| --- | --- | --- | --- | --- |
| Triagem | 9 | 296.606 ms | 3.843 | 878 |
| Pedido separado de contexto | 3 | 28.493 ms | 1.527 | 79 |
| Sem regra antirrepetição | 3 | 43.865 ms | 1.443 | 81 |

Recibos completos, nenhum timeout. Os tempos incluem efeitos de cache/carga e
não são promessa de latência de atendimento. Não houve cobrança de API; foram
usados recursos da VPS existente. O custo de energia/hospedagem não foi medido.

## Limite de aceitação e próximo trabalho

A rodada completa de 20 casos e os rascunhos de site/roteiro/imagem **não foram
executados para este modelo**. A triagem já falhou em fidelidade básica e não
justificava avançar até uma promoção. Não foi criada/importada qualificação.
O candidato não responde a clientes e não foi conectado ao supervisor.

Os defeitos determinísticos de encaminhamento e tratamento de respostas estão
corrigidos e testados na branch. O bloqueio remanescente é obter respostas
confiáveis sob critérios semânticos, não conectividade. Uma próxima avaliação
precisa de escopo/modelo definidos e casos independentes; nenhuma promessa de
confiabilidade geral pode ser deduzida de mais memória, mais parâmetros, uma
resposta boa ou uma média lexical. Não habilitar tarefas para contornar o gate.

## Encerramento e produção

Às 14:04:02 UTC de 14/09/2026, o container candidato
`vitrinecity-neural-model4b-eval-20260914` estava **encerrado**, após identificação
de sua imagem, montagem exclusiva dos pesos e rede própria. O arquivo de modelo,
artefatos e evidências foram preservados; nada foi apagado.

Produção continuava no commit `dd5d1077db45dc2c014d154f5e8d46a0b13f693c`, sem
alterações rastreadas. App e modelo original saudáveis, com os mesmos horários
de início: 13/09 às 16:02:50 UTC e 07/09 às 15:44:21 UTC, respectivamente.
Saúde pública HTTP 200 e saúde interna HTTP 200 **dentro do container app**.
Uma tentativa no localhost:3000 do host retornou conexão recusada; não foi usada
como prova de falha da aplicação. RAM disponível após encerramento: 8.569 MiB.
O container `vitrinecity-codex-executor-1` foi preservado.

Sem deploy, mudança de `.env`, credencial, cobrança, orçamento, dado de cliente,
mensagem, publicação, transação ou execução de código gerado.

Evidências locais, em `outputs` da tarefa operacional:

- `neural-model4b-evaluation-20260914.mjs` e `neural-model4b-screen-20260914.jsonl`.
- `neural-request-boundary-probe-20260914.mjs` e `neural-model4b-boundary-20260914.jsonl`.
- `neural-echo-rule-probe-20260914.mjs` e `neural-model4b-echo-20260914.jsonl`.
- Archive `neural-model4b-source-20260914.tar.gz` do código avaliado.

As instruções de regressão e avaliação orientaram a reprodução antes da mudança,
isolamento, três repetições e revisão independente; não substituíram os gates da
aplicação por um parecer do próprio autor.
