# LIA Vídeo dentro do chat existente

**Estado:** especificação de integração; não é uma função publicada nem um instalador.
**Repositório:** markentingimperio-debug/vitrinecity.
**Base examinada:** PR #216, revisão `f7e2df42e92d47b0b1da97bd973c23c3ee94b779`, em 20/09/2026.
**Destino operacional pretendido:** aplicação existente na VPS principal `srv1901029`. Preservar os workers da VPS `srv1987582`.

## 1. Decisão de produto

O chat da LIA será a entrada principal para pedir, acompanhar e receber vídeos. `/lia-video.html` será a biblioteca de projetos e editor complementar, não outro chat. `/admin-lia-video.html` será o painel administrativo dos mesmos projetos, planos, clientes, fila e incidentes. Não criar histórico, carteira ou produção duplicados.

O cliente poderá escrever: “Use a foto deste produto e nossa apresentadora. Faça um vídeo vertical de 1 minuto para TikTok e Reels, narrado em português. Entregue editado com descrição e hashtags.” A LIA deverá reconhecer um projeto de vídeo, reunir os campos faltantes e apresentar uma prévia antes de iniciar consumo.

A palavra “anúncio” sozinha não determina imagem, vídeo ou texto. “Escreva o roteiro de um vídeo” continua sendo texto; não deve iniciar um vídeo pago. Upload ou visualização do histórico nunca autoriza produção. O reconhecimento deve considerar contexto e anexos, mas pedir esclarecimento diante de ambiguidade.

## 2. O que o PR #216 realmente contém

| Encontrado no código | Consequência para a integração |
| --- | --- |
| `lia_video_plans`, `lia_video_subscriptions`, `lia_video_jobs`, `lia_video_scenes`, `lia_video_distribution` | Reutilizar essas entidades; não criar outra carteira de minutos. |
| APIs de cliente em `/api/lia/video` e gestão em `/api/admin/lia-video` | O chat deve chamar o mesmo serviço de aplicação, com a autoridade resolvida no servidor. |
| `POST /api/lia/video/jobs` cria um job `queued` e reserva quota | Não utilizar esse endpoint para um mero rascunho ou para “mostrar orçamento”. |
| Planejamento ocorre após a entrada na fila | Adicionar rascunho e aprovação do roteiro antes de permitir cenas pagas. |
| Cada cena é planejada com até 8 segundos | Não prometer seis clipes de dez segundos nessa versão; a duração deve respeitar o modelo escolhido. |
| `planLiaVideoContent` e TTS instruem português do Brasil; vozes OpenAI | Português/inglês, ElevenLabs e Sync são extensões, não capacidades já entregues por esse PR. |
| FFmpeg concatena cenas, ajusta velocidade da narração e combina áudio/vídeo | É edição com narração; não é sincronização labial. |
| `startLiaVideoScene` envia prompt, duração, proporção, resolução e `generate_audio:false` | Ainda não encaminha a foto privada do produto ou uma identidade persistente da personagem. |
| Publicação Vitrine Social e demais destinos `awaiting_connection` | Não afirmar publicação externa sem autorização e recibo da respectiva rede. |
| `process()` usa exclusão em memória (`running`) | Antes de ampliar concorrência, acrescentar lease persistente e reconciliação por etapa. |
| Workspace nessa branch difere do chat mostrado na produção reconciliada | Não substituir o chat atual por um checkout genérico dessa branch/main. |

Essas constatações são da revisão examinada, não um teste da VPS ou dos fornecedores reais. Aprovação de CI não comprova geração paga, qualidade da fala, consistência visual ou publicação externa.

## 3. Experiência dentro da conversa

### 3.1 Cartão de configuração

Exibir um cartão “Projeto de vídeo” na própria conversa, associado à mensagem que o originou:

