# LIA Creator — estrutura comercial e técnica do piloto

Data: 20/09/2026. Estado: **planejamento executável isolado; não disponível para venda**.
Base de revisão: `eb7079529ec7e98450aed50148a65ffcce900fcb`, branch `feat/lia-product-reference-20260919`.

## Entrega desta etapa e limite de escopo

Este pacote contém a proposta comercial, o mapa de integração, funções puras de planejamento e testes locais. Não adiciona rotas HTTP, não altera `server.js`, não migra banco, não concede créditos, não cria assinaturas no Mercado Pago, não chama ElevenLabs/Sync/Kling nem agenda ou publica em contas reais. Não é instalador da VPS.

O planejador descreve o trabalho a executar; `executed`, `reservationPerformed`, `quotaReserved` e os indicadores de publicação continuam falsos. Referências repetidas ajudam a planejar consistência, mas não são prova de consistência visual de um vídeo gerado.

Não incorpora o pacote de roteamento flexível v96 nem altera o recurso imagem→vídeo já publicado. O Git de produção não deve receber `git pull main`: a instalação atual usa overlays reconciliados sobre a imagem ativa. Qualquer publicação futura precisa do seu próprio pacote revisado, testes, aprovação, backup e retorno sem sobrescrever gravações novas.

## 1. Proposta comercial para validação

Nome de trabalho: **LIA Creator — Inicial**. Preço proposto: **R$45 por ciclo mensal**.
Público inicial: lojistas e afiliados que produzem conteúdo original de seus produtos.
Promessa: organizar a criação, aprovação e distribuição de conteúdo, sem garantir vendas, alcance ou monetização.

| Item | Proposta do piloto |
|---|---|
| Espaço de marca | 1 workspace com produtos, identidade visual e projetos |
| Contas sociais | Até 4 destinos: 1 página Facebook, 1 Instagram, 1 TikTok e 1 YouTube |
| Calendário | Até 30 conteúdos únicos por ciclo, distribuíveis nos destinos escolhidos |
| Contagem externa | Até 120 publicações no total, sujeitas às permissões e limites das APIs |
| Idiomas planejados | Português brasileiro como padrão; inglês opcional |
| Franquia de IA | **Não definida**: depende de custo medido e política aprovada |
| Créditos adicionais | Vitrine Coins existentes; débito extra só com consentimento e limite |
| Armazenamento/retenção | **Não definidos**: bloquear venda até aprovar limites e avisos |
| Cobrança adicional no cartão | Desabilitada por padrão; não confundir com uso de saldo já comprado |

30 conteúdos agendados NÃO são 30 vídeos de IA gratuitos. Distribuir o mesmo arquivo em quatro redes utiliza uma criação e até quatro vagas de publicação, não quatro gerações. Uma versão que realmente requer novo processamento recebe novo orçamento.

A mensalidade dá acesso às ferramentas e ao calendário. Esgotar a franquia não bloqueia a organização nem a publicação de arquivos já prontos dentro do plano ativo. Pausa/cancelamento da assinatura não elimina o saldo comprado; gerações por créditos avulsos devem continuar obedecendo à elegibilidade do produto e às regras da carteira, sem grant fictício.

## 2. Economia do plano e Vitrine Coins

A franquia fica `null` e a oferta `draft_not_for_sale`. Não substituir esse campo por zero para contornar uma configuração pendente, nem anunciar vídeos ilimitados.

Teto de custo de fornecedores incluído na mensalidade:

`4500 centavos - taxas de pagamento - tributos - infraestrutura - suporte - reserva de risco - contribuição desejada`.

Todos os componentes precisam ser medidos ou aprovados. `allowanceCostCeiling` calcula apenas esse teto: não calcula tributos e não converte o teto diretamente em créditos de varejo. Câmbio, tarifa, arredondamento, modelo, qualidade e data de vigência devem integrar a cotação versionada de cada projeto. Gastos fixos dos fornecedores também entram na economia, não só custo variável por segundo.

