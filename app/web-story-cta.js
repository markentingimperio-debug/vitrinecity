/** Server-owned labels describe the existing destination, never a discount or
 * an external checkout. Explicit labels saved in a story remain editable. */
export function storySourceCta(source={}) {
  const kind=source.kind||source.sourceKind;
  const labels={product:'Ver oferta',affiliate:'Ver oferta',store:'Visitar loja',course:'Ver curso',service:'Ver serviço',city:'Explorar cidade'};
  if(Object.hasOwn(labels,kind))return labels[kind];
  if(kind==='recipe'||['recipes','receitas'].includes(source.group)||source.portal==='receitas'||source.category==='receitas')return 'Ver modo de preparo';
  return 'Ler matéria completa';
}
