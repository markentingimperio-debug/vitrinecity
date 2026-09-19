/** Pure routing hints. Never authorizes a provider, charge or attachment read. */
function normalized(message) {
  if (typeof message !== 'string' || message.length > 6000) return '';
  return message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bimage\b/g, 'imagem').trim();
}
const WRITING = /\b(?:roteiro|script|legenda|descricao|texto|copy|plano|ideias?|prompt)\b/;
const REQUEST = /\b(?:ger[ae]|gerar|cri[ae]|criar|faca|fazer|produz[ai]|produzir|quero|escreva|redija)\s+(?:(?:um|uma|o|a|os|as|novo|nova|outro|outra|me|agora|mais)\s+)*(videos?|clipe|imagem|imagens|fotos?|ilustracao|logo|logotipo|banner|arte|roteiro|script|legenda|descricao|texto|copy|plano|ideia|ideias|prompt)\b/;
const ACTION = /^(?:(?:por favor|agora|pode|voce pode|quero que voce|preciso que voce)[, ]+)*(?:publique|publicar|poste|postar|envie|enviar|mande|mandar|dispare|disparar|pague|pagar|compre|comprar|apague|apagar|exclua|excluir|execute|executar|implante|implantar|deploy|pesquise|pesquisar|busque|buscar|procure)\b/;
const EXPLANATION = /^(?:(?:por favor|voce pode|pode)[, ]+)*(?:como|explique|descreva|analise|analisar|leia|ler|o que|oque|qual|quais)\b/;

/** Explicit generation only. Mentioning a video in a script request is not generation. */
export function referenceMediaKind(message) {
  const text = normalized(message);
  if (!text || ACTION.test(text) || EXPLANATION.test(text)) return null;
  const target = text.match(REQUEST)?.[1];
  if (target && WRITING.test(target)) return null;
  if (!target && WRITING.test(text)) return null;
  // "Anime essa imagem" means a video, not generation of another still image.
  if (/\b(?:anime|animar|anima)\b/.test(text) ||
      /\b(?:transforme|transformar|transforma)\b[\s\S]*\b(?:video|clipe|animacao)\b/.test(text)) return 'video';
  if (target && /^(?:videos?|clipe)$/.test(target)) return 'video';
  if (target && /^(?:imagem|imagens|fotos?|ilustracao|logo|logotipo|banner|arte)$/.test(target)) return 'image';
  return null;
}

/** An explicit reference is required to reuse an earlier private attachment. */
export function requestsImageReference(message) {
  const text = normalized(message);
  if (!text || refusesImageReference(message)) return false;
  return /\b(?:essa|esta|esse|este|dessa|desta|desse|deste|nessa|nesta|nesse|neste)\s+(?:mesma?\s+)?(?:imagem|foto|print|produto|embalagem|item|anexo)\b/.test(text) ||
    /\b(?:imagem|foto|print|produto|embalagem)\s+(?:que\s+(?:eu\s+)?(?:enviei|mandei)|anexad[oa]|enviad[oa])\b/.test(text) ||
    /\b(?:use|usar|utilize|utilizar)\s+(?:a|o)\s+(?:imagem|foto|print|anexo)\b/.test(text);
}
export function refusesImageReference(message) {
  return /\b(?:nao\s+(?:use|usar|utilize|utilizar)|sem\s+(?:usar|utilizar))\s+(?:(?:a|o|essa|esta|esse|este)\s+)?(?:imagem|foto|print|anexo)\b/.test(normalized(message));
}
export function routeReferenceMedia(message, baseIntent) {
  if (!baseIntent || typeof baseIntent !== 'object') throw new TypeError('Base intent required');
  if (['action', 'research', 'audio'].includes(baseIntent.kind)) return baseIntent;
  if (EXPLANATION.test(normalized(message)) && ['image', 'video'].includes(baseIntent.kind))
    return {kind: 'text', capability: 'support.draft-reply'};
  const kind = referenceMediaKind(message);
  return kind ? {kind, capability: null} : baseIntent;
}
