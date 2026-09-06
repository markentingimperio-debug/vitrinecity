# Piloto de conhecimento Microsoft — 06/09/2026

O administrador autorizou usar materiais gratuitos da Microsoft no GitHub para ampliar a memória consultável do Jarvis, mantendo o serviço na VPS e sem contratar serviços pagos. Este piloto contém duas sínteses editoriais em português, revisadas pelo operador. Não instala programas dos repositórios, não treina pesos, não cria busca vetorial, não conecta Azure/OneDrive e não transfere a base da empresa à Microsoft.

## Material revisado

Arquivo: `ops/jarvis/curriculum-microsoft-20260906.json`, ID `microsoft-20260906-v2`. Duas adições, nenhuma correção dos 13 documentos anteriores. Validade de revisão: 06/12/2026. Temas: organização de documentos/RAG; avaliação responsável das respostas de IA. A fonte indica que o Jarvis atual usa recuperação por palavras, não embeddings.

Origem: repositório público [Microsoft Generative AI for Beginners](https://github.com/microsoft/generative-ai-for-beginners/tree/645f932514e9f22f688c8feb3e49a7a7f2eb6f1b), commit fixo `645f932514e9f22f688c8feb3e49a7a7f2eb6f1b`. Foram lidas as lições `15-rag-and-vector-databases/README.md`, `03-using-generative-ai-responsibly/README.md` e a licença MIT. Caminhos, hashes dos bytes originais e data estão no JSON. O aviso de licença está em `ops/jarvis/MICROSOFT-LICENSE.txt`. Não foram importadas imagens, códigos executáveis, credenciais, exemplos de serviços pagos ou afirmações de parceria/endosso.

## Avaliação antes de importar

Os critérios foram definidos em `.claude/evals/jarvis-microsoft-20260906.md`. O ensaio `ops/jarvis/eval-microsoft-20260906.mjs` abre produção somente para leitura e copia todos os 13 documentos para um banco descartável. Não inicializa `createJarvis` no banco real. Modelo somente pela rede privada interna; chamadas em série, teto de 25 segundos, com guarda de pausa/consulta em andamento.

O snapshot de partida usa SHA-256 `0243eba1ff09af5cf1323373c40bd75d10ea6c998cdbd12fbf6004f9836f1056`: JSON UTF-8 de todas as linhas ordenadas por ID, com chaves de cada objeto ordenadas. Mudança nesse snapshot exige nova avaliação antes de importar.

### Rodada v1 reprovada

O plano inicial tinha três temas e seis perguntas. Embora recuperasse as seis fontes e preservasse 16 controles, uma resposta de acessibilidade tratou `aria-describedby` como substituto de nome acessível e sugeriu conformidade não verificada. Outra resposta não distinguiu suficientemente a orientação geral da situação real do site. O lote não foi importado. Acessibilidade foi excluída do piloto, sem reescrever os dois textos restantes para decorar o teste. Uma fonte correta não impede o modelo de produzir uma síntese incorreta.

### Rodada v2 aprovada com limites

Antes da rodada v2, foram adicionadas duas formulações inéditas sobre embeddings e sobre fluência não comprovar verdade. Seis perguntas para dois documentos; sem selecionar as melhores respostas entre repetições.

- A fonte nova esperada passou de ausente em 6/6 perguntas para presente em 6/6. Cinco fontes ficaram em primeiro lugar; na comparação entre métodos de busca, a fonte correta ficou em segundo, depois de um documento sobre Analytics. Isso expõe uma limitação da busca lexical.
- Os 16 controles dos três currículos anteriores mantiveram a fonte esperada em primeiro lugar. Todas as linhas antigas permaneceram idênticas.
- O modelo gerou duas sínteses coerentes: métodos de busca e finalidade dos embeddings. As quatro demais respostas foram retornos explícitos dos trechos, com conteúdo pertinente. Foram revisadas como fallback, não como quatro acertos de geração.
- Os tempos observados foram aproximadamente 8,9–22,0 segundos. Amostra pequena, não um SLA. O motivo informado pelos fallbacks foi `model_unavailable_or_unverified`; não há diagnóstico suficiente para atribuir cada caso a uma causa mais específica.
- A pergunta sem fonte sobre faturamento futuro continuou sem resposta inventada e sem chamada ao modelo. Reaplicação zero; arquivamento de um registro novo no banco descartável não foi desfeito pela reaplicação.
- A memória real permaneceu inalterada durante os ensaios. A revisão semântica aceitou os resultados do piloto v2, sem certificar precisão geral nem aprendizagem autônoma.

Os testes locais existentes de núcleo e currículo passaram. O operador também foi ensaiado com cópia das tabelas relevantes em tmpfs, volume real somente leitura e rede desativada: aplicar, verificar, arquivar seletivamente e repetir arquivamento passaram. Relatório já existente foi rejeitado antes de criar backup ou aprovar documentos. Revisão independente encontrou e ajudou a corrigir uma possibilidade de falha de auditoria depois do commit.

## Publicação de conteúdo pelo operador

O merge deste material não importa conhecimento sozinho. Aplicar somente após revisão, CI e confirmação de saúde/ausência de concorrência. Não é necessário rebuild/reinício do aplicativo ou do modelo para uma importação de conteúdo.

`ops/jarvis/apply-microsoft-20260906.mjs` é um operador de uso único, limitado ao lote e snapshot acima; não é uma API pública nem sincronizador. Montar como `/app/apply-microsoft.mjs` na imagem já conferida do aplicativo, junto de `app/scripts/jarvis-curriculum.mjs` em `/app/scripts/jarvis-curriculum.mjs`, JSON em `/lesson.json`, diretório privado de auditoria em `/work` e volume de dados em `/data`. O código e o JSON têm mount somente leitura. Usar `--network none`; somente `/data` e `/work` precisam de escrita em `apply`/`rollback`.

Segurar `/tmp/vitrinecity-codex-deploy.lock` durante toda a operação. Conferir que a árvore rastreada não tem alterações e que somente arquivos deste lote serão atualizados; preservar arquivos não rastreados e containers existentes. O operador exige o hash exato do JSON `c1d93767fec988cbd81d1a7840cafa7434fe7abf2a78104075c103131ea3a15a`.

Modos de execução dentro do container isolado:

```sh
node /app/apply-microsoft.mjs apply --confirm-reviewed-microsoft-v2
node /app/apply-microsoft.mjs verify
node /app/apply-microsoft.mjs rollback --confirm-reviewed-microsoft-v2
```

`apply` reserva um relatório novo antes de escrever no banco, realiza backup online consistente novo em `/data/recovery-backups/before-jarvis-microsoft-v2-20260906.db` e confere a integridade. Revalida snapshot, pausa e atividade dentro da transação; aprova exatamente dois registros e registra quatro eventos de rascunho/aprovação com operador de sistema (actor 0), sem se passar por uma conta humana. Preserva configurações e estado de trading. Esse backup é local à VPS, não substitui backup externo.

`verify` confere identidade/revisão dos novos registros, hash de todos os antigos, eventos, integridade e plano sem reaplicação. O relatório privado `/work/import-result-microsoft-v2.json` é a evidência da execução real; este documento registra avaliação e procedimento, não presume importação apenas porque houve merge.

Código 74 indica banco possivelmente já atualizado e falha de gravação da auditoria: executar `verify`, nunca repetir `apply` às cegas. Falha após importação exige rollback seletivo e verificação. `rollback` arquiva apenas os dois documentos novos, após conferir fonte, conteúdo, autoria e revisão. Não apaga registros nem restaura um banco antigo sobre dados vivos. Se o administrador já tiver editado o material, o rollback automático aborta para revisão humana. Conferir saúde e identidade dos containers após a operação.

## Próximos passos não implementados

### Ocorrência operacional após PR #134

Em 06/09/2026 às 16:00 UTC, a primeira importação gravou e verificou os dois documentos (IDs 14/15, revisão 2), preservando os 13 antigos. O wrapper tentou a saúde em `localhost:3000` do host, mas essa porta não é publicada pelo Compose. A proteção arquivou seletivamente os dois novos registros, revisão 3, às `2026-09-06T16:00:57.348Z`. A checagem HTTPS pública e a checagem interna no próprio container retornaram 200; os containers permaneceram saudáveis. Não foi uma queda causada pelo conteúdo.

O endereço local de saúde deve ser consultado **dentro do container**, como já faz o healthcheck do Compose, além de verificar `https://vitrinecity.com/api/health`. Não abrir a porta do host para contornar a checagem.

`ops/jarvis/recover-microsoft-20260906.mjs` trata apenas essa reversão do operador: exige os dois IDs, fonte, texto, autoria, criação, revisão 3, horário exato de rollback e os seis eventos originais conferidos. Edições ou arquivamentos administrativos impedem a retomada. Exige novo backup, relatório novo, lock, confirmação `--confirm-own-rollback-recovery` e transação; `resume` aprova na revisão 4 com eventos próprios, sem apagar o histórico; `verify` confere essa revisão. Em nova falha, `rollback-recovery` arquiva só os dois registros na revisão 5. O operador inicial não deve ser reaplicado nem ter seu histórico reescrito.

O teste `ops/jarvis/test-microsoft-recovery-20260906.mjs` usa cópia de tabelas em tmpfs e volume real somente leitura: mudanças administrativas simuladas e alteração de evento devem abortar antes de escrever; retomada, verificação e reversão seletiva devem preservar os 13 anteriores. A evidência da retomada real é o relatório privado `/work/recovery-result-microsoft-v2.json`, não apenas o merge desse procedimento.

Esse ensaio passou em 06/09/2026: as duas simulações foram rejeitadas antes das escritas; retomada, verificação e rollback preservaram os 13 registros antigos; a memória de produção permaneceu inalterada durante o teste. A retomada não precisa executar novamente o modelo: os corpos do lote aprovado continuam exatamente os mesmos.

### Fora do piloto

Ingestão automática de repositórios, sincronização com Drive/OneDrive, histórico integral de todas as revisões no banco, busca semântica e treinamento de pesos continuam fora deste piloto. Crescimento seguro exige seleção de fontes/licenças, revisão, testes de perguntas novas, expiração e observação de erros reais. Não há promessa de que anexar documentos faça o modelo aprender sozinho ou ganhar novas permissões.
