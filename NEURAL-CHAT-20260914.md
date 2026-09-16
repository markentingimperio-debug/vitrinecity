# Lia: chat privado e bases de créditos IA — 14/09/2026

## Entrega e limites

Nome do chat: **Lia — IA da VitrineCity**. Lia também é a agente de vendas; o nome não altera a identidade dos módulos Jarvis/Vitriny Neural, APIs, bancos ou variáveis existentes.

- `/neural-workspace.html`: conversa contínua, histórico no servidor, nova conversa, seleção interna de capacidade e anexos privados.
- `/neural-tasks.html`: interface anterior preservada, com os mesmos rascunhos, tarefas, controles e dados.
- `/admin-vitriny-neural.html`: acesso destacado ao chat; ferramentas anteriores permanecem em Administração avançada.
- Lojas usam `?store=REFERENCIA`, autenticação existente e allowlist `VITRINY_NEURAL_CHAT_STORES` (fallback: `VITRINY_NEURAL_TASKS_STORES`). Administradores têm histórico separado por usuário, não um histórico global.

O chat não é público para visitantes anônimos. A conexão ao histórico **não significa que o modelo esteja operacional**. Respostas locais exigem configuração habilitada, modo advisory/low_risk_auto e qualificação vigente vinculada ao modelo/capacidade. `shadow` nunca é contornado por avaliação.

**Não habilitado nesta entrega:** fallback pago OpenAI, visão, pesquisa web, geração de imagem/vídeo/áudio, execução de código, publicações, pagamentos e aprendizado automático de conversas. Esses pedidos retornam indisponibilidade explícita. Não existe chamada paga real nos testes.

## Anexos e privacidade

- PNG/JPEG/WebP: até 2 MiB cada, até 24 milhões de pixels; envelope/tipo/dimensões verificados, sem alegação de varredura antivírus.
- TXT/MD/CSV UTF-8: até 64 KiB cada. PDF/DOCX não suportados.
- Até três arquivos por mensagem; até 40 arquivos/20 MiB por acesso, 400/128 MiB globalmente.
- Bytes em tabelas SQLite privadas, sem arquivos públicos, URLs externas ou parser executável. Toda leitura verifica proprietário; cabeçalhos no-store/nosniff.
- Contexto de texto limitado a 16 mil caracteres e oito mensagens recentes. Imagens não entram na inferência textual. Documentos e histórico são dados não confiáveis, nunca instruções privilegiadas ou conhecimento aprovado.
- Quotas de retenção não apagam dados automaticamente. Política/fluxo de exclusão e retenção de longo prazo precisam ser definidos antes de ampliar o acesso.

## Entrega de mensagens

Cada envio possui chave idempotente ligada a mensagem, conversa e anexos. Recebimento incerto é recuperado por GET; não ocorre reenvio automático. Se a consulta não encontrar o pedido, somente ação explícita permite repetir exatamente o payload com a mesma chave, sem reupload ou novo identificador. Cancelamento/timeout não libera a concorrência até o transporte encerrar. Reinício preserva pedidos sem repetir inferência; revogação de loja não impede a limpeza interna de pedidos expirados nem bloqueia outros acessos. Respostas solicitando ferramentas não são aceitas como ações concluídas. Limites atuais: 20 pedidos/dia por acesso, 100/dia globais, duas inferências simultâneas, 45 segundos, 120 mensagens/conversa.

## Créditos: núcleos preparados, não comercializados

`ai-credit-pricing.js` e `ai-credit-wallet.js` são módulos internos isolados. **Não estão conectados ao chat, checkout, APIs públicas ou saldo real.** A carteira fica desabilitada por padrão. Nenhum saldo antigo, carteira Ads ou VitrineCoins recebe nova validade ou preço.