- Duração final, armazenada em segundos e apresentada também em minutos.
- Formato: 9:16, 16:9 ou 1:1; TikTok/Reels sugerem 9:16, sem publicação automática implícita.
- Idioma: Português (Brasil) ou Inglês, disponíveis apenas quando o adaptador estiver validado.
- Tipo de som: sem som, ambiente, narração ou personagem falando. Uma opção indisponível deve explicar o bloqueio.
- Voz salva e, quando suportado, personagem e produto de referência.
- Destinos, saldo do plano, custo adicional autorizado e permissões de agendamento.

Dados pessoais, chaves de API, paths do servidor e identificadores de outros clientes nunca são preenchidos pelo modelo. O sistema determina a conta, as permissões e os limites.

### 3.2 Roteiro e autorização

O primeiro rascunho é apenas configuração persistida, sem chamada a gerador. Para escrever um roteiro usando API paga, apresentar a autorização específica de planejamento ou demonstrar que ele está incluído no plano, antes da chamada.

O roteiro gerado deve ficar disponível para revisão. Alterações invalidam a autorização anterior. O cartão final de aprovação identifica revisão do roteiro, duração, formato, idioma, voz, referências, provedor/modelo, etapas, minutos reservados e teto financeiro. A seleção do provedor ocorre antes dessa autorização.

Ação principal: **“Aprovar roteiro e produzir”**. Não interpretar um “sim” ambíguo como autorização para produção, recarga, publicação e agendamento ao mesmo tempo.

### 3.3 Progresso real

Exibir estados confirmados, e não porcentagens inventadas: preparando roteiro; aguardando aprovação; cenas 3 de 8 concluídas; narração; sincronização labial quando contratada e disponível; edição; conferência; entregue.

Reabrir a conversa deve carregar o mesmo projeto do servidor. Atualização de página, duplo clique ou perda da resposta HTTP não devem criar outra produção.

### 3.4 Entrega e publicação

Entregar no chat um player autenticado do MP4, download privado, duração real conferida, roteiro, descrição, hashtags e, se efetivamente produzidas, legendas. A biblioteca e o painel administrativo mostram esse mesmo registro.

Depois da entrega, exibir **Baixar**, **Revisar conteúdo**, **Agendar** e **Publicar**, habilitados conforme plano, conta conectada e estado do projeto. “Agendar” abre prévia por destino, data/hora e fuso horário. Uma solicitação textual de postagem sugere configurações, não autoriza automaticamente o envio.

Revisar roteiro depois de entregue cria nova versão e novo orçamento para as etapas necessárias; não reinicia tudo silenciosamente.

## 4. Arquitetura proposta

```text
Chat atual da LIA / neural-workspace
  -> classificação de intenção + coleta de parâmetros
  -> rascunho de projeto vinculado à conversa
  -> roteiro revisável + orçamento/limite + confirmação
  -> serviço compartilhado LIA Vídeo
       -> quota/plano ou orçamento em Vitrine Coins
       -> fila persistente e adaptadores de cenas
       -> voz / sincronização labial opcional / edição
       -> conferência da duração, mídia e recibos
  -> arquivo privado + eventos e resultado na conversa
  -> aprovação de publicação por destino
       -> publicador autorizado + reconciliação do recibo
```

Preservar o Kling existente para os fluxos já validados; OpenRouter do PR #216 é um adaptador adicional, não substituição silenciosa. OpenAI TTS do PR #216, ElevenLabs e Sync devem ser capacidades distintas. Até ElevenLabs/Sync estarem implementados e testados, a UI não pode apresentá-los como ativos.

## 5. Fronteiras entre componentes

| Componente proposto | Responsabilidade |
| --- | --- |
| `chat-video-intent` | Detectar projeto de vídeo, texto sobre vídeo e pedidos ambíguos; não executar fornecedores nem autorizar cobrança. |
| `chat-video-project-service` | Validar escopo, vínculo com conversa, revisão do rascunho e autorizações; chamar o serviço de produção compartilhado. |
| Serviço de aplicação de `lia-video-studio.js` | Exportar operações autenticadas reutilizáveis, sem fazer chamadas HTTP internas para si próprio. |
| `chat-video-project-card` | Configuração, confirmação, eventos, resultado e erros específicos dentro do chat já existente. |
| Adaptadores de fornecedores | Receber somente capacidades e conteúdo aprovados; persistir recibos e evitar reenvio cego após incerteza. |
| Serviço de publicação | Separar geração de publicação e exigir autorização real de escrita em cada destino. |

