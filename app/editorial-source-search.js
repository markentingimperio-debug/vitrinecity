import {storyResearchUrl} from './web-story-research.js';

// Reuse the platform's public search route. Only a public topic title leaves
// this adapter: no prompts, session cookies or provider credentials are sent.
const ENDPOINT='http://127.0.0.1:3000/api/search/web';
const MAX_BYTES=512*1024;
const fail=code=>Object.assign(Error(code),{code});

export function createEditorialSourceSearch({fetchImpl=globalThis.fetch}={}) {
  return async function searchSources({query,signal}={}) {
    if(typeof query!=='string'||query.length>300||query.trim().length<3||/[\x00-\x1f\x7f]/.test(query))throw fail('editorial_search_query_invalid');
    signal?.throwIfAborted();
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(16000)]):AbortSignal.timeout(16000);
    const url=new URL(ENDPOINT);
    url.search=new URLSearchParams({q:query.trim(),type:'web',page:'1'}).toString();
    const response=await fetchImpl(url.href,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal:combined});
    if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')){
      await response.body?.cancel();throw fail('editorial_search_unavailable');
    }
    if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw fail('editorial_search_response_limit');}
    let size=0;const chunks=[];
    for await(const chunk of response.body){combined.throwIfAborted();size+=chunk.length;if(size>MAX_BYTES){throw fail('editorial_search_response_limit');}chunks.push(Buffer.from(chunk));}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('editorial_search_response_invalid');}
    if(!data||!['ready','partial','empty'].includes(data.status)||!Array.isArray(data.results))throw fail('editorial_search_response_invalid');
    if(data.status==='partial'&&!data.results.length)throw fail('editorial_search_unavailable');
    combined.throwIfAborted();
    const seen=new Set(),results=[];
    for(const item of data.results.slice(0,30)){
      const sourceUrl=storyResearchUrl(item?.url);
      if(!sourceUrl||seen.has(sourceUrl))continue;
      seen.add(sourceUrl);
      results.push({url:sourceUrl,title:String(item.title||'').replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,180)});
      if(results.length===8)break;
    }
    // Search snippets are discovery hints, never article text or evidence.
    return results;
  };
}
