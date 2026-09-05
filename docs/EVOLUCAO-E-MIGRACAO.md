# Evolução e migração da VitrineCity

## Objetivo e limite atual

Preparar uma evolução gradual, sem contratar recursos antecipadamente. Docker Compose
facilita reproduzir os serviços, mas não torna uma VPS automaticamente elástica nem
comprova capacidade para um milhão de usuários simultâneos. Essa capacidade depende
de testes realistas, tráfego de vídeo, banco de dados e serviços externos.

## Base verificável

- Código e configurações não secretas ficam no GitHub, em branches revisadas.
- O aplicativo usa `package-lock.json`, `npm ci` e imagem base Node identificada por digest.
- `ops/verify-release.sh` testa o commit em containers temporários, sem rede pública,
  credenciais reais, dados reais ou volumes de produção. O workflow Verify release
  executa o mesmo procedimento em pull requests e no main; não faz deploy automático.
- Segredos ficam somente nos arquivos de ambiente do servidor. Nunca no repositório,
  relatórios, imagens Docker ou mensagens. `.env.example` documenta nomes, não valores.
- O endpoint `/api/health` confirma vida da aplicação, não todas as integrações.
  O painel `/admin-saude.html` detalha indicadores disponíveis e bloqueios externos.
- A rotina de backup local do SQLite está em `ops/backup-database.sh`. Consulte
  `ops/database-recovery.md`: backup de banco não inclui uploads, cursos ou toda a VPS.

## Publicação e recuperação

1. Verificar execução concorrente e usar o lock `/tmp/vitrinecity-codex-deploy.lock`.
2. Conferir branch, commit, alterações locais e saúde. Não usar pull/reset destrutivo
   nem remover containers órfãos. Preservar `vitrinecity-codex-executor-1`.
3. Trabalhar em branch/worktree. Revisar o diff, executar os testes e registrar o PR.
   Guardar a versão anterior do código e uma tag da imagem saudável antes da troca.
4. Testar a imagem candidata sem credenciais, volumes ou rede externa. Não iniciar
   duas aplicações gravando no mesmo SQLite durante essa verificação.
5. Publicar somente o serviço alterado, sem recriar dependências ou apagar volumes.
   Verificar `/api/health`, páginas públicas, autenticação e logs sem expor segredos.
6. Se falhar, voltar à imagem saudável preservada e à configuração anterior validada.
   Não restaurar um banco antigo sobre novas vendas. Mudanças de esquema precisam de
   plano próprio e aprovação quando houver risco ou alteração destrutiva.

Uma única instância Docker pode ter breve interrupção ao ser substituída. Não há
blue-green ou promessa de zero downtime implementados por este documento.

## Antes de mudar de hospedagem

- Inventariar imagens/commits, domínios/TLS, variáveis, redes externas, timers, webhooks,
  callbacks OAuth, workers e endereços de retorno cadastrados nos provedores.
- Mapear os volumes de banco/uploads, live-studio, Caddy, busca e fila Codex; também
  o diretório `private-courses` e os serviços Chatbotx/WhatsApp que forem necessários.
  Não supor que copiar apenas `/opt/vitrinecity` transfere esses dados.
- Escolher e aprovar um destino externo de backup com criptografia, retenção e acesso
  restrito. Definir tolerância a perda de dados (RPO) e tempo de recuperação (RTO).
- Ensaiar a restauração completa em ambiente separado, com saídas externas bloqueadas,
  sem executar campanhas, cobranças, mensagens ou transmissões de verdade.
- Preparar o novo ambiente em paralelo, com HTTPS e testes privados antes de mudar DNS.
- Para o SQLite atual, pausar escritores na sincronização final ou projetar previamente
  outro mecanismo de dados. Não deixar dois bancos independentes recebendo vendas.
- Sincronizar banco e arquivos finais; apontar o tráfego; manter o servidor antigo
  disponível para encaminhar acessos enquanto houver caches de DNS antigos.
- Revalidar sessões, uploads, pedidos e callbacks. Uma volta do tráfego após novas
  gravações exige reconciliar os dados; não basta apontar o DNS para o banco antigo.

## Crescimento por etapas — ainda não implementado

| Evidência de necessidade | Próxima etapa a avaliar |
| --- | --- |
| Banda ou entrega de vídeos dominando o custo | Armazenamento de objetos, CDN e vídeo adaptativo |
| CPU ou latência sustentada acima da meta | Perfil de desempenho, cache e filas antes de ampliar recursos |
| Necessidade de vários servidores gravadores | Migração planejada do SQLite para banco adequado a múltiplas instâncias |
| Trabalho em segundo plano duplicado | Filas e travas distribuídas, idempotência e separação de workers |
| Exigência de atualização sem pausa | Balanceador, sessões compartilhadas e estratégia blue-green testada |

Critérios para avançar: latência p95, erros, CPU/RAM, disco, conexões, fila, custo por
usuário e testes de carga em ambiente autorizado. Não fazer teste de um milhão de
acessos contra produção. Cada etapa requer orçamento e validação antes de contratação.

Fontes técnicas: [backup online do SQLite](https://www.sqlite.org/backup.html) e
[cache/TTL de DNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/).