Esses nomes são destinos propostos de implementação, não arquivos ou endpoints já instalados.

## 6. Contrato e persistência

O arquivo `lia-video-chat-draft.schema.json` define uma **proposta** de entrada de rascunho. Não é o payload aceito atualmente por `POST /api/lia/video/jobs` e não deve ser enviado a esse endpoint. O contrato não transporta preço, saldo, plano, `userId`, flags de administrador ou tokens. A validação JSON é só o primeiro nível: o backend ainda precisa validar a propriedade de todos os IDs, capacidade, plano e limites.

Operações propostas sob o chat autenticado: criar/ler rascunho; preparar roteiro autorizado; revisar; cotar; confirmar produção; consultar projeto/eventos; solicitar cancelamento; aprovar publicação. O namespace e a implementação finais devem reutilizar os controles do chat já instalado.

Persistir um vínculo único entre conta, conversa, mensagem, projeto de vídeo e chave de idempotência. O projeto pode aparecer em várias visualizações, mas deve ter uma única execução. A confirmação deve vincular o hash da revisão completa do roteiro, referências, voz, idioma, modelo, duração e orçamento. Não aceitar `approved:true` produzido por IA como prova de consentimento.

Histórico, anexos, minutos e mídia de outras contas não devem ser acessíveis via troca de IDs. O acesso administrativo é resolvido pela sessão e auditado; instruções do usuário nunca concedem privilégios.

## 7. Duração, áudio e consistência

Planejar a duração de cada cena conforme as durações permitidas pelo adaptador. O PR atual divide por oito e pode deixar um resto de 1 ou 2 segundos, que precisa ser validado contra o modelo. Quando necessário, gerar uma duração suportada e recortar na edição, cotando a duração efetivamente faturável antes da confirmação.

Medir a fala antes de finalizar a distribuição entre as cenas. Limitar o ajuste de velocidade a uma faixa editorial explicitamente definida; se o texto não couber, oferecer revisão, não acelerar drasticamente ou cortar palavras para fingir sincronização. Compensar sobreposições de transições e verificar a duração e os streams do MP4 final.

Narração sobre o produto não precisa de sincronização labial. Personagem falando exige uma etapa específica. Faixa de som presente não comprova português, palavras corretas nem boca sincronizada.

Para produto/personagem recorrente, guardar referências privadas aprovadas e a voz associada no mesmo escopo. Reutilizar por cena quando o adaptador suportar essa modalidade; não substituir por uma simples descrição sem avisar. Consistência perfeita não é garantida por repetir o nome. Exigir revisão do material e direitos de uso da referência.

## 8. Planos, créditos e cancelamentos

Reutilizar segundos reservados/usados nas assinaturas existentes. Rascunho não reserva produção. A confirmação deve reservar quota e criar job na mesma transação, com unicidade contra repetição. Converter minutos para segundos sem arredondamentos que criem saldo.

Ao esgotar o plano, oferecer orçamento em Vitrine Coins somente quando essa integração estiver concluída. Não descontar de ambos para o mesmo serviço e não transformar uso de saldo comprado em autorização de cobrança no cartão. Qualquer modo misto exige divisão e teto explícitos.

Separar consumo interno do plano, custo real do provedor e quota de publicação. Devolver minutos de uma produção falhada não demonstra estorno no fornecedor. Um pedido incerto após POST deve ficar em conferência até identificar consumo, não ser reenviado automaticamente.

Cancelamento em andamento precisa de estado `cancel_requested`, checagem após cada espera assíncrona e conciliação das tarefas já enviadas. Antes da entrega, impedir que callbacks atrasados publiquem ou marquem sucesso após cancelamento. Uma política de cancelamento não deve permitir repetidas gerações custosas gratuitas sem registro de custo.

## 9. Publicação e privacidade

