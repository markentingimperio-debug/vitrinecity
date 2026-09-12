import {createHash} from 'node:crypto';
import {createStoryAssets} from './web-story-assets.js';
import {createWebStorySources} from './web-story-sources.js';
import {createWebStoryResearch} from './web-story-research.js';
import {createWebStoryAI,storySourcePreflight} from './web-story-ai.js';
import {createStoryAutomation} from './web-story-automation.js';
import {setupWebStories} from './web-stories.js';
import {createLocalEditorialStories} from './web-story-local.js';
import {storyDiagnostics} from './web-story-diagnostics.js';
import {createEditorialChannelSources} from './editorial-channel-sources.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const notes={quality_checks_passed:'História criada, revisada pela IA e publicada.',source_needs_verified_evidence:'Faltam fontes verificadas para sustentar esta história.',source_insufficient_for_ten_pages:'O conteúdo não sustenta dez páginas úteis. Complete a página de origem.',catalog_photo_missing:'O catálogo precisa de uma foto original.',catalog_photo_quality:'A foto original precisa de mais resolução.',catalog_photo_unavailable:'A foto original não está disponível para a história.',source_asset_unavailable:'Revise a imagem original do conteúdo.',ai_copy_limits:'A redação precisa de ajuste no título ou na descrição.',ai_ten_pages_required:'A redação não atingiu dez páginas completas.',ai_page_invalid:'Uma página precisa de ajuste no texto.',ai_repetitive_or_thin:'O texto ficou repetitivo ou curto demais.',ai_unbacked_numbers:'A revisão encontrou números ausentes na fonte.',ai_pressure_or_promise:'A revisão encontrou uma promessa ou chamada inadequada.',ai_review_held:'A revisão automática pediu ajustes no conteúdo.',ai_text_unavailable:'A IA de texto não concluiu esta história.',ai_invalid_json:'A IA devolveu um formato de texto inválido.',ai_image_unavailable:'A IA de imagem não concluiu esta história.',story_image_invalid:'O provedor não entregou uma imagem válida.',story_image_quality:'A imagem gerada não atingiu a qualidade necessária.',source_destination_invalid:'A página de destino precisa ser corrigida.'};
Object.assign(notes,{local_editorial_preserved:'Texto integral e imagem da fonte própria aprovada foram diagramados e publicados.',local_source_needs_editing:'A fonte precisa de ajuste para caber integralmente em dez a vinte páginas.',local_source_needs_review:'A fonte precisa de revisão editorial antes da diagramação automática.',local_source_image_invalid:'A imagem original precisa ser corrigida antes de publicar.'});
notes.ai_provider_blocked='O provedor exige revisão da conta, da configuração ou da política de dados antes de outra geração.';
notes.prayer_story_reused='Oração pública integral e arte existente conferidas e diagramadas, sem nova IA.';
const explain=value=>Object.hasOwn(notes,String(value))?notes[value]:'Esta história precisa de revisão antes de publicar.';

