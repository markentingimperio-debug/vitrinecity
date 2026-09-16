# Recomendações no meio das Web Stories

Implementação preparada em 12/09/2026, sujeita à revisão e liberação do código. Não conecta AdSense, não compra mídia e não usa o endpoint de campanhas/CPC da VitrineCity.

`web-story-promotions.js` consulta o catálogo público já usado pelas histórias: artigos, produtos, afiliados, serviços, cursos, lojas e a apresentação da cidade. Os destinos de jogos, prédios e outros espaços vêm do guia público existente da cidade, sem inventar ofertas. A ordenação considera somente o assunto da história; o desempate varia de maneira determinística pelo identificador/vínculo da edição, sem perfil, religião ou dados pessoais do visitante. Não há treinamento automático de pesos.

Ofertas comerciais precisam de correspondência contextual. Sem uma opção pertinente, o único fallback é o convite explícito **Conheça a VitrineCity**, se a fonte institucional estiver disponível. Orações e histórias com conteúdo sensível não recebem inserções nesta versão. Produtos exigem preço e estoque positivos e as regras públicas do catálogo; afiliados precisam estar publicados, disponíveis e com link saudável/validado. Cursos e serviços vêm dos fornecedores públicos já injetados no catálogo. Toda escolha é conferida novamente após a leitura das imagens e imediatamente antes de retornar ao renderizador.

## Apresentação

- Uma inserção para histórias de 10–19 páginas; no máximo duas para 20–40. O limite considera as páginas editoriais originais, não as páginas adicionadas.
- Inserir somente após uma frase completa, no miolo da narrativa, com pelo menos cinco páginas editoriais entre duas inserções. Não substituir capa, conclusão, fontes, instruções ou botão final; se não houver posição apropriada, não inserir.
- Ofertas: **Publicidade**; afiliados também mostram **Link de afiliado: podemos receber comissão**. Leitura, cidade e lazer: **Conteúdo recomendado**. Prédio, loja e curso continuam identificados como publicidade quando forem o destino comercial.
- Imagens somente da biblioteca local, usando o normalizador e a validação existentes. Uma imagem ausente, insuficiente ou remota retira apenas aquela sugestão; não impede a história editorial.
- Um botão `amp-story-page-outlink` por sugestão, sem demora obrigatória, redirecionamento automático ou popup. O destino é uma página pública da VitrineCity; na página de afiliado permanece o link oficial do parceiro. Não encaminhar diretamente a APIs, checkout, área privada ou redirecionadores.

Prévia no editor, prévia em página e versão pública usam o mesmo hook. As sugestões são um parâmetro de renderização: não são gravadas no JSON editorial e não alteram revisão, texto, hash da fonte ou URL canônica. Retirar uma oferta do catálogo a remove nas próximas renderizações; a resposta pública mantém o cache curto existente de 60 segundos.

## Medição e limites

Os links carregam UTM com campanha/item opacos, sem nome do assunto sensível. A página de destino pode usar a medição já existente **somente com consentimento**, preservando sua regra atual de primeiro contato. Assim, uma sessão que já possui atribuição pode continuar atribuída à origem anterior. Não há impressão ou evento de clique criado pelo servidor ao renderizar HTML. Acesso não é venda; pedido criado não é compra paga; venda externa de afiliado depende de confirmação do parceiro. Nenhum número de conversão ou aprendizado é inventado por este módulo.

O limite de inserções é uma regra editorial conservadora da VitrineCity, não uma garantia de elegibilidade no Google. A história precisa continuar completa, original e útil: o Google permite links afiliados apenas numa parte pequena e restringe histórias excessivamente comerciais. [Política oficial de Web Stories](https://developers.google.com/search/docs/appearance/web-stories-content-policy).

O outlink permanece como último filho da página, com `layout="nodisplay"` e um único link. [Documentação oficial AMP](https://amp.dev/documentation/components/amp-story-page-outlink).

Validação: `node --test scripts/test-web-story-promotions.mjs scripts/test-web-stories.mjs scripts/test-web-story-sources.mjs`. Os testes usam catálogo/SQLite isolados, incluindo retirada durante validação, densidade, URLs maliciosas, catálogo paginado, imutabilidade editorial e as rotas de prévia/publicação. O validador AMP oficial aprovou os HTMLs de teste público e de prévia; nenhuma história real foi publicada durante estes testes.
