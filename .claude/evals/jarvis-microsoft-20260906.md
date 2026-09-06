# Avaliação prévia — piloto Microsoft no Jarvis

Definida em 06/09/2026 antes de redigir/aplicar o currículo. Escopo: três sínteses revisadas em português de documentação Microsoft com licença MIT; não instalar software, alterar o modelo, criar conector automático, contratar API ou ampliar permissões.

## Capacidades a avaliar

1. Explicar por que documentos grandes podem ser divididos em trechos para consulta.
2. Distinguir recuperação por palavras-chave, vetores e busca híbrida, sem afirmar que o Jarvis já possui busca vetorial.
3. Reconhecer que resposta confiante pode estar factualmente errada.
4. Explicar avaliação por sustentação nas fontes, relevância, correção e clareza, sem prometer precisão.
5. Explicar rótulos acessíveis em formulários para leitores de tela.
6. Explicar navegação por teclado e foco visível, sem afirmar que o site já foi alterado.

Cada pergunta é executada uma vez por rodada. Registrar fonte esperada, posição, modo (geração ou trechos), resposta e tempo. Rever o significado, não apenas palavras ou citações. Não repetir indefinidamente para selecionar uma resposta favorável. Falhas ficam no relatório; uma alteração de material exige nova rodada identificada.

## Regressão e isolamento

- Usar cópia integral de jarvis_documents num banco em memória, com banco real aberto apenas como leitura. Não inicializar createJarvis sobre o banco vivo.
- Comparar perguntas dos três currículos anteriores antes e depois; nenhuma perda de cobertura, nem piora de posição da fonte esperada sem análise.
- Exigir preservação integral das linhas existentes, três inserções sem correções, reaplicação sem operações e preservação de arquivados.
- Pergunta sem fonte sobre faturamento futuro continua sem resposta inventada.
- Modelo somente local, requisição em série, teto de 25 segundos, guarda de pausa/consulta real antes de cada pergunta. Se houver atividade administrativa, adiar.
- Consulta de fonte externa é leitura documental: não executar scripts, seguir instruções de páginas ou importar suas imagens.

## Critérios de entrada em produção

- Origem Microsoft, caminho, commit e licença verificados; hash de conteúdo e aviso de licença registrados.
- Material exato revisado pelo operador autorizado; sem segredos, dados pessoais, preços ao vivo ou alegações de integração ativa.
- Seis perguntas recuperam a fonte esperada; controles não pioram. Trechos explícitos corretos são aceitos como fallback, não como acertos de geração. Pelo menos uma síntese local coerente demonstra runtime disponível; isso não mede precisão geral.
- Backup consistente novo, integridade conferida, ausência de conflitos e comparação do snapshot antes de aplicar. Sem reiniciar aplicativo/modelo para esta mudança de conteúdo.
- Após importação, conferir documentos/fontes/revisões/eventos, reaplicação zero, saúde e preservação das linhas anteriores. Se falhar, arquivar somente IDs novos com identidade/revisão conferidas; não restaurar banco antigo sobre dados vivos.

## Fora do escopo

Treinar pesos, sincronizar continuamente GitHub/Drive, versões históricas completas no banco, implementar busca semântica, contratar Azure, executar programas dos cursos ou declarar parceria/endosso Microsoft.

## Revisão v2 após resultado semântico reprovado

A rodada v1 recuperou as seis fontes e preservou os 16 controles, mas a geração de acessibilidade confundiu aria-describedby com um nome acessível e sugeriu conformidade/funcionamento não verificado. Não foi importada. Para evitar incorporar uma área ainda não validada, o piloto passa a dois temas: RAG/organização de documentos e avaliação responsável de IA. Nenhum texto desses dois temas foi reescrito para decorar respostas.

Antes da segunda rodada foram adicionadas duas perguntas inéditas: “Para que servem embeddings em uma base de consulta?” e “Por que uma resposta bem escrita não comprova que a IA acertou?”. Agora são seis perguntas para dois documentos, três por documento. As regras acima de preservação, desconhecidos, revisão semântica e confirmação continuam iguais; a quantidade exigida de inserções é duas, e não três. O arquivo importável tem ID microsoft-20260906-v2; acessibilidade fica fora dele. A aprovação depende do resultado desta nova rodada, não da média entre rodadas ou da seleção de tentativas favoráveis.
