# Reconciliação da publicação Multiversal — 08/09/2026

## Evidência anterior à alteração de produção

- VPS `/opt/vitrinecity`: `c7cfe8092f09da22c0aa64b94a4fd6ab925bb41b`, a mesma base main incorporada no PR 144. Árvore rastreada e staging sem alterações.
- App saudável: imagem `sha256:0a5c9e20fd2dfe1e459020a812df4b7d13412a472d356539e6eb8e272b402b9f`. Onze outros containers em execução devem permanecer intactos.
- Foram comparados 255 arquivos de runtime rastreados. As diferenças de 70 HTMLs são integralmente explicadas por `prepare-public-highlights`/injeção de medição e banner. Nenhum JavaScript exclusivo não reconciliado apareceu. O JSON `affiliate-batches/darkplanner-20260908.json` é um lote de origem e não faz parte dos arquivos copiados para o runtime pelo Dockerfile.
- Arquivos não rastreados de agentes/mapas foram preservados. O snapshot abaixo inclui a árvore completa da VPS, inclusive Git, configurações e mapas locais. Os volumes persistentes não serão substituídos.
- A diferença anteriormente reportada em `ASAAS_API_KEY` era a representação de escape de dólar na saída reutilizável do Compose. Comparação normalizada confirma o mesmo valor efetivo, assim como todas as demais variáveis configuradas. **Não é necessária alteração de credencial nem override de ambiente.** Nenhum valor de segredo foi registrado nesta evidência.

## Preservação concluída às 13:46 UTC

- Diretório privado: `/opt/vitrinecity-recovery/multiversal-20260908T134605Z` (permissões restritas).
- `working-tree.tar`: 1.790.064.640 bytes; SHA-256 `62d8c28eb98aa2650bedd33362942eb1170632e0207090a3405fc69ef06f7bf2`.
- Imagem saudável marcada como `vitrinecity-app:before-multiversal-20260908t134605z`.
- Cópia consistente pela API de backup do SQLite: `/data/recovery-backups/before-multiversal-20260908T134605Z.db`, modo 0600, `integrity_check=ok`.
- `manifest.json` privado registra commit, imagem, backup, mounts e identidades dos onze serviços protegidos, sem valores de ambiente.

## Publicação

Candidato funcional `eeee796e112f361779f3386f309892103af98693`: quatro centros com identidade, produtos e navegação; arena musical; mudanças anteriores de conta/fazenda/vitrines e arquitetura. Verificação isolada na VPS, migração em cópia do banco e deploy apenas do app são as etapas seguintes. Nenhuma restauração de banco antigo está prevista no rollback; em caso de falha, preservar dados novos e retornar somente código/imagem.

Esta evidência resolve a divergência de leitura e preservação da issue 146. A confirmação de publicação deve registrar o commit/imagem efetivamente em execução e o resultado das jornadas públicas e protegidas após a troca.
