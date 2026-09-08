import {editorialImage} from './editorial-image-policy.js';

const PAGE_SIZE=12,MAX_PAGE=10000;
const categories=new Set(['total','noticias','receitas','esportes','entretenimento']);
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const invalid=message=>Object.assign(Error(message),{status:400});

function publicDate(value){
  if(typeof value!=='string'||!value.trim())return null;
  // SQLite CURRENT_TIMESTAMP is UTC; preserve that meaning in the public DTO.
  const raw=value.trim(),iso=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)?raw.replace(' ','T')+'Z':raw;
  const time=Date.parse(iso);return Number.isFinite(time)?new Date(time).toISOString():null;
}

/** Read-only editorial catalog. No AI, research, job, tracking or publication
 * calls occur here; companion articles are ordinary published destinations. */
export function createEmissoraFeed({db,siteUrl}){
  const origin=new URL(siteUrl).origin;
  db.function('emissora_normalize',{deterministic:true},normalize);
  function list(input={}){
    if(input.categoria!==undefined&&typeof input.categoria!=='string')throw invalid('Escolha uma categoria válida.');
    const category=input.categoria||'total';if(!categories.has(category))throw invalid('Escolha uma categoria válida.');
    if(input.q!==undefined&&typeof input.q!=='string')throw invalid('Informe uma busca em texto.');
    const query=(input.q||'').trim();if(query.length>120||/[\x00-\x1f\x7f]/.test(query))throw invalid('Use uma busca com até 120 caracteres.');
    if(input.page!==undefined&&(typeof input.page!=='string'||!/^[1-9]\d{0,4}$/.test(input.page)))throw invalid('Informe uma página válida.');
    const page=Number(input.page||1);if(page>MAX_PAGE)throw invalid('Informe uma página válida.');
    const where=["status='published'","portal IN ('noticias','receitas','esportes','entretenimento','celebridades')"],params=[];
    if(category!=='total'){
      where.push(category==='entretenimento'?"portal IN ('entretenimento','celebridades')":'portal=?');
      if(category!=='entretenimento')params.push(category);
    }
    for(const term of normalize(query).split(' ').filter(Boolean)){
      where.push("instr(emissora_normalize(COALESCE(title,'')||' '||COALESCE(summary,'')||' '||COALESCE(body,'')||' '||COALESCE(portal,'')),?)>0");params.push(term);
    }
    const clause=where.join(' AND ');
    const total=db.prepare('SELECT count(*) total FROM editorial_articles WHERE '+clause).get(...params).total;
    const rows=db.prepare(`SELECT slug,portal,title,summary,image_url,published_at,updated_at FROM editorial_articles WHERE ${clause}
      ORDER BY datetime(published_at) DESC,slug ASC LIMIT ? OFFSET ?`).all(...params,PAGE_SIZE,(page-1)*PAGE_SIZE);
    const items=rows.map(row=>{
      const image=editorialImage(row.image_url,{siteUrl:origin});
      return {slug:String(row.slug),category:row.portal==='celebridades'?'entretenimento':row.portal,title:String(row.title||''),summary:String(row.summary||''),imageUrl:image.url,imageCredit:image.credit,url:'/artigo/'+encodeURIComponent(row.slug),publishedAt:publicDate(row.published_at),updatedAt:publicDate(row.updated_at)};
    });
    return {category,query,page,pageSize:PAGE_SIZE,total,pages:Math.max(1,Math.ceil(total/PAGE_SIZE)),items};
  }
  return {list};
}

export function setupEmissora({app,db,siteUrl}){
  const feed=createEmissoraFeed({db,siteUrl});
  app.get('/api/emissora/conteudos',(req,res)=>{
    res.set('X-Content-Type-Options','nosniff');
    try{return res.set('Cache-Control','public,max-age=60').json(feed.list(req.query));}
    catch(error){return res.status(error.status===400?400:503).set('Cache-Control','no-store').json({error:error.status===400?error.message:'Os conteúdos estão indisponíveis no momento. Tente novamente.'});}
  });
  return feed;
}
