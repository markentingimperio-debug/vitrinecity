# Ensino sobre aprendizado — critérios anteriores à correção

Em 06/09/2026 06:53 UTC, um ensaio novo de linguagem coloquial encontrou a fonte em três de quatro perguntas. Houve duas sínteses coerentes, um fallback correto e uma ausência de fonte. O enunciado `o jarvis aprende sozinho tudo que converso com ele?` não recuperou o documento existente sobre ensino, embora seu significado estivesse coberto. A resposta se absteve: segura, mas insuficiente. Não duplicar a memória para elevar a contagem.

Correção selecionada: esclarecer o documento inicial de ensino com linguagem natural sobre aprender, conversar, memória e aprovação, mantendo os fatos do código `app/jarvis-core.js` no commit 91d1587. Não alterar algoritmo, pesos, prompt, limites, permissões ou guardas de citações.

Critérios pré-definidos:

- A fonte corrigida deve ser encontrada na pergunta que falhou e em duas formulações novas, testadas uma vez cada.
- Explicar que conversas não causam aprendizagem automática e que cadastrar/revisar/aprovar memória não treina os pesos do modelo. Para ensinar/corrigir, orientar a revisão e nova aprovação; não prometer que o chat salva conteúdo sozinho.
- As 13 perguntas dos dois lotes anteriores devem manter a fonte esperada na recuperação; a pergunta de faturamento futuro deve permanecer `no_sources`.
- Registrar geração, fallback, fonte encontrada, duração e análise semântica separadamente. Uma referência válida sozinha não prova que a resposta está correta.
- Usar cópia descartável dos 13 documentos de produção e modelo local, três chamadas no máximo, cada uma limitada a 25 segundos. Guardas de pausa/atividade do administrador antes de cada chamada.
- Importação só pode corrigir o documento de sistema original, revisão 1, estado aprovado e corpo/fonte exatos. Se houve edição administrativa, abortar sem sobrescrever. Reaplicação deve fazer zero operações. Backup novo, registro de revisão e os outros 12 documentos idênticos.
