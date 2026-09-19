# LIA: foto/print do produto como referência de geração

PR212 acrescenta roteamento explícito, reutilização privada da referência dentro da mesma conversa e proteção contra desvio de geração para FFmpeg. Não implementa leitura visual genérica nem garante fidelidade de texto/rótulo, idioma de áudio ou sincronização labial.

## Fluxo

Anexe uma imagem PNG/JPEG do produto e peça `Gere um vídeo demonstrativo desse produto de 5 segundos`. `Anime essa imagem` também é vídeo. A referência segue pelo contrato de imagem-para-vídeo existente, como primeiro frame privado em base64. A geração só começa após confirmação do orçamento. Nova geração de imagem usa o adaptador de imagem existente.

Uma referência anterior só é reutilizada com indicação explícita, como `desse produto`, e apenas dentro da mesma conversa autorizada. A imagem selecionada é associada à nova mensagem para preservar seu histórico. Referência ausente ou contraditória não vira uma geração paga sem referência. Roteiros/legendas e perguntas não se transformam automaticamente em geração. Continua aceitando uma referência PNG/JPEG por pedido, com limites e validações existentes.

## Atualização

Não execute o script genérico com `git checkout`/`git pull`/`docker compose up` apresentado antes: a produção possui configuração congelada e diferenças reconciliadas. Não copie arquivos isolados sobre `/opt/vitrinecity`.

O atualizador `update-reference-media-v95.py` usa o helper v92 e identifica a última release gerenciada por imagem, hashes, configuração e montagens. Aceita a base com roteamento v93 ou áudio v94; preserva áudio já instalado. A opção explícita `--ativar-audio` acrescenta o payload v94 já existente e sua configuração somente quando necessário. Nunca altera outro membro de configuração, FX, credenciais ou preço sem áudio. A referência de áudio nativo segue USD0.126/s em Kling3.0 720p sem controle de voz, fornecida pelo proprietário.

Pacote local precisa conter o atualizador, build-reference-media-v95.py, test-reference-media.mjs, uma cópia idêntica de app/public/neural-reference-media.js e uma cópia idêntica de ops/lia-native-audio/build-native-audio-v94.py. Todos são fixados por SHA256.

Modo padrão `plano` consulta a instalação e a aprovação do SHA exato no GitHub/Sonar antes de permitir a troca. `aplicar --confirmar-troca` verifica o backup existente, cria imagem sobre a imagem ativa, testa sem rede/credenciais/volume de produção, exige parada normal com init, preserva o banco e registra o rollback de código. A atualização pode interromper requisições em andamento. Não faz gerações pagas para testar.

## Validação

A suíte contém 46 testes de roteamento, referência, HTTP, autorização de anexos, primeira imagem exata, confirmação, carteira e entrega com Express/better-sqlite3 reais, usando transportes de provedor simulados e mídia sintética. Exercita as variantes com e sem payload de áudio. Os testes do atualizador conferem os hashes e recusa antes de alteração. CI usa Docker Compose real em projeto descartável separado para atualizar e retornar sem restaurar SQLite, inclusive falha pós-troca. A aprovação de CI não comprova uma geração real do Kling e não instala nada na VPS.

Depois da implantação, o proprietário deve confirmar uma tarefa real no próprio chat, após conferir o orçamento. Não repetir um POST pago quando o consumo estiver incerto. O relatório `PRODUCT_REFERENCE_ENABLED_E2E_PENDING` distingue instalação de comprovação ponta a ponta.
