import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_JSON_BYTES=64*1024;
const MAX_UPLOAD_BYTES=50*1024*1024;
const MAX_TASKS=200;
const URL_RE=/https:\/\/[^\s<>"']+/i;
const MIME_EXT=new Map([
  ['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],
  ['video/mp4','mp4'],['video/webm','webm'],['video/quicktime','mov'],
  ['audio/mpeg','mp3'],['audio/mp4','m4a'],['audio/wav','wav'],['audio/ogg','ogg']
]);

function truthy(v){return ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase());}
function sha(v){return createHash('sha256').update(String(v)).digest();}
function safeEqual(a,b){
  const aa=sha(a),bb=sha(b);
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function cleanInstruction(value){
  const text=String(value||'').trim();
  if(text.length<3||text.length>6000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Object.assign(new Error('invalid_instruction'),{status:400});
  return text;
}
function normalize(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function has(re,text){return re.test(normalize(text));}

export function classifyOperationInstruction(instruction){
  const text=cleanInstruction(instruction),n=normalize(text);
  const url=(text.match(URL_RE)||[])[0]||'';
  const browser=Boolean(url)||/\b(abra|abrir|acesse|acessar|navegue|navegar|pagina|site|clique|clicar|preencha|captura|screenshot)\b/.test(n);
  const media=/\b(video|foto|imagem|thumbnail|capa|cortar|corte|recortar|redimensionar|redimensione|vertical|horizontal|audio|som|normalizar)\b/.test(n);
  let kind='unsupported';
  if(browser&&media)kind='combined';
  else if(browser)kind='browser';
  else if(media)kind='media';
  return {kind,url,supported:['browser','media'].includes(kind),needsUpload:kind==='media',chargeClass:kind};
}

function parseDimensions(text){
  const m=normalize(text).match(/\b(\d{2,4})\s*[x×]\s*(\d{2,4})\b/);
  if(!m)return null;
  const width=Number(m[1]),height=Number(m[2]);
  if(width<16||height<16||width>7680||height>7680)return null;
  return {width,height};
}
function parseClip(text){
  const n=normalize(text);
  const range=n.match(/(?:de|do segundo)\s*(\d+(?:[.,]\d+)?)\s*(?:a|ate)\s*(\d+(?:[.,]\d+)?)/);
  if(range){
    const start=Number(range[1].replace(',','.')),end=Number(range[2].replace(',','.'));
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)return {startSeconds:start,durationSeconds:end-start};
  }
  const duration=n.match(/(?:por|duracao de)\s*(\d+(?:[.,]\d+)?)\s*(?:s|segundo)/);
  if(duration){
    const d=Number(duration[1].replace(',','.'));
    if(Number.isFinite(d)&&d>0)return {startSeconds:0,durationSeconds:d};
  }
  return {startSeconds:0,durationSeconds:30};
}
function mediaPlan(instruction,input,taskId){
  const n=normalize(instruction),dims=parseDimensions(instruction);
  const ext=path.extname(input).toLowerCase();
  const image=['.jpg','.jpeg','.png','.webp'].includes(ext);
  const video=['.mp4','.mov','.mkv','.webm'].includes(ext);
  if(/\b(thumbnail|capa)\b/.test(n)){
    const t=n.match(/(?:segundo|em)\s*(\d+(?:[.,]\d+)?)/);
    return {action:'thumbnail',input,output:`completed/${taskId}-thumbnail.jpg`,timeSeconds:t?Number(t[1].replace(',','.')):1,width:dims?.width||1280,height:dims?.height||720};
  }
  if(video&&/\b(cortar|corte|recortar|recorte)\b/.test(n)){
    return {action:'clip',input,output:`completed/${taskId}-clip.mp4`,...parseClip(instruction)};
  }
  if(video&&(/\bvertical\b/.test(n)||/\b9\s*:\s*16\b/.test(n))){
    return {action:'videoResize',input,output:`completed/${taskId}-vertical.mp4`,width:dims?.width||1080,height:dims?.height||1920};
  }
  if(video&&dims)return {action:'videoResize',input,output:`completed/${taskId}-resized.mp4`,...dims};
  if(image&&dims)return {action:'imageResize',input,output:`completed/${taskId}-resized${ext==='.jpeg'?'.jpg':ext}`,...dims};
  if(/\b(normalizar|normalize|audio|som)\b/.test(n)){
    return {action:'audioNormalize',input,output:`completed/${taskId}-audio${video?'.mp4':ext||'.m4a'}`};
  }
  return {action:'probe',input};
}

function safeArtifact(root,relative,mustExist=false){
  if(typeof relative!=='string'||relative.length<1||relative.length>240||path.isAbsolute(relative)||relative.includes('\0'))throw Object.assign(new Error('invalid_artifact_path'),{status:400});
  const out=path.resolve(root,relative),prefix=root.endsWith(path.sep)?root:root+path.sep;
  if(!(out===root||out.startsWith(prefix)))throw Object.assign(new Error('invalid_artifact_path'),{status:400});
  return out;
}
function sourceCandidates(links){
  return links.map(x=>{
    try{
      const parsed=new URL(x.url);
      if(/(^|\.)bing\.com$/.test(parsed.hostname)&&parsed.pathname==='/ck/a'){
        const encoded=parsed.searchParams.get('u')||'';
        if(!encoded.startsWith('a1'))return null;
        const direct=Buffer.from(encoded.slice(2),'base64url').toString('utf8');
        if(new URL(direct).protocol!=='https:')return null;
        return {...x,url:direct};
      }
      if(/(^|\.)(?:bing|google|duckduckgo)\.[a-z.]+$/.test(parsed.hostname))return null;
      return parsed.protocol==='https:'?x:null;
    }catch{return null;}
  }).filter(Boolean).slice(0,12);
}
function researchQuery(instruction){
  let query=instruction.split(/[.!?]\s/)[0]
    .replace(/^\s*(?:por favor[, ]*)?(?:pesquise|pesquisar|pesquisa|busque|buscar|procure|procurar)\b\s*/i,'')
    .replace(/^\s*(?:em\s+)?(?:pelo menos\s+)?(?:\d+|duas|dois|tres|três|quatro)\s+fontes?\s+(?:públicas?\s+)?(?:confiáveis?\s+)?/i,'')
    .replace(/^\s*(?:sobre|a respeito de|as principais|os principais)\s+/i,'')
    .replace(/[,;]\s*(?:analise|compare|resuma|entregue|cite)\b.*$/i,'')
    .replace(/\s+para\s+(?:uma|a)\s+página\s+da\s+lia\b.*$/i,'')
    .trim();
  query=normalize(query).split(/[^a-z0-9]+/).filter(term=>term.length>=3&&
    !['recomendacoes','principais','melhores','fontes','publicas','confiaveis','sobre','para','com','das','dos','uma','que','ser','ter'].includes(term)).slice(0,7).join(' ');
  if(query.length<4||query.length>240)throw Object.assign(new Error('research_query_invalid'),{status:400});
  return query;
}
function relevantCandidate(candidate,query){
  const terms=normalize(query).split(/[^a-z0-9]+/).filter(term=>term.length>=4&&!['para','sobre','principais','recomendacoes','fontes','publicas','confiaveis'].includes(term));
  const haystack=normalize(`${candidate.text||''} ${candidate.url||''}`);
  return terms.some(term=>haystack.includes(term));
}
async function searchCandidates(query){
  const url=new URL('https://vitrinecity.com/api/search/web');
  url.search=new URLSearchParams({q:query,type:'web',page:'1'}).toString();
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Object.assign(new Error('research_search_unavailable'),{status:502});
  const data=await response.json();
  if(!['ready','partial','empty'].includes(data?.status)||!Array.isArray(data.results))throw Object.assign(new Error('research_search_invalid'),{status:502});
  return sourceCandidates(data.results.slice(0,25).map(item=>({text:String(item.title||''),url:String(item.url||'')})));
}
async function readJson(req,limit=MAX_JSON_BYTES){
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('payload_too_large'),{status:413});chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
function sendJson(res,status,payload){
  const raw=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(raw)});
  res.end(raw);
}
async function mediaRequest(socketPath,token,payload){
  const raw=Buffer.from(JSON.stringify(payload));
  return await new Promise((resolve,reject)=>{
    const req=http.request({socketPath,path:'/v1/media/run',method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':raw.length}},res=>{
      const chunks=[];res.on('data',d=>chunks.push(d));res.on('end',()=>{
        let data={};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}
        if((res.statusCode||500)>=400)return reject(Object.assign(new Error(String(data.error||'media_failed')),{status:502}));
        resolve(data);
      });
    });
    req.setTimeout(15*60*1000,()=>req.destroy(new Error('media_timeout')));
    req.on('error',reject);req.end(raw);
  });
}

