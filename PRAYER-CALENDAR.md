# Orações por dia e vídeos da Vitriny Social

A página `/oracao-do-dia.html` seleciona a data atual em `America/Sao_Paulo`.
O calendário aceita datas desde 10/09/2026 até 366 dias à frente de hoje;
datas futuras são apresentadas como orações programadas.

## Acrescentar orações

Os 31 textos originais permanecem em `app/prayer-daily.js`. Há 35 novos textos
em `app/prayer-collection-v2.js`. A coleção de 66 textos começa em 12/09/2026
e volta ao início ao completar o ciclo. Não há geração automática ou cobrança
por IA ao abrir a página.

Para adicionar textos depois, crie uma nova coleção e acrescente uma entrada
com a data de início em `PRAYER_COLLECTIONS`. Preserve as versões anteriores,
sua ordem e seus textos para manter os links compartilhados. Não substitua
o conjunto de uma versão já publicada. IDs de oração devem continuar únicos.

## Vídeos publicados

`GET /api/prayer/videos?dia=AAAA-MM-DD` lê diretamente os vídeos `ready` da
Vitriny Social, respeitando bloqueios e silenciamentos do visitante autenticado.
Rascunhos e vídeos aguardando revisão não são exibidos. A aprovação continua
no fluxo existente de `/admin-social-moderacao.html`.

Inclua na legenda uma identificação de oração:

- `#Oração`, `#Oracao` ou `#OracaoDoDia`: oração geral, disponível em todos os dias.
- `#OracaoSexta`, `#OracaoSabado`, etc.: vídeo apenas para o dia da semana indicado.
- `#Oracao20260912`: vídeo para a data exata 12/09/2026 (tem prioridade sobre os gerais).

Vídeos novos ou removidos aparecem/desaparecem na próxima abertura da página,
sem recópia do arquivo e sem uma segunda publicação. O player só é carregado
após o clique, com controles e som habilitados, sem reprodução automática.
A narração completa do texto usa a síntese de voz do navegador, disponível
conforme o aparelho, com botões para ouvir, pausar, continuar e parar.

## Verificar

`node --test scripts/test-prayer-daily.mjs scripts/test-prayer-page.mjs scripts/test-prayer-media.mjs`

Verifique também no site: hoje, sábado, domingo, mudança de mês, copiar link,
voz do aparelho, vídeo publicado e tamanho de tela de celular.
