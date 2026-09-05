# Google Analytics da VitrineCity

Propriedade verificada: **Vitrine City**, `551657228`; fluxo web `15500793460`;
ID público de medição `G-0V9KJQMH0V`. Não é uma chave secreta e não exige alteração do `.env`.

## Coleta e privacidade

- Google carrega somente em `vitrinecity.com`/`www.vitrinecity.com`, nas rotas públicas explicitamente permitidas em `app/public/measurement-policy.js`.
- Exige `vc_analytics_consent=accepted` **e** nova escolha `vc_google_analytics_consent_v1=accepted`. Uma autorização antiga da medição interna não autoriza silenciosamente o novo fornecedor.
- Modo de consentimento básico: nenhuma requisição ao Google antes da autorização; publicidade, personalização e Google Signals desativados nesta tag.
- Cada carregamento autorizado envia um `page_view` manual. Títulos são genéricos, detalhes públicos são agrupados; consultas livres, fragmentos, campos de formulário, caminhos privados do referenciador e páginas de conta/administração não são enviados.
- Somente identificadores UTM e `gclid` restritos a letras/números/hífen/underscore e 160 caracteres podem compor a URL medida. Não coloque dados pessoais em parâmetros de campanha.
- **Métrica otimizada foi desativada no fluxo web em 05/09/2026**, para impedir captura automática de formulários, pesquisas, links e mudanças de histórico e evitar duplicação de visualizações. Não reativar sem nova revisão.
- A opção “Preferências de privacidade”, nas páginas públicas medidas, permite escolher “Só essenciais”. O sinal documentado `ga-disable-G-0V9KJQMH0V` bloqueia a coleta posterior na página já aberta. Não apaga dados históricos do Google nem cookies já criados.
- Os eventos internos de cadastro/CTA continuam separados; esta entrega não configura conversões, compras, públicos ou campanhas do Google Ads.

## Verificação e limites

1. Rodar `node --test scripts/test-analytics-consent.mjs scripts/test-google-analytics.mjs` dentro de `app`; depois executar `ops/verify-release.sh` em imagem isolada.
2. O build executa `prepare-public-highlights.js` para incluir o carregador nas páginas estáticas permitidas; o middleware cobre HTML público dinâmico. Inclusão idempotente.
3. No navegador, confirmar ausência de `googletagmanager.com`/`google-analytics.com` antes de aceitar. Depois confirmar tag com o ID correto e `g/collect` de `page_view`, sem dados privados.
4. Abrir o relatório **Tempo real** da propriedade `551657228`, distinguindo a visita controlada (`utm_source=codex_validation`) de tráfego comercial. Relatórios comuns podem demorar a processar.

Cliques de anúncios não equivalem a sessões medidas: recusa de cookies, bloqueadores e saída antes do carregamento reduzem a contagem. Visitas anteriores à instalação não são recuperadas retroativamente.

## Reversão

Preservar a imagem anterior e aplicar rollback somente do serviço `app`, sem excluir volumes, alterar credenciais ou remover o executor. A versão anterior não carregava Google Analytics. A configuração de métrica otimizada do fluxo é independente do código; manter desativada é seguro caso se retire a tag. Registrar qualquer futura alteração dela separadamente.
