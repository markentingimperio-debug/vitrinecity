# Política diária de conteúdo da VitrineCity

Atualizada em 12/09/2026. Orientação para novas produções; este documento não altera código, agendamentos, conexões ou publicações.

## Pauta e identidade

Horário de Brasília: **07h oração**, **11h conteúdo útil** vinculado a uma página real, **18h Lia** apresentando uma descoberta, produto, curso ou projeto disponível. Alternar temas relevantes, sem depender de tendências. Conferir página, fatos, disponibilidade e condições comerciais antes do roteiro. Manter uma edição por faixa/dia e recibos separados por canal; preparação e configuração não equivalem a publicação verificada nem a autonomia completa.

Identidade alvo: **Lia · VitrineCity**, `lia-abacus-v1`, salva no Abacus Studio com voz anexada. Reutilizar rosto e voz, identificando-a como assistente com IA. Integração de API/IDs e LiveAvatar continuam pendentes; não anunciar live ativa. Ver [identidade e limites](LIA-VIDEO-IDENTITY.md).

## Duração e edição

| Destino | Orientação editorial |
| --- | --- |
| TikTok e Facebook | Versão principal de 65s, com conteúdo suficiente do começo ao fim. |
| Instagram Reels e YouTube Shorts | Usar 65s quando a narrativa sustentar; encurtar se melhorar a experiência. |
| Stories de Instagram e Facebook | Corte próprio de 15–30s, compreensível sozinho e ligado à edição principal. |

Preservar as mídias de **12 e 13/09/2026 já prontas com 61s**. Não regenerar, alongar artificialmente ou reenviar apenas por esta política.

Produzir conteúdo original, com abertura clara, demonstração ou exemplo, variação visual útil, voz confortável e legendas legíveis. Exportar arquivo limpo, sem marca-d'água de outra plataforma; usar somente imagens, voz e áudio autorizados. Encerrar com convite natural para uma página relacionada ou uma pergunta pertinente. Não exigir comentários, compras ou doações para receber bênçãos ou benefícios.

## Resultado e fontes oficiais

O responsável informou monetização no Facebook e TikTok. **65s não garante elegibilidade, alcance nem receita.** Avaliar retenção, tempo assistido, conclusão e acessos qualificados; comparar edições do mesmo tema antes de mudar a duração. Receitas só devem ser relatadas quando confirmadas no painel da rede.

- **Facebook:** monetização considera desempenho, originalidade, tempo assistido e visualizações qualificadas em diferentes formatos; a fonte não estabelece 65s como requisito universal. [Meta, 18/03/2026](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/).
- **TikTok:** 65s ultrapassa o requisito de um minuto do Creator Rewards, mas não substitui os demais critérios de conta, originalidade e conteúdo elegível. Conteúdo patrocinado não deve ser presumido elegível. [Programa oficial](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program) e [explicação oficial dos critérios](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/how-is-the-creator-rewards-program-different-from-the-tiktok-creator-fund).
- **YouTube:** Shorts verticais ou quadrados podem ter até três minutos; acima de um minuto, uma reivindicação ativa de direitos autorais bloqueia o vídeo globalmente. A duração não assegura monetização. [Ajuda oficial](https://support.google.com/youtube/answer/15424877?hl=pt-BR).

Fontes consultadas em 12/09/2026. Os cortes de Stories e a preferência por 65s são decisões editoriais da VitrineCity, não recomendações universais comprovadas das redes.

## Implementação da geração de oração

Preparada para revisão/liberação em 12/09/2026 no módulo `app/prayer-media.js`: manter `tiktok` como identificador técnico da versão principal de 65s, reutilizável pelos canais de vídeo, e `short` como versão de Stories de 30s. Os nomes de diretório e URLs não mudam. A versão curta seleciona frases completas da mesma oração e recebe narração própria; não é um recorte automático do áudio principal. Permanecem as duas gerações de voz/transcrição já existentes, sem ativar um novo gerador pago.

Para um trabalho novo, `render-plan.json` registra antes de qualquer chamada paga a política `prayer-media-65s-v2`, data, formato, papel `main`/`story`, duração alvo, versão do renderizador e vínculo do roteiro. O `ready.json` novo inclui esses metadados e o hash do plano, além da duração medida e hash do vídeo. FFprobe precisa confirmar a duração e os codecs antes da conclusão. Um vídeo já pronto é reutilizado, sem mudar seus bytes, manifesto ou recibos; uma intenção paga ambígua ou um rascunho antigo sem plano fica preservado para revisão. Falha apenas na renderização local pode reutilizar voz/transcrição já concluídas e vinculadas, sem repeti-las. A gravação final não sobrescreve outro vídeo.

O renderizador `prayer-illustrated-voice-v1` compõe a ilustração existente de Jesus, movimento discreto do fundo, narração e legendas. **Não anima o avatar Lia, não gera filmagem e não assegura os critérios de originalidade ou monetização do TikTok.** A versão de 65s é um ajuste técnico de duração; qualidade narrativa e retenção ainda exigem avaliação. Publicação automática depende dos destinos efetivamente conectados, permissões e comprovantes individuais; esta mudança não conecta TikTok, LiveAvatar nem os provedores do roteador preparado.

Verificação local: `node --test scripts/test-prayer-media-duration.mjs` a partir de `app`. Testes com rede/processos simulados cobrem 65s/30s, preservação de 12/13, plano durável, concorrência, recuperação local sem nova cobrança e retenção de casos ambíguos. Não houve geração paga ou publicação durante a implementação.
