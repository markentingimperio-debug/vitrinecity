# Jarvis — núcleo primário v1

Assistente interno em `/admin-jarvis.html`, também acessível pela central administrativa e pelo edifício neural. Não é um modelo treinado do zero e não é um sistema autônomo de vendas ou implantação. O código, a memória e a orquestração pertencem à aplicação; a geração usa um modelo aberto existente, hospedado na própria VPS.

## O que funciona

- Cadastro de até 500 conhecimentos (título, texto, fonte e validade opcional), com estados rascunho/aprovado/arquivado. Limite de 6.000 caracteres por documento.
- Aprovação explícita; qualquer edição invalida a aprovação e incrementa a revisão. Conflitos de edição são rejeitados, sem sobrescrever silenciosamente.
- Busca lexical limitada a três trechos aprovados e não vencidos. Não há embeddings, busca externa, treinamento contínuo ou ingestão automática de conversas.
- Resposta experimental em português com referências numeradas; revisão humana continua necessária. Referências válidas não provam que cada afirmação está correta.
- Se o modelo estiver ausente, indisponível ou produzir saída sem referências válidas, retorna trechos literais identificados como **sem geração de IA**. Sem correspondência suficiente, informa que não sabe e nem chama o modelo.
- Pausa persistente de novas consultas e cancelamento da consulta em andamento. Revalidação das revisões antes de entregar a resposta; aprovação revogada durante a geração bloqueia a entrega.
- Estado real do serviço, histórico de estados e duração. Não existe animação que represente trabalho contínuo fictício.

Os três conhecimentos iniciais são fatos do próprio núcleo e das rotas do catálogo, identificados como bootstrap do sistema. Informações comerciais adicionais precisam ser cadastradas e aprovadas pela administração.

## Limites e segurança

Administração autenticada e segundo fator quando já habilitado na conta. API em `/api/admin/jarvis`; respostas não armazenáveis em cache. Escritas exigem JSON, cabeçalho `X-Jarvis-Request: 1` e verificação de origem. Máximo de 15 escritas por administrador por minuto e uma consulta global por processo. A v1 pressupõe uma instância do processo Node; múltiplas instâncias exigem coordenação compartilhada antes de expansão.

Nenhuma ferramenta de shell, rede externa, publicação, pagamento, mensagem, compra, coleta de leads ou modificação do site é exposta ao modelo. Texto de perguntas/documentos não determina URLs ou ferramentas. Destino de inferência fixo: `http://jarvis-model:8080`. A rede Docker do modelo é interna, sem porta publicada e sem acesso externo. O modelo roda sem privilégios, filesystem somente leitura e limites de 2 CPUs e 4 GiB. A aplicação não depende da saúde do modelo para iniciar.

Perguntas e respostas são transitórias no aplicativo. SQLite guarda somente identificador, administrador, estado, duração e referências das consultas; a memória salva contém o texto explicitamente cadastrado. Eventos registram responsável e revisão, não o texto de cada versão. Não há interface de exclusão nesta etapa; arquivar apenas retira o documento das consultas. Backups existentes continuam contendo os dados segundo sua política de retenção. Não salvar credenciais, informações pessoais desnecessárias ou conteúdo sem autorização. Filtros de padrões de segredos são uma proteção adicional, não uma garantia de detecção.

O runtime local pode manter trechos no contexto em RAM durante a execução. Não habilitar logs verbosos de prompts. Outros módulos da VitrineCity mantêm suas integrações externas: a garantia de não usar API externa de IA se refere ao **núcleo Jarvis**, não à plataforma inteira.

## Runtime reproduzível

