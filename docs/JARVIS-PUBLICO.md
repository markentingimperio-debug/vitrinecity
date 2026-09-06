# Jarvis público — pesquisa e memória revisada

Pedido autorizado pelo administrador em 06/09/2026: conversar com visitantes, buscar conteúdo público e guardar conhecimentos para reuso. Esta implementação é um piloto limitado, não uma IA com autonomia irrestrita ou treinamento de pesos.

## Fronteiras

- `/jarvis-public.html`: perguntas independentes com consentimento explícito para consultar motores de busca. Até seis trocas somente na memória da página; sem histórico em localStorage nem envio do histórico como contexto.
- `/admin-jarvis-public.html`: curadoria **pública** separada, com login/segundo fator administrativo existentes. Salvar edição retorna a rascunho. Aprovar exige confirmar fonte, licença e autorização para divulgação pública. Prévia bruta deve ser editada antes da aprovação.
- Nenhuma leitura/escrita da memória empresarial `jarvis_documents`, histórico `jarvis_runs` ou configuração `jarvis_settings` pelo módulo público. “Aprovado internamente” nunca significa “autorizado para o público”.
- Modelo local fixo `http://jarvis-model:8080`; sem ferramentas, navegação por instrução do modelo, execução de comandos, mensagens, pagamentos ou alternativa automática de API externa.

## Fluxo

1. Valida pergunta de 3–300 caracteres, campos exatos e consentimento. Rejeita padrões comuns de dados pessoais/credenciais e solicitações perigosas ou sensíveis. É uma proteção conservadora de piloto, não um classificador universal.
2. Reserva orçamento diário e uma rodada pública por vez antes de qualquer consulta externa.
3. Procura primeiro texto explicitamente aprovado na coleção pública, não vencido, com sobreposição suficiente à pergunta. Nesse caso entrega trechos revisados sem buscar novamente.
4. Quando não houver memória correspondente, consulta o SearXNG existente por callback, somente a primeira página textual. Não baixa páginas de resultados, imagens ou perfis. Descarta candidatos sem termos significativos em comum com a pergunta e ordena por essa correspondência antes de selecionar até três fontes com prévias de 350 caracteres. Esse filtro lexical reduz ruído; não é uma prova de relevância semântica.
5. Tenta síntese curta no modelo local, compartilhando uma única vaga de inferência com o Jarvis administrativo. Ocupação, falha, excesso de saída ou citações inválidas resultam em **trechos**, identificados como tal. Sem fontes suficientes, informa isso.
6. Até duas prévias elegíveis podem virar novos rascunhos privados da coleção pública, com URL/data/validade. **A pergunta e a resposta gerada não são gravadas como conhecimento.**

Validar `[1]` impede referência inexistente, mas não prova a exatidão de cada afirmação. A interface identifica sínteses como experimentais e pede conferir as fontes. Não promete respostas a qualquer assunto nem substitui profissionais.

## Memória e retenção

- Fontes de ingestão permitidas: Google Search Central, artigos Sebrae, Microsoft Learn, artigos pt/en da Wikipédia (sem namespaces de usuário/especiais) e caminhos de conteúdo agrícola da Embrapa. Outros links textuais seguros podem aparecer na resposta sem serem incorporados à base.
- Apenas título, prévia, URL, estado, versão, data, validade e identificação do operador de curadoria são persistidos. Nada é aprovado automaticamente.
- URL única; editar/arquivar não libera a URL para reinserção. Não remove registros para liberar espaço. Prévia: 14 dias; nova aprovação: 30 dias. Vencidos ficam para revisão, fora das respostas revisadas.
- 20 rascunhos pendentes e 100 fontes no máximo; base pública não é uma cópia de todos os resultados pesquisados.
- Cache público efêmero de fontes por 10 minutos, até 100 entradas, chave HMAC com sal aleatório do processo. O metasearch existente também mantém consulta em cache RAM por 2 minutos. Não há promessa de ausência absoluta de retenção temporária, nem de apagar registros de motores externos.
- Textos de perguntas/respostas não são persistidos no banco da VitrineCity. IP vira chave temporária HMAC na RAM para limite de uso; não é associado a conhecimentos.

