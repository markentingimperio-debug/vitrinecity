# Viagem entre cidades — prévia isolada

## Escopo implementado

O explorador reutiliza `planSpatialCityGates` e a Spatial API v1, com validação adicional de destinos. Nesta etapa, a lista permitida contém Vitrine City, Silvânia, Anápolis e Goiânia. Novas cidades exigem atualização explícita dessa lista e testes; não se deve transformar qualquer texto retornado pela API em endereço de navegação.

Os portais intermunicipais mantêm a arquitetura em anel, recebem rótulos legíveis e ficam numa estação de entrada. O menu “Viajar entre cidades” oferece os mesmos destinos como links HTML para teclado/toque. Viajar exige clique, toque ou confirmação pelo botão/tecla E; apenas se aproximar não troca a página.

## Retorno por cidade

`vitrinySpatialCheckpoint:v1:<cidade>` guarda somente o último ponto de câmera em cada cidade, na aba atual. Limite: quatro chaves, validade de duas horas. O formato valida mundo, posição e horário, e descarta conteúdo corrompido, expirado ou de outro mundo. Não copia identificador pessoal, produto, token ou histórico de navegação. A chave legada `vitrinySpatialReturn` continua compatível com lojas e distritos.

## Renderização e falhas

- Direção de movimento, deslocamento lateral e orientação da câmera usam a mesma base vetorial.
- Prédios procedurais não ocupam a praça central nem a aproximação da estação.
- A praça aparece antes de terminar o carregamento sequencial dos chunks; rede lenta não bloqueia os controles já inicializados.
- Materiais compartilhados de ruas e solo não são destruídos quando apenas um chunk sai da memória.
- Falha no catálogo permite destinos de prévia conhecidos; não libera comércio. O hub é a única cidade com integração comercial habilitada neste explorador.
- Links HTML de saída permanecem disponíveis se o 3D não puder iniciar.

## Testes e limites da entrega

Executar, a partir de `app`:

```sh
node scripts/test-vitriny-spatial-city-portals.mjs
```

A suíte possui 12 casos, incluindo ida e volta entre cidades, seleção de destinos, armazenamento bloqueado/expirado, falha e timeout do catálogo, direção da câmera e contrato HTML/JS. O runner `test-platform-release.mjs` descobre esse arquivo automaticamente.

Esses testes são de lógica, contrato e sintaxe; não comprovam desempenho de GPU, toque em aparelho físico ou aparência final. Homologação visual em Android/desktop, teste do caminho loja → retorno e teste de latência continuam necessários antes de exposição ampla. Esta etapa não inclui avatares sincronizados, física de colisão geral, operação comercial nas três prévias nem deploy na VPS.