A carteira inspecionada já possui lotes, reservas, recibos, retenções, expiração e isolamento por usuário. O contrato atual contém 9,6 coins/BRL, taxa de recarga de 15% aplicada uma vez e validade de 60 dias. Este pacote **não altera essa política nem as datas dos lotes existentes**. Renovar uma assinatura não renova nem apaga um saldo comprado. Eventual mudança de validade exige revisão separada e termos versionados.

### Lacuna crítica antes de conceder franquia

Hoje a seleção canônica de lotes ocorre por vencimento, sem separar o consentimento de uso de franquia e de saldo comprado. É necessário acrescentar seleção atômica por origem/serviço, preservando o ledger existente. Uma franquia de IA não pode virar crédito irrestrito para Ads/cursos por acidente. A simulação `previewFunding` não realiza nem substitui essa mudança.

Requisitos da futura integração:
- Conceder a franquia uma vez por fatura/ciclo efetivamente pago; identificar `origin=subscription_allowance` e uma fonte imutável vinculada à fatura, sem usar indevidamente o grant de recarga existente.
- Impedir que o mesmo pagamento seja contabilizado como recarga e assinatura. Assinatura autorizada não comprova parcela paga.
- Selecionar primeiro a franquia elegível e depois saldo comprado apenas se autorizado; proteger essa escolha dentro da transação da carteira, nunca só no front-end.
- Reservar o orçamento de todas as etapas antes de chamar provedores, com alocações por etapa. Não reservar novamente os mesmos valores nos adaptadores legados: eles devem consumir a alocação comprovada do projeto.
- Confirmar consumo por recibo. Resposta perdida, custo desconhecido ou excesso ficam em conferência; não liberar reserva nem reenviar geração presumindo ausência de cobrança.
- A devolução do não consumido preserva a origem e o vencimento originais. Reembolso/chargeback demanda reconciliação e retenção apropriada, sem crédito duplicado nem saldo negativo escondido.

## 3. Assinatura e telas

Fluxo: plano e termos → consentimento de recorrência → checkout Mercado Pago → reconciliação autenticada → ciclo pago → concessão única → painel.

A documentação do Mercado Pago distingue assinatura (`/preapproval`), fatura (`/authorized_payments/{id}`) e pagamento (`/v1/payments/{id}`) [1]. Webhooks devem ter assinatura validada; consultar o objeto no provedor e comparar application/collector, cliente vinculado, fatura, assinatura, moeda, valor e ambiente de teste/produção [2]. Não confiar em `paid=true` recebido pelo browser.

Telas a construir: Meu plano; saldo do mês e saldo comprado separados; recarga; produtos/personagens/vozes; Criar vídeo; roteiro/orçamento; andamento por etapa; prévia final; calendário; contas conectadas; falhas e recibos; cancelamento/privacidade.

O painel de administração deve mostrar custo real por etapa, reservas, consumo incerto, margem de contribuição e permissões das APIs. Nunca registrar tokens, imagens privadas ou roteiro completo nos logs operacionais comuns.

## 4. Produção de vídeo em português/inglês

Contrato de experiência: **produto/personagem → roteiro aprovado → orçamento → reserva → voz → cenas → sincronização seletiva → montagem → validação → prévia final**.

Modos: econômico (material do cliente com narração e edição), gerado com narração, personagem falando. A implementação executável desta etapa planeja `narration`, `presenter` e `ambient`; o modo econômico completo ainda requer adaptador de montagem.