## Capacidade, ativação e proteção

- Inicia pausado. Ativação versionada no painel ou pelo operador após testes isolados e ensaio de qualidade.
- Até 60 consultas públicas/dia UTC, persistidas em uma linha SQLite; falhas e consultas à memória também contam. Até três solicitações/minuto por IP em memória, mapa limitado a 2 mil visitantes.
- Uma rodada pública por vez, lease de 85s; busca limitada a 15s, modelo a 45s, operação a 65s. Sem fila ilimitada. Gate de modelo global em `jarvis_model_lease`, máximo 65s, compartilhado com consultas internas e protegido por token de proprietário.
- Pausar ou alterar configuração invalida a rodada corrente. Desconectar/cancelar a requisição impede resposta/gravação tardia. Quota reservada não é devolvida por cancelamento. Reinício não zera orçamento diário.
- POST público exige JSON, origem exata da plataforma, cabeçalho `X-Jarvis-Public: 1`, consentimento e nenhum parâmetro na URL. Nenhuma credencial do visitante é encaminhada à busca/modelo. API pública não retorna documentos administrativos.
- APIs administrativas separadas exigem autenticação, origem/JSON/cabeçalho `X-Jarvis-Request: 1`. HTML e APIs sem cache; CSP estrita nas novas páginas, conteúdo renderizado por `textContent`, links HTTPS em nova aba com `noopener noreferrer nofollow`.
- Sem nova tarifa por chamada de IA; o processamento e a busca consomem recursos da VPS já contratada.

## API

- `GET /api/jarvis/public/status`: disponibilidade e limites públicos.
- `POST /api/jarvis/public/ask`: `{question,searchConsent:true}`; retorna resposta, modo `local_model|excerpts|approved_memory`, fontes e data. Sem fonte: `status=no_sources`. Erros de entrada, consentimento, ocupação/quota ou indisponibilidade usam 400/403/429/503; cancelamento invalidado usa409.
- `GET /api/admin/jarvis-public/status` e `/knowledge`: configuração e coleção pública para curadoria.
- `POST .../settings`: `{enabled,revision}`.
- `PUT .../knowledge/:id`: `{title,body,revision}`; URL de origem imutável, título140 e corpo2500 caracteres, volta para draft.
- `POST .../knowledge/:id/status`: `{status,revision,confirmedPublic:true}` para aprovação. Outros estados: draft/archived.

## Publicação e retorno

Tabelas aditivas, sem alteração de dados anteriores. Testes em bancos sintéticos com sentinelas privadas e rede bloqueada. Antes de publicar: backup online consistente novo, snapshot dos documentos internos, imagem anterior preservada, CI e ensaio de geração. Publicar apenas o app, preservar modelo/buscador/executor/volumes, verificar HTTP interno dentro do container e HTTPS. Só ativar depois da conferência.

Em falha, pausar público e voltar à imagem anterior; não restaurar banco antigo sobre dados vivos. Tabelas e rascunhos aditivos podem permanecer. O coletor administrativo supervisionado e sua memória de 15 aprovados + três rascunhos são independentes desta funcionalidade.

## Verificação da implementação

- 34 cenários de aceitação pública (incluindo cinco regressões de relevância), nove do gate de modelo, teste HTTP real de autenticação/origem e suíte de release de 82 arquivos passaram em isolamento.
- UI integrada com Express e SQLite em memória: consentimento → pergunta → prévia → edição administrativa → aprovação explícita → reutilização sem busca. Cancelamento tardio, ausência de cookies/histórico no POST e sentinelas privadas também conferidos.
- Layout público/curadoria inspecionado em 375, 768 e 1440px, sem overflow; não havia baseline para afirmar ausência de regressão visual por comparação.
- Auditoria somente leitura encontrou `qs@6.15.3` moderado, preexistente e indireto. Os caminhos reportados (`comma:true` e `qs.stringify`) não são usados pelo novo endpoint JSON. Atualização controlada para 6.16.0 fica como manutenção separada; nenhum lock foi alterado aqui.
- Esses ensaios não atestam toda resposta do modelo: antes de ativar em produção, conferir também fontes/respostas reais com a coleção pública pausada e dados de ensaio em memória.
