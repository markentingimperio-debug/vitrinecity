# Retrato narrado da Lia no estúdio

`app/live-lia-media.js` prepara um clipe privado a partir de um texto que o administrador já aprovou. A mídia usa um retrato estático, narração sintetizada e legendas do próprio texto. Não faz sincronização labial, não representa vídeo de uma pessoa real e não inicia transmissão. O quadro informa **“Lia · assistente com IA”** e **“Retrato ilustrativo com narração”**.

## Identidade visual preservada

- Original autorizado: `lia-abacus-v1-original.png`, copiado sem alteração para `app/public/assets/lia/lia-abacus-v1-original.png`.
- Dimensões: 1536 × 2048; 3.722.313 bytes.
- SHA-256: `6c4fa137cef11bdb1ad9a5e0602fa92d1a3935d75bcecc22d8902a210c747aa2`.
- O adaptador confere o hash antes da preparação e nos pontos de revalidação. O enquadramento no vídeo não altera o arquivo original. Trocar retrato, voz, modelo, texto ou oferta exige outra resposta aprovada; o mesmo identificador não sobrescreve o clipe anterior.

## Configuração e chamada

```js
const media = createLiveLiaMedia({
  env: process.env,
  liveStudioDir: process.env.LIVE_STUDIO_DIR,
  publicDir,
  reserveDailyOperation: input => liveLia.reserveDailyOperation(input)
});
// Somente a ação administrativa explícita “Preparar voz”.
await media.prepare({id, text, offer, canRun});
```

`id` é UUID v4. O texto é exato, sem HTML, de 1 a 600 caracteres. `offer` é `null` ou `{id,title,url,kind}` vindo do catálogo revalidado pelo chamador. Só são aceitos destinos públicos conhecidos da VitrineCity; nenhum recurso remoto é usado na composição. Para `kind: 'affiliate'`, o quadro e o manifesto recebem a indicação fixa **“Link de afiliado · podemos receber comissão”**.

`canRun()` deve ser síncrono e confirmar pausa global, aprovação/revisão exatas e fonte/oferta ainda válidas. `reserveDailyOperation({id,textHash,model,voice})` também é síncrono e deve reservar uma operação durável, única por resposta. O serviço administrativo fornece essa reserva e o limite diário de voz, inicialmente **3 operações por dia**. Uma resposta já pronta passa pela conferência do hash antes de qualquer nova reserva.

O provedor é OpenAI direto com `OPENAI_API_KEY`. Variáveis opcionais: `LIVE_LIA_TTS_MODEL=gpt-4o-mini-tts` e `LIVE_LIA_TTS_VOICE=coral`. A seleção de voz solicita português brasileiro, sem acrescentar palavras ao texto. A documentação admite português e instruções de estilo; isso não substitui a revisão auditiva da primeira voz real. [Guia oficial de voz](https://developers.openai.com/api/docs/guides/text-to-speech), [referência de geração de fala](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

`config.configured` indica configuração presente, não uma chamada bem-sucedida ao provedor. O endpoint de fala não fornece aqui recibo de custo monetário: `costUsd` permanece **null**, jamais um zero presumido. Preparar voz pode gerar cobrança na conta existente; não há assinatura adicional de avatar neste fluxo.

## Arquivos e recuperação

Destino final: `LIVE_STUDIO_DIR/lia-answers/<id>.mp4` e `<id>.json`. O resultado de `prepare()` contém `{file,duration,sha256,bytes,previewUrl}`. A URL é exclusivamente administrativa: `/api/admin/live-studio/lia/answers/:id/media`.

O manifesto contém `answerId`, `file`, `sha256`, `bytes`, `duration`, `width:720`, `height:1280`, vínculo do conteúdo, versão e crédito de afiliado quando aplicável. Não contém a chave nem o texto integral. A saída exige H.264/AAC, no máximo 60 segundos e 30 MiB. Narração acima de 60 segundos fica para revisão; não é cortada silenciosamente nem refeita automaticamente.

`lia-answers/preparation.lock` limita a preparação a **uma por vez em todo o volume**, antes de reservar quota ou pedir voz. Um encerramento abrupto deixa a trava para conferência administrativa, sem recuperação por prazo presumido. Há também uma trava individual para a renderização. A implantação não deve apagar travas ou recibos para liberar uma nova cobrança.

A intenção imutável é gravada e sincronizada antes do único POST de voz. Timeout, resposta inválida ou perda do recibo mantêm o estado incerto e impedem outro POST com aquele identificador, inclusive após reinício. Voz recebida e conferida pode ser renderizada localmente novamente após uma falha conhecida do encoder; isso não repete a chamada paga. Pausa ou alteração durante uma chamada preserva o resultado recebido, sem mudar aprovação, fila ou transmissão.

As intenções e o áudio ficam privados em `lia-answers/intents/<id>/`, diretórios 0700 e arquivos 0600. Quando o aplicativo executa como root, o diretório de saída e os dois arquivos finais são atribuídos ao uid/gid 10001 do worker OBS (0750/0640). Isso permite leitura do resultado sem compartilhar o áudio intermediário ou as intenções. Instalações que executam com outro usuário precisam conceder o acesso de leitura equivalente no volume.

FFmpeg/ffprobe são executados com argumentos locais, sem shell e sem URLs de entrada, com dois threads no encoder e limite de 120 segundos. O worker faz uma conferência independente do manifesto, hash, codecs e duração antes de exibir a fonte.

## Validação desta entrega

`node --test scripts/test-live-lia-media.mjs`, dentro de `app`: **22 testes passaram**. Cobrem reserva anterior ao POST, concorrência entre respostas, reinício, retorno ambíguo, mudanças de identidade/texto/oferta, pausa, hashes, limites, erro do encoder, disclosure e permissões do worker. As respostas de rede e a execução de mídia são injetadas apenas nos testes; não existe variável de ambiente que ative um provedor falso em produção.

A fixture de áudio é um WAV PCM válido de tom sintético. A saída de FFmpeg dessa suíte é simulada; a prova de decodificação e a inspeção visual do clipe real são uma etapa separada do operador, com FFmpeg instalado e áudio sintético explicitamente identificado. Esta entrega não chamou a API paga nem transmitiu vídeo. A primeira narração real deve ser ouvida e aprovada antes de exibição ao público.
