# Lia Work — Chrome Conectado

Este conector permite que o painel privado da Lia execute uma navegação no Chrome do próprio usuário e devolva uma confirmação objetiva da ação.

## Proteções

- recebe comandos apenas de páginas HTTPS da VitrineCity;
- abre somente endereços HTTPS públicos, sem credenciais, portas especiais, IPs ou domínios locais;
- oferece somente dois recursos na primeira versão: abrir uma página e iniciar o primeiro resultado de uma busca no YouTube;
- devolve ao painel somente título, endereço final e estado de reprodução;
- não lê senhas, cookies, histórico nem conteúdo de outras abas.

## Instalação administrativa

Abra `chrome://extensions`, ative o modo do desenvolvedor, escolha **Carregar sem compactação** e selecione esta pasta. A instalação precisa ser confirmada no momento porque concede acesso a páginas HTTPS para executar tarefas solicitadas pelo usuário.
