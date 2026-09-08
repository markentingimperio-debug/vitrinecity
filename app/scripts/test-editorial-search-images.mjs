// Real public routes, an isolated database and no provider credentials or fetches.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-editorial-images-'));
const port=47500+Math.floor(Math.random()*500),origin=`http://127.0.0.1:${port}`;
const guard=path.join(dataDir,'outbound-guard.mjs');
writeFileSync(guard,"globalThis.fetch=async()=>{throw Error('External fetch disabled in editorial image test')};");
const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin});
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
let output='',db;child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const get=async pathname=>{const response=await fetch(origin+pathname,{redirect:'manual'});assert.equal(response.status,200,pathname);return response.json();};
try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(ready,output.slice(-2500));db=new Database(path.join(dataDir,'vitrinecity.db'));
  const insert=db.prepare("INSERT INTO editorial_articles(id,slug,portal,title,summary,body,image_url,status,published_at) VALUES (?,?, 'noticias',?,'Resumo público da fixture','Corpo público da fixture',?,?, '2099-01-01 00:00:00')");
  const images={generic:'/assets/vitriny-city-master.jpg',absolute:origin+'/assets/vitrinecity-avenida-premium.webp',recipe:'/assets/recipes/bolo-cenoura.jpg',ai:'/uploads/generated-videos/editorial-ai-a7150844-9ec1-4972-a3b4-10bd7da19a09.png',unsafe:'https://outside.invalid/image.jpg'};
  for(const [key,image]of Object.entries(images))insert.run('image-fixture-'+key,'image-fixture-'+key,'Imagemfixture '+key,image,'published');
  insert.run('image-fixture-draft','image-fixture-draft','Imagemfixture PRIVATE_DRAFT','/assets/recipes/bolo-cenoura.jpg','draft');
  db.prepare("INSERT INTO digital_books(id,slug,title,category,summary,cover_url,status,published_at) VALUES ('image-fixture-book','image-fixture-book','Imagemfixture livro','tecnologia','Livro da fixture','/assets/vitriny-city-master.jpg','published','2099-01-01 00:00:00')").run();
  const snapshot=()=>JSON.stringify(db.prepare("SELECT * FROM editorial_articles WHERE id LIKE 'image-fixture-%' ORDER BY id").all()),before=snapshot();
  for(const [route,field]of [['/api/discover','articles'],['/api/search?q=imagemfixture','contents'],['/api/discovery/search?q=imagemfixture','contents']]){
    const payload=await get(route),items=payload[field],find=key=>items.find(item=>item.url==='/artigo/image-fixture-'+key);
    for(const key of Object.keys(images))assert.ok(find(key),route+' keeps '+key+' visible');
    for(const key of ['generic','absolute','unsafe']){assert.equal(find(key).imageUrl,'',route+' '+key);assert.equal(find(key).imageCredit,'');}
    assert.equal(find('recipe').imageUrl,images.recipe);assert.equal(find('recipe').imageCredit,'');assert.equal(find('ai').imageCredit,'Ilustração por IA');
    assert.ok(!items.some(item=>item.url==='/artigo/image-fixture-draft'),'Draft visibility is unchanged');
    assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_DRAFT|Corpo público da fixture/);
    const book=(payload.books||items).find(item=>item.url==='/livro/image-fixture-book');
    assert.ok(book,route+' retains books');assert.equal(book.imageUrl,'/assets/vitriny-city-master.jpg','The policy applies only to editorial article covers');
  }
  assert.equal(snapshot(),before,'Image display rules do not modify published content');
  console.log('editorial-search-images: discover, legacy search and primary search omit institutional covers, preserve recipes/books, credit AI and hide drafts');
}finally{
  db?.close();if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  const resolved=path.resolve(dataDir);
  if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('vitriny-editorial-images-'))rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
