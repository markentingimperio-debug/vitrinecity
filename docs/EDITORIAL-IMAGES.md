# Imagens editoriais

Capas institucionais da cidade não devem substituir uma imagem de notícia. O módulo `editorial-image-policy.js` aplica essa regra ao radar, Emissora e busca/Descobrir. Uma matéria já publicada continua acessível sem imagem; novas publicações do radar exigem uma capa permitida. O gerador usa título, resumo e trecho do corpo e mantém o rascunho pendente quando não consegue gerar uma capa.

A política valida endereços e remove substituições conhecidas. Ela não comprova correspondência semântica ou fatos de uma foto arbitrária. Pessoas, acontecimentos e informações atuais precisam de contexto e revisão editorial. Ilustrações dos provedores conhecidos recebem crédito de IA e não são registros de acontecimentos reais.

## Fotografias revisadas

| Arquivo em `app/public/assets/editorial` | Origem e contexto | Autor e licença |
| --- | --- | --- |
| `vitoria-baia-arionstar-2024.webp` | [Vista panorâmica de Vitória](https://commons.wikimedia.org/wiki/File:Vista_panor%C3%A2mica_de_Vit%C3%B3ria.jpg). Baía vista do Convento da Penha, 12/02/2024. | ArionStar, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `whitecaps-lafc-bmo-tumford14-2024.webp` | [Los Angeles FC x Vancouver Whitecaps](https://commons.wikimedia.org/wiki/File:Los_Angeles_FC_vs_Vancouver_Whitecaps,_October_27_2024.jpg), BMO Stadium, 27/10/2024. Foto de arquivo, não de partida atual. | Tumford14, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

As fotos foram reduzidas proporcionalmente para 1280 pixels de largura e convertidas para WebP. Sem alteração do assunto ou recorte. Os créditos curtos aparecem nos cards; o artigo mantém a legenda com data, local e autor.

## Verificação

Regressões cobrem capas institucionais em URL relativa/absoluta, destinos inseguros, falha de carregamento sem outra foto genérica, preservação de receitas e produtos, legendas de IA e arquivo, formato horizontal e erro do provedor sem repetição de chamadas. A geração das Web Stories mantém o formato vertical existente.
