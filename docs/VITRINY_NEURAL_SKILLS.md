# Vitriny Neural — Skills e Providers

## Objetivo
Separar **habilidade** de **fornecedor**. A Vitriny Neural decide o que precisa fazer por meio de uma skill; o Skill Registry escolhe um provider saudável para executar.

Isso evita dependência de OpenRouter ou de qualquer API única.

## Skills iniciais

### media.generate
Capacidades:
- `image.generate`
- `video.generate`
- `audio.generate`

Responsabilidades:
- validar briefing;
- normalizar proporção, duração, voz e qualidade;
- escolher provider;
- tentar fallback quando o principal falha;
- devolver asset e metadados;
- registrar evento de aprendizagem no Neural.

### code.engineer
Capacidades:
- `code.analyze`
- `code.plan`
- `code.patch`
- `code.review`
- `code.test-plan`

Por padrão trabalha em modo `dryRun` e exige revisão antes de mudanças reais.

### growth.optimizer
Capacidades:
- diagnóstico;
- plano de campanha;
- plano de conteúdo;
- SEO;
- experimentação;
- leitura de métricas.

Toda recomendação deve trazer plano de medição para virar aprendizado mensurável.

### research.supervised
Capacidades de coleta, comparação, síntese e verificação. Resultados externos nunca são aprovados automaticamente como conhecimento.

## Providers
Um provider é um adaptador substituível. Pode ser:
- modelo local na VPS;
- servidor GPU próprio;
- API direta de um fornecedor;
- serviço interno especializado;
- ferramenta open-source hospedada por nós.

O adaptador HTTP genérico permite conectar providers por uma interface estável (`/health` + `/invoke`). Tokens e segredos continuam fora da memória e do registro de skills.

## Estratégia de fallback
Exemplo para imagem:

`Vitriny Vision -> provider local -> provider A -> provider B`

Se um provider cair, o Registry registra a falha e tenta o próximo. Estatísticas de sucesso/falha ajudam a priorizar providers mais confiáveis.

## Aprendizagem
Cada execução pode gerar eventos como:
- `skill.image.generate.completed`
- `skill.video.generate.completed`
- `skill.audio.generate.completed`
- `skill.code.analyze.completed`
- `skill.growth.diagnose.completed`

Depois, métricas reais (CTR, retenção, conversão, testes, erros, custo e latência) são ligadas à execução. O Neural aprende qual skill/provider funciona melhor para cada contexto.

## Segurança
- nenhuma skill recebe segredos no payload;
- providers externos precisam ser configurados no servidor, não pelo usuário final;
- pesquisa externa permanece supervisionada;
- código real e deploy ficam fora do modo automático inicial;
- pagamentos e operações destrutivas nunca são skills de baixo risco.

## Próximas skills
- Vitriny Commerce;
- Vitriny Support;
- Vitriny Search/Ranking;
- Vitriny SEO técnico;
- Vitriny Analytics;
- Vitriny Ops/observabilidade;
- Vitriny Delivery;
- Vitriny CRM.
