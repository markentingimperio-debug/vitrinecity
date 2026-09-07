const CAPABILITY=/^[a-z][a-z0-9._:-]{1,79}$/;
function fail(message){throw new Error(message);}
function normalizeBase(value){const url=new URL(String(value||''));if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')fail('Provider precisa usar HTTPS ou localhost.');if(url.username||url.password||url.hash)fail('URL de provider inválida.');url.pathname=url.pathname.replace(/\/$/,'');url.search='';return url;}

export function createHttpProvider({id,baseUrl,capabilities,priority=100,costClass='variable',local=false,headers=()=>({}),healthPath='/health',invokePath='/invoke',fetchImpl=fetch}={}){
  const base=normalizeBase(baseUrl);const supported=new Set((capabilities||[]).map(String));if(!supported.size||[...supported].some(v=>!CAPABILITY.test(v)))fail('Capacidades do provider inválidas.');
  const safeHeaders=()=>{const value=headers?.()||{};const out={};for(const [k,v] of Object.entries(value)){const key=String(k).toLowerCase();if(!['authorization','x-api-key','x-vitriny-provider-key'].includes(key))continue;out[k]=String(v);}return out;};
  async function available(){try{const url=new URL(healthPath,base);const response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json',...safeHeaders()},redirect:'error',signal:AbortSignal.timeout(3000)});await response.body?.cancel();return response.ok;}catch{return false;}}
  async function invoke({capability,input,signal}){if(!supported.has(capability))fail('Capacidade não suportada pelo provider.');const url=new URL(invokePath,base);const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...safeHeaders()},body:JSON.stringify({capability,input}),redirect:'error',signal});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(String(data?.error||`Provider respondeu ${response.status}`).slice(0,300));return data;}
  return {id:String(id),capabilities:[...supported],priority,costClass,local,available,invoke};
}