- Custo de fornecedor em USD, cotação BRL e tarifa versionadas; acréscimo fixo de 50% (multiplicador 1,50, não margem bruta de 50%).
- Chat: entrada, saída e entrada em cache discriminadas. Uso ausente não é custo zero.
- Imagem/vídeo: orçamento de servidor válido e vinculado ao pedido. R$2 por vídeo foi exemplo do administrador, não tarifa publicada.
- Cálculo exato com BigInt e um único arredondamento final em microBRL; a ponte para carteira deverá validar inteiro seguro e limite antes de converter string em number.
- Reserva do teto autorizado, liquidação exata uma vez, liberação de sobra sem renovar validade; saldo não pode ficar negativo.
- Recibo conhecido acima do teto fica retido para conciliação. Sua evidência e identificação são preservadas; custo conhecido não pode ser alterado ou reutilizado silenciosamente. O fluxo auditado de resolução ainda não foi implementado.
- Novas compras: proposta técnica de 60 dias, uso interno e sem conversão em dinheiro fora da plataforma. Não foi publicado contrato de não reembolso absoluto; direitos legais precisam ser preservados e termos revisados antes da venda.
- Validação do pagamento, autorização do teto, verificação de recibo e namespace global do fornecedor são responsabilidade de futura integração autenticada. O módulo isolado não prova esses eventos.

## Próximas entregas necessárias

1. Roteamento de API paga, cotação e consentimento por requisição; conciliação de erros e consumo real de fornecedores, sem chamadas de teste não autorizadas.
2. Checkout de créditos, recibos, termos e política de retenção/exclusão; não usar carteira Ads como saldo IA.
3. Geração imagem/vídeo com referência e recibo real. A integração atual de Kling Studio não equivale à API comercial AK/SK; não assumir créditos intercambiáveis.
4. Vitrine Neural Ads: recomendações orgânicas pertinentes primeiro; publicidade separada com rótulo **Patrocinado**. Leilão proposto de CPC R$0,15–R$3,00 depende de placement próprio, relevância, orçamento, antifraude e atribuição auditável. **Ainda não implementado nem ativado; CPC dos anúncios existentes não foi alterado.**
5. Validar capacidade/qualidade operacional do modelo. Interface e testes com respostas simuladas não certificam qualidade factual, visão, pesquisa ou geração real.

### Planejamento para 50 pedidos de vídeo recebidos juntos

Receber pedidos não equivale a 50 gerações simultâneas. A futura fila persistente deverá limitar os trabalhos em execução ao limite efetivamente concedido pela Kling, com divisão justa entre clientes, orçamento/saldo e reserva antes do despacho. Ao terminar um trabalho, inicia-se outro. Cada pedido e recibo precisa de identidade persistida; falha de conexão após envio exige consulta/reconciliação, não repetição cega. A interface deverá diferenciar aguardando, gerando, concluído e revisão, sem prometer prazo não medido. Nenhuma fila de vídeo foi ativada nesta entrega.

O [guia da plataforma API Kling](https://docs.qingque.cn/d/home/eZQA6m4cRjTB1BBiE5eJ4lyvL?identityId=1oEER8VjdS8), consultado em 14/09/2026, informa que compras adicionais do pacote básico não aumentam concorrência e orienta contato para demandas elevadas. O limite específico desta conta ainda não foi confirmado; não supor 5, 20 ou 50.

O administrador pediu esta proteção para imagem, vídeo e respostas de chat, com rapidez. A integração deverá usar filas separadas por modalidade/fornecedor para não causar bloqueio de conversas por vídeos demorados. Chat deverá priorizar baixa latência e, quando suportado/validado, transmissão incremental da resposta; mídia roda em segundo plano. Concorrência limitada por conta/modelo e rate limit real, distribuição justa, orçamento e medição de espera/tempo de geração/p95 devem orientar ajustes. Não há garantia de tempo de geração externo, streaming ou fila de mídia implementados nesta versão.

## Verificação reproduzível

- `npm run test:neural`: regressões existentes e novos testes de chat/precificação/carteira.
- `node scripts/test-ads-pricing.mjs`: preços Ads legados intactos.
- `node scripts/browser/test-neural-chat-browser.mjs`: navegador local com APIs simuladas, sem rede externa, larguras 320/360/390/412/768/1280.
- Smoke com `server.js` real e banco temporário: autenticação, isolamento, origem e indisponibilidade honesta; não usa banco de produção.
- Publicação deve manter flags e dados, verificar aplicação e containers protegidos, conservar imagem anterior e reverter somente o código/imagem se necessário. A confirmação de deploy pertence ao relatório operacional, não a este documento de implementação.
