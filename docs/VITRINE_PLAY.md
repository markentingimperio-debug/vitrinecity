# Vitrine Play — catálogo e orquestração de minisséries

## Estado desta entrega

Código de catálogo, player, painel, persistência e fila implementado. A geração real
por Kling/ElevenLabs/LLM, edição e postagem social NÃO está conectada por este módulo.
O worker incluído executa um adapter local auditado; esse adapter ainda precisa ser
implementado contra os provedores efetivamente disponíveis na LIA. Uma credencial
configurada não prova conectividade. Não há vídeos gerados, postagem real, campanha,
cobrança de assinatura ou implantação VPS decorrente apenas deste commit.

A publicação local de arquivos finais revisados funciona sem um worker de geração.

## Integração

`app/media-catalog.js` compõe o catálogo atual com `setupVitrinePlay`. O catálogo
anterior é preservado byte a byte em `app/media-catalog-base.js`; suas importações
relativas continuam no mesmo diretório. Não altera server.js, a conta do usuário,
as credenciais existentes, as tabelas anteriores nem o Docker Compose.

Rotas adicionadas:
- `/series`: catálogo público gratuito e indexável.
- `/series/:slug`: detalhes e lista de capítulos.
- `/series/:slug/:chapter`: capítulo e player vertical.
- `/vitrine-play`: redirecionamento para o catálogo.
- `/admin-series.html`: painel protegido pelo requireAdmin existente.
- `/api/admin/series`: CRUD, revisão, planejamento e exportação.
- `/api/worker/vitrine-play/*`: fila privada, com token dedicado.

O menu principal existente ainda não foi alterado: entrar no painel pela rota
`/admin-series.html`. O módulo incorpora as novas páginas ao sitemap retornado pelo
catálogo de mídia. Não existe paywall; a proposta de R$10/mês ficou fora deste escopo.

## Usar sem gerar novas despesas

1. Implantar e validar o código em homologação antes da VPS de produção.
2. Abrir `/admin-series.html` com uma sessão administrativa válida.
3. Criar uma série ou usar “Criar piloto original”. O piloto “Ela Já Sabia” tem
   bíblia, elenco e roteiro-base do capítulo 1, mas permanece privado e sem mídia.
4. Definir voz e referência de cada personagem, capítulos e datas de lançamento.
   As datas do formulário usam Brasília (UTC−3); o banco armazena ISO UTC.
5. Entregar o vídeo pelo armazenamento de mídia existente e informar sua URL no
   capítulo. Este módulo NÃO adiciona um endpoint de upload binário.
6. Informar duração real de 60–90 segundos, assistir e confirmar os direitos.
7. Marcar a série como visível. O relógio local verifica lançamentos aprovados a
   cada 30 segundos. Também há botão para verificar imediatamente.
8. Revisar separadamente o clipe antes de autorizar a postagem orgânica.

“Maratonar” reproduz os capítulos disponíveis em sequência. Um vídeo único de toda
a temporada pode ser cadastrado, mas só aparece quando todos os capítulos previstos
estiverem publicados. O módulo não concatena automaticamente a temporada.

## Configuração na VPS (nunca no GitHub público)

```dotenv
VITRINE_PLAY_MEDIA_HOSTS=cdn-seu-dominio.example
VITRINE_PLAY_WORKER_TOKEN=<segredo-aleatorio-dedicado-com-32-ou-mais-caracteres>
VITRINE_PLAY_SITE_URL=https://vitrinecity.com
VITRINE_PLAY_ADAPTER=/caminho/absoluto/lia-series-adapter.mjs
VITRINE_PLAY_RECEIPTS_DIR=/data/vitrine-play-receipts
# Para desativar somente o publicador de capítulos já aprovados:
# VITRINE_PLAY_SCHEDULER=off
```

Sem MEDIA_HOSTS só são aceitos caminhos locais `/generated-videos/...` e
`/social-media/...`. URLs HTTPS de hosts explicitamente autorizados podem ser usadas;
portas alternativas, credenciais em URLs, scripts e travessia de caminho são rejeitados.
O módulo não faz requisições a URLs de mídia. A capacidade e o custo do armazenamento,
CDN, banda e permissões do servidor precisam ser validados na implantação.

## Worker e contrato dos provedores

O runner `app/scripts/vitrine-play-worker.mjs` exige um módulo local com:

```js
export async function estimateMaxCostBrl(stage) {
  // Limite superior conservador, incluindo todas as chamadas da etapa.
  // null = etapa não implementada. Não chamar API paga para estimar sem aprovação.
  return null;
}
export async function run({id, brief, maxCostCents, idempotencyKey, signal}) {
  // Implementar contra os provedores reais. Respeitar teto e cancelamento.
  // Não retornar sucesso antes de confirmar arquivos/recibos do provedor.
  throw new Error('Etapa ainda não integrada');
}
```

