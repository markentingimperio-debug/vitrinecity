const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

/**
 * Identify an image attachment that is a visual reference for a new generation
 * or semantic edit. Deterministic resize requests stay with the media worker.
 */
export function referenceMediaKind(instruction){
  const text=normalize(instruction);
  if(!text)return'';
  const generated=/\b(crie|criar|gere|gerar|faca|fazer|produza|produzir|imagine|transforme|transformar)\b/.test(text);
  const semanticEdit=/\b(adicione|adicionar|remova|remover|troque|trocar|mude|mudar|edite|editar|substitua|substituir)\b/.test(text);
  const visual=/\b(imagem|foto|arte|ilustracao|personagem|cenario|estilo|visual|design|capa|thumbnail)\b/.test(text);
  const reference=/\b(esta|essa|anexada|enviada|referencia|base|modelo)\b/.test(text);
  if(generated&&(visual||reference))return'image-reference';
  if(semanticEdit&&(visual||reference))return'image-edit';
  return'';
}
