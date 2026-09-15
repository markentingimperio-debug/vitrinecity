import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {fetchCatalogImage,originalCatalogImageUrl,publicImageAddress} from './catalog-product-images.js';

// Actual raster origins already used by the reviewed Shopee catalog. This is
// private to story creation, not a public URL proxy or a new content source.
const shopeeHosts=new Set(['down-bs-br.img.susercontent.com','down-tx-br.img.susercontent.com']);
const MAX_BYTES=4*1024*1024;
export function storyCatalogImageUrl(value) {
  const existing=originalCatalogImageUrl(value);if(existing)return existing;
  try{
    const raw=String(value||'');if(raw.length>400||/[\\\s%]/.test(raw)||raw.split('/').some(part=>part==='.'||part==='..'))return '';
    const url=new URL(raw);
    return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&shopeeHosts.has(url.hostname)&&/^\/[a-z0-9-]+\.(?:webp|png|jpe?g)$/i.test(url.pathname)?url.href:'';
  }catch{return '';}
}

export function fetchStoryCatalogImage(value,{httpsGet=https.get,lookupImpl=lookup}={}) {
  const url=storyCatalogImageUrl(value);if(!url)return Promise.reject(Error('unsupported_image_origin'));
  if(originalCatalogImageUrl(url))return fetchCatalogImage(url);
  return new Promise((resolve,reject)=>{
    const request=httpsGet(url,{agent:false,family:4,headers:{accept:'image/jpeg,image/png,image/webp'},lookup(host,options,callback){
      lookupImpl(host,{family:4,all:true}).then(addresses=>{
        if(!addresses.length||addresses.some(item=>!publicImageAddress(item.address)))return callback(Error('non_public_image_address'));
        if(options.all)callback(null,[addresses[0]]);else callback(null,addresses[0].address,4);
      },callback);
    }},response=>{
      const type=String(response.headers['content-type']||'').split(';')[0];
      if(response.statusCode!==200||!['image/jpeg','image/png','image/webp'].includes(type)||Number(response.headers['content-length'])>MAX_BYTES){response.destroy();reject(Error('invalid_catalog_image'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy(Error('image_too_large'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve({type,body:Buffer.concat(chunks)}));
    });
    const timer=setTimeout(()=>request.destroy(Error('image_timeout')),8000);request.on('error',reject);request.on('close',()=>clearTimeout(timer));
  });
}
