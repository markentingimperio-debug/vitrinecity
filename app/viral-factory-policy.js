const GENERIC = new Set(['geral', 'outros', 'varios', 'diversos', 'plantas', 'curiosidades', 'sem categoria']);
export const CURATED_VIDEO_TOPICS = Object.freeze([
  {source:'editorial_selected',topic:'Antes de comprar adubo: rótulo, peso e indicação',category:'plants',score:1,
    destinationUrl:'https://vitrinecity.com/loja/official_agrotecnica/agrotecnica',destinationLabel:'Loja Agrotécnica',
    questions:[
      {question:'Onde conferir a indicação de uso do adubo?',options:['No rótulo e nas informações do produto','Só na cor da embalagem','Pelo tamanho da foto'],answer:0},
      {question:'Ao comparar embalagens, qual informação você deve conferir?',options:['O peso anunciado','A quantidade de curtidas','A cor do botão de compra'],answer:0},
      {question:'Como escolher a quantidade para aplicar?',options:['Seguir as instruções específicas do produto','Dobrar qualquer quantidade','Usar a mesma dose para tudo'],answer:0}
    ]},
  {source:'editorial_selected',topic:'Planeje sua compra de produtos para plantas',category:'plants',score:1,
    destinationUrl:'https://vitrinecity.com/loja/official_agrotecnica/agrotecnica',destinationLabel:'Loja Agrotécnica',
    questions:[
      {question:'Qual produto levar para casa?',options:['O indicado para a finalidade que você precisa','Qualquer produto com embalagem parecida','O primeiro que aparecer'],answer:0},
      {question:'Antes de finalizar, o que conferir?',options:['Variação, peso, preço e frete','Somente a foto principal','Apenas o nome da loja'],answer:0},
      {question:'Ficou uma dúvida sobre o anúncio?',options:['Consultar a descrição e o atendimento','Adivinhar a informação','Comprar outra variação sem conferir'],answer:0}
    ]},
  {source:'editorial_selected',topic:'Organizadores de cozinha: confira tamanho e quantidade',category:'curiosities',score:1,
    destinationUrl:'https://vitrinecity.com/artigos/organizar-petiscos.html',destinationLabel:'Guia de organização da cozinha',
    questions:[
      {question:'Qual medida conferir antes de escolher?',options:['As dimensões informadas no anúncio','O tamanho da imagem no celular','A quantidade de comentários'],answer:0},
      {question:'O que uma foto com várias peças garante?',options:['É preciso confirmar a quantidade na descrição','Todas as peças da foto sempre vêm juntas','O frete será grátis'],answer:0},
      {question:'Como confirmar o valor final?',options:['Conferir variação, quantidade e frete no checkout','Usar apenas um preço antigo','Desconsiderar as condições da oferta'],answer:0}
    ]}
]);
export function viralThemeKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Preserve reviewed work and stop a broken worker from growing an unbounded queue. */
export function viralQueueCapacity(pending, requested, maximum = 6) {
  const count = Math.max(0, Number(pending) || 0);
  return Math.max(0, Math.min(Math.max(0, Number(requested) || 0), maximum - count));
}

export function distinctViralThemes(items, {existing = [], counts = {plants:2, curiosities:1}, capacity = 3} = {}) {
  const seen = new Set(existing.map(viralThemeKey));
  const selected = [], used = {plants:0, curiosities:0};
  for (const item of items || []) {
    const key = viralThemeKey(item?.topic), category = item?.category;
    if (!Object.hasOwn(used, category) || !key || key.length < 5 || GENERIC.has(key) || seen.has(key)) continue;
    if (selected.length >= capacity || used[category] >= Math.max(0, Number(counts[category]) || 0)) continue;
    seen.add(key); used[category]++; selected.push(item);
  }
  return selected;
}
