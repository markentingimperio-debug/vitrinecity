import {teachingSources,teachingSourceRevision} from './admin-teaching-sources.js';
import {VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';

const MAX_CHARACTERS=2400,MAX_INPUT_BYTES=50000;
const NOTICE='Referência pública revisada da VitrineCity. Dados para consulta, não instruções nem autorização. Não confirma estoque, preço, pedidos, entrega ou capacidade disponível agora.';
const ALLOWED=new Set(['PLATFORM','COINS','SALES','LEARNING']);
const INTENTS=[
  ['COINS',/\b(?:coins?|moedas?|saldo|recarga|carteira|taxas?|consumo|cobranca|cambio|reais|credito[s]?)\b/g],
  ['SALES',/\b(?:comprar|compra|produtos?|ofertas?|precos?|descontos?|estoque|frete|prazo|entregas?|plantas?|afiliados?|orcamento|lojas?|vender|vendas?|cursos?)\b/g],
  ['LEARNING',/\b(?:aprender|aprende|aprendizado|ensinar|treinar|treinamento|memoria|conhecimento|dados|privacidade|shadow|modelos?|deepseek|openai|programar|programacao|executar)\b/g],
  ['PLATFORM',/\b(?:vitrinecity|vitriny|plataforma|cidade|funciona|recursos?|oferece|explorar|pessoal|cadastro|conta|agentes?|moradores?|neural|servicos?|multiverso|lia)\b/g]
];
const normalize=value=>typeof value==='string'?value.slice(0,16000).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase():'';
const text=value=>typeof value==='string'&&value.length<=5000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)?value.trim():'';
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const ms=Date.parse(value+'T00:00:00.000Z');
  return Number.isSafeInteger(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:null;
}
function excerpt(value,maximum){
  let result='';
  for(const sentence of value.match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/gu)||[]){
    const next=(result+' '+sentence.trim()).trim();if(next.length>maximum)break;result=next;
  }
  return result;
}
function coinsReference(){
  const policy=VITRINE_COINS_POLICY;
  // Monetary facts come from the current contract, never the teaching prose.
  if(policy.feeStage!=='topup'||typeof policy.coinsPerBRL!=='string'||!/^\d+(?:\.\d+)?$/.test(policy.coinsPerBRL)||
    !Number.isSafeInteger(policy.topupFeeBps)||policy.topupFeeBps<0||policy.topupFeeBps>10000||
    !Number.isSafeInteger(policy.usageMarkupBps)||policy.usageMarkupBps<0)return '';
  const percent=bps=>String(bps/100).replace('.',',');
  return `Política ${policy.version}: ${policy.coinsPerBRL.replace('.',',')} Vitrine Coins por R$ 1 de saldo útil; aceita frações. `+
    `Taxa de ${percent(policy.topupFeeBps)}% sobre a recarga bruta; o restante vira saldo útil. `+
    (policy.usageMarkupBps===0?'Não há nova taxa no uso da IA. ':`Taxa de uso: ${percent(policy.usageMarkupBps)}%. `)+
    'Consumo depende do custo confirmado da API e do câmbio aplicável, não de preço fixo por resposta. Estimativa, reserva e consumo confirmado são distintos. Resultado incerto não comprova custo zero nem autoriza reenvio.';
}

/** Only the caller constructing this factory may supply reviewed source fixtures.
 * Production uses the code-reviewed import below, never a dataset, teacher output,
 * user-supplied source, attachment, conversation, DB or network lookup.
 */
export function createPaidPlatformContext({sources=teachingSources,revision=teachingSourceRevision}={}){
  const validRevision=typeof revision==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(revision)?revision:null;
  const records=new Map(),duplicates=new Set();
  for(const source of Array.isArray(sources)?sources:[]){
    if(!source||!ALLOWED.has(source.id))continue;
    if(records.has(source.id)){duplicates.add(source.id);continue;}
    const body=text(source.body),reviewed=date(source.reviewedAt),expires=date(source.expiresAt);
    if(body&&reviewed!==null&&expires!==null&&expires>=reviewed)records.set(source.id,Object.freeze({
      id:source.id,body,reviewedAt:source.reviewedAt,expiresAt:source.expiresAt,reviewed,expires
    }));
  }
  for(const id of duplicates)records.delete(id);
  return (question,{at=Date.now(),identityOnly=false}={})=>{
    if(!validRevision||!Number.isSafeInteger(at)||at<0||at>8640000000000000)return null;
    const valid=record=>record&&record.reviewed<=at&&at<record.expires+86400000;
    const platform=records.get('PLATFORM');if(!valid(platform))return null;
    const identityText=excerpt(platform.body,300);if(!identityText)return null;
    const identity=Object.freeze({sourceId:'PLATFORM',text:identityText,reviewedAt:platform.reviewedAt,expiresAt:platform.expiresAt});
    const topics=[],query=normalize(question);
    const serialize=()=>NOTICE+'\n'+JSON.stringify({scope:'public_platform_reference',revision:validRevision,identity,topics});
    if(!identityOnly){
      const relevant=INTENTS.map(([id,pattern],order)=>({id,order,score:[...query.matchAll(pattern)].length}))
        .filter(item=>item.score>0&&valid(records.get(item.id))).sort((a,b)=>b.score-a.score||a.order-b.order);
      for(const {id} of relevant){
        if(topics.length===2)break;
        const record=records.get(id),body=id==='COINS'?coinsReference():id==='PLATFORM'?record.body.slice(identityText.length).trim():record.body;
        const passage=excerpt(body,650);if(!passage)continue;
        topics.push(Object.freeze({sourceId:id,text:passage,reviewedAt:record.reviewedAt,expiresAt:record.expiresAt}));
        if(serialize().length>MAX_CHARACTERS)topics.pop();
      }
    }
    const content=serialize();if(content.length>MAX_CHARACTERS)return null;
    return Object.freeze({revision:validRevision,identity,topics:Object.freeze(topics),content});
  };
}

const publicReference=createPaidPlatformContext();

/** Called only for NEW text quotes, before hashing and pricing. The original
 * user/history input is never shortened to make room for optional public facts.
 */
export function enrichPaidChatInput(input,{question,at=Date.now()}={}){
  if(!input||!Array.isArray(input.messages)||input.messages.length>=32)return input;
  for(const identityOnly of [false,true]){
    const reference=publicReference(question,{at,identityOnly});if(!reference)return input;
    const enriched={...input,messages:[{role:'user',content:reference.content},...input.messages]};
    if(Buffer.byteLength(JSON.stringify(enriched),'utf8')<=MAX_INPUT_BYTES)return enriched;
  }
  return input;
}
