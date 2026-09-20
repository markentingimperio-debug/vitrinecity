# LIA Vídeo no chat: voz ElevenLabs, sincronização e edição

Estado: extensão em revisão. O planejador foi adicionado; o executor e o chat ainda não estão conectados a ele. Não há deploy ou chamada paga nesta entrega.

Base examinada: PR #217, c0d25dad6699c0716236840e8f8eedb83ab00527, sobre PR #216, f7e2df42e92d47b0b1da97bd973c23c3ee94b779.

## Fluxos solicitados

**Narração de produto:** texto aprovado -> ElevenLabs -> medir a fala -> organizar cenas -> edição FFmpeg -> conferir -> MP4 privado no chat. Não utilizar Sync quando não há personagem falando.

**Personagem falando:** mesma voz salva -> ElevenLabs por cena com contexto -> medir fala e vídeo -> Sync apenas nas cenas com personagem falando -> FFmpeg -> conferência -> MP4 privado.

**Editar vídeo anexado:** utilizar arquivo privado autorizado e gerar uma nova versão com narração, cortes e legendas, sem gerar todas as cenas novamente. Manter o original.

## Preferências da interface a implementar

Português do Brasil ou inglês, perfil de voz salvo, narração ou personagem falando, duração final, formato, legendas e substituição da fala original. Trilha opcional somente de fonte autorizada. Não habilitar opções que ainda não têm executor e capacidade validados.

O uso de ElevenLabs exige aprovação do texto e do custo. Selecionar fornecedor/modelo/voz antes da aprovação; não trocar para outro fornecedor silenciosamente. Uma modificação da fala gera nova revisão e nova aprovação das etapas necessárias. Alterar apenas legendas não deve gerar outra voz automaticamente.

## Código incluído

`app/lia-video-audio-editing-plan.mjs` é uma função pura: planeja as etapas, mantém voz e idioma, seleciona Sync apenas para cenas faladas, diferencia vídeo existente de cenas novas e calcula um fingerprint do conteúdo. Ele não faz chamadas de rede, não lê mídia, não cria fila nem consome saldo. `productionAuthorized` é sempre falso. O fingerprint não constitui consentimento.

`checkLiaNarrationFit` compara durações já medidas. Fala longa gera `script_revision_required`, sem cortar palavras, acelerar arbitrariamente ou autorizar outra geração paga. Fala curta pode ser preenchida com silêncio. Medir o arquivo real ainda é responsabilidade do futuro executor.

O planejador aceita seis cenas de 10s para 60s quando o modelo permitir. A configuração do PR #216 é até 8s: sete cenas de 8s e uma de 4s também totalizam 60s. Limites do provedor e duração faturável precisam ser conferidos no servidor antes da cotação.

## Contratos oficiais e cuidados

ElevenLabs: `POST /v1/text-to-speech/{voice_id}/with-timestamps`; origem oficial fixa; chave `xi-api-key` exclusivamente no servidor. O usuário escolhe perfil interno, nunca chave/endpoint. A resposta possui áudio e alinhamento de caracteres. Usar contexto anterior/seguinte para continuidade, sem dados de outra conta.

A API usa código ISO `pt` ou `en`. O sotaque brasileiro depende da voz. A documentação declara que `language_code` não é suportado por `eleven_multilingual_v2`; não prometer português por um parâmetro ignorado. A seleção deve respeitar o modelo e ser validada no resultado.

Sync: `POST https://api.sync.so/v2/generate`, chave `x-api-key` no servidor, vídeo e áudio compatíveis, acompanhamento pelo ID. O modo `cut_off` pode cortar fala: preparar durações iguais antes e verificar o resultado. Não usar loop/bounce para esconder uma fala que não cabe. No piloto, um falante compatível por cena. Animais, bicos e rostos encobertos não têm sincronização garantida.

A edição deverá remover a fala concorrente, montar as cenas, encaixar a narração sem mutilar palavras, ajustar volumes, gerar legendas, exportar e validar o MP4. Execução FFmpeg com argumentos controlados, sem interpolar prompt em shell, mídia privada e limites de recursos.

## Pendências antes de ativar

Implementar adaptadores reais ElevenLabs/Sync, registro persistente por etapa, autorização de custo, reserva única de plano/créditos, verificação de propriedade, editor FFmpeg, entrega privada e cartão do chat. Após um POST incerto, reconciliar o identificador; não gerar novamente sem saber o consumo. Cancelamento não pode ser sobrescrito por callbacks tardios. Geração não implica publicação.

Não executar o deploy genérico do PR #216 nem `git pull main` na produção reconciliada. Preservar Kling, workers, init, configurações e volumes. Confirmar a candidata e o rollback antes de fornecer um comando de publicação.

## Validação e limites desta revisão

51 testes locais do planejador passaram (Node, sem rede). O teste está em `app/scripts/test-lia-video-audio-editing-plan.mjs`. Não é teste de HTTP, banco, fila, cobrança, FFmpeg, ElevenLabs, Sync ou VPS.

Uma extensão do JSON Schema foi preparada e passou em 37 casos locais, mas a tentativa de atualizar `docs/lia-video-chat-draft.schema.json` não foi aceita pela ferramenta. Portanto, esse contrato ampliado NÃO está publicado nesta branch; encontra-se somente no pacote local de revisão. Não tratar o schema antigo como se já aceitasse as novas opções.

## Fontes oficiais consultadas em 20/09/2026

- https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- https://sync.so/docs/api-reference/api/generate-api/create
- https://sync.so/docs/developer-guides/sync-mode
- https://sync.so/docs/compatibility-and-tips/media-content-tips
