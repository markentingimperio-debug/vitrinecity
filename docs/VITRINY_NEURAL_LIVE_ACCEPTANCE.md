# Vitriny Neural — conexão e aceitação do modelo real

Este complemento prepara a verificação operacional da IA local. Não instala pesos, não configura a VPS, não habilita lojas, não cobra assinaturas e não concede novas ferramentas de execução ao modelo. Os recursos continuam desabilitados por padrão. Os testes automatizados usam fixtures; nenhum resultado desses testes é qualificação de um modelo real.

## Diagnóstico no painel administrativo

Em `/admin-vitriny-neural.html`, **Verificar modelo local** consulta os metadados do servidor configurado, sem enviar um prompt ou gerar tokens. O endpoint administrativo é `POST /api/admin/vitriny-neural/model/preflight`, com sessão administrativa, origem autorizada, JSON e `X-Neural-Request: 1`. Não recebe URL, token ou nome de modelo do navegador.

O resultado distingue conexão, alias do modelo, habilitação das tarefas, política do provider e qualificação persistida para `code.plan` e `growth.content-plan`. `readyForTaskAttempt` significa que esses pré-requisitos estão satisfeitos. Não comprova a qualidade de uma resposta, o funcionamento de ferramentas ou prontidão para produção. `liveTaskAcceptance: not_run_here` torna essa limitação explícita.

A conectividade pode ser reutilizada por até 10 segundos; a política e a qualificação são consultadas novamente a cada pedido. Providers remotos não são consultados. O diagnóstico não altera os limites, os créditos, as qualificações nem o modo da Neural. `/api/health` do aplicativo, isoladamente, não comprova que a Neural foi inicializada.

O adaptador aceita a origem configurada com ou sem o sufixo `/v1`, inclusive prefixo de proxy. Rejeita credenciais na URL, query e fragmento, bloqueia redirecionamentos e não devolve corpos HTTP de erro em mensagens. A marca `local` e os nomes de host são configuração administrativa: isolamento real exige DNS e regras de saída da infraestrutura sob controle do operador.

## Ensaio explícito com inferência real

Na pasta `app`, consultar ajuda não chama o modelo:

```sh
npm run acceptance:neural -- --help
```

Para executar no ambiente configurado:

```sh
npm run acceptance:neural -- --run-local
```

Em um contêiner já publicado e conferido, o equivalente é:

```sh
docker compose exec -T app npm run acceptance:neural -- --run-local
```

Esses comandos são operacionais para uso após reconciliar a instalação; não foram executados contra a VPS nesta entrega. O ensaio gera inferência local e consome recursos. Executar primeiro em homologação, sem chats ou benchmarks concorrentes. Concorrência 1 do ensaio não limita outros serviços. O Compose existente declara um modelo com uma sequência, 2 CPUs e 4 GiB; isso descreve o arquivo do repositório, não comprova os recursos efetivos da VPS.

O ensaio usa somente o provider local primário configurado por `VITRINY_NEURAL_MODEL_ORIGIN` e `VITRINY_NEURAL_MODEL_NAME`, ou por `JARVIS_LOCAL_MODEL` e `JARVIS_MODEL_ORIGIN` explícito. A flag Jarvis sozinha não seleciona um endereço para o ensaio: o operador deve fornecer a origem efetivamente conferida. Ignora fallback e rejeita origem fora de loopback, IP privado ou nomes internos previstos na ajuda. Chaves permanecem no ambiente do processo. Não importar relatórios ou qualificações artificiais para liberar o teste.

Sequência:

1. Consultar `/v1/models` com prazo e limite de corpo, confirmando o alias exato.
2. Executar os 20 casos do benchmark atual contra o modelo real.
3. Derivar a qualificação desse relatório em SQLite descartável, em memória. Exigir os limiares atuais e as capacidades necessárias.
4. Executar roteiro, rascunho de site e pedido de imagem cuja ferramenta está ausente, um de cada vez.
5. Emitir relatório JSON com estado, verificações estruturais, tokens, latência, tentativas e hashes de arquivos; não executar o HTML/JS produzido.

Um timeout solicita aborto, mas o próximo caso e o fechamento do banco aguardam a chamada anterior terminar. Se um transporte ignorar cancelamento, o ensaio pode demorar além do prazo configurado. Totais de tokens que ultrapassem a precisão inteira segura são marcados como desconhecidos, com `overflow: true`, sem arredondar um valor para cobrança.

O relatório não inclui o conteúdo dos artefatos, e não persiste qualificação de produção. Para revisão humana de conteúdo, repetir os pedidos no chat administrativo de homologação e baixar os rascunhos. A qualificação operacional continua sendo produzida pelo benchmark autenticado do painel.

| Saída | Significado |
| --- | --- |
| `0`, `structural_pass` | Os três casos cumpriram as verificações de protocolo/estrutura |
| `1`, `partial` ou `failed` | Um ou mais casos não cumpriram as verificações |
| `2`, `blocked` | Configuração inválida ou execução explícita ausente |
| `3`, `blocked` | Conexão, alias, benchmark ou qualificação impediram as tarefas |

Mesmo `structural_pass` mantém `semanticQualityVerified: false`. Rubricas lexicais e a existência de `index.html` não comprovam qualidade do site. Consumo ausente fica desconhecido; não usar um resultado incompleto para definir preço. O ensaio não mede custo financeiro da VPS nem garante economia.

## Ativação do piloto e publicação

Seguir primeiro a reconciliação, lock e preservação de dados descritos em [JARVIS.md](JARVIS.md). O merge no GitHub não implanta automaticamente a VPS. Não restaurar um banco antigo sobre vendas novas para reverter uma atualização de código.

Depois de verificar código/imagem/Compose e o servidor real, configurar Neural em `advisory`, com salt privado válido, chat administrativo e lista de lojas vazia. Manter billing desligado enquanto os preços e pagamentos não forem definidos. Realizar diagnóstico, benchmark persistido e casos do chat antes de conceder acesso a uma loja piloto.

O que continua pendente: executor de código isolado, navegador, geração/edição de mídia, integração de publicação social, validação de carga, medição de custo e cobrança recorrente. Nenhum resultado deste ensaio autoriza essas capacidades.

Testes determinísticos: `npm run test:neural`. O workflow Neural acompanha também mudanças em painéis, servidor, scripts de diagnóstico e configuração Docker, incluindo push em `main`. O CI não executa `--run-local` e não acessa modelos ou dados de produção.
