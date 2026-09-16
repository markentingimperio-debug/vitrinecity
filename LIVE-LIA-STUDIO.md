# Lia no estúdio existente

## O que esta versão faz

O cartão **Lia no estúdio**, dentro de `/admin-live.html`, prepara uma resposta
administrativa com texto, retrato ilustrativo, voz sintética e uma oferta atual do
catálogo. O retrato preserva a personagem Lia; não é vídeo fotorrealista responsivo
e não tem sincronização labial.

O operador adiciona uma pergunta e a página pública relacionada. A fila é própria
do administrador, sem misturar o histórico, o cadastro ou os consentimentos dos
visitantes que conversam com a Lia. A entrada de perguntas é **manual**: não há
nova leitura automática de comentários de Instagram, YouTube ou TikTok neste
cartão. Nenhum item desta fila é enviado ao Direct ou WhatsApp.

## Sequência no painel

1. Adicionar a pergunta, sem dados privados de quem comentou.
2. Usar **Criar rascunho do catálogo** (sem IA paga), escrever a resposta, ou
   escolher explicitamente **Gerar rascunho com IA**.
3. Conferir texto e oferta, marcar a revisão e aprovar. É possível usar uma
   resposta sem oferta. Nenhum pedido ou pagamento é criado.
4. Se desejado, usar **Copiar mensagem e link do produto**. O servidor relê a
   aprovação e o catálogo antes de devolver o link correto. Afiliados mantêm a
   identificação de publicidade e comissão. Copiar não significa enviar.
5. Usar **Preparar voz e retrato**. Essa é a ação explícita que pode consumir a
   API de voz já configurada. O resultado fica privado, disponível no player para
   o operador ouvir e conferir.
6. Com o estúdio parado, **Testar resposta no OBS — privado** grava localmente,
   sem iniciar transmissão. Com uma sessão já ativa, **Exibir resposta na sessão
   ativa** solicita a reprodução desse clipe; não inicia uma nova live.

O estado do worker distingue comando recebido, exibição em curso, término, falha
e interrupção. O estado de saída do OBS não prova publicação pública em uma rede.
O operador continua usando os controles existentes para iniciar ou parar a sessão.

## Custos, arquivos e recuperação

- Voz: no máximo **3 tentativas por dia**, compartilhadas entre administradores.
- Texto com IA: no máximo **20 tentativas por dia**. O rascunho do catálogo não
  consome esse limite nem chama um modelo.
- O dia usa Brasília (UTC−3). A reserva durável ocorre antes da chamada paga;
  resultado incerto também consome a tentativa. Isso é limite de operações,
  não orçamento monetário em reais. A resposta da API de voz não informa custo
  financeiro: o valor permanece desconhecido, nunca zero presumido.
- Atualizar a tela não solicita IA, voz, clipe, comentário ou transmissão.
- Uma falha ambígua não é reenviada automaticamente. O histórico da pergunta e
  os recibos de mídia ficam disponíveis para conferência administrativa. Não
  apagar intenção nem criar uma nova pergunta apenas para repetir uma cobrança
  cujo resultado é desconhecido.
- Respostas aprovadas ficam imutáveis após a tentativa de voz. Mudanças na página
  ou na oferta impedem aprovação tardia, cópia de link e reprodução.
- O adapter salva `<UUID>.mp4` e `<UUID>.json` em `/live-studio/lia-answers/`.
  Os recibos vinculam texto, oferta, retrato, modelo/voz e bytes finais. A prévia
  é privada em `/api/admin/live-studio/lia/answers/:id/media`.
- O backend e o worker conferem UUID, nome, duração até 60 segundos, dimensões,
  bytes e SHA-256. O worker ainda confere codecs e controla a fonte audiovisual.
- Preparar mídia não troca `config.json`, credenciais, vídeo base, destinos ou
  repetição. A fila de comandos usa criação exclusiva para não sobrescrever
  comandos concorrentes. Uma exibição registrada não é repetida por retry HTTP.

## Integração e limites

`app/live-lia.js` reaproveita `siteSalesAssistant.resolveContext` e `offersFor`.
O rascunho com IA usa o cliente OpenAI já configurado, por chamada explícita e com
limite de saída. Não aciona campanhas, presentes, cupons, contatos ou ferramentas
de compra da Lia pública. As rotas administrativas usam autenticação existente,
same-origin nas alterações e JSON, sem retornar segredos do estúdio.

`app/live-lia-media.js` prepara o clipe; `ops/live-studio/worker.py` o reproduz
como fonte separada, conservando o distribuidor OBS/FFmpeg para Instagram,
YouTube e TikTok. Facebook não é um destino deste relay. A Emissora pública
continua sendo o catálogo editorial; não se torna um player de streaming nesta
alteração.

O Direct de comentários de live do Instagram já existente é outro fluxo. Ele
confere mídia própria ativa e tentativa única por comentário, mas não recebe
automaticamente esta resposta aprovada nem seu vínculo de produto. Unir os dois
exige uma ponte específica de comentário, live, aprovação e oferta; não basta
trocar uma URL genérica na configuração.

## Validação

```
node --test app/scripts/test-live-lia.mjs app/scripts/test-live-lia-ui.mjs app/scripts/test-live-lia-media.mjs app/scripts/test-live-studio.mjs
```

Os testes exercitam SQLite, contratos HTTP, revalidação, concorrência, cotas,
recibos, arquivos e UI. Provedor de voz e encoder são simulados nessa suíte;
isso não é prova de publicação externa, qualidade de voz ou desempenho do OBS.
Uma gravação privada no ambiente real deve ser conferida separadamente.
