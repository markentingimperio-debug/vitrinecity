# Pesquisa supervisionada do Jarvis

O administrador autorizou, em 06/09/2026, dar autonomia ao Jarvis para buscar conhecimento. A primeira etapa usa um coletor determinístico separado do modelo: consulta fontes públicas, organiza links e trechos como rascunhos e aguarda revisão humana. Não aprende pesos, lê conversas, define novos objetivos, aprova material, publica, gasta dinheiro ou executa código de resultados.

## Limites definidos antes da ativação

- Temas e consultas fixos: SEO/conteúdo no Google Search Central, marketing digital em artigos do Sebrae e fundamentos de IA no Microsoft Learn. O administrador escolhe os temas, não uma URL ou prompt arbitrário.
- Uma consulta na primeira página por rodada; até duas tentativas por dia UTC, incluindo erros e buscas manuais. Intervalo mínimo de seis horas. Rodízio dos temas escolhidos.
- Até três rascunhos novos por rodada, 20 rascunhos de pesquisa pendentes e 100 fontes únicas registradas no piloto. O limite global de 500 conhecimentos continua valendo. Não apaga dados automaticamente para liberar espaço.
- O agendador verifica a oportunidade a cada minuto na VPS. Estado/contagem/lease persistem no SQLite: reiniciar o app não zera quota nem repete imediatamente uma rodada interrompida. Só uma pesquisa por vez; aguarda consultas Jarvis em andamento.
- Pausar a pesquisa cancela a rodada e impede próximas. Cancelar só a rodada preserva o agendamento e a quota já usada. Pausar as consultas do Jarvis também impede coleta/gravação; a UI distingue as pausas.
- Três falhas consecutivas desativam a pesquisa, mantendo os registros e pedindo conferência do buscador. O horário exibido é oportunidade, não promessa de resultado.

## Fronteira de rede e custo

O único endpoint chamado pelo coletor é `http://127.0.0.1:3000/api/search/web` **dentro do container do aplicativo**, com `type=web`, `page=1`, consulta pública fixa, sem cookies, credenciais ou dados da empresa. Reutiliza o SearXNG já hospedado; não usa `/api/search/ai` nem configura provedor pago. Não altera cobrança. Há consumo normal da VPS/rede; “sem contratar API” não significa infraestrutura sem custo.

O endpoint existente mantém cache, limites de concorrência/tamanho/tempo e rate limit. O coletor acrescenta timeout de15s, corpo máximo de1MB, `redirect:error` e orçamento persistente. O filtro `site:` serve apenas para descoberta. Cada URL de resultado é validada novamente por protocolo HTTPS, host e caminho permitidos, sem usuário/senha ou porta alternativa. Parâmetros/hash são removidos para deduplicação. Nenhuma página resultante é baixada, incorporada ou executada, nem há raspagem de perfis, pessoas ou grupos.

Referências públicas dos temas: [Google Search Central](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [artigos Sebrae](https://sebrae.com.br/sites/PortalSebrae/artigos/marketing-digital-em-midias-sociais-faz-diferenca-no-seu-negocio%2Cb742d18c73881810VgnVCM100000d701210aRCRD) e [Microsoft Learn](https://learn.microsoft.com/). Presença nessas fontes não comprova exatidão, atualidade nem licença de republicação de todo o conteúdo.

## Rascunhos e revisão

Salva somente título, prévia de até300caracteres, URL/data e hash da prévia, sem imagens/artigos completos. A origem e licença aparecem como pendentes de revisão. O coletor usa `core.save` para criar rascunhos, nunca `transition('approved')`, nunca atualiza conhecimento existente e nunca reativa arquivados. A URL única continua registrada mesmo que o administrador edite ou arquive o documento. Fontes já mencionadas na memória também são preservadas.

Um rascunho não entra na recuperação nem nas respostas do modelo. No painel `/admin-jarvis.html`, abra a fonte, confira direito de uso, significado e atualidade, transforme a prévia em conhecimento revisado e só depois use a confirmação de aprovação já existente. Uma página, resultado ou resposta de IA é dado não confiável, não uma instrução para o sistema.

## API e operação

Sob o mesmo middleware de autenticação administrativa, JSON, `X-Jarvis-Request`, origem e rate limit do Jarvis:

- `GET /api/admin/jarvis/research/status`: estado, limites, fontes permitidas, próxima oportunidade e último resultado; sem cache.
- `POST .../research/settings`: `{enabled,topicIds,revision}`. Conflito de revisão exige recarregar. Mudar configuração cancela a rodada pendente sem zerar orçamento.
- `POST .../research/start`: objeto vazio; responde202 rapidamente. Resultados continuam no servidor, não dependem de navegador aberto.
- `POST .../research/cancel`: `{id}` da rodada. A requisição e a gravação são canceladas no servidor, mesmo que uma resposta de busca chegue atrasada.

As tabelas `jarvis_research_settings` e `jarvis_research_sources` são aditivas. Instalação inicia desligada. Habilitar somente após ensaio isolado, testes e aprovação administrativa do escopo; fazer primeira consulta real supervisionada antes de manter o agendamento. Conteúdo já aprovado e controles de trading não são alterados. O modelo local continua sem ferramenta de navegação ou execução externa.

## Critérios de verificação e reversão

Testes independentes devem conferir fontes/URLs, limites persistentes, duplicatas inclusive arquivadas, concorrência entre instâncias, cancelamento/pausa com resposta atrasada, ausência de rascunhos na recuperação, fontes malformadas e credenciais, parada por falhas, tamanho/timeout, além de autenticação/CSRF/rate limit das novas rotas. O painel deve preservar foco, edições e confirmação durante polling.

Antes de deploy: Git limpo em branch, testes no runtime isolado, backup online consistente novo e identificação da imagem saudável para rollback. Publicar somente o app, sem remover volumes ou executor nem reiniciar modelo/buscador. Conferir saúde interna no container e HTTPS. A pausa de pesquisa é a primeira contenção. Se for necessário voltar à imagem anterior, manter as tabelas aditivas e rascunhos, sem restaurar banco antigo sobre dados vivos; o código antigo ignora as tabelas novas.

Limitações: indexação incompleta e motores indisponíveis podem deixar zero candidatos. Não há garantia de cobrir qualquer assunto, compreender artigos inteiros, sincronizar revisões de uma página ou melhorar automaticamente a precisão do modelo. Novas fontes ou poderes exigem nova revisão de escopo.

## Evidências locais de 06/09/2026

- 79 scripts de regressão da plataforma passaram, incluindo os dois novos scripts de pesquisa.
- 19 cenários independentes do coletor passaram; API administrativa verificada com fixtures sem rede externa. Incluem pausa global seguida de retomada e fornecedores indisponíveis sem resultados, encontrados na revisão independente.
- Chrome headless com banco em memória: iniciar, cancelar resposta atrasada, pausar, criar três rascunhos e abrir links de fonte preparados para revisão; nenhuma aprovação automática, erro JavaScript ou requisição externa.
- Layout inspecionado em 1440, 768 e 375 pixels, sem rolagem horizontal. Polling preservou edição, foco e confirmação manual. Não há baseline anterior para afirmar regressão visual por comparação de imagens.
- Essas evidências são de ambiente isolado; não comprovam, sozinhas, ativação ou resultado em produção.
