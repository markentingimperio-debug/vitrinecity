// Public, read-only context for Lia's paid chat. Every result is selected from
// the current platform database, at quote time, before the provider permit is hashed.
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const STOP=new Set('quero gostaria preciso me mostre indicar indique comprar compra um uma para por com da de do das dos no na em qual quais tem voce vcs lia site cidade vitrinecity produto produtos loja lojas curso cursos'.split(' '));
const terms=query=>[...new Set((normalize(query).match(/[a-z0-9]{3,32}/g)||[]).filter(t=>!STOP.has(t)))].slice(0,5);
const safe=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,110);

export function createLiveEcosystemContext({db,now=Date.now}={}){
  if(!db?.prepare)throw new TypeError('Ecosystem context requires a database.');
  const available=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  return question=>{
    const query=normalize(question),tokens=terms(question);
    if(!tokens.length&&!/\b(?:cidade|lojas?|ads|anuncios?|cursos?|studio|estudio|video|videos|social|pesquisa)\b/.test(query))return null;
    const scored=(name)=>tokens.reduce((score,term)=>score+(name.includes(term)?1:0),0);
    const products=[];
    if(available('store_products')&&available('store_profiles')){
      const rows=db.prepare(`SELECT p.id,p.name,p.category,s.business_name
        FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference
        WHERE p.active=1 AND p.review_status='approved' AND p.marketplace_enabled=1
          AND p.available=1 AND p.price_cents>0 AND p.stock_quantity>0 AND s.review_status='published'
        ORDER BY p.id DESC LIMIT 250`).all();
      products.push(...rows.map(p=>({...p,score:scored(normalize(p.name)+' '+normalize(p.category))}))
        .filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,4)
        .map(p=>({name:safe(p.name),store:safe(p.business_name),url:`https://vitrinecity.com/produto/${p.id}`})));
    }
    const courses=[];
    if(available('managed_courses')){
      const rows=db.prepare("SELECT slug,title,description FROM managed_courses WHERE active=1 AND status='active' AND (length(material_url)>0 OR length(video_url)>0) ORDER BY slug LIMIT 100").all();
      courses.push(...rows.filter(c=>scored(normalize(c.title)+' '+normalize(c.description))>0).slice(0,2)
        .map(c=>({title:safe(c.title),url:`https://vitrinecity.com/centro-educacional.html#${encodeURIComponent(c.slug)}`})));
    }
    const locations=[];
    if(available('store_profiles')&&/\b(?:cidade|loja|lojas|onde|encontrar|visitar|mapa)\b/.test(query)){
      const rows=db.prepare("SELECT business_name,public_slug FROM store_profiles WHERE review_status='published' AND public_slug IS NOT NULL ORDER BY id LIMIT 12").all();
      locations.push(...rows.filter(s=>scored(normalize(s.business_name))>0||/\b(?:cidade|loja|lojas|mapa)\b/.test(query)).slice(0,3)
        .map(s=>({name:safe(s.business_name),url:`https://vitrinecity.com/cidade`})));
    }
    const routes=[];
    if(/\b(?:cidade|mapa|explorar|lojas?)\b/.test(query))routes.push({area:'Cidade e lojas',url:'https://vitrinecity.com/cidade'});
    if(/\b(?:produtos?|npk|comprar|compras)\b/.test(query))routes.push({area:'Loja',url:'https://vitrinecity.com/loja'});
    if(/\b(?:cursos?|aprender|ensino)\b/.test(query))routes.push({area:'Cursos',url:'https://vitrinecity.com/cursos'});
    if(/\b(?:social|videos?|criadores?)\b/.test(query))routes.push({area:'Vitrine Social',url:'https://vitrinecity.com/social'});
    if(/\b(?:ads|anuncios?|campanhas?|publicidade)\b/.test(query))routes.push({area:'Carteira de anúncios',url:'https://vitrinecity.com/carteira.html'});
    if(!products.length&&!courses.length&&!locations.length&&!routes.length)return null;
    return {observedAt:new Date(now()).toISOString(),products,courses,locations,routes,
      note:'Registros públicos atuais do catálogo. Ativo/publicado não comprova estoque, preço, promoção, disponibilidade ou entrega agora. Confirme na página antes de comprar. Links são destinos, não ações executadas.'};
  };
}