- Modelo: [Qwen3-1.7B-GGUF oficial](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF), Q8_0, licença Apache-2.0.
- Revisão do repositório do modelo: `90862c4b9d2787eaed51d12237eafdfe7c5f6077`.
- Arquivo: `Qwen3-1.7B-Q8_0.gguf`, 1.834.426.016 bytes.
- SHA-256: `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a`.
- Runtime: [llama.cpp](https://github.com/ggml-org/llama.cpp), imagem linux/amd64 derivada de `server-b10795`, digest `sha256:c363a67c08cb74cc9099590d88cd9948ee0c464cca03db40f9cb5c19d5376da9`.
- 4.096 tokens de contexto, uma sequência, 300 tokens de resposta, modo sem thinking. Timeout de geração: 60 segundos.

Não há cobrança por chamada de API de IA. A operação consome recursos e armazenamento da VPS; não é uma promessa de custo operacional zero.

## Instalação e atualização

1. Confirmar branch, alterações locais, saúde, capacidade e ausência de outro deploy; usar o lock `/tmp/vitrinecity-codex-deploy.lock`.
2. Executar `bash ops/jarvis/prepare-model.sh` em host amd64. Baixa artefatos públicos fixados e valida o checksum. Não recebe credenciais. Se existir download parcial, interrompe para inspeção.
3. Testar a aplicação em ambiente isolado, com bancos descartáveis. Não usar o banco de produção nos testes.
4. Fazer backup online de SQLite e preservar imagem e commit anteriores. Não restaurar banco antigo sobre pedidos novos para desfazer uma alteração apenas de código.
5. Publicar com `docker compose --profile jarvis up -d --build --no-deps app jarvis-model`. O serviço opcional é definido via `docker-compose.jarvis.yml`; não é necessário passá-lo como overlay.
6. Validar `/api/health`, saúde do app/modelo, proteção dos endpoints, painel e consulta real. Manter Caddy, search, live-studio e `vitrinecity-codex-executor-1` intactos.

O Compose base usa `JARVIS_LOCAL_MODEL=0` por padrão; o override de produção usa `1` por padrão. A variável explícita no ambiente/arquivo `.env` prevalece e pode desabilitar a geração com `0`. `.env.example` é conservador e traz `0`. O perfil `jarvis` evita baixar ou iniciar o runtime em instalações que não o solicitaram. Rebuilds comuns do aplicativo preservam sua configuração e não precisam recriar o modelo já em execução; para iniciar/recriar o modelo, usar o perfil acima.

Se a versão falhar, recuperar o commit e a imagem anteriores do aplicativo com o mesmo projeto/volumes Docker, sem remover volumes ou restaurar o banco automaticamente. As tabelas novas são aditivas e inertes para a versão anterior. Parar apenas o novo serviço Jarvis se necessário. O botão de pausa é a primeira medida operacional para suspender consultas, sem desativar a plataforma.

## Validação inicial — 06/09/2026

- `test-jarvis-core.mjs`: estados da memória, concorrência, validade, revisão, pausa/retomada, revogação em andamento, ausência de chamadas externas, recusa sem fontes, referências inválidas, fallback explícito, autenticação, CSRF, limites e renderização segura.
- `test-admin-auth.mjs`: integra a autenticação real do servidor e protege HTML/API contra visitantes e usuários comuns.
- `npm run test:release`: 70 scripts aprovados no ambiente local antes da publicação.
- Ensaio na VPS em container isolado, rede interna, banco em memória: três perguntas do painel respondidas pelo modelo em 5,8 s, 4,9 s e 6,8 s. Pergunta sobre cotação futura sem fonte recusada sem inferência. Tempos são uma amostra curta, não SLA ou teste de carga.
- Prévia visual local: rascunho, aprovação e pausa/retomada exercitados pelo navegador; largura de celular 390 px sem overflow horizontal. Dados sintéticos, sem conta administrativa de produção criada para o teste.

## Revisão de arquitetura

Contrato estreito: consultar conhecimento aprovado, produzir texto e fontes; não executar ações. Ferramentas determinísticas tipadas, sem catch-all. Memória durável aprovada separada de conversas transitórias. Contexto limitado e versionado. Saída não vira comando, HTML ou conhecimento aprovado. Fallback explícito, sem outro modelo reparador ou dependência externa oculta. Reinício marca consultas pendentes como interrompidas, sem reexecutá-las. Há testes de invalidação e provas de execução local; qualidade semântica continua experimental. Deploy deve ser bloqueado caso falhe um desses contratos. Expansões futuras (busca externa, recomendações públicas, ações e aprendizado estatístico) exigem nova avaliação e métricas reais.
