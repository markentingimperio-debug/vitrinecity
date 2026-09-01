# Continuidade do projeto VitrineCity

Atualizado em 01/09/2026.

## Ambiente

- Site: https://vitrinecity.com
- Aplicação na VPS: `/opt/vitrinecity`
- Execução: Docker Compose, serviço `app`
- Repositório GitHub: `markentingimperio-debug/vitrinecity`
- Branch usada: `codex/sonarqube-test-cleanup`
- Último commit desta etapa: `ac463bd` — `feat: misturar lojas produtos cursos e servicos nas vitrines`
- Não registrar neste documento senhas, tokens, chaves SSH ou credenciais de APIs.

## Funcionalidades implantadas nesta sequência

### Afiliados

- Área de afiliados e campanhas adicionada ao ecossistema.
- Funções administrativas de edição e aprovação previstas no painel.
- Requisitos de vídeo para afiliados foram definidos durante a conversa.

### Centro Educacional e cursos

- Página administrativa: https://vitrinecity.com/admin-cursos.html
- Catálogo público: https://vitrinecity.com/centro-educacional.html
- Administração contempla cursos, capas, vídeos, arquivos, valores, alunos, matrículas e vendas.
- Foi solicitada pré-visualização do curso como cliente e acesso imediato após pagamento.
- A API pública `/api/courses` atualmente entrega cursos e um livro cadastrado.
- Ainda é necessário revisar o conteúdo integral dos livros: o usuário informou que havia somente uma página/landing page e não o livro completo com textos e imagens.

### Editora digital e automação editorial

- Radar editorial e fluxo tendências → rascunho → revisão → publicação foram criados.
- Temas solicitados: notícias, esportes, receitas, tecnologia/IA e famosos.
- Livros pretendidos: dois por dia, mínimo de 30 páginas, 9.000 palavras e 10 capítulos, sempre sujeitos à aprovação.
- Conteúdos sensíveis ou sem fontes suficientes devem continuar bloqueados.
- Deve existir no painel opção para visualizar, revisar e editar cada capítulo antes da aprovação/publicação.

### Serviços digitais

- Página pública: https://vitrinecity.com/servicos-digitais.html
- Painel: https://vitrinecity.com/admin-servicos.html
- API: `/api/services/digital`
- Serviços cadastrados: Google/Maps, página empresarial, pacote de vídeos, identidade social, SEO local, chatbot e implantação de loja digital.
- Checkout é preparado por serviço via Mercado Pago.

### ChatbotX, WhatsApp e canais sociais

- Página: https://vitrinecity.com/admin-chatbotx.html
- Integração do ChatbotX foi adicionada ao painel.
- WhatsApp por QR Code foi conectado e houve trabalho em conversas, grupos e agendamentos.
- Foram solicitadas automações para comentários de Facebook/Instagram, direct, WhatsApp e campanhas em grupos.
- Toda publicação externa deve respeitar aprovação, limites dos provedores e regras antispam.
- Houve relato de aumento de memória da VPS após ChatbotX; monitorar containers e consumo antes de ampliar automações.

### Loja e produtos Agrotécnica

- Loja: https://vitrinecity.com/loja/official_agrotecnica/agrotecnica
- Produtos direcionam para a página correspondente em `adubonpkparaplantas.com.br`.
- Botão de ação foi solicitado como “Comprar”.
- Produtos sem imagem devem receber imagem real/licenciada ou arte identificada, sem inventar aparência enganosa.
- A API `/api/marketplace/products` entrega atualmente 14 produtos publicados da Agrotécnica.

### Vitriny Social

- Foram relatados e trabalhados: lentidão, vídeos ausentes nos perfis, layout móvel cobrindo vídeos e banner global.
- Perfis de teste vazios devem receber apenas conteúdo relacionado e aprovado; evitar publicação fictícia atribuída a terceiros.
- Revalidar perfis e feed em desktop e celular após novas mudanças globais.

## Outdoors e banner interativo — estado atual

- Cidade 2.5D: https://vitrinecity.com/cidade-25d-demo.html
- Mapa interativo: https://vitrinecity.com/cidade
- Foram adicionados quatro outdoors em cada ambiente.
- Rotação automática ocorre a cada 7 segundos.
- Três outdoors da Cidade 2.5D foram posicionados sobre lojas, com suportes curtos, para não esconder fachadas; um permanece na área livre superior.
- O clique abre/direciona para o item correspondente.
- O banner global aparece nas páginas públicas e não aparece no painel administrativo.
- Nova API unificada: `/api/promotions`.
- A API mistura, nesta data:
  - 2 lojas da cidade;
  - 14 produtos;
  - 9 cursos;
  - 7 serviços digitais.
- Ordem intercalada: loja → produto → curso → serviço, evitando que serviços dominem a divulgação.
- O banner global usa o mesmo catálogo e mostra tipo, título e preço.
- Arquivos principais:
  - `app/server.js`
  - `app/public/global-market-banner.js`
  - `app/public/cidade-25d-demo.html`
  - `app/public/cidade-25d-demo.css`
  - `app/public/cidade-25d-demo.js`
  - `app/public/cidade-exploravel.html`
  - `app/public/cidade-exploravel.css`
  - `app/public/cidade-exploravel.js`
  - `app/public/cidade.html`

## Verificações realizadas na última publicação

- `/api/promotions` respondeu com 32 anúncios.
- Contagens confirmadas: 2 lojas, 14 produtos, 9 cursos e 7 serviços.
- Cidade 2.5D e mapa interativo carregam `/api/promotions`.
- Banner global carrega `/api/promotions`.
- Scripts receberam versão `v=3` para reduzir problemas de cache.
- Alterações foram publicadas na VPS e enviadas ao GitHub.

## Como publicar com segurança

1. Trabalhar somente no diretório local deste repositório.
2. Preservar alterações e arquivos não relacionados do usuário.
3. Validar JavaScript com `node --check` e executar `git diff --check`.
4. Copiar apenas os arquivos modificados para `/opt/vitrinecity/app` ou `/opt/vitrinecity/app/public`.
5. Na VPS, executar `docker compose up -d --build app` dentro de `/opt/vitrinecity`.
6. Conferir `/api/health`, as APIs modificadas e as páginas públicas por HTTP.
7. Fazer commit e push na branch correta.
8. Nunca remover containers órfãos, bancos, uploads ou volumes sem revisar o alvo e obter autorização específica.

## Próximas prioridades sugeridas

1. Fazer revisão visual móvel dos quatro outdoors para garantir que nenhum encubra loja ou controle em diferentes larguras.
2. Criar administração do catálogo de promoções para ordenar, pausar e definir período de cada anúncio.
3. Permitir que lojas pagantes cadastrem campanha de R$ 49,90/mês, com aprovação antes de entrar na rotação.
4. Concluir leitor/editor integral de livros no painel, com capítulos, imagens, contagem de páginas/palavras e aprovação.
5. Revisar desempenho da Vitriny Social e memória consumida pelo ChatbotX.
6. Conferir acesso automático aos cursos após confirmação do pagamento e testar o fluxo como cliente.

## Observação para a próxima conversa

Antes de implementar algo novo, ler este arquivo, conferir `git status`, o último commit e o estado real da VPS. Não assumir como concluídas funcionalidades antigas apenas com base na conversa; confirmar por código, API e página publicada.
