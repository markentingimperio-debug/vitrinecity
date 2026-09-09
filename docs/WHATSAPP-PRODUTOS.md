# Divulgação de produtos com foto no ChatbotX

O painel `/admin-chatbotx.html` permite preparar uma campanha com até cinco produtos do Mercado Livre e selecionar os grupos já sincronizados na sessão do WhatsApp da VitrineCity.

## Fluxo

1. Em **Divulgar produtos com foto**, selecione produtos e grupos. É possível marcar todos os grupos apresentados.
2. Edite a mensagem de cada produto, sem preço fixo. O sistema acrescenta o título, a identificação de publicidade afiliada e o link da página na VitrineCity.
3. Escolha o início e o intervalo entre produtos, inicialmente 120 minutos.
4. Use **Preparar prévia** para conferir as fotos, as mensagens, os destinos e os horários. Essa etapa não envia mensagens.
5. **Publicar campanha** coloca os envios na fila. Atualizar o andamento não reenvia a campanha.

As fotos vêm do cadastro do produto e são convertidas para JPEG preservando as proporções. A prévia mantém uma cópia conferida da imagem. A foto é enviada como imagem com legenda; não depende de o WhatsApp gerar uma miniatura do link.

## Resultados

- **Enviados:** o provedor aceitou o envio e devolveu um identificador. Não representa leitura da mensagem, visita, compra ou comissão.
- **Pendentes:** aguardam o horário e a vez na fila, processada em lotes de até três itens a cada 30 segundos.
- **Em envio:** o processamento começou.
- **Falhas:** é necessário conferir antes de tentar outra campanha. Timeout ou resposta sem identificador não provoca reenvio automático.
- Os links mantêm a página pública `/ofertas/:slug` e identificam origem WhatsApp/grupo, campanha e produto por parâmetros UTM.

O agendador antigo de texto continua disponível. Cancelar um agendamento pendente pelo painel impede seu processamento.

## Escopo e proteção contra duplicidade

Os destinatários vêm do histórico de grupos da sessão conectada, sem incluir conversas individuais ou convites coletados na prospecção. A lista de nomes do provedor apenas enriquece os grupos já presentes no histórico. Nenhum grupo é criado ou ingressado automaticamente.

Uma chave de preparação retorna a mesma prévia quando a seleção é idêntica. Publicar novamente o mesmo identificador não cria outros agendamentos. O processamento reivindica cada linha atomicamente e usa um identificador de mensagem estável.

Produtos pausados, indisponíveis, com link inválido ou alterados desde a prévia são bloqueados antes do envio. Cada foto é limitada ao domínio HTTPS `http2.mlstatic.com`, sem redirecionamentos, com limite de tamanho e dimensões. O cache fica no diretório privado de dados; a visualização exige autenticação administrativa.

Se o processo for interrompido depois de iniciar um envio, uma linha pode permanecer em processamento e exigir inspeção operacional. Não retorne esse estado a pendente sem conferir a conversa: a mensagem pode ter sido aceita antes da interrupção.

## Verificação

`npm run test:whatsapp-products` cobre o módulo de campanhas, os controles do painel e o processador. Os testes usam banco e provedor isolados, sem publicar mensagens reais.

Integração de imagem baseada na [documentação do WuzAPI](https://github.com/asternic/wuzapi/blob/main/API.md#send-image-message), usando `/chat/send/image`, imagem JPEG em base64 e legenda.
