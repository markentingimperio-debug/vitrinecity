# Roteamento de geração paga — preparado, ainda sem ativação

`app/content-provider-routing.js` não cria clientes, não lê credenciais, não chama a rede e não altera provedores, servidores ou tarefas existentes. O padrão é desativado. A integração futura deve criar registros apenas para os **novos** trabalhos autorizados, como as novas edições das 11h e 18h; não deve importar, reiniciar ou republicar tarefas antigas. Reconhecer um nome de provedor não significa que sua conta ou API esteja conectada.

## Interface

`createContentProviderRouting({db, adapters, getPolicy, now?})` usa `better-sqlite3` e retorna:

- `createJob({id, request, budgets})`: criação idempotente de um trabalho novo. O mesmo ID com conteúdo, identidade ou teto diferente é rejeitado; repetir o ID nunca reabre uma conclusão ou cancelamento.
- `run(id)`: avança um trabalho. Faz no máximo **uma tentativa de envio pago por chamada** e no máximo **duas tentativas totais por trabalho**, incluindo reservas que chegaram à etapa de envio. Uma alternativa após rejeição comprovada fica pendente para a próxima chamada, respeitando o intervalo mínimo.
- `reconcile(id)`: consulta exclusivamente o provedor e a chave/recibo da tentativa existente. Não muda de provedor nem gera outro trabalho.
- `cancel(id)`: impede novos envios. Não promete cancelar uma operação que o provedor já recebeu; seu recibo tardio e custo são preservados e não reabrem o trabalho.
- `getJob(id)` e `status()`: resumos para uma futura API administrativa. Não expõem prompt, referências, credenciais, corpo de erros nem resultados completos. `hasReceipt` indica existência de recibo, não publicação em rede social.
- `result(id)`: devolve o resultado validado apenas quando o trabalho está concluído; caso contrário devolve `null`. Não expor este método como rota pública sem as permissões do produto.

Nenhum timer é criado. Os intervalos padrão são 60 segundos para repetição/conferência e dois minutos para o claim; chamadas antecipadas não consultam o provedor. As tabelas próprias são `content_routing_jobs`, `content_routing_attempts` e `content_routing_preflights`.

## Política e unidades

Exemplo **sintético**, sem conexão real:

```js
const policy = {
  enabled: false,
  maxAttempts: 2,
  providers: {
    google: {enabled: false, configured: false, revision: 'config-v1'},
    heygen: {enabled: false, configured: false, revision: 'config-v1'},
    abacus: {enabled: false, configured: false, revision: 'config-v1'}
  },
  dailyLimits: {USD: '2.00', 'abacus:credits': '5'}
};
```

Os únicos IDs reconhecidos são `openai`, `google`, `kling_studio`, `heygen` e `abacus`. IDs desconhecidos, duplicados e OpenRouter são recusados. Só adapters explicitamente injetados, permitidos, configurados e compatíveis com a capacidade/referências do trabalho podem entrar no preflight. `revision` é obrigatória para provedores configurados: um identificador opaco de até 128 caracteres, sem segredos. O integrador deve atualizá-la quando mudar credencial, conta, modelo ou configuração de cobrança. A revisão fica persistida antes do envio; se a configuração atual divergir, a tentativa mantém recibo e reserva e não faz consulta nem envio até a configuração original ser restabelecida. Registros antigos sem revisão persistida ficam retidos para conferência, sem inferir uma conta. Este módulo não verifica conexão por conta própria nem contorna restrições de operação manual de um provedor existente.

Valores monetários/unidades são **strings decimais**, sem notação exponencial, com até seis casas. São armazenados como inteiros com escala 1.000.000, sem arredondamento ou conversão cambial. `USD` é compartilhado entre os provedores; outras unidades precisam do prefixo exato do próprio provedor, por exemplo `abacus:credits` ou `heygen:video_seconds`. Créditos de Abacus nunca pagam uma operação Google ou HeyGen. Unidade ausente no teto do trabalho ou no teto diário impede a reserva.

O dia da quota é o dia da autorização do envio em `America/Sao_Paulo`, não a data contábil que o provedor venha a atribuir depois. A soma de reservas e custos conservadores não pode ultrapassar o teto do dia nem o teto do trabalho. Uma aceitação com recibo consome o teto orçado, mesmo que o processamento falhe depois; estes números **não representam uma fatura verificada**. Um resultado incerto retém a reserva sem vencimento automático. Apenas prova de não envio/rejeição anterior à aceitação pode liberá-la.

## Pedido e identidade

```js
router.createJob({
  id: 'nova-edicao-2026-09-13-11h',
  request: {
    capability: 'video', // text, image, video ou speech
    content: {prompt: 'Texto previamente aprovado.', durationSeconds: 8},
    referencedAvatar: {id: 'avatar-aprovado-v1', sha256: 'a'.repeat(64), source: '/owned/avatar.png'},
    voice: {id: 'voz-aprovada-v1', sha256: 'b'.repeat(64), source: '/owned/voz.wav'}
  },
  budgets: {USD: '1.00', 'abacus:credits': '3'}
});
```

