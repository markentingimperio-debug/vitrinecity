const ID=/^[0-9]{1,40}$/;
const POST=/^[0-9]{1,40}(?:_[0-9]{1,40})?$/;
const surfaces=new Set(['facebook_page','facebook_group','instagram']);
const error=(message,uncertain=false)=>Object.assign(new Error(message),{uncertain,definitive:!uncertain,metaCommentSafe:true});

/** Official Meta APIs only. inspect is read-only; send performs one requested
 * private reply and never retries an uncertain provider response. */
export function createMetaCommentApi({db,decryptToken,env=process.env,fetchImpl=globalThis.fetch,now=Date.now}) {
  function config(){
    const version=String(env.META_SOCIAL_API_VERSION||env.META_API_VERSION||'v26.0');
    if(!/^v\d{1,3}\.\d{1,2}$/.test(version))throw error('A versão da conexão Meta precisa ser revisada.');
    return {version,appId:String(env.META_SOCIAL_APP_ID||''),secret:String(env.META_SOCIAL_APP_SECRET||'')};
  }
  function accountFor(accountId,surface){
    if(!Number.isSafeInteger(Number(accountId))||Number(accountId)<1||!surfaces.has(surface))throw error('Escolha uma conta e um destino válidos.');
    const account=db.prepare("SELECT * FROM social_accounts WHERE id=? AND status='connected'").get(Number(accountId));
    if(!account||!ID.test(String(account.page_id))||(surface==='instagram'&&!ID.test(String(account.instagram_id||''))))throw error('Conecte a Página ou a conta profissional do Instagram.');
    return account;
  }
  async function request(route,{token,query={},body,signal}={}){
    const {version}=config(),url=new URL('https://graph.facebook.com/'+version+'/'+route);
    for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
    let response,data;
    try {
      response=await fetchImpl(url.href,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      data=await response.json();
    } catch {throw error(body===undefined?'Não foi possível verificar a conexão Meta agora.':'O resultado do envio não foi confirmado. Confira a conversa antes de tentar novamente.',body!==undefined&&!(response?.status>=400&&response?.status<500));}
    if(!response.ok||data?.error){
      const code=Number(data?.error?.code);
      const uncertain=body!==undefined&&response.status>=500;
      if(code===190)throw error('A conexão Meta expirou. Reconecte a conta no painel.',uncertain);
      if(code===10||code===200)throw error('A Meta não autorizou esta operação. Confira as permissões e o acesso do aplicativo.',uncertain);
      throw error(body===undefined?'A Meta não confirmou o acesso a esta publicação.':'A Meta não confirmou a resposta privada.',body!==undefined&&response.status>=500);
    }
    return data;
  }
  async function inspect({accountId,surface,postId='',groupId=''}){
    const missing=[];let postUrl='';const details={checkedAt:new Date(now()).toISOString(),permissionCheck:false,subscriptionCheck:false,ownershipCheck:false,publicAccessVerified:false};
    const note='Configuração verificada; alcance público depende da aprovação Meta.';
    const signal=AbortSignal.timeout(30000),read=(route,options)=>request(route,{...options,signal});
    async function findInPages(route,options,predicate){
      let after='';const seen=new Set();
      for(let page=0;page<5;page++){
        const result=await read(route,{...options,query:{...options.query,limit:100,...(after?{after}:{})}});
        const found=(Array.isArray(result?.data)?result.data:[]).find(predicate);if(found)return found;
        const cursor=result?.paging?.cursors?.after;if(!result?.paging?.next||typeof cursor!=='string'||!cursor||cursor.length>2000||/[\x00-\x20\x7f]/.test(cursor)||seen.has(cursor))break;
        // Never follow provider-supplied URLs or credentials from paging.next.
        seen.add(cursor);after=cursor;
      }
      return null;
    }
    try {
      const account=accountFor(accountId,surface),{appId,secret}=config();
      if(!ID.test(appId)||!secret)return {ready:false,missing:['Configure o aplicativo Meta no painel de integrações.'],postUrl,details};
      let token;try {token=decryptToken(account.token_encrypted);}catch{throw error('A conexão da conta precisa ser renovada.');}
      const debug=await read('debug_token',{token:appId+'|'+secret,query:{input_token:token}}),grant=debug?.data;
      if(!grant?.is_valid||String(grant.app_id)!==appId)throw error('A conexão Meta expirou ou pertence a outro aplicativo. Reconecte a conta.');
      if([grant.expires_at,grant.data_access_expires_at].some(value=>Number(value)>0&&Number(value)*1000<=now()))throw error('A conexão Meta expirou. Reconecte a conta.');
      const permissions=new Set(Array.isArray(grant.scopes)?grant.scopes:[]);
      const required=surface==='instagram'?['instagram_basic','instagram_manage_comments','pages_read_engagement','pages_manage_metadata']:['pages_messaging','pages_read_engagement','pages_manage_metadata'];
      for(const permission of required)if(!permissions.has(permission))missing.push('Autorize a permissão '+permission+' na conexão Meta.');
      // Granular permissions restricted to other targets do not grant this Page.
      for(const row of grant.granular_scopes||[])if(required.includes(row.scope)&&Array.isArray(row.target_ids)&&row.target_ids.length&&!row.target_ids.map(String).includes(String(account.page_id))&&!row.target_ids.map(String).includes(String(account.instagram_id||'')))missing.push('A permissão '+row.scope+' não inclui esta conta.');
      details.permissionCheck=missing.length===0;
      const identity=await read('me',{token,query:{fields:'id'}});
      if(String(identity.id)!==String(account.page_id))throw error('O token da conexão não corresponde à Página selecionada.');
      if(surface==='instagram'){
        const linked=await read(account.page_id,{token,query:{fields:'instagram_business_account'}});
        if(String(linked.instagram_business_account?.id)!==String(account.instagram_id))throw error('O Instagram não está vinculado à Página selecionada. Reconecte a conta.');
      }
      try {
        const app=await findInPages(account.page_id+'/subscribed_apps',{token,query:{fields:'id,subscribed_fields'}},item=>String(item.id)===appId),fields=new Set(app?.subscribed_fields||[]);
        const field=surface==='facebook_group'?'group_feed':surface==='instagram'?'comments':'feed';
        if(surface==='instagram'){
          // This integration uses Facebook Login. Install the app on its linked
          // Page; Instagram comment fields are configured at app level. The IG
          // /subscribed_apps endpoint belongs to the separate Instagram Login flow.
          const subscription=await findInPages(appId+'/subscriptions',{token:appId+'|'+secret},item=>item.object==='instagram'&&item.active===true&&Array.isArray(item.fields)&&item.fields.some(field=>(typeof field==='string'?field:field?.name)==='comments'));
          details.subscriptionCheck=Boolean(app&&subscription);
        }else details.subscriptionCheck=fields.has(field);
        if(!details.subscriptionCheck)missing.push('Configure a assinatura de comentários '+field+' deste aplicativo na Meta.');
      }catch {missing.push('Não foi possível confirmar a assinatura de comentários desta conta na Meta.');}
      if(!POST.test(String(postId)))missing.push('Informe o ID de uma publicação existente.');
      else if(surface==='instagram'){
        const post=await read(String(postId),{token,query:{fields:'id,owner,permalink'}});
        if(String(post?.id)!==String(postId)||String(post?.owner?.id)!==String(account.instagram_id))missing.push('A publicação precisa pertencer ao Instagram profissional selecionado.');
        else {postUrl=String(post.permalink||'');details.ownershipCheck=true;}
      }else{
        const post=await read(String(postId),{token,query:{fields:'id,from,permalink_url'}});
        if(String(post.id)!==String(postId)||String(post.from?.id)!==String(account.page_id))missing.push('A publicação precisa ter sido criada como a Página selecionada.');
        else {
          postUrl=String(post.permalink_url||'');let actualGroup='';
          try {actualGroup=new URL(postUrl).pathname.match(/^\/groups\/([0-9]+)(?:\/|$)/)?.[1]||'';}catch{}
          if(surface==='facebook_group'&&(!ID.test(String(groupId))||actualGroup!==String(groupId)))missing.push('Confira o ID do grupo e use uma publicação criada como Página nesse grupo.');
          else if(surface==='facebook_page'&&actualGroup)missing.push('Esta publicação pertence a um grupo. Escolha o destino Grupo do Facebook.');
          else details.ownershipCheck=true;
        }
      }
      if(!String(env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN||''))missing.push('Configure o recebimento de comentários no painel de integrações.');
    }catch(e){missing.push(e.metaCommentSafe?e.message:'Não foi possível concluir a verificação da conexão Meta.');}
    return {ready:missing.length===0,missing:[...new Set(missing)],postUrl,details,note:missing.length?'':note};
  }
  async function send({accountId,surface,commentId,text}){
    const account=accountFor(accountId,surface);
    if(!POST.test(String(commentId))||typeof text!=='string'||!text.trim()||text.length>1900||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw error('Confira o comentário e a mensagem antes do envio.');
    let token;try {token=decryptToken(account.token_encrypted);}catch{throw error('Reconecte a conta Meta antes de enviar.');}
    const actor=surface==='instagram'?account.instagram_id:account.page_id;
    const result=await request(actor+'/messages',{token,body:{recipient:{comment_id:String(commentId)},message:{text}}});
    const messageId=String(result.message_id||'');
    if(!messageId||messageId.length>500)throw error('A Meta não confirmou o identificador da resposta. Confira a conversa antes de tentar novamente.',true);
    return {messageId};
  }
  return {inspect,send};
}
