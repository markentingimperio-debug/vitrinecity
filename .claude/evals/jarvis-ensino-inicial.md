# Avaliação definida antes da importação

Escopo: oito conhecimentos novos e correção factual de um conhecimento inicial sobre o catálogo. Não alterar pesos, prompt, algoritmo de busca, permissões, contatos ou dados comerciais.

Antes/depois: comparar recuperação de fontes e respostas às nove perguntas em `ops/jarvis/curriculum-20260906.json`, com o mesmo modelo/configuração. Registrar a saída e tempo, não apenas aprovações.

Critérios: fonte esperada entre as três recuperadas em todas as perguntas; respostas com fontes existentes e sem afirmações de execução. As verificações de palavras/rotas são sinais determinísticos, não prova de qualidade semântica. Avaliar o conteúdo das respostas e não ajustar os textos apenas para passar nas perguntas. Não esconder tentativas falhas.

Regressões: correções exigem correspondência exata do registro antigo, importação repetida não duplica, documentos alterados/arquivados pelo administrador não são reativados, consultas em execução e configurações não são modificadas pelo importador, nenhuma tabela alheia ao Jarvis é alterada, backup verificado antes da importação real. Questões de faturamento futuro/credenciais sem fontes não podem inventar respostas.

Amostra de estabilidade: repetir três perguntas representativas em três rodadas na janela noturna, sem concorrência de inferência. Guardar resultados completos e relatar quantidade exata; não inferir precisão geral a partir de nove perguntas conhecidas. Testar novas formulações nas rodadas posteriores.

Custos: zero chamadas a provedores de IA externos. Recursos da VPS continuam consumidos. Se Jarvis estiver pausado ou ocupado, adiar a rodada, não ignorar a escolha do administrador.