A reserva de publicação deve ser separada da de produção. Definir se a unidade do plano conta conteúdo ou destino e aplicar isso de maneira consistente; não marcar postagem como consumida apenas porque o MP4 foi editado.

Guardar fuso horário e instante UTC; pedir esclarecimento para horário ambíguo. Agendamento fora do ciclo exige regra explícita e rechecagem de autorização no momento de publicar.

O PR #216 retorna saídas em `/uploads/generated-videos/...`. A integração com o chat precisa conferir a autorização na leitura de cada arquivo e Range request, em vez de presumir que o prefixo de upload fornece privacidade. Gerar URLs temporárias restritas apenas quando um fornecedor precisar de acesso, sem expor anexos privados de forma permanente.

Resultados externos permanecem “aguardando conexão” até autorização de publicação. Métricas, token de leitura ou recebimento de upload não comprovam postagem pública. Depois de interrupção, reconciliar o identificador externo antes de reenviar.

## 10. Implantação e proteção da produção

O PR #216 é baseado em `main`; o último relatório de produção fornecido nesta conversa é da release `release-20260920T141039Z-2dbad738`, com referências do produto e áudio. Esse histórico não substitui uma inspeção atual da VPS.

O script genérico `ops/deploy-video-factory.sh` usa `main` por padrão e faz troca de branch. Não deve ser recomendado para a produção reconciliada sem confirmar que preserva todos os overlays, Compose, init, chaves, volumes, carteiras, histórico, Kling e workers. Fazer merge também não publica automaticamente na VPS.

Primeiro construir e validar uma candidata reconciliada, sem chamadas pagas e sem montar dados de produção. Depois verificar CI/Sonar da revisão exata, inventário da versão ativa, backup válido e retorno de código/configuração. Migrações aditivas devem permitir retorno sem restaurar uma base antiga por cima de novas transações.

A ativação inicial deve ser opt-in administrativo. Não habilitar geradores, pauta automática, clientes ou publicadores apenas por instalar um arquivo. Não emitir comando de publicação até esse caminho estar validado.

## 11. Critérios de aceite

1. Mesmo chat, histórico e conta: projeto anexado à conversa correta e nenhuma leitura cruzada entre usuários.
2. Pedido de roteiro permanece texto; intenção ambígua pergunta; foto nunca é ignorada silenciosamente.
3. Rascunho sem consumo; roteiro revisável; quota e orçamento confirmados antes das etapas cobradas.
4. Confirmação repetida e resposta perdida produzem no máximo um job e uma reserva; recebimentos externos são reconciliados.
5. Voltar à conversa acompanha a tarefa existente; nenhum polling inicia nova produção.
6. Cancelamento durante planejamento, geração, TTS, edição e publicação não é sobrescrito por callback tardio.
7. Português e inglês são oferecidos somente conforme capacidades reais; narração não é rotulada como lip sync.
8. Duração final, dimensões, codecs e áudio conferidos no MP4; fontes privadas e conteúdo revisados.
9. Geração não publica sem consentimento; cada rede informa seu estado real e o recibo confirmado.
10. Candidata e retorno testados com banco/arquivos isolados; nenhum recurso já instalado desaparece.

## 12. Entrega desta organização

Esta revisão acrescenta especificação e contrato de rascunho ao GitHub. Não altera o executável do chat, os provedores, a carteira ou o servidor. O contrato foi validado localmente contra exemplos válidos e inválidos; isso não constitui teste HTTP, concorrência, VPS ou geração de mídia. A integração executável é o próximo trabalho técnico identificado aqui, não uma capacidade entregue por este documento.

### Fontes de código examinadas

- PR #216 e metadados na revisão acima.
- `app/lia-video-studio.js`: validação, quota, rotas e worker.
- Diff de `app/server.js`: roteiro, cenas OpenRouter, TTS OpenAI, concatenação/mux e startup.
- `app/public/neural-workspace.html`: workspace presente na branch do PR.
- `ops/deploy-video-factory.sh`: troca de branch, backup e retorno.