O pedido completo, os IDs/hashes de referência, o hash canônico da identidade e os tetos ficam persistidos. Cada alternativa recebe uma cópia imutável do mesmo pedido. Preservar esses hashes protege a identidade **solicitada**; não é uma afirmação de que dois modelos produzem a mesma voz ou aparência. Cada adapter deve validar os arquivos reais, os hashes, a origem autorizada e a capacidade de manter essas referências. Se não consegue manter a identidade, não deve declarar a capacidade nem fazer o envio.

## Contrato obrigatório dos adapters

Um adapter é um objeto confiável do servidor, nunca fornecido pelo visitante:

```js
{
  id: 'google',
  capabilities: {types: ['video'], referencedAvatar: true, voice: true},
  async preflight({jobId, request, identityHash}) { /* sem operação paga */ },
  async submit({jobId, request, identityHash, idempotencyKey, quote, beforeSubmit}) { /* uma operação */ },
  async reconcile({jobId, receiptId, identityHash, idempotencyKey, configurationRevision}) { /* só consulta na configuração vinculada */ }
}
```

`preflight` é estritamente não faturável e não pode iniciar uma geração. Para aprovar:

```js
{status: 'ready', configured: true, allowed: true, identityHash,
 quote: {unit: 'USD', amount: '0.25', upperBound: true, validUntil: Date.now() + 60000}}
```

A cotação precisa representar um **teto que o adapter consegue impor à operação**, não uma estimativa aberta; validade máxima de dez minutos. Seu valor/unidade, o claim e a intenção de envio são persistidos na mesma transação imediata antes de `submit`. O adapter deve usar os parâmetros cotados e a chave idempotente recebida, validar o destino oficial e executar `beforeSubmit()` **sincronamente imediatamente antes de qualquer requisição paga**, inclusive depois de seus próprios `await`. Se a função retornar `false`, não deve enviar nada.

Na reconciliação, o adapter deve manter a conta e configuração correspondentes à `configurationRevision` recebida durante toda a consulta; não pode trocar silenciosamente credenciais depois de um `await`. O roteador verifica a revisão antes da chamada, mas não gerencia credenciais nem a implementação interna do adapter.

Os resultados normalizados são:

| Resultado | Forma | Consequência |
| --- | --- | --- |
| Indisponível antes de envio | `{status:'unavailable', notSubmitted:true}` | Pode selecionar alternativa compatível; libera apenas uma reserva que comprovadamente não foi enviada. |
| Recusado antes de aceitação | `{status:'rejected_before_acceptance', confirmed:true, notAccepted:true}` | Libera a reserva, agenda uma alternativa dentro do limite de tentativas. Não usar para simples ausência de registro numa consulta. |
| Aceito/processando | `{status:'accepted' /* ou pending */, receiptId, identityHash}` | Mantém o mesmo provedor e consome o teto conservador. |
| Concluído | `{status:'completed', receiptId, identityHash, output:{...}}` | Entrega resultado somente com recibo, identidade correspondente e objeto de saída válido. |
| Falha após aceitação | `{status:'failed', receiptId, identityHash}` | Terminal, sem gastar outra tentativa em outro provedor. |
| Recusa de política | `{status:'policy_refused', confirmed:true, notAccepted:true}` | Terminal, nunca tenta contornar a recusa. Sem prova pré-aceitação, o custo continua retido. |
| Incerto | `{status:'unknown'}` | Retém provedor, chave e custo; somente reconciliação. |

Timeout após envio, HTTP 5xx, corpo inválido e ausência de recibo **nunca** autorizam fallback, mesmo que haja uma indicação contraditória de rejeição no corpo. `unavailable` com `notSubmitted:true` e um `receiptId` também é contraditório: bloqueia o preflight ou mantém incerta a tentativa já reservada, sem liberar custo nem selecionar outro provedor. Mensagens brutas de erro, tokens e URLs de credenciais não entram nos resumos. Uma consulta que não encontrou um trabalho não prova que ele não foi aceito. Se o provedor não oferece consulta pelo recibo/chave, o adapter deve retornar `unknown` e exigir conferência humana.

Um processo interrompido durante preflight pode retomar essa consulta sem custo após o lease. Um processo interrompido depois da intenção de envio fica incerto; não libera quota nem repete o POST. A resposta de uma consulta cujo claim já foi substituído não modifica a tentativa nem limpa o claim da consulta atual. Recibos tardios do envio original são aceitos apenas para a tentativa vinculada e não substituem uma conclusão posterior ou ressuscitam um cancelamento. A implementação não contém ação administrativa para apagar essa proteção.

## Validação

`node --test scripts/test-content-provider-routing.mjs`

Testes usam adapters falsos e SQLite isolado, inclusive duas conexões concorrentes. Nenhum teste usa conta, rede ou geração paga real. Antes de integrar adapters reais, validar seus formatos oficiais de recibo, cotação, limites, capacidades de referência, política de rejeição e consulta sem nova cobrança. Ativação e agendamento ficam para a integração separada do servidor.