- `pt-BR` e `en`: voz salva ElevenLabs; fala nativa Kling desligada para não competir com a locução. A documentação de ElevenLabs lista ambos os idiomas e permite timestamps [3][4]. Sotaque, pronúncia e licença da voz precisam de aprovação.
- Som ambiente: pode usar áudio nativo, sem voz externa. Misturar música/ambiente com narração exige trilhas separadas e direitos de uso.
- Fala com rosto: vídeo e áudio da cena vão ao Sync; cenas só de produto/narração não precisam dele [5].
- Medir áudio antes de produzir imagens em movimento. Voz longa demais não deve ser cortada, acelerada excessivamente ou traduzida silenciosamente. Replanejar e renovar aprovação quando mudar roteiro/custo.
- 60 segundos: seis cenas planejadas de dez; 65 segundos: seis de dez e uma de cinco. O planejador aceita 3–180 segundos como limite editorial inicial, NÃO como suporte confirmado de todas as APIs.
- Verificar durações realmente aceitas pelo modelo antes do orçamento. Se um provedor só aceitar outra duração, planejar o custo e a edição explicitamente. Nunca cortar a fala para encaixar um clipe.
- Os cortes diretos conservam a soma. Transições sobrepostas exigem recálculo e verificação da duração exportada.
- Personagem: referências imutáveis versionadas, figurino, voz, licença/consentimento, workspace e continuidade da série. Repetir IDs não garante rosto/roupa consistentes: manter revisão de qualidade e não prometer identidade perfeita.
- Edição: MP4 vertical 9:16, alvo 1080×1920, voz, legendas selecionáveis, mixagem e áreas seguras. Validar o arquivo entregue, não somente o sucesso da API. FFmpeg precisa de sandbox, timeout, limites, argv sem shell e entradas locais autorizadas.

## 5. Calendário e redes

Aprovação de gasto não autoriza publicar. Aprovação de publicação fica vinculada a arquivo SHA-256, versão, contas, legenda, privacidade, divulgação comercial/IA e agendamento. Qualquer mudança relevante invalida a aprovação.

Armazenar UTC e fuso IANA; a interface converte e confirma o horário. O limite de conteúdo conta uma vez por ciclo; o limite de destinos é independente. Reagendamento/retry não consome outra vaga. Quotas precisam de reserva e unique constraints transacionais para impedir ultrapassagem por concorrência.

Facebook: página autorizada, não perfil pessoal. Instagram: conta profissional e permissões do fluxo escolhido; com Facebook Login requer página vinculada [6]. TikTok: OAuth, revisão da API, duração consultada no creator_info, privacidade sem padrão, prévia e consentimento explícito; sem auditoria não anunciar postagem pública [7]. YouTube: upload/autorização e auditoria quando aplicável; projetos não verificados sujeitos à restrição permanecem privados [8]. A situação real de cada app ainda precisa ser auditada no painel do proprietário.

Estados por destino: `draft → awaiting_approval → scheduled → claimed → submitting → processing → published`. Adicionais: `reconcile_required`, `reauth_required`, `failed`, `cancelled`.

Persistir chave da intenção e recibos/sessão antes/depois de cada efeito externo. Timeout após POST pode significar envio concluído: consultar status ou encaminhar à conferência, sem repetir às cegas. Se uma rede falhar, preservar recibos das outras; não regenerar o vídeo. Revalidar conta/consentimento/assinatura antes do envio. APIs têm quotas próprias, independentes das 120 vagas do plano.

## 6. Mapa de integração e armazenamento (a implementar)

| Base existente inspecionada | Reuso / trabalho necessário |
|---|---|
| `app/public/vitrine-coins-contract.js` | Unidade monetária, taxa e validade canônicas; não duplicar conversão nem aplicar margem oculta |
| `app/vitrine-coins-wallet.js` | Lotes/reservas/settlement; adicionar elegibilidade e alocação por etapa com migração revisada |
| `app/vitriny-neural/coin-wallet-adapter.js` | Owner, carteira unificada e autorização; não chamar grant de recarga com fatura de assinatura |
| `app/media-publication-lifecycle.js` | Padrão de journal, estado desconhecido e recibo; não presumir que implementa os quatro destinos externos para SaaS |
| Pacotes v94/v95 em `ops/` | Preservar produção reconciliada; nenhum checkout de main |