Este exemplo é deliberadamente não operacional; não finge que há um gerador.
O desenvolvimento e teste deste adapter é a pendência principal para automação real.
Não reusar endpoints antigos da LIA sem verificar suporte a cada operação.

Execução depois da implementação e validação do adapter:

```sh
node app/scripts/vitrine-play-worker.mjs
# Execução de uma passagem apenas:
VITRINE_PLAY_WORKER_ONCE=1 node app/scripts/vitrine-play-worker.mjs
```

Etapas, em ordem: `script`, `scenes`, `voices`, `video`, `lipsync`, `edit`, `clips`, `social`.
O briefing inclui bíblia, elenco/vozes/referências fixas, idioma pt-BR, narração breve,
trilha instrumental licenciada, 9:16, duração de 60–90s e destino na Vitrine City.

Resultados exigidos:
- script: `{script: "roteiro completo"}`
- scenes: `{scenes: [{description, seconds, dialogue}]}`; soma de 60–90s.
- voices/video: `{assets: [{url, label}]}`; arquivos existentes, em host autorizado.
- edit: `{mediaUrl, captionUrl, duration}`; duração real verificada pelo adapter.
- clips: `{clipUrl}`; novo clipe invalida autorização social anterior.
- social: `{posts: [{platform, postId}]}`; só com publicação confirmada pelo provedor.

A API aceita claim somente na ordem correta e dentro do orçamento total do capítulo
(incluindo revisões anteriores). Cada claim usa `maxCostBrl`. O adapter deve retornar
`{result, actualCostBrl}`; custo acima da reserva exige reconciliação manual. Zero
permite somente operações sem custo real, nunca crédito pago não contabilizado.
O planejamento NÃO autoriza gastar acima do teto e não é prova de execução.

Recibos são gravados em diretório privado (arquivos 0600) antes de confirmar a tarefa.
Uma falha de comunicação reenvia o recibo, não repete a geração. Leases expirados ou
falhas incertas não são reexecutados automaticamente. Confirmar no provedor ausência
de execução/cobrança antes de usar “Reconciliar sem cobrança”. Resultado tardio com
lease original pode resolver incerteza. Chamadas acima de 25 minutos exigem adapter
com polling e controle de prazo; não desconsiderar o AbortSignal.

O worker externo deve preservar as condições específicas de cada rede: conta
correta, autorização OAuth, revisão/auditoria do aplicativo, direitos, identificação
de IA e recibos. A aprovação do clipe não substitui essas permissões.

## Tráfego e monetização

O pacote do capítulo exporta rascunho de anúncio e link com UTM. Não há chamada a
Meta Ads/TikTok Ads, execução de campanha, remarketing, pixels novos, gasto ou
promessa de lucro. Não há AdSense ou rede de anúncios instalada. Revisar objetivos,
criativos, público e orçamento antes de desenvolver/ativar integração de mídia paga.
O link interno usa a raiz da Vitrine City; não presume uma rota de checkout.

## Verificação e limites

```sh
node --check app/vitrine-play.js
node --check app/public/vitrine-play-client.js
node --check app/scripts/vitrine-play-worker.mjs
node --test app/scripts/test-vitrine-play.mjs
```

Testes locais: Node 22.16.0, SQLite real via node:sqlite e harness de rotas, sem
provedores pagos. 16 casos cobrem exposição de rascunhos, XSS, URLs, custos, revisão,
agendamento, duplicatas, concorrência, leases, aprovação social e proteção das rotas.
Isto não substitui testes HTTP com Express/better-sqlite3 reais, navegação na aplicação
completa, smoke test VPS ou verificação das permissões e políticas dos provedores.
O worker/adapters não foram executados contra APIs reais.

Validar antes de integrar na main: ordem dos middlewares no servidor, autenticação
no navegador, entrega de arquivos, CSP, volume persistente, compatibilidade do Node,
botões no menu principal, plano de rollback e backup SQLite consistente. Não executar
`docker compose down` nem reiniciar a VPS inteira. A implantação deve preservar o
container/serviço correto e os volumes atuais; nenhuma troca foi executada aqui.


## Política de provedores da Vitrine Play

Fluxo oficial deste projeto, sem OpenRouter:

- **ElevenLabs**: geração de todas as falas dos personagens e da narração. A voz é persistente por personagem durante toda a série.
- **Kling**: geração das referências, Elements persistentes e cenas de vídeo. Não gerar fala final no Kling quando houver faixa de voz do ElevenLabs.
- **HeyGen**: somente sincronização labial das cenas em que um rosto fala e edição quando necessário. Não usar HeyGen como gerador principal das vozes.
- **FFmpeg**: montagem final, concatenação, mixagem, normalização, legendas e validação do MP4.

Credenciais nunca entram no repositório. IDs públicos de personagem/voz podem ser persistidos; chaves e tokens ficam somente no armazenamento privado da VPS.
