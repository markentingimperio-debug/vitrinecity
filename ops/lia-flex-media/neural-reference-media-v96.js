/** Bounded Portuguese routing hints, not execution or billing authorization.
 * Normalization affects a private routing copy only, never the original prompt.
 */
const LIMIT = 6000;
const GROUPS = {
  imagem: ['imagem','imagens','image','images','imagm','imagn','imageem','foto','fotos','fotografia','fotografias','arte','artes','banner','banners','cartaz','cartazes','capa','ilustracao','ilustracoes','logo','logotipo'],
  video: ['video','videos','vidio','vidios','videozinho','videozinhos','videoclipe','clipe','clipes','reels','shorts','animacao','animacoes'],
  criar: ['criar','crie','cria','criem','crair','criarar','gera','gere','gerar','gerem','geracao','faca','fazer','faz','produza','produzir','produz','monte','montar'],
  animar: ['anime','anima','animar','animee'],
  transformar: ['transforme','transforma','transformar','converta','converter','converte'],
  audio: ['audio','musica','narracao','voz'],
  escrita: ['roteiro','roteiros','script','legenda','legendas','descricao','texto','textos','copy','plano','ideia','ideias','prompt','prompts'],
  indefinido: ['anuncio','anuncios','propaganda','propagandas','comercial','comerciais','criativo','criativos','demonstrativo','demo']
};
const ALIASES = new Map(Object.entries(GROUPS).flatMap(([kind, words])=>words.map(word=>[word,kind])));
// Fuzzy matching is restricted to long domain words. Short common words such as
// "ler", "ver", "faz", "arte" are exact-only; no substring matching is used.
const FUZZY = ['imagem','imagens','video','videos','criar','gerar','animar','transformar','transforme','produzir','demonstrativo'];
function near(a,b) {
  if (a.length<5 || a.length>16 || Math.abs(a.length-b.length)>1) return false;
  if (a===b) return true;
  let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;
  if(a.length===b.length) return a.slice(i+1)===b.slice(i+1) ||
    (a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2));
  return a.length>b.length?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1);
}
function kindOf(word) {
  if(ALIASES.has(word))return ALIASES.get(word);
  const matches=new Set(FUZZY.filter(target=>near(word,target)).map(target=>ALIASES.get(target)));
  return matches.size===1?[...matches][0]:null;
}
function normalized(message) {
  if(typeof message!=='string'||message.length>LIMIT)return '';
  return message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\b(?:vc|vce)\b/g,'voce').replace(/\bimage\b/g,'imagem').replace(/\s+/g,' ').trim();
}
function tokens(text){return text.match(/[a-z0-9]+/g)||[];}
function withoutPrefix(text){return text.replace(/^(?:(?:por favor|agora|voce pode|voce consegue|pode|consegue|quero que voce|preciso que voce|voce poderia)[, ]+)*/,'');}
const ACTION=/^(?:publique|publicar|poste|postar|envie|enviar|mande|mandar|dispare|pague|pagar|compre|comprar|apague|apagar|exclua|excluir|execute|executar|implante|implantar|deploy|pesquise|pesquisar|busque|buscar|procure)\b/;
const EXPLANATION=/^(?:como|explique|explica|explicar|descreva|descreve|descrever|analise|analisa|analisar|leia|le|ler|o que|oque|qual|quais)\b/;
const VERBS=new Set(['criar','animar','transformar']);
function negated(words,kinds) {
  const filler=new Set(['quero','que','voce','pode','precisa','deve','me','mais','de']);
  return words.some((word,index)=>{
    if(!['nao','nunca','jamais','sem'].includes(word))return false;
    for(let i=index+1;i<Math.min(words.length,index+7);i++) {
      if(VERBS.has(kinds[i]) || (words[index+1]==='quero'&&['imagem','video'].includes(kinds[i])))return true;
      if(!filler.has(words[i])||word==='sem')break;
    }
    return false;
  });
}
function inputReference(words,index) {
  const before=words.slice(Math.max(0,index-3),index).join(' ');
  const after=words.slice(index+1,index+3).join(' ');
  return /\b(?:essa|esta|esse|este|dessa|desta|desse|deste|nessa|nesta|nesse|neste)(?:\s+mesma?)?$/.test(before) ||
    /\b(?:usando|utilizando|partir|base)(?:\s+(?:a|o|da|do|de))?$/.test(before) ||
    /^(?:anexad[oa]|enviad[oa])\b/.test(after);
}
function explicitTarget(words,kinds,start) {
  const action=kinds[start];
  if(action==='animar')return 'video';
  let from=start+1;
  if(action==='transformar') {
    const inAt=words.indexOf('em',from);
    if(inAt<0||inAt>start+18)return null;
    from=inAt+1;
  }
  for(let i=from;i<Math.min(words.length,from+18);i++) {
    if(VERBS.has(kinds[i]))return null;
    if(kinds[i]==='escrita')return 'text';
    if(kinds[i]==='audio')return 'audio';
    if(['imagem','video'].includes(kinds[i])&&!inputReference(words,i))return kinds[i]==='imagem'?'image':'video';
  }
  return null;
}
/** The hold states are handled before the paid runtime in chat-engine. */
export function referenceMediaDecision(message) {
  const text=normalized(message),head=withoutPrefix(text);
  if(!text)return {kind:null,hold:null};
  if(ACTION.test(head))return {kind:/^(?:pesquis|busc|procure)/.test(head)?'research':'action',hold:null};
  if(EXPLANATION.test(head))return {kind:'text',hold:null};
  const words=tokens(text),kinds=words.map(kindOf);
  const starts=kinds.flatMap((kind,i)=>VERBS.has(kind)?[i]:[]);
  if(negated(words,kinds))return {kind:null,hold:'reference_cancelled'};
  // Never turn a request for a prompt, script or caption into media generation.
  const firstMeaning=kinds.find(kind=>['escrita','imagem','video'].includes(kind));
  if(/^(?:escreva|escrever|escreve|redija|redigir)\b/.test(head) ||
     (firstMeaning==='escrita'&&(!starts.length||kinds.slice(0,starts[0]).includes('escrita'))))return {kind:'text',hold:null};
  const targets=starts.map(i=>explicitTarget(words,kinds,i)).filter(Boolean);
  if(['text','audio'].includes(targets[0]))return {kind:targets[0],hold:null};
  const media=[...new Set(targets.filter(kind=>kind!=='text'))];
  const alternatives=words.some((word,i)=>['e','ou'].includes(word)&&
    ['imagem','video'].includes(kinds[i-1])&&!inputReference(words,i-1)&&
    kinds.slice(i+1,i+5).some(kind=>['imagem','video'].includes(kind)&&kind!==kinds[i-1]));
  if(media.length>1||alternatives)return {kind:null,hold:'reference_clarify'};
  if(media.length===1)return {kind:media[0],hold:null};
  if(/\b(?:de|dar|coloque|colocar)\s+(?:vida|movimento)\b/.test(text)&&requestsImageReference(message))return {kind:'video',hold:null};
  if((starts.length||/\bquero\b/.test(text))&&kinds.some(kind=>kind==='indefinido'))return {kind:null,hold:'reference_clarify'};
  // "Quero um video" does not require the verb "gerar".
  const want=words.indexOf('quero');
  if(want>=0) {
    const target=explicitTarget(words,kinds,want);
    if(target)return {kind:target,hold:null};
  }
  if(starts.length&&kinds.some(kind=>['imagem','video'].includes(kind)))return {kind:null,hold:'reference_clarify'};
  return {kind:null,hold:null};
}
export function referenceMediaKind(message){const {kind}=referenceMediaDecision(message);return ['image','video'].includes(kind)?kind:null;}
export function refusesImageReference(message) {
  return /\b(?:nao\s+(?:use|usar|usa|utilize|utilizar)|sem\s+(?:usar|utilizar))\s+(?:(?:a|o|essa|esta|esse|este)\s+)?(?:imagem|foto|print|anexo)\b/.test(normalized(message));
}
export function requestsImageReference(message) {
  let text=normalized(message);
  if(!text||refusesImageReference(message))return false;
  text=tokens(text).map(word=>['imagm','imagn','image','imageem'].includes(word)?'imagem':word).join(' ');
  return /\b(?:essa|esta|esse|este|dessa|desta|desse|deste|nessa|nesta|nesse|neste)\s+(?:mesma?\s+)?(?:imagem|foto|print|produto|embalagem|item|anexo)\b/.test(text)||
    /\b(?:imagem|foto|print|produto|embalagem)\s+(?:que\s+(?:eu\s+)?(?:enviei|mandei)|anexad[oa]|enviad[oa])\b/.test(text)||
    /\b(?:use|usar|usa|utilize|utilizar)\s+(?:a|o)\s+(?:imagem|foto|print|anexo)\b/.test(text);
}
export function routeReferenceMedia(message,baseIntent) {
  if(!baseIntent||typeof baseIntent!=='object')throw new TypeError('Base intent required');
  if(['action','research'].includes(baseIntent.kind))return baseIntent;
  const decision=referenceMediaDecision(message);
  if(decision.hold)return {kind:'text',capability:null,referenceHold:decision.hold};
  if(decision.kind==='text')return {kind:'text',capability:'support.draft-reply'};
  if(decision.kind)return {kind:decision.kind,capability:null};
  return baseIntent;
}