Novas entidades planejadas: `creator_workspaces`, `creator_memberships`, `creator_subscriptions`, `creator_billing_cycles`, `creator_entitlements`, `creator_projects`, `creator_scene_jobs`, `creator_provider_attempts`, `creator_social_connections`, `creator_publication_intents`, `creator_quota_reservations`, `creator_approvals`. Lotes monetários continuam na carteira canônica. Não há DDL/migração neste PR.

Todo registro privado deve ter workspace/owner resolvido no servidor. Uma conta OAuth usada no administrador não autoriza a conta de outro cliente. Segredos em armazenamento privado cifrado; referência a segredo em banco, nunca chave no Git. URLs temporárias de mídia, verificação de domínio/SSRF e expiração de acesso ao material após tarefa. Personagens/vozes precisam de direito de uso e consentimento verificável.

Workers: lease persistente, concorrência limitada por usuário e fornecedor, checkpoint de cada etapa, cancelamento seguro, retomada após reinício e kill switch. Não liberar reservas de tarefas ambíguas apenas por expirar o lease. App gerencia autorização/estado; workers executam; não é necessário um novo repositório.

## 7. Sequência de construção e critérios de liberação

1. **Estrutura**: proposta, planejadores e testes locais (este PR). Sem venda/deploy.
2. **Vídeo ponta a ponta**: adaptadores ElevenLabs/Sync, edição real, filas, custo/recibos e 1 projeto aprovado com imagem/voz/idioma/duração conferidos.
3. **Plano/carteira**: assinatura de teste, webhooks duplicados/fora de ordem, falhas/cancelamento/reembolso, isolamento entre dois usuários, reserva/consumo sem débito duplo, lote de franquia restrito a IA e consentimento para recarga.
4. **Calendário**: uma rede de cada vez, OAuth/revisões, quotas concorrentes, aprovação por versão e teste de queda após POST sem publicação duplicada. Avaliar aprovações de apps desde já, sem prometer prazo externo.
5. **Piloto comercial**: medir 10–20 clientes, fechar franquia, armazenamento/retenção, suporte e termos; liberar apenas redes/provedores verificados. Medir custo por projeto, latência, erros, conferências, suporte e renovação.
6. **Produção**: CI/revisão, staging na imagem exata, backup/rollback e habilitação gradual por conta. Nenhuma cobrança/postagem real só por marcar um checklist como concluído.

A lista `RELEASE_GATES` organiza os bloqueios; `readiness()` é relatório, não autorização de produção. A venda permanece bloqueada até concluir integrações e comprovar custos.

## 8. Como validar este pacote isolado

Requer Node.js 22. Sem npm install, credenciais, Docker ou rede para esta suíte:

```sh
node --test app/scripts/test-lia-creator-structure.mjs
```

Os testes verificam apenas regras e planejadores. Não comprovam integração HTTP, SQLite/concorrência, APIs, renderização, cobrança ou publicação. Exemplos monetários usados nos testes são artificiais, não franquia comercial.

## Referências primárias consultadas em 20/09/2026

[1] Mercado Pago — Assinaturas e faturas: https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview
[2] Mercado Pago — Webhooks: https://www.mercadopago.com.br/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
[3] ElevenLabs — TTS/idiomas: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
[4] ElevenLabs — timestamps: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
[5] Sync — API e ajuste de duração: https://sync.so/docs/api-reference/api-overview ; https://sync.so/docs/developer-guides/sync-mode
[6] Meta — coleção oficial Instagram/Facebook Login: https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login
[7] TikTok — Content Sharing Guidelines: https://developers.tiktok.com/docs/en/content-sharing-guidelines
[8] YouTube — Videos: https://developers.google.com/youtube/v3/docs/videos

Não copiar tarifas de assinatura de aplicativo como custo de API. Tarifas dos provedores, câmbio e elegibilidade externa devem ser reconferidos na implementação e a cada cotação versionada.