export function setupDailyWebStories({app,db,requireAdmin,sameOriginOnly,siteUrl,publicDir,dataDir,services,courses,requestText,requestImage,isConfigured,canRun=()=>true,autoRunAllowed=()=>true,schedule=true,searchSources=null,sourceFetchImpl,assets=createStoryAssets({publicDir,dataDir,siteUrl}),research=null,additionalSources=null}) {
  research??=createWebStoryResearch({db,searchSources,canRun,requirePreparedEvidence:true,fetchImpl:sourceFetchImpl});
  const channelSources=createEditorialChannelSources({db,canRun,research,fetchImpl:sourceFetchImpl});
  const sources=createWebStorySources({db,services,courses,publicDir});
  const enrichCached=source=>source&&research.getEnriched?research.getEnriched(source):source;
  // Keep owned gardening/curiosity articles and official channels. Raw Google
  // Trends topics are excluded before pagination and quota claims, in any group.
  const automaticSourceAllowed=source=>source?.reuseBinding?additionalSources?.eligible(source)===true:source?.kind!=='trend'||research.automaticSourceAllowed?.(source)===true;
  const automaticEligible=source=>webStories.canGenerateAutomatically(source.key)&&(source.reuseBinding?additionalSources?.eligible(source)===true:source.kind==='trend'||(source.kind==='article'&&['news','sports','noticias','esportes'].includes(source.group||source.portal))
    ?research.automaticEligible?.(source)===true
    :storySourcePreflight(source,{siteUrl}).eligible);
  function trendRows(options) {
    const result=[];
    // The research adapter itself pages at 200. Count all eligible trend rows
    // before applying the merged offset so later pages do not skip own sources.
    for(let offset=0;offset<10000;offset+=200){
      const rows=research.list({...options,limit:200,offset});
      if(!Array.isArray(rows))throw Error('story_candidates_invalid');
      result.push(...rows.filter(item=>item&&typeof item.key==='string'&&!sources.get(item.key)&&(!options.automatic||automaticEligible(item))));
      if(rows.length<200)return result;
    }
    throw Error('story_candidates_limit');
  }
  function ownRows({q,group,limit,offset,automatic}){
    if(!automatic)return sources.list({q,group,limit,offset}).map(enrichCached);
    // Offsets count feasible candidates, not rejected rows. Walk raw pages until
    // enough candidates are found; sparse early pages must not hide later ones.
    const result=[];let skipped=0;
    for(let cursor=0;cursor<10000;cursor+=200){
      const rows=sources.list({q,group,limit:200,offset:cursor});
      for(const source of rows){if(!automaticEligible(source))continue;if(skipped++<offset)continue;result.push(enrichCached(source));if(result.length===limit)return result;}
      if(rows.length<200)return result;
    }
    throw Error('story_candidates_limit');
  }
  const catalog={
    get(key){if(typeof key!=='string'||!key)return null;const own=sources.get(key);return own?enrichCached(own):additionalSources?.get(key)||(key.startsWith('trend:')?research.get(key):null);},
    list({q='',group='all',limit=50,offset=0,automatic=false}={}){
      const take=Math.max(0,Math.min(200,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):50)),skip=Math.max(0,Number.isSafeInteger(Number(offset))?Number(offset):0);
      if(!take)return [];
      const extra=(additionalSources?.list({q,group,limit:200,offset:0})||[]).filter(source=>source&&!sources.get(source.key)&&(!automatic||automaticEligible(source)));
      const first=extra.slice(skip,skip+take),remaining=take-first.length,nextSkip=Math.max(0,skip-extra.length);
      if(!remaining)return first;
      const trends=trendRows({q,group,automatic});
      const front=trends.slice(nextSkip,nextSkip+remaining),rest=remaining-front.length;
      return first.concat(front,rest?ownRows({q,group,limit:rest,offset:Math.max(0,nextSkip-trends.length),automatic}):[]);
    }
  };
  const ai=createWebStoryAI({requestText,requestImage,assets,siteUrl,dataDir});
  const local=createLocalEditorialStories({db,assets});
  const webStories=setupWebStories({app,db,requireAdmin,sameOriginOnly,siteUrl,publicDir,dataDir,assets,canRun,automaticSourceAllowed,sourceCatalog:catalog,generateStory:async(...args)=>{
    // Choose an approved source-preserving workflow BEFORE any AI call. A model
    // rejection can never fall through to local automatic approval.
    // A recognized reused source never falls through to a paid generator.
    const result=args[0]?.reuseBinding?await additionalSources.generate(...args,assets):await local.generate(...args)||await ai.generate(...args);
    const diagnostics=storyDiagnostics(result),detail=diagnostics.review.notes;
    // A provider/JSON failure is not an editorial rejection. Only explicit
    // technical codes with no prior failed criterion can use the cost cooldown.
    const technical=['ai_text_unavailable','ai_image_unavailable','ai_invalid_json'].includes(result.notes)&&!result.qualityFailures?.length&&![false].includes(result.review?.grounded)&&!['medium','high'].includes(result.review?.risk);
    return {...result,diagnostics,failureStatus:technical?'failed':'review',notes:[explain(result.notes),result.approved!==true&&detail?detail:''].filter(Boolean).join(' ').slice(0,500)};
  }});
  const recoveryForSource=key=>webStories.recoveryForSource(key);
  const automation=createStoryAutomation({db,isConfigured,canRun,autoRunAllowed,schedule,recoveryForSource,publicationCounts:()=>webStories.publicationCounts(),getCandidates:options=>catalog.list({...options,automatic:true}).map(source=>({...source,
    // Evidence refresh timestamps are not editorial changes. A changed public
    // source or new dated topic can be considered again, without daily duplicates.
    fingerprint:digest(source.reuseBinding?[source.key,source.reuseBinding]:source.kind==='trend'?[source.key,source.title]:sources.get(source.key)||[source.key,'unavailable'])
  })),processSource:async(source,context)=>{
    const checked=source.kind==='trend'||['news','sports'].includes(source.group)?await research.enrich(source,context):source;
    if(!context.isCurrent())throw Error('story_round_interrupted');
    return webStories.generateAndPublish(checked,context);
  }});
  const actor=req=>String(req.user?.id||req.user?.email||'admin').slice(0,160);
  const route=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){res.status([400,409,503].includes(error.status)?error.status:400).json({error:error.status?error.message:'Não foi possível concluir esta ação. Atualize o painel e tente novamente.'});}};
  let syncing=null,lastSync=channelSources.lastCheckedAt(),closed=false,syncController=null;
  const sourceSnapshot=options=>{const state=channelSources.snapshot(options),enabled=automation.status().enabled,reason=closed?'closed':!canRun()?'global_paused':syncing?'busy':!enabled?'disabled':Math.max(lastSync,channelSources.lastCheckedAt())+3600000>Date.now()?'cooldown':'ready';return {...state,busy:!!syncing||state.busy,controls:{canSync:reason==='ready',reason,nextAt:lastSync?new Date(lastSync+3600000).toISOString():state.nextAt},nextAt:lastSync?new Date(lastSync+3600000).toISOString():state.nextAt};};
  const sync=()=>{
    if(closed||!canRun()||!automation.status().enabled||syncing||Date.now()-lastSync<3600000)return syncing||Promise.resolve();
    lastSync=Date.now();syncController=new AbortController();const signal=syncController.signal,isCurrent=()=>!closed&&canRun()&&automation.status().enabled&&!signal.aborted;
    syncing=Promise.resolve().then(async()=>{await channelSources.sync({signal,isCurrent});if(!isCurrent())return;try{await research.syncTrends({signal,isCurrent});}catch{}if(!isCurrent())return;await research.prepareCandidates?.({signal,isCurrent});}).catch(()=>{}).finally(()=>{syncing=null;syncController=null;});return syncing;
  };
  app.get('/api/admin/editorial-sources',requireAdmin,route((req,res)=>{
    const {q='',topic='all',sort='recent',offset='0',limit='60'}=req.query;
    if(typeof q!=='string'||q.length>120||!['all','news','recipes','gardening'].includes(topic)||!['recent','views','popular'].includes(sort)||!Number.isSafeInteger(Number(offset))||Number(offset)<0||!Number.isSafeInteger(Number(limit))||Number(limit)<1||Number(limit)>200)return res.status(400).json({error:'Filtro de fontes inválido.'});
    res.json(sourceSnapshot({q,topic,sort,offset:Number(offset),limit:Number(limit)}));
  }));
  app.post('/api/admin/editorial-sources/sync',requireAdmin,sameOriginOnly,route((_req,res)=>{
    const state=sourceSnapshot();if(!state.controls.canSync)return res.status(409).json({...state,error:state.controls.reason==='global_paused'?'As rotinas estão pausadas na Central do dia.':'Aguarde a janela de consulta ou confira se a rotina diária está habilitada.'});
    void sync();res.status(202).json(sourceSnapshot());
  }));
  app.get('/api/admin/web-story-automation',requireAdmin,route((_req,res)=>res.json(automation.status())));
  app.put('/api/admin/web-story-automation',requireAdmin,sameOriginOnly,route((req,res)=>{
    if(req.body?.enabled&&!isConfigured())return res.status(503).json({error:'Configure a IA gestora de texto e imagem antes de ativar a publicação diária.'});
    const state=automation.updateSettings(req.body,actor(req));res.json(state);void sync();
  }));
  app.post('/api/admin/web-story-automation/run',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    if(!automation.status().enabled)return res.status(409).json({error:'Ative a publicação diária antes de iniciar uma rodada.'});
    await sync();res.status(202).json(automation.run({manual:true,actor:actor(req)}));
  }));
  const syncTimer=schedule?setInterval(()=>void sync(),3600000):null;
  syncTimer?.unref();
  const firstSync=schedule?setTimeout(()=>void sync(),1000):null;firstSync?.unref();
  return {...webStories,automation,catalog,research,channelSources,sync,sourceSnapshot,close(){closed=true;syncController?.abort();channelSources.close();clearInterval(syncTimer);clearTimeout(firstSync);automation.close();}};
}
