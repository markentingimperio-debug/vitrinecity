import {createHash} from 'node:crypto';
import {publicCopyHasLinks} from './public/social-public-copy.js';

const ID=/^[1-9][0-9]{0,39}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const failure=(code,{uncertain=false,notSubmitted=false}={})=>Object.assign(new Error(code),{code,uncertain,definitive:!uncertain,notSubmitted,photoApiSafe:true});

/** Page photo publication only. Fixed Graph host; no arbitrary URL downloads,
 * no automatic retries, no assumption that app publication grants permissions. */
export function createMetaPhotoApi({db,decryptToken,accountAllowed=()=>false,env=process.env,fetchImpl=globalThis.fetch,now=Date.now}) {
  function config(){
    const version=String(env.META_SOCIAL_API_VERSION||env.META_API_VERSION||'v26.0'),appId=String(env.META_SOCIAL_APP_ID||''),secret=String(env.META_SOCIAL_APP_SECRET||'');
    if(!/^v\d{1,3}\.\d{1,2}$/.test(version)||!ID.test(appId)||!secret)throw failure('meta_app_not_configured');
    return {version,appId,secret};
  }
  function account(accountId,pageId){
    if(!Number.isSafeInteger(Number(accountId))||Number(accountId)<1||!ID.test(String(pageId||'')))throw failure('invalid_page');
    const row=db.prepare("SELECT * FROM social_accounts WHERE id=? AND status='connected'").get(Number(accountId));
    if(!row||String(row.page_id)!==String(pageId)||accountAllowed(row)!==true)throw failure('page_not_authorized');
    let token;try{token=decryptToken(row.token_encrypted);}catch{throw failure('page_token_unavailable');}
    if(typeof token!=='string'||!token)throw failure('page_token_unavailable');
    return {token,credentialVersion:sha(row.token_encrypted)};
  }
  async function request(route,{token,query={},body,signal}={}){
    const {version}=config(),url=new URL('https://graph.facebook.com/'+version+'/'+route);
    for(const [name,value] of Object.entries(query))url.searchParams.set(name,String(value));
    const write=body!==undefined;let response,data;
    try{
      response=await fetchImpl(url.href,{method:write?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token},...(write?{body}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      data=await response.json();
    }catch{throw failure(write?'meta_publish_unknown':'meta_inspection_unavailable',{uncertain:write});}
    if(!response.ok||data?.error){
      const code=Number(data?.error?.code),rejected=[400,401,403].includes(response.status)&&[10,100,190,200].includes(code)&&data?.error?.is_transient!==true,uncertain=write&&!rejected;
      throw failure(code===190?'meta_token_expired':code===10||code===200?'meta_permission_denied':write?'meta_publish_rejected':'meta_inspection_unavailable',{uncertain});
    }
    return data;
  }
  async function inspect({accountId,pageId}){
    try{
      const {appId,secret}=config(),selected=account(accountId,pageId),signal=AbortSignal.timeout(30000);
      const data=await request('debug_token',{token:appId+'|'+secret,query:{input_token:selected.token},signal}),grant=data?.data;
      if(!grant?.is_valid||String(grant.app_id)!==appId||[grant.expires_at,grant.data_access_expires_at].some(value=>Number(value)>0&&Number(value)*1000<=now()))throw failure('meta_token_expired');
      const required=['pages_show_list','pages_read_engagement','pages_manage_posts'],scopes=new Set(Array.isArray(grant.scopes)?grant.scopes:[]);
      const missing=required.filter(permission=>!scopes.has(permission));
      for(const row of grant.granular_scopes||[])if(required.includes(row.scope)&&Array.isArray(row.target_ids)&&row.target_ids.length&&!row.target_ids.map(String).includes(String(pageId)))missing.push(row.scope+':page_not_granted');
      const identity=await request('me',{token:selected.token,query:{fields:'id'},signal});
      if(String(identity.id)!==String(pageId))throw failure('page_token_identity_mismatch');
      return {ready:missing.length===0,missing:[...new Set(missing)],credentialVersion:selected.credentialVersion,
        checkedAt:new Date(now()).toISOString(),note:'Identidade e permissões verificadas. A Meta valida a tarefa de criação de conteúdo no envio; o alcance público não foi verificado.'};
    }catch(error){return {ready:false,missing:[error.photoApiSafe?error.code:'meta_inspection_unavailable'],checkedAt:new Date(now()).toISOString()};}
  }
  async function send({accountId,pageId,credentialVersion,caption,imageBytes,imageSha256,isCurrent=()=>false}){
    if(typeof caption!=='string'||caption.length<10||caption.length>1500||publicCopyHasLinks(caption)||/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(caption))throw failure('invalid_public_caption',{notSubmitted:true});
    if(!Buffer.isBuffer(imageBytes)||imageBytes.length<4||imageBytes.length>8*1024*1024||imageBytes[0]!==255||imageBytes[1]!==216||sha(imageBytes)!==imageSha256)throw failure('invalid_approved_image',{notSubmitted:true});
    const selected=account(accountId,pageId);
    if(selected.credentialVersion!==credentialVersion)throw failure('page_credential_changed',{notSubmitted:true});
    const form=new FormData();form.set('source',new Blob([imageBytes],{type:'image/jpeg'}),'vitrinecity.jpg');form.set('caption',caption);form.set('published','true');
    if(isCurrent()!==true)throw failure('publication_cancelled_before_send',{notSubmitted:true});
    const result=await request(String(pageId)+'/photos',{token:selected.token,body:form});
    const photoId=ID.test(String(result?.id||''))?String(result.id):'',rawPostId=String(result?.post_id||''),postId=new RegExp('^'+pageId+'_[1-9][0-9]{0,39}$').test(rawPostId)?rawPostId:'';
    return {photoId,postId,uncertain:!photoId||!postId};
  }
  async function confirm({accountId,pageId,photoId,postId,caption}){
    if(!ID.test(String(photoId))||!new RegExp('^'+pageId+'_[1-9][0-9]{0,39}$').test(String(postId)))throw failure('receipt_incomplete');
    const selected=account(accountId,pageId),post=await request(String(postId),{token:selected.token,query:{fields:'id,from,message,is_published,permalink_url,attachments{target,type}'}});
    const attachment=(post?.attachments?.data||[]).some(item=>String(item.target?.id)===String(photoId)&&['photo','album'].includes(item.type));
    if(String(post.id)!==String(postId)||String(post.from?.id)!==String(pageId)||post.message!==caption||!attachment)throw failure('receipt_does_not_match');
    // Build the link from the verified receipt, never echo provider query values.
    let url='';try{const parsed=new URL(post.permalink_url);if(parsed.protocol==='https:'&&['www.facebook.com','facebook.com'].includes(parsed.hostname)&&!parsed.port&&!parsed.username&&!parsed.password)url='https://www.facebook.com/'+pageId+'/posts/'+String(postId).split('_')[1];}catch{}
    return {published:post.is_published===true,photoId:String(photoId),postId:String(postId),url};
  }
  return {inspect,send,confirm};
}
