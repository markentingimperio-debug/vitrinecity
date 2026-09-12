import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const readScopes=['pages_show_list','pages_read_engagement','pages_read_user_content','read_insights','instagram_basic','instagram_manage_insights'];
const commentScopes=['pages_messaging','pages_manage_metadata','instagram_manage_comments','business_management','pages_manage_engagement','pages_manage_posts','instagram_content_publish'];
const instagramMessageScopes=['pages_show_list','pages_read_engagement','instagram_basic','instagram_manage_messages','pages_manage_metadata','instagram_manage_comments','pages_messaging','business_management'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const intents=new Set(['read_only','comment_replies','instagram_messages']);
const destinations=new Set(['carteira','admin','chatbot']);

export function socialOauthRequest(query,isAdmin){
  const intent=query.intent===undefined?'read_only':query.intent;
  if(!intents.has(intent))throw fail('Escolha uma finalidade válida para a conexão Meta.');
  if(intent==='comment_replies'&&!isAdmin)throw fail('Somente administradores podem conectar respostas a comentários.',403);
  if(intent==='instagram_messages'&&!isAdmin)throw fail('Somente administradores podem conectar mensagens do Instagram.',403);
  const returnTo=isAdmin&&query.returnTo==='chatbot'?'chatbot':isAdmin&&query.returnTo==='admin'?'admin':'carteira';
  return {intent,returnTo};
}

export function socialOauthScopes(intent='read_only'){
  if(!intents.has(intent))throw fail('Finalidade inválida.');
  return intent==='instagram_messages'?[...instagramMessageScopes]:intent==='comment_replies'?[...readScopes,...commentScopes]:[...readScopes];
}

export function socialOauthConfigId(intent='read_only',{readOnlyConfigId,commentConfigId,instagramMessageConfigId}={}){
  if(!intents.has(intent))throw fail('Finalidade inválida.');
  if(intent==='instagram_messages'){
    if(typeof instagramMessageConfigId!=='string'||!/^[1-9]\d{4,29}$/.test(instagramMessageConfigId))throw fail('Cadastre a configuração exclusiva de mensagens do Instagram no painel de conexões, ou em META_SOCIAL_INSTAGRAM_MESSAGE_LOGIN_CONFIG_ID.',503);
    if([readOnlyConfigId,commentConfigId].includes(instagramMessageConfigId))throw fail('Use uma configuração da Meta exclusiva para mensagens do Instagram, diferente das conexões de leitura e comentários.',503);
    return instagramMessageConfigId;
  }
  const value=intent==='comment_replies'?commentConfigId:readOnlyConfigId;
  if(typeof value!=='string'||!/^[1-9]\d{4,29}$/.test(value))throw fail(intent==='comment_replies'
    ?'A conexão para respostas a comentários ainda precisa de uma configuração própria da Meta. Configure META_SOCIAL_COMMENT_LOGIN_CONFIG_ID no servidor.'
    :'A conexão de leitura da Meta ainda não está configurada corretamente.',503);
  if(intent==='comment_replies'&&value===readOnlyConfigId)throw fail('Use uma configuração da Meta exclusiva para respostas a comentários, diferente da conexão de leitura.',503);
  return value;
}

export function signSocialOauthState({userId,returnTo,intent='read_only'},{secret,now=Date.now()}={}){
  if(!secret||!Number.isSafeInteger(Number(userId))||Number(userId)<1||!destinations.has(returnTo)||!intents.has(intent))throw fail('Não foi possível preparar a conexão Meta.');
  const payload=Buffer.from(JSON.stringify({userId:Number(userId),returnTo,intent,issuedAt:now,nonce:randomBytes(12).toString('hex')})).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
}

export function verifySocialOauthState(value,userId,{secret,isAdmin=false,now=Date.now()}={}){
  if(!secret||typeof value!=='string'||value.length>3000)return null;
  const parts=value.split('.');if(parts.length!==2||!parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)))return null;
  const [payload,signature]=parts,expected=createHmac('sha256',secret).update(payload).digest('base64url'),actualBytes=Buffer.from(signature),expectedBytes=Buffer.from(expected);
  if(actualBytes.length!==expectedBytes.length||!timingSafeEqual(actualBytes,expectedBytes))return null;
  try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));data.intent??='read_only';
    if(!Number.isSafeInteger(data.userId)||data.userId<1||data.userId!==Number(userId)||!Number.isSafeInteger(data.issuedAt)||data.issuedAt>now+30000||now-data.issuedAt>600000||!destinations.has(data.returnTo)||!intents.has(data.intent)||typeof data.nonce!=='string'||!/^[a-f0-9]{24}$/.test(data.nonce))return null;
    if(!isAdmin&&(data.intent!=='read_only'||data.returnTo!=='carteira'))return null;
    return data;
  }catch{return null;}
}

export function socialOauthDestination(state,status){
  const target=state?.returnTo==='chatbot'?['/admin-chatbotx.html','#socialCommentCampaigns']:state?.returnTo==='admin'?['/admin','#admin-social']:['/carteira.html','#socialConnectArea'];
  return target[0]+'?social='+encodeURIComponent(status)+target[1];
}