export async function createOperationsRouter({env=process.env,dataDir='/opt/lia/data'}={}){
  const enabled=truthy(env.LIA_OPERATIONS_ENABLED);
  const token=String(env.LIA_OPERATIONS_TOKEN||'');
  const browserUrl=String(env.LIA_BROWSER_WORKER_URL||'http://127.0.0.1:8792').replace(/\/+$/,'');
  const browserToken=String(env.LIA_BROWSER_CONTROL_TOKEN||'');
  const mediaSocket=String(env.LIA_MEDIA_SOCKET||'/run/lia-media-worker/media.sock');
  const mediaToken=String(env.LIA_MEDIA_CONTROL_TOKEN||'');
  const artifactRoot=path.resolve(env.LIA_ARTIFACT_ROOT||'/opt/lia/artifacts');
  const tasksFile=path.join(path.resolve(dataDir),'operations-tasks.json');
  if(enabled){
    if(token.length<32)throw new Error('operations_token_too_short');
    if(browserToken.length<32)throw new Error('browser_token_too_short');
    if(mediaToken.length<32)throw new Error('media_token_too_short');
  }
  await fs.mkdir(path.dirname(tasksFile),{recursive:true,mode:0o750});
  await fs.mkdir(path.join(artifactRoot,'incoming'),{recursive:true,mode:0o770});
  await fs.mkdir(path.join(artifactRoot,'completed'),{recursive:true,mode:0o770});
  let tasks=[];
  try{const parsed=JSON.parse(await fs.readFile(tasksFile,'utf8'));if(Array.isArray(parsed))tasks=parsed;}catch(e){if(e?.code!=='ENOENT')throw e;}

  const auth=req=>{
    const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const header=String(req.headers['x-lia-operations-token']||'');
    return token.length>=32&&((bearer&&safeEqual(bearer,token))||(header&&safeEqual(header,token)));
  };
  const persist=async()=>{
    if(tasks.length>MAX_TASKS)tasks=tasks.slice(-MAX_TASKS);
    const tmp=`${tasksFile}.tmp-${process.pid}`;
    await fs.writeFile(tmp,JSON.stringify(tasks,null,2)+'\n',{mode:0o600});await fs.rename(tmp,tasksFile);
  };
  const view=t=>({id:t.id,status:t.status,instruction:t.instruction,kind:t.kind,actor:t.actor,createdAt:t.createdAt,updatedAt:t.updatedAt,completedAt:t.completedAt||null,result:t.result||'',resultData:t.resultData||null,error:t.error||null,events:t.events||[],artifacts:t.artifacts||[],provider:t.provider||null,model:'deterministic-ops-v1',step:(t.events||[]).length,usage:{totalTokens:0}});
  const find=id=>tasks.find(t=>t.id===id);

  async function browserRun(task,plan){
    const url=plan.url||(/vitrine\s*city/i.test(task.instruction)?'https://vitrinecity.com':'');
    if(!url)throw Object.assign(new Error('browser_url_required'),{status:400});
    const output=`op-${task.id}-page.png`;
    const steps=[{action:'goto',url},{action:'text',selector:'body'},{action:'links'},...(plan.noScreenshot?[]:[{action:'screenshot',output,fullPage:true}])];
    const response=await fetch(browserUrl+'/v1/browser/run',{method:'POST',headers:{authorization:`Bearer ${browserToken}`,'content-type':'application/json'},body:JSON.stringify({steps}),signal:AbortSignal.timeout(120000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(String(data.error||'browser_failed')),{status:502});
    const textOutput=(data.outputs||[]).find(x=>x.action==='text')?.text||'';
    const links=(data.outputs||[]).find(x=>x.action==='links')?.links||[];
    const artifact=(data.outputs||[]).find(x=>x.action==='screenshot')?.artifact||'';
    task.events.push({tool:'browser.run',ok:true,detail:url});
    if(artifact)task.artifacts.push({path:'browser/'+artifact,kind:'image'});
    const candidates=sourceCandidates(links);
    if(/unusual traffic|complete the following challenge|verify you are human/i.test(textOutput)&&!candidates.length)
      throw Object.assign(new Error('search_verification_required'),{status:502});
    const found=candidates.length?'\n\nLinks encontrados:\n'+candidates.map(x=>`- ${x.text}: ${x.url}`).join('\n'):'';
    return {summary:`${plan.search?'Busca por nome; confirme o endereço antes de abrir':'Página acessada'}: ${data.title||url}\n\n${textOutput.slice(0,6000)}${found}`,raw:data,candidates};
  }
  async function mediaRun(task,input){
    if(!input)throw Object.assign(new Error('media_upload_required'),{status:400});
    safeArtifact(artifactRoot,input);
    const payload=mediaPlan(task.instruction,input,task.id);
    const data=await mediaRequest(mediaSocket,mediaToken,payload);
    task.events.push({tool:`media.${payload.action}`,ok:true,detail:payload.output||input});
    if(data.output)task.artifacts.push({path:data.output,kind:path.extname(data.output).match(/mp4|mov|webm/i)?'video':'file'});
    return {summary:data.output?`Edição concluída: ${data.output}`:`Análise concluída para ${input}`,raw:data};
  }
  async function execute(task,body){
    const plan=classifyOperationInstruction(task.instruction);
    task.kind=plan.kind;
    if(!plan.supported)throw Object.assign(new Error('operation_unsupported'),{status:400});
    if(plan.kind==='combined')throw Object.assign(new Error('combined_operation_requires_separate_tasks'),{status:400});
    if(plan.kind==='browser')return browserRun(task,plan);
    if(plan.kind==='media')return mediaRun(task,String(body.artifactPath||''));
    throw Object.assign(new Error('operation_unsupported'),{status:400});
  }

  async function handle(req,res,url){
    if(!url.pathname.startsWith('/v1/operations'))return false;
    if(req.method==='GET'&&url.pathname==='/v1/operations/health'){
      sendJson(res,200,{ok:true,service:'lia-operations',enabled,browserConfigured:browserToken.length>=32,mediaConfigured:mediaToken.length>=32});return true;
    }
    if(!auth(req)){sendJson(res,401,{ok:false,error:'unauthorized'});return true;}
    if(!enabled){sendJson(res,423,{ok:false,error:'operations_locked'});return true;}

    if(req.method==='POST'&&url.pathname==='/v1/operations/quote'){
      const body=await readJson(req),plan=classifyOperationInstruction(body.instruction);
      sendJson(res,200,{ok:true,...plan});return true;
    }
    if(req.method==='POST'&&url.pathname==='/v1/operations/research'){
      const body=await readJson(req),instruction=cleanInstruction(body.instruction);
      const explicitUrl=(instruction.match(URL_RE)||[])[0]||'';
      const query=explicitUrl?'':researchQuery(instruction);
      const target=explicitUrl||'';
      const task={id:'op_'+randomUUID(),status:'running',instruction,kind:'browser',actor:String(body.actor||'admin').slice(0,120),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),events:[],artifacts:[]};
      tasks.push(task);await persist();
      try{
        const result=explicitUrl?await browserRun(task,{url:target,noScreenshot:true}):null;
        const sources=[];
        if(!explicitUrl){
          const candidates=(await searchCandidates(query)).filter(candidate=>relevantCandidate(candidate,query));
          task.events.push({tool:'search.query',ok:true,detail:query});
          const seenHosts=new Set();
          for(const candidate of candidates){
            let hostname;try{hostname=new URL(candidate.url).hostname;}catch{continue;}
            if(seenHosts.has(hostname))continue;
            seenHosts.add(hostname);
            try{
              const page=await browserRun(task,{url:candidate.url,noScreenshot:true});
              const excerpt=String((page.raw.outputs||[]).find(x=>x.action==='text')?.text||'').slice(0,5000);
              const title=String(page.raw.title||'');
              if(excerpt.length<100||/^(?:acesso bloqueado|access denied|just a moment|forbidden|verify you are human)/i.test(title.trim())||
                /(?:complete the following challenge|verify you are human|unusual traffic|captcha)/i.test(excerpt.slice(0,1000)))continue;
              sources.push({url:page.raw.finalUrl||candidate.url,title:String(page.raw.title||candidate.text||hostname).slice(0,200),excerpt});
            }catch(error){task.events.push({tool:'browser.source',ok:false,detail:hostname,error:String(error?.message||'unavailable').slice(0,120)});}
            if(seenHosts.size>=8)break;
          }
        }else{
          const excerpt=String((result.raw.outputs||[]).find(x=>x.action==='text')?.text||'').slice(0,5000);
          if(excerpt)sources.push({url:result.raw.finalUrl||explicitUrl,title:String(result.raw.title||explicitUrl).slice(0,200),excerpt});
        }
        const score=source=>{
          const host=new URL(source.url).hostname,haystack=normalize(`${source.title} ${source.excerpt.slice(0,2500)}`);
          const terms=normalize(query).split(/[^a-z0-9]+/).filter(term=>term.length>=4&&!['para','sobre','principais','recomendacoes'].includes(term));
          return terms.filter(term=>haystack.includes(term)).length*3+(/(?:^|\.)(?:gov|edu|ac)\./.test(host)?3:0)+(/(?:^|\.)(?:w3|org)\./.test(host)?2:0)+
            (host.endsWith('.ufc.br')?2:0)-(host.endsWith('wikipedia.org')?4:0);
        };
        sources.sort((a,b)=>score(b)-score(a));
        const selected=sources.slice(0,3);
        const sourceSummary=selected.map((source,index)=>`Fonte ${index+1}: ${source.title}\n${source.url}\n${source.excerpt.slice(0,1800)}`).join('\n\n');
        task.status='completed';task.result=sourceSummary||'Nenhuma fonte pública verificável encontrada para este tema.';
        task.resultData={query:query||null,sources:selected};task.provider='browser-worker';task.completedAt=new Date().toISOString();task.updatedAt=task.completedAt;
        await persist();sendJson(res,201,{ok:true,item:view(task)});return true;
      }catch(error){
        task.status='failed';task.error=String(error?.message||'research_failed').slice(0,300);task.updatedAt=new Date().toISOString();await persist();
        sendJson(res,error?.status||502,{ok:false,error:task.error,item:view(task)});return true;
      }
    }
    if(req.method==='POST'&&url.pathname==='/v1/operations/upload'){
      const mime=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase(),ext=MIME_EXT.get(mime);
      if(!ext){sendJson(res,415,{ok:false,error:'unsupported_media_type'});return true;}
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD_BYTES){sendJson(res,413,{ok:false,error:'upload_too_large'});return true;}chunks.push(chunk);}
      if(size<1){sendJson(res,400,{ok:false,error:'empty_upload'});return true;}
      const rel=`incoming/${randomUUID()}.${ext}`,dest=safeArtifact(artifactRoot,rel);
      await fs.writeFile(dest,Buffer.concat(chunks),{mode:0o660,flag:'wx'});
      sendJson(res,201,{ok:true,artifactPath:rel,sizeBytes:size,mimeType:mime});return true;
    }
    if(req.method==='GET'&&url.pathname==='/v1/operations/artifact'){
      const rel=String(url.searchParams.get('path')||''),file=safeArtifact(artifactRoot,rel,true);
      let stat;try{stat=await fs.stat(file);}catch{return sendJson(res,404,{ok:false,error:'artifact_not_found'}),true;}
      if(!stat.isFile()||stat.size>MAX_UPLOAD_BYTES*2){sendJson(res,404,{ok:false,error:'artifact_not_found'});return true;}
      res.writeHead(200,{'content-type':'application/octet-stream','content-length':stat.size,'cache-control':'private,no-store','x-content-type-options':'nosniff','content-disposition':`attachment; filename="${path.basename(file).replace(/[^A-Za-z0-9._-]/g,'_')}"`});
      createReadStream(file).pipe(res);return true;
    }
    if(req.method==='GET'&&url.pathname==='/v1/operations/tasks'){
      sendJson(res,200,{ok:true,items:tasks.slice(-50).reverse().map(view)});return true;
    }
    if(req.method==='POST'&&url.pathname==='/v1/operations/tasks'){
      const body=await readJson(req),instruction=cleanInstruction(body.instruction),actor=String(body.actor||'unknown').slice(0,120);
      const task={id:'op_'+randomUUID(),status:'running',instruction,kind:null,actor,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),events:[],artifacts:[]};
      tasks.push(task);await persist();
      try{
        const result=await execute(task,body);
        task.status='completed';task.result=result.summary;task.resultData=result.raw;task.provider=task.kind==='browser'?'browser-worker':'media-worker';task.completedAt=new Date().toISOString();task.updatedAt=task.completedAt;
        await persist();sendJson(res,201,{ok:true,item:view(task)});return true;
      }catch(error){
        task.status='failed';task.error=String(error?.message||'operation_failed').slice(0,300);task.updatedAt=new Date().toISOString();await persist();
        sendJson(res,error?.status||500,{ok:false,error:task.error,item:view(task)});return true;
      }
    }
    const m=url.pathname.match(/^\/v1\/operations\/tasks\/(op_[0-9a-f-]+)(?:\/(cancel))?$/i);
    if(m){
      const task=find(m[1]);if(!task){sendJson(res,404,{ok:false,error:'task_not_found'});return true;}
      if(req.method==='GET'&&!m[2]){sendJson(res,200,{ok:true,item:view(task)});return true;}
      if(req.method==='POST'&&m[2]==='cancel'){
        if(task.status==='running'){task.status='cancelled';task.updatedAt=new Date().toISOString();await persist();}
        sendJson(res,200,{ok:true,item:view(task)});return true;
      }
    }
    sendJson(res,404,{ok:false,error:'not_found'});return true;
  }
  return {enabled,handle,classify:classifyOperationInstruction};
}
