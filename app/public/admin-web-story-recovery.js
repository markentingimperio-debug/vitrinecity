const key=(value,max=300)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value:null;
export function storyPublicHref(value){
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\s\\\u0000-\u001f\u007f]/.test(value))return null;
  try{const url=new URL(value,'https://vitrinecity.invalid');if(url.origin!=='https://vitrinecity.invalid'||/^\/(?:api|admin[^/]*|logout|sair)(?:\/|$)/i.test(url.pathname))return null;return url.pathname+url.search+url.hash;}catch{return null;}
}
export function storyEntry(search){
  const params=new URLSearchParams(search),story=params.get('story'),source=params.get('source');
  if(story!==null){if(!key(story,200))throw Error('O link desta história está incompleto. Abra o conteúdo pela biblioteca.');return {storyId:story};}
  if(source!==null){if(!key(source))throw Error('O link desta fonte está incompleto. Escolha o conteúdo novamente.');return {sourceKey:source};}
  return null;
}
// Opening a recovery link only reads protected data. Draft creation stays on the form's submit action.
export async function readStoryEntry(search,api){
  const entry=storyEntry(search);if(!entry)return null;
  if(entry.storyId)return {story:await api('/api/admin/web-stories/'+encodeURIComponent(entry.storyId))};
  const result=await api('/api/admin/web-stories/sources?'+new URLSearchParams({sourceKey:entry.sourceKey}));
  const source=Array.isArray(result?.items)?result.items.find(item=>item.id===entry.sourceKey):null;
  if(!source)throw Error('A fonte desta tentativa não está mais disponível no catálogo publicado. Confira a página original antes de criar uma história.');
  if(key(source.story_id,200))return {source,story:await api('/api/admin/web-stories/'+encodeURIComponent(source.story_id))};
  return {source};
}
export function storyHistoryLink(item){
  const id=item?.recovery?.storyId||item?.storyId;
  if(typeof id==='string'&&id.length>0&&id.length<=200)return '/admin-web-stories?story='+encodeURIComponent(id)+'#editor';
  const source=key(item?.recovery?.sourceKey||item?.sourceKey);
  return source&&item?.recovery?.sourceAvailable===true?'/admin-web-stories?source='+encodeURIComponent(source)+'#source-manual':null;
}
export function storyOutcomeSummary(status){
  const n=value=>Number.isInteger(value)&&value>=0?String(value):'—',q=status?.quota||{};
  return `${n(q.published)} publicadas pela rotina · ${n(q.review)} tentativas em revisão · ${n(q.failed)} falhas · ${n(q.interrupted)} interrompidas · ${n(q.remaining)} tentativas restantes`;
}
const CHECKS={grounded:'Conferir as informações com as fontes.',original:'Revisar a originalidade do conteúdo.',complete:'Completar as informações da história.',nonRepetitive:'Retirar repetições e acrescentar conteúdo útil.',commerceBalanced:'Equilibrar a oferta com informações úteis.',risk:'Revisar os cuidados e as afirmações do conteúdo.'};
export function storyDiagnosticLines(diagnostics){
  if(!diagnostics||typeof diagnostics!=='object')return [];
  return [...new Set(Array.isArray(diagnostics.qualityFailures)?diagnostics.qualityFailures:[])].flatMap(code=>CHECKS[code]?[CHECKS[code]]:[]);
}
