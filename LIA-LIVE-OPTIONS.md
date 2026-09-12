# Lia ao vivo: alternativa sem assinatura de avatar

## Decisão e estado em 12/09/2026

O responsável considerou o LiveAvatar caro e pediu alternativa sem HeyGen. Não contratar plano, ativar excedentes ou tratar a entrada na conta como integração de API concluída. Preservar a identidade criada no Abacus e as instruções da Lia, reaproveitáveis em outros serviços.

O painel verificado do LiveAvatar ofereceu Essential por US$99/mês, com um avatar personalizado 720p, 1100 créditos e sessões de até 20 minutos. Isso não foi contratado. As instruções foram salvas no contexto `Lia · VitrineCity · Atendimento e Live Shop`; não existe avatar da Lia ou transmissão ativa nesse serviço.

## Alternativa própria a validar

OBS Studio pode transmitir a composição de avatar, produtos e legendas sem mensalidade do programa. Ele não gera sozinho um rosto falante, respostas ou leitura de comentários. Uma implementação própria precisa separar:

1. Perguntas recebidas pelo site ou APIs oficiais de cada canal, com fila e moderação.
2. Resposta da Lia baseada no catálogo existente e disponibilidade atual.
3. Voz sintetizada, com limite de custo e cancelamento.
4. Avatar animado e sincronizado à voz.
5. Composição e transmissão, com botão de encerramento e confirmação do canal.

TalkingHead é uma biblioteca MIT para animar um modelo 3D no navegador. A licença do código não autoriza todos os avatares de demonstração: vários são apenas não comerciais. A foto da Lia no Abacus não se transforma automaticamente em um modelo 3D com rig e expressões. É necessário preparar uma versão própria e validar a semelhança visual e a dicção em português. Esse caminho tende a exigir menos infraestrutura que vídeo fotorrealista gerado continuamente, mas ainda precisa de benchmark no equipamento real.

MuseTalk documenta sincronização labial em tempo real a mais de 30 quadros por segundo em NVIDIA Tesla V100. Isso não comprova o mesmo desempenho em outra GPU. O computador acessível nesta tarefa possui NVIDIA GeForce GTX 960, com 2 GB informados pelo Windows. Não foi feito benchmark nem instalado modelo. Não prometer vídeo fotorrealista contínuo nesse equipamento; uma GPU alugada ou outra máquina pode ser necessária, com custo separado.

LiveKit resolve transporte e infraestrutura de conversa; seu plano gratuito não inclui automaticamente um renderizador fotorrealista da Lia. Um vídeo pré-gravado exibido pelo OBS pode compor a programação, mas não equivale a respostas labiais dinâmicas ao vivo.

Não há orçamento fechado, economia percentual medida ou live própria implementada. O primeiro passo executável é um ensaio local, sem transmissão pública nem compra, depois de escolher e preparar um avatar com licença comercial apropriada.

## Recursos e prompts

Original exportado do Abacus: `E:\CodexWork\prayer-social-20260912\lia-live\lia-abacus-v1-original.png`, 1536×2048. Personagem fictícia criada para VitrineCity; manter este original.

Modo: ferramenta integrada de geração/edição de imagens, com o original como referência. Arquivos derivados na mesma pasta: `lia-live-v1.png` e `lia-live-v2.png`, ambos 1672×941. Não foram validados para upload no LiveAvatar e não são avatares animados.

Prompt de enquadramento: preservar exatamente o rosto, idade aparente, olhos castanhos, cabelo castanho ondulado, blazer verde profundo e blusa clara da Lia; retrato frontal do peito para cima, face centralizada e inteira, boca fechada, expressão acolhedora, luz suave, fundo claro com planta discreta; formato horizontal 16:9, sem texto ou logotipo, sem trocar a personagem.

Prompt da segunda edição: somente ampliação técnica para 2560×1440, mínimo 1920×1080, mantendo identidade, proporções, enquadramento, roupa e fundo. A saída real continuou 1672×941; portanto o objetivo de resolução não foi atendido. Não repetir cobranças ou gerações automaticamente para tentar corrigir esse requisito.

## Fontes primárias consultadas

- OBS: https://obsproject.com/
- TalkingHead e licenças de recursos: https://github.com/met4citizen/TalkingHead
- Licença do código: https://github.com/met4citizen/TalkingHead/blob/main/LICENSE
- MuseTalk: https://github.com/TMElyralab/MuseTalk/blob/main/README.md
- LiveKit: https://livekit.com/pricing
- Alternativa hospedada Tavus: https://www.tavus.io/pricing — Starter anunciado por US$59/mês com 100 minutos de conversa e cobrança adicional; menor mensalidade não comprova menor custo para lives longas diárias. Não contratado.
