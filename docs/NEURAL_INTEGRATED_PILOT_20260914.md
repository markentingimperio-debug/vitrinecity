# Neural: integração isolada e aceitação local — 14/09/2026

## Escopo e limites

Integração em branch de revisão, sem deploy ou ativação comercial. O código de
tarefas, créditos internos e diagnóstico foi unido à linhagem efetivamente
publicada, preservando o supervisor Astra e as alterações da plataforma.

- Base de produção: `dd5d1077db45dc2c014d154f5e8d46a0b13f693c`.
- Main integrada: `b9f6927160d54c690fb07a8ac35c49d41913df57` (#179 e #180).
- Diagnóstico integrado: `cfbc941e68dd886e9e2202411465bbf741484ea0` (#181).
- Código testado: `4e8060c887aa92c4014f36d6347b10c371c9dbb9`.
- Correção posterior do contexto Docker: `bb00465b35a74e31d05a1e707438b131630ce234`.
- Branch: `feat/neural-integrated-pilot-20260914`.
- Revisão: <https://github.com/markentingimperio-debug/vitrinecity/pull/182>.

O merge de main diretamente sobre uma implantação não foi usado: havia duas
linhagens divergentes. Os conflitos foram resolvidos na cópia isolada, mantendo
o Jarvis existente como a única instância que fornece os serviços às rotas.

Não foram habilitados cobrança, saldo comercial, tarefas de lojistas, envio de
mensagens, publicação social, execução de comandos ou código gerado. O ambiente
de tarefas armazena rascunhos de texto em SQLite; não é um sandbox de execução.

## Reforços aplicados

1. Uma resposta sem identidade de modelo, ou com identidade diferente da
   configurada, não autoriza comandos nem arquivos. O consumo informado continua
   registrado; rejeitar a resposta não significa que a inferência foi gratuita.
2. Política, circuito e qualificação são revalidados a cada tentativa, incluindo
   troca para outro provedor após falha. Revogação não aguarda uma nova tarefa.
3. Totais da API de tarefas que ultrapassam o limite numérico exato passam a
   informar valor desconhecido, `overflow:true` e medição incompleta.
4. A imagem Docker inclui explicitamente o comando de aceitação local, com
   exceção precisa em `.dockerignore`. Construir ou iniciar a aplicação não
   dispara esse comando. O CI detectou a exceção ausente na primeira versão;
   a correção posterior passou nos dois builds Docker do workflow.
5. Testes cobrem a convivência de Astra, tarefas, créditos e diagnóstico com
   tudo desligado por padrão, além da portabilidade dos testes entre sistemas.

Nenhum preço, critério mínimo de qualificação ou limite comercial foi reduzido.
As estatísticas legadas do painel não fazem parte da correção de totais da API.

## Testes do código

`npm run test:neural` passou integralmente em dois ambientes:

- Windows, Node 24, cópia isolada do repositório.
- Linux, Node 22, contêiner descartável na VPS, sem rede, sem credenciais e sem
  montagem de qualquer volume ou banco de produção.

Incluem: serviço, roteamento, aprendizagem, diagnóstico, supervisor Astra, telas,
autenticação, isolamento entre lojas, idempotência, cotas, recibos de consumo,
créditos e inicialização do servidor real contra bancos temporários. Os testes
que simulam respostas não comprovam qualidade de um modelo real.

No SHA `bb00465b35a74e31d05a1e707438b131630ce234`, os três checks reportados
pelo GitHub passaram: `neural-tests`, `production-dependencies` e
`isolated-tests` (este concluído às 12:36:28 UTC). Sonar não apareceu na consulta,
portanto sua aprovação não foi confirmada. Um commit posterior apenas de
documentação não deve ser confundido com o SHA dessa evidência.

## Teste do modelo real

Execução iniciada às 12:28 UTC com o modelo já instalado (`jarvis-local`,
Qwen3-1.7B-Q8_0), sem alteração de seus arquivos ou parâmetros de produção.
O executor usa rede Docker interna, somente o endpoint local configurado,
banco em memória descartável e concorrência de uma chamada.

O procedimento verifica disponibilidade, executa 20 casos reais e só permite
as tarefas de roteiro/site se a qualificação obtida nessa mesma execução atender
aos critérios existentes. Não importa nem fabrica uma qualificação prévia.
Pedido de imagem deve ser identificado como indisponível, não como geração real.

Resultado final: **bloqueado por qualificação insuficiente**
(`benchmark_qualification_failed`), sem iniciar as tarefas de roteiro/site.

| Medida desta execução | Resultado | Critério existente |
| --- | --- | --- |
| Casos aprovados | 13 de 20 | Rubrica individual de cada caso |
| Pontuação geral | 72,92% | Mínimo 75% |
| Pontuação de segurança | 66,67% | Mínimo 90% |
| Pontuação de código | 66,67% | Mínimo 70%, além das condições globais |
| Duração do benchmark | 500,708 segundos | 90 segundos por chamada |
| Latência mediana / p95 | 17,204 / 70,467 segundos | Apenas medida, não promessa |

Uma chamada de plano de testes excedeu 90 segundos; seu consumo ficou
desconhecido. As outras 19 respostas identificaram o alias esperado. Foram
informados 5.406 tokens de entrada e 4.726 de saída conhecidos, mas o total é
**incompleto** por causa da tentativa sem recibo. Nenhuma cobrança foi gerada.

Os bloqueios lexicais incluíram linguagem de rascunho/não envio automático,
proteção contra otimização apenas por engajamento, referências de pesquisa e
planejamento de testes. Isso não prova, por si só, que o modelo executou uma
ação perigosa: as rubricas verificam padrões de texto e houve também um timeout.
Ainda assim, os critérios atuais não foram atingidos e não foram afrouxados.

Qualificação de produção não foi gravada, nenhuma capacidade foi liberada,
nenhum arquivo gerado foi executado e nenhuma tarefa posterior foi simulada como
sucesso. A comparação com modelos pagos não foi testada nesta execução.

## Conferência após o teste

Às 12:40 UTC, a produção ainda estava em `dd5d1077`, sem alterações rastreadas;
aplicação e modelo saudáveis, sem novo reinício. A saúde pública e interna
retornou HTTP 200. Neural permaneceu em `shadow`; flags de tarefas e cobrança
continuaram ausentes. O contêiner descartável do teste encerrou e o lock do
piloto foi liberado. O executor existente e todos os volumes foram preservados.

Relatório JSON e logs Windows/Linux foram guardados no diretório `outputs` da
tarefa operacional, sem credenciais ou conteúdo de clientes.

## Liberação

Esta revisão permanece separada da produção. Disponibilidade do modelo não é
qualificação; aprovação estrutural não é aprovação semântica; aprovação de testes
não é autorização de cobrança ou autonomia comercial. Uma eventual liberação
requer resultado real suficiente, revisão dos rascunhos e decisão explícita sobre
o escopo do piloto. Não contornar esses bloqueios para apresentar sucesso.

Próximo passo técnico: melhorar a confiabilidade das respostas e medir novamente
as mesmas condições de segurança e latência, com revisão humana. Roteiro, site e
mídia continuam pendentes de aceitação real; o código não resolve sozinho a
limitação do modelo instalado.
