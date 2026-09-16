# Reaproveitamento editorial em Web Stories

## Oração das 07h

`prayer-web-story-bridge.js` acrescenta uma fonte ao catálogo do estúdio existente:
`prayer-video:AAAA-MM-DD:07`. Não cria outro publicador, timer, artigo companion,
cliente de IA ou cobrança. O grupo atual do estúdio é `trends` (conteúdo próprio);
isso não representa origem Google Trends.

A fonte só aparece automaticamente para o dia atual no Brasil, após existir o
`ready.json` do vídeo curto. Não há recuperação automática de dias anteriores.
O horário de publicação e o limite continuam sendo os configurados na rotina de
Web Stories. `07` identifica o conteúdo de origem, não um novo horário de execução.
A habilitação, a pausa global, a quota consumida, as categorias selecionadas e os
demais requisitos de configuração do estúdio permanecem obrigatórios.

O vídeo curto é um trecho da oração. Para produzir páginas úteis sem preencher
espaço artificialmente, a Story usa a oração **integral** da mesma edição pública,
incluindo reflexão e pergunta final. As frases são distribuídas sem alteração,
com capa, arte existente e botão para `/oracao-do-dia.html?dia=AAAA-MM-DD#oracao`.
Não cria uma segunda página quase igual ao artigo/oração já existente.

## Evidência, moderação e idempotência

- A data, formato, caminho real, URL pública, roteiro completo, bytes e SHA-256
  devem coincidir com o `ready.json`. O arquivo MP4 é verificado por hash; a
  inspeção de codec pertence ao gerador que produz esse recibo, não é simulada
  pela ponte. Arquivos ou links arbitrários não são admitidos.
- A arte local `jesus-areia-v1.png` tem SHA-256 fixo
  `03789c08892c0ef3d46268efd7fe61ce69c50af63ffc6f0e9578f75be7c8ec90`.
  É a ilustração de Jesus feita de areia já usada no vídeo. Cada página informa
  **Ilustração IA**. Substituir a arte exige revisão e atualização explícita.
- O hash da fonte vincula texto integral, data/slot/formato, vídeo, roteiro,
  imagem e destino. Mudança ou retirada torna a Story anterior indisponível no
  site e no catálogo; seu histórico não é apagado.
- O hash de conteúdo integral, sem a data, reconhece repetições do calendário
  editorial e conserva o primeiro endereço canônico. Uma Story da mesma fonte
  ou destino também impede a criação de outra.
- Edição, publicação ou retirada manual é preservada. Uma retenção de revisão
  anterior não é convertida em aprovação por este reaproveitamento.
- O método é `editorial-local`, responsável técnico `source-editorial-check`,
  não “revisado pela IA”. A autorização vale somente para a transcrição integral
  da coleção editorial pública e a arte conferida. Texto incompleto, fonte
  divergente ou menos de dez páginas úteis fica fora da automação.
- O `generateAndPublish` existente continua validando todas as páginas,
  imagens, limites de leitura, origem e direitos declarados. A transação final
  revalida pausa, revisão, fonte e concorrência. As tentativas e publicações
  usam as mesmas tabelas e quota do estúdio; não há orçamento paralelo.
- Não são inseridos anúncios comerciais automaticamente na oração. A política
  de promoção do renderer mantém a exclusão religiosa.

## Conferência e publicação pelo fluxo atual

O painel de Web Stories lista a fonte acima. Uma rodada autorizada da rotina
publica somente quando há quota e a fonte passa as condições. Se já existe uma
edição manual, abra essa edição. Para um lote editorial manual, use o importador
`createManualDraft` existente, com autoria explícita e revisão pela prévia; ele
não publica por si só. Não zere tentativas antigas nem aumente a quota para
contornar uma retenção.

Em 12/09/2026, o texto completo produz 11 páginas, sem nova chamada de IA. A
fonte permanece a oração datada e o vídeo curto real; o resultado local de teste
não é prova de publicação em produção.

## Contrato para conteúdos das 11h e 18h

Esses slots ainda não são admitidos pela ponte. Uma futura extensão deve fornecer
uma fonte efetivamente publicada/aprovada, identificação canônica estável de
conteúdo/dia/slot, roteiro completo, imagem local com direitos/revisão, destino
público, hash do conteúdo aprovado e recibo do asset real. O catálogo deve poder
reler essa fonte e verificar sua versão antes de cada publicação.

O adaptador de fonte adicional usa `get(key)`, `list(options)`, `eligible(source)`
e `generate(source, {signal, isCurrent, buttons}, assets)`. Uma fonte reconhecida
que falhe não pode cair na IA paga. A fonte deve declarar `reuseBinding` e
`facts.reuseContentHash`; o resultado entra no mesmo serviço de validação e
publicação. Não basta um horário, uma ideia, um vídeo sem aprovação ou uma URL.

## Testes offline

Em `app`:

```
node --test scripts/test-prayer-web-story-bridge.mjs scripts/test-web-story-daily.mjs scripts/test-web-story-publication.mjs scripts/test-ecosystem-catalog.mjs
```

Os testes usam SQLite temporário, imagens locais reais e recibos de mídia
sintéticos. Comprovam publicação/URL no servidor local, preservação integral do
texto, zero chamadas de IA, concorrência, quota, pausa durante validação,
alteração de fonte, retenção manual e repetição do calendário. Não publicam em
produção nem usam credenciais.
