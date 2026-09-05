const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function oneEdit(a,b){
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;
    if(a.length===b.length){if(a[i]===b[j+1]&&a[i+1]===b[j]){i+=2;j+=2;}else{i++;j++;}}
    else if(a.length>b.length)i++;else j++;
  }
  return edits+(i<a.length||j<b.length?1:0)<=1;
}
export function suggestSpelling(query,titles){
  const words=norm(query).split(' ');if(words.length>8)return null;
  const vocab=new Set(titles.flatMap(t=>norm(t).split(' ')).filter(w=>w.length>=4));
  let changed=0;
  const corrected=words.map(word=>{
    if(word.length<5||vocab.has(word)||changed)return word;
    const candidates=[...vocab].filter(v=>v[0]===word[0]&&oneEdit(word,v));
    if(candidates.length!==1)return word;changed++;return candidates[0];
  }).join(' ');
  return changed?corrected:null;
}
