# DeepSeek para VitrineCity — preparação e ativação controlada

Contrato consultado em 15/09/2026. Instalar este código não ativa uma chave,
não compra créditos, não faz inferência e não muda cobranças anteriores.

## Escopo

- Texto dos agentes, editorial e Lia: seleção explícita de DeepSeek Flash;
  OpenAI pode ser a alternativa explícita. Imagens, vídeos, pagamentos,
  permissões e ações de ferramentas continuam nos componentes atuais.
- Vitrine Neural com Coins: adaptador pago independente com orçamento,
  confirmação, hash do pedido, recibo e tarifa do provedor escolhido.
- O modelo local continua local. DeepSeek remoto não é apresentado como IA
  própria, gratuito ou automaticamente qualificado.
- A supervisão Astra, jobs já enviados e o núcleo local de aprendizado não
  são trocados por esta configuração.

## Texto dos agentes e Lia

No ambiente privado usado pelo Compose (nunca em Git ou frontend):

```dotenv
AI_TEXT_PROVIDER=deepseek
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_REASONING_EFFORT=none
DEEPSEEK_API_KEY=<inserir somente no servidor>
AI_TEXT_FALLBACK_PROVIDER=openai
OPENAI_DIRECT_MODEL=gpt-4o-mini
```

Preservar `OPENAI_API_KEY` existente. `auto` mantém o comportamento anterior.
Cada chave só pode ser enviada à origem HTTPS do seu próprio provedor.
O esforço padrão DeepSeek é `none` para caber nos limites curtos da Lia;
`low`, `high` ou `max` são opções explícitas do servidor, sujeitas a testes.
Esse padrão específico não é repassado automaticamente ao OpenAI.

A API Responses DeepSeek é stateless. Não pode substituir silenciosamente
contratos de conversação armazenada ou ferramentas nativas do OpenAI.
Requisições incompatíveis são encaminhadas ao OpenAI antes do envio, quando
essa alternativa estiver autorizada, ou falham fechadas. Não reenviar
respostas parciais, recusas, erros de transporte ou consumo desconhecido.
Falha desconhecida exige inspeção: alternativa automática não significa
repetir qualquer operação.

## Chat pago Neural

`VITRINY_NEURAL_PAID_CONFIG_JSON` é privado, lido no servidor e independente
de `AI_TEXT_PROVIDER`. Não substituir o objeto inteiro: preservar FX,
configuração Kling, carteira, limites e política de Coins existentes.

Novos pedidos podem selecionar `chat.providerId: "deepseek"`,
`chat.model: "deepseek-flash"`, `chat.acceptedResponseModels: ["deepseek-flash"]`
e `chat.primary: true`. A preferência solicita uma cotação mesmo quando há
modelo local qualificado; a confirmação e a reserva continuam obrigatórias.
Uma preferência enviada pelo cliente não altera a configuração do servidor.

O calendário exige `chat.tariffSchedule: "deepseek-flash-utc-weekday-20260915"`.
Tarifas ficam em `chat.tariffs.offPeak` e `chat.tariffs.peak`, com campos
decimais string `inputUsdPerMillion`, `cachedInputUsdPerMillion` e
`outputUsdPerMillion`, além de versão e data efetiva. O teto cobre a faixa
mais cara. A liquidação usa a faixa comprovada durante a operação. Se houver
ambiguidade na mudança de horário, a reserva fica para conciliação.

Não presumir equivalência entre a alternativa do texto operacional e a do
chat pago. Esta primeira integração paga usa um único provedor por pedido;
consumo desconhecido permanece reservado, sem tentar o OpenAI. O fallback
pago exige autorização vinculada às duas tarifas e registro durável de cada
tentativa antes de ser habilitado.

Quotes/recibos OpenAI antigos mantêm seus hashes, modelos e tarifas. A taxa
de 15% na recarga de Coins não é cobrada novamente no uso. Regras legadas
ficam ligadas ao snapshot original; não reprecificar histórico.

## Preço e escolha recomendada

Preços oficiais Flash observados por milhão de tokens em USD:

| Faixa | Entrada sem cache | Entrada com cache | Saída |
| --- | ---: | ---: | ---: |
| Fora do pico | 0.15 | 0.003 | 0.60 |
| Pico | 0.30 | 0.006 | 1.20 |

Pico: segunda a sexta, 01:00–04:00 e 06:00–10:00 **UTC**. Não confundir com
horário do Brasil. Valores, impostos da recarga e câmbio podem mudar.
Tokens de raciocínio já incluídos na saída não são somados novamente.

Comparação com a configuração da VitrineCity observada nesta data:
GPT-4o mini estava configurado em 0.15/0.075/0.60 USD por milhão
(entrada/cache/saída). Portanto DeepSeek não é universalmente mais barato:
a principal vantagem de preço desse comparativo é cache, enquanto o pico
aumenta o custo sem cache. Isso não é uma nova confirmação da tarifa OpenAI.

Recomendação: piloto com conteúdo público da própria empresa, orçamento
limitado e revisão de qualidade antes de ampliar. Registrar custo por tarefa
aceita, latência, taxa de erro e de uso da alternativa. Um teste de transporte
simulado não comprova geração real nem qualidade do modelo.

## Conhecimento e treinamento

A API responde, mas não modifica automaticamente os pesos da IA própria.
O projeto já separa fatos públicos revisados (`approved-platform-knowledge`)
e exemplos candidatos (`dataset-builder`), que exigem aprovação explícita.
Não importar automaticamente respostas de provedores ou conversas privadas
de clientes. Primeiro verificar exatidão, origem, direitos e consentimento;
depois manter conjunto de validação separado. Não confundir memória/RAG,
dataset preparado e modelo efetivamente treinado.

O modelo aberto permite estudar uma implantação própria sujeita à licença,
mas treinamento/inferência locais precisam de capacidade específica. Esta
mudança não baixa pesos, não contrata GPU e não inicia treinamento.

## Checklist de publicação e ativação

1. Executar testes unitários, carteira/recibos, roteamento, privacidade e QA
   obrigatório em navegador no runtime isolado de testes.
2. Registrar commit/PR, exigir CI saudável, verificar HEAD real da produção
   e preservar todos os dados e alterações locais antes de publicar.
3. Fazer backup privado e manter imagem saudável de retorno. Não remover
   o executor nem reiniciar serviços alheios à mudança.
4. Instalar chave diretamente no servidor, sem chat/log/Git. Validar a conta
   com consulta de metadados, sem confundir isso com geração validada.
   `node scripts/check-deepseek.mjs` apenas lê presença da configuração;
   `node scripts/check-deepseek.mjs --probe` faz um único GET de modelos,
   sem prompt, geração, compra ou impressão da chave.
5. Autorizar separadamente um piloto de inferência com teto, sem disparos
   externos. Não ativar texto pago sem preços, FX e capacidade validados.
6. Para reverter novas seleções, restaurar as configurações anteriores.
   Preservar adaptadores e recibos de pedidos pendentes até conciliação;
   nunca restaurar um banco antigo por causa de uma falha de provedor.

## Fontes oficiais

- [Primeira chamada e modelo atual](https://api-docs.deepseek.com/)
- [Compatibilidade Responses](https://api-docs.deepseek.com/guides/responses_api/)
- [Preços e horários](https://api-docs.deepseek.com/quick_start/pricing/)
- [Erros da API](https://api-docs.deepseek.com/quick_start/error_codes/)
- [Modelo aberto e licença](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)
