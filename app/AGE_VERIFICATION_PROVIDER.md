# Contrato do provedor de verificação 18+

A Vitriny City usa uma página hospedada pelo provedor ou por um adaptador confiável. A aplicação não recebe nem armazena foto do documento ou selfie; a data de nascimento chega somente ao webhook, é usada em memória para calcular a idade e não é persistida.

## Configuração

- `AGE_VERIFICATION_PROVIDER`: nome interno do fornecedor.
- `AGE_VERIFICATION_START_URL`: URL HTTPS hospedada, contendo `{reference}` no ponto em que a referência opaca deve ser inserida.
- `AGE_VERIFICATION_WEBHOOK_SECRET`: segredo aleatório compartilhado exclusivamente com o adaptador.

O provedor deve verificar documento oficial, extrair a data de nascimento e realizar prova de vida. Seu adaptador devolve somente o resultado mínimo ao endpoint `POST /api/identity/age-verification/webhook`.

## Webhook

Cabeçalhos obrigatórios:

- `x-age-verification-timestamp`: horário Unix em segundos, aceito por até cinco minutos.
- `x-age-verification-signature`: `sha256=<hex>`, calculado com HMAC-SHA256 sobre `<timestamp>.<corpo JSON bruto>`.

Exemplo de resultado aprovado:

```json
{
  "eventId": "evento-unico-do-provedor",
  "reference": "referencia-opaca-recebida-no-inicio",
  "status": "verified",
  "documentVerified": true,
  "livenessPassed": true,
  "dateOfBirth": "2000-01-31"
}
```

Estados aceitos: `verified`, `rejected`, `manual_review` e `expired`. Uma aprovação só é reconhecida quando documento e prova de vida estão aprovados e o próprio servidor calcula idade igual ou superior a 18 anos. A data de nascimento é usada apenas em memória durante essa decisão e não é persistida.

Cada `eventId` é processado uma única vez. Os metadados técnicos desses eventos são eliminados após 370 dias. O provedor deve redirecionar a pessoa de volta para `/minha-conta.html` após concluir sua interface hospedada.
