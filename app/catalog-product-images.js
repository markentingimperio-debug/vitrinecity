import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIPv4} from 'node:net';

// Explicit catalog origins, never a user-supplied proxy URL.
const HOSTS=new Set(['adubonpkparaplantas.com.br','www.adubonpkparaplantas.com.br','vitrinecity.com','www.vitrinecity.com']);
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])blocked.addSubnet(address,prefix,'ipv4');
export function publicImageAddress(address){return isIPv4(address)&&!blocked.check(address,'ipv4');}
export function catalogImageUrl(value){
  try{const raw=String(value||'');if(/[\\\s]/.test(raw))return '';const url=new URL(raw,'https://vitrinecity.com');
    if(url.protocol!=='https:'||url.port||url.username||url.password||!HOSTS.has(url.hostname)||!/^\/(?:uploads|assets|wp-content\/uploads)\//.test(url.pathname))return '';
    return url.href;
  }catch{return '';}
}
const MAX_BYTES=4*1024*1024;
export function originalCatalogImageUrl(value){const allowed=catalogImageUrl(value);if(!allowed)return '';const url=new URL(allowed);if(url.pathname.startsWith('/wp-content/uploads/'))url.pathname=url.pathname.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))$/i,'$1');return url.href;}
export function fetchCatalogImage(value){
  const url=catalogImageUrl(value);if(!url)return Promise.reject(new Error('unsupported_image_origin'));
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{agent:false,family:4,headers:{accept:'image/jpeg,image/png,image/webp,image/gif'},lookup(host,options,callback){
      lookup(host,{family:4,all:true}).then(addresses=>{
        if(!addresses.length||addresses.some(item=>!publicImageAddress(item.address)))return callback(new Error('non_public_image_address'));
        // Connect only to the checked address; no second DNS lookup or redirects.
        if(options.all)callback(null,[addresses[0]]);else callback(null,addresses[0].address,4);
      },callback);
    }},response=>{
      const type=String(response.headers['content-type']||'').split(';')[0];
      if(response.statusCode!==200||!['image/jpeg','image/png','image/webp','image/gif'].includes(type)||Number(response.headers['content-length'])>MAX_BYTES){response.destroy();reject(new Error('invalid_catalog_image'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy(new Error('image_too_large'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve({type,body:Buffer.concat(chunks)}));
    });
    const timeout=setTimeout(()=>request.destroy(new Error('image_timeout')),8000);request.on('error',reject);request.on('close',()=>clearTimeout(timeout));
  });
}
export function setupCatalogProductImages(app,{getProduct,fetchImage=fetchCatalogImage}){
  const cache=new Map(),pending=new Map();let cacheBytes=0;
  app.get('/api/marketplace/products/:id/image',async(req,res)=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.sendStatus(404);
    try{
      const product=await getProduct(id),url=catalogImageUrl(product?.image_url);if(!url)return res.sendStatus(404);
      let entry=cache.get(url);
      if(!entry||entry.expires<Date.now()){
        if(!pending.has(url)){
          if(pending.size>=8)return res.sendStatus(503);
          const original=originalCatalogImageUrl(url);
          pending.set(url,fetchImage(original).catch(error=>{if(original===url)throw error;return fetchImage(url);}).then(image=>{
            if(!image.body.length||image.body.length>MAX_BYTES)throw new Error('image_too_large');
            if(cache.has(url)){cacheBytes-=cache.get(url).body.length;cache.delete(url);}
            while(cacheBytes+image.body.length>24*1024*1024&&cache.size){const key=cache.keys().next().value;cacheBytes-=cache.get(key).body.length;cache.delete(key);}
            const saved={...image,expires:Date.now()+300000};cache.set(url,saved);cacheBytes+=image.body.length;return saved;
          }).finally(()=>pending.delete(url)));
        }
        entry=await pending.get(url);
      }
      return res.set({'Content-Type':entry.type,'Cache-Control':'public,max-age=300','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}).send(entry.body);
    }catch{return res.sendStatus(502);}
  });
}
