# Operação VitrineCity — 5 de setembro de 2026

## Entrega publicada

- Menu e cartão **Saúde da plataforma** no painel administrativo, em `/admin-saude.html`.
- Diagnóstico por operação do OpenRouter e pelo último histórico de sincronização de Facebook, Instagram, YouTube, TikTok, Google e Kwai.
- Estados explícitos: sem verificação, operação concluída, falha, execução em andamento, resultado antigo e execução sem conclusão.
- Uma consulta de conta bem-sucedida não apaga uma falha de geração de conteúdo. As observações do OpenRouter reiniciam junto com o processo e não abrangem o fallback direto da OpenAI.
- As falhas da Meta passam a registrar códigos fixos, sem mensagens brutas do provedor. Erros de autenticação/permissão não repetem a mesma tentativa com campos reduzidos; o fallback para métricas incompatíveis continua disponível.
- O painel é somente leitura: não testa chaves, gera conteúdo, publica ou altera permissões. Nenhuma migração, credencial ou cobrança foi alterada.

## Evidência de validação

- Cinco testes comportamentais do diagnóstico aprovados: preservação de resultados e exceções; privacidade; separação entre operações; histórico e expiração; autorização HTTP; fallback da Meta.
- Teste de operações da plataforma e suíte `npm test` aprovados na base do GitHub e sobre uma cópia do código real da VPS, em container isolado, sem rede e sem o banco de produção.
- Interface exercitada com dados simulados em 390 px: sem rolagem horizontal e sem erros de JavaScript observados.
- Página inicial de produção verificada em 390 px com o CSS do banner bloqueado: conteúdo dinâmico não apareceu sem formatação. A regra de bloqueio foi removida após o teste. Isso não substitui testar todos os aparelhos ou todas as páginas dinâmicas.
- Após o deploy: `/api/health` retornou `{"ok":true}`; o diagnóstico sem sessão continuou retornando HTTP 401.
- Nove páginas retornaram HTTP 200/HTML: `/`, `/descobrir`, `/loja`, `/entregas`, `/cidade-premium`, `/centro-educacional.html`, `/acessos.html`, `/recuperar-acesso.html`, `/social`. Não foi realizada compra ou publicação para testar essas páginas.
- Arquivos de produção comparados byte a byte com o candidato testado. App, busca e live-studio saudáveis; Caddy e executor mantidos em execução.

## Estado real observado após a publicação

- Facebook e Instagram: última sincronização falhou por permissões, em 05/09/2026 às 17:25 UTC. O diagnóstico não concede permissões nem resolve aprovação do aplicativo.
- YouTube: último sucesso salvo em 24/08. TikTok: último sucesso salvo em 28/08. Esses resultados antigos não comprovam disponibilidade atual.
- Google e Kwai: sem histórico de sincronização encontrado. Não afirmar que estão conectados e funcionando.
- OpenRouter: respostas de bloqueio de inferência observadas antes do deploy. A nova instrumentação torna as próximas operações visíveis, sem contornar o bloqueio do provedor.

## Publicação e reversão

Release operacional: `integration-health-20260905-172514`.

- Fonte anterior: `/opt/vitrinecity/backups/integration-health-20260905-172514/source-before.tgz`.
- Imagem anterior: `vitrinecity-app:rollback-integration-health-20260905-172514`.
- Somente o serviço `app` foi reconstruído/recriado. O executor não foi removido.
- O patch foi aplicado sobre a árvore existente, sem `git pull`, limpeza ou stash abrangente. O `package.json` da VPS foi preservado, e os novos testes foram executados explicitamente no candidato.

## Pendências prioritárias — não declarar a plataforma inteira concluída

1. **Consolidar o código efetivo da VPS no GitHub.** A VPS ainda está no commit `4d0380c` da branch local `backup/vps-pre-viral-20260903`, com numerosas mudanças locais e módulos ausentes na main. A melhoria acima está versionada separadamente; isso não torna a main uma cópia completa da produção. Uma captura de fonte, sem `.env`, bancos ou backups, foi preservada para revisão. A consolidação precisa manter as funcionalidades existentes e não substituir a árvore por uma versão antiga.
2. **Regularizar as integrações externas.** Revisar o bloqueio de inferência no OpenRouter e as permissões da Meta; retomar sincronizações somente após verificar configuração e aprovação. Não trocar contas, chaves ou cobrança automaticamente.
3. **Revisar o healthcheck do Chatbotx.** `chatbotx-builder-1` foi sinalizado como unhealthy porque seu teste tenta executar `curl`, ausente na imagem. Isso, isoladamente, não prova indisponibilidade do serviço. Nenhuma alteração/reinicialização foi feita nesse stack nesta entrega.
4. **Ampliar a validação móvel e de jornadas.** Fluxos autenticados, checkout real, entrega, postagem e contas externas não foram integralmente validados nesta entrega. Usar ambiente de teste e evidência por fluxo.

Comandos locais de regressão: `npm test`, `node scripts/test-platform-operations.mjs`. A prévia isolada `node scripts/preview-platform-health.mjs` usa apenas banco em memória e escuta em `127.0.0.1`; não é um servidor administrativo para produção.
