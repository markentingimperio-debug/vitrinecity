# LIA — Vitrine City

LIA é a camada de agente administrativo da Vitrine City. Ela reutiliza a Vitriny Neural, o modelo local da VPS e os controles de segurança já existentes.

## Objetivos da versão 1

- usar o modelo local compatível com OpenAI como padrão;
- manter memória e histórico de tarefas no backend;
- limitar passos e uso por tarefa;
- operar somente para administradores autenticados;
- permitir leitura e edição controlada do workspace;
- exigir revisão humana antes de deploy, pagamentos, credenciais, permissões ou ações destrutivas;
- manter o executor em serviço interno, sem porta pública.

## Componentes

1. Vitriny Neural: skills, memória, benchmark, políticas e roteamento de modelos.
2. LIA Admin: identidade e API administrativa.
3. LIA Executor: serviço interno da VPS que recebe tarefas autorizadas e trabalha no workspace.
4. Modelo local: llama.cpp no serviço `jarvis-model`, reutilizado como backend econômico.
5. Fallback remoto opcional: usado somente quando configurado e dentro do orçamento definido.

## Política

A LIA pode executar tarefas reversíveis no workspace dentro de limites explícitos. Operações de produção e alto risco continuam sujeitas a aprovação humana e aos gates existentes.
