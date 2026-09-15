# Ensino administrativo da Lia — piloto de 15/09/2026

O piloto prepara 50 exemplos em cinco áreas: plataforma, vendas, gestão,
marketing e SEO. DeepSeek produz rascunhos; OpenAI faz uma revisão independente.
Dez perguntas de avaliação ficam separadas e nunca entram no prompt dos professores.
Gerar exemplos não altera pesos, modo shadow, qualificações ou permissões.

## Fronteiras

- Orçamento próprio da empresa: teto inicial fixo de R$ 20, sem recarga automática.
- Não usa carteira, saldo, reserva ou débito de Vitrine Coins.
- Somente fontes públicas revisadas; sem conversas privadas ou dados de pedidos.
- Ledger SQLite privado e exclusivo; o banco operacional é recusado.
- Um identificador estável por lote/professor, ligado ao conteúdo exato. Reiniciar
  não dispara a mesma consulta outra vez.
- Consumo desconhecido fica retido pelo teto reservado. Não interpretar como
  gratuito, reenviar automaticamente ou trocar de provedor depois de erro incerto.
- `completed` confirma transporte e recibo, não aprovação de conhecimento.
- Nenhuma resposta do professor vira fonte aprovada automaticamente.

## Tarifas congeladas deste piloto

As tarifas por milhão de tokens foram conferidas nas páginas oficiais em 15/09/2026:

| Modelo/faixa | Entrada sem cache | Entrada com cache | Saída |
| --- | ---: | ---: | ---: |
| DeepSeek Flash, fora do pico | US$ 0,15 | US$ 0,003 | US$ 0,60 |
| DeepSeek Flash, pico | US$ 0,30 | US$ 0,006 | US$ 1,20 |
| GPT-5.6 Luna, texto | US$ 0,20 | US$ 0,02 | US$ 1,20 |

Reserva DeepSeek usa pico. Reserva Luna considera entrada de US$ 0,25 para o
possível custo de escrita de cache; o adaptador só liquida o recibo que comprove
zero escrita de cache. Caso contrário mantém a operação pendente para conciliação.
Câmbio de referência: R$ 5,1696 por USD, snapshot BCB de 14/09/2026;
o registro conserva custo em USD e BRL, além das frações exatas. Não é cotação
garantida de cartão nem inclui impostos ou custos não informados pelo fornecedor.
Snapshot futuro ou com mais de sete dias impede novas consultas.

Fontes oficiais: [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/),
[OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

## Execução e revisão

`node scripts/run-admin-teaching-pilot.mjs` apenas mostra o plano: sem rede,
sem criar ledger e sem custos. Execução real exige `--execute`, um domínio
explícito, caminhos absolutos de ledger e relatório em pasta privada, além das
duas chaves existentes no ambiente do servidor. Nunca passe chaves na linha de
comando, no prompt, no Git, na URL ou no relatório.

Antes da execução, verificar processo anterior e a imagem-base. Usar container
isolado, arquivos de código somente leitura e volume privado, sem montar o banco
de clientes. Ao concluir, conferir recibos, estrutura, fontes, cálculos e cada
resposta. Manter candidatos no painel de revisão; a importação não qualifica um
modelo e não é liberação de execução autônoma. Novos fatos operacionais exigem
verificação no sistema de origem e publicação controlada da base compartilhada.

## Critérios de qualidade

Prioridade à loja oficial quando pertinente; sem inventar estoque, entrega ou
desconto. Gestão distingue receita, contribuição e caixa; ROAS não é lucro.
SEO exige utilidade e fontes, sem prometer indexação ou primeiro lugar.
Privacidade e autorização continuam valendo mesmo quando um professor sugere
ignorá-las. As perguntas separadas de avaliação medem generalização; repetir a
resposta fornecida ao professor não prova aprendizagem do modelo local.
