import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createNeuralWebResearchEngine,scoreResearchSource} from '../vitriny-neural/web-research-engine.js';

const official=scoreResearchSource({url:'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',providers:['google','bing','brave'],title:'SEO Starter Guide',description:'Documentação oficial sobre fundamentos de SEO, indexação, conteúdo útil e mecanismos de pesquisa.'});
const social=scoreResearchSource({url:'https://www.reddit.com/r/seo/test',providers:['duckduckgo'],title:'Opinião sobre SEO',description:'Uma discussão informal de usuários sobre técnicas de SEO e experiências pessoais.'});
assert.equal(official.score>social.score,true);
assert.equal(official.type,'technical');
assert.equal(social.type,'social');

const payload={results:[
  {url:'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',title:'SEO Starter Guide',content:'Documentação oficial sobre fundamentos de SEO, indexação, conteúdo útil, rastreamento, links internos e boas práticas para mecanismos de busca.',engines:['google','bing','brave']},
  {url:'https://github.com/openai/openai-cookbook',title:'OpenAI Cookbook',content:'Exemplos técnicos públicos para construir aplicações de inteligência artificial, avaliações e integrações de modelos.',engines:['google','duckduckgo']},
  {url:'https://www.reddit.com/r/seo/test',title:'Discussão informal',content:'Usuários compartilham opiniões sobre SEO sem garantia de verificação independente.',engines:['duckduckgo']}
]};
const fetchImpl=async(url)=>{
  const parsed=new URL(url);assert.equal(parsed.pathname,'/search');assert.equal(parsed.searchParams.get('format'),'json');
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
};
const db=new Database(':memory:');const signals=[];let clock=Date.parse('2026-09-07T12:00:00Z');
try{
  const engine=createNeuralWebResearchEngine({db,env:{SEARXNG_URL:'http://searxng.local',SEARCH_ENGINES:'google,bing,duckduckgo,brave',VITRINY_NEURAL_WEB_RESEARCH_ENABLED:'1',VITRINY_NEURAL_WEB_RESEARCH_DAILY_RUNS:'3',VITRINY_NEURAL_RESEARCH_CANDIDATE_SCORE:'0.70',VITRINY_NEURAL_RESEARCH_TOPICS:'SEO técnico e indexação'},fetchImpl,now:()=>clock,neural:{signal(value){signals.push(value);return{ok:true};}},logger:{warn(){}}});
  const result=await engine.run({topic:'SEO técnico e indexação',query:'boas práticas oficiais de SEO'});
  assert.equal(result.status,'completed');assert.equal(result.results,3);assert.equal(result.candidates>=1,true);
  const pending=engine.listCandidates({status:'candidate',limit:20});assert.equal(pending.length>=1,true);assert.equal(pending.some(x=>x.host==='developers.google.com'),true);
  const chosen=pending[0];engine.reviewCandidate(chosen.id,{status:'approved',note:'Fonte revisada para teste'});
  assert.equal(engine.listCandidates({status:'approved',limit:20}).length,1);
  const status=engine.status();assert.equal(status.configured,true);assert.equal(status.enabled,true);assert.equal(status.runsToday,1);assert.equal(status.approvedCandidates,1);
  assert.equal(signals.some(x=>x.metric==='research.candidate.score'),true);assert.equal(signals.some(x=>x.metric==='research.run.candidates'),true);
  console.log(JSON.stringify({ok:true,research:{results:result.results,candidates:result.candidates,approved:status.approvedCandidates,officialScore:official.score,socialScore:social.score}}));
}finally{db.close();}
