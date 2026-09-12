const portals=new Set(['noticias','esportes','receitas','plantas-e-jardinagem','tecnologia','inteligencia-artificial','entretenimento','celebridades']);
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

// Routing hints classify a newly researched topic; they never attest its facts
// or rewrite the portal chosen by an editor for an existing source.
export function storyTopicCategory(title) {
  const value=normalize(title);
  // Gaming hardware/services are not sporting events even when their titles
  // contain "jogo". Keep the more specific signal ahead of generic sports.
  if(/\b(?:xbox|game\s*pass|playstation|videogames?|jogos? eletronicos?)\b/.test(value))return {group:'trends',portal:'tecnologia'};
  if(/\b(?:futebol|flamengo|vasco|corinthians|palmeiras|atletico|cruzeiro|santos|botafogo|gremio|real madrid|liga|campeonato|jogo|esporte|esportes|tenis|formula|copa)\b/.test(value))return {group:'sports',portal:'esportes'};
  if(/\b(?:receitas? (?:de|para|caseiras?|faceis|facil)|cozinha|culinaria|bolo|fricasse|sobremesa|ingredientes)\b/.test(value))return {group:'recipes',portal:'receitas'};
  if(/\b(?:inteligencia artificial|chatgpt|openai)\b/.test(value))return {group:'trends',portal:'inteligencia-artificial'};
  if(/\b(?:planta|plantas|jardim|jardinagem|horta|cultivo)\b/.test(value))return {group:'trends',portal:'plantas-e-jardinagem'};
  if(/\b(?:tecnologia|tecnologias|celular|smartphone|software|computador)\b/.test(value))return {group:'trends',portal:'tecnologia'};
  if(/\b(?:cinema|filme|filmes|serie|series|novela|musica|celebridade|celebridades)\b/.test(value))return {group:'news',portal:'entretenimento'};
  return {group:'news',portal:'noticias'};
}

export function storyEditorialPortal(source) {
  if(portals.has(source?.portal))return source.portal;
  if(source?.group==='recipes')return 'receitas';
  if(source?.group==='sports')return 'esportes';
  return storyTopicCategory(source?.title).portal;
}
