// Facebook Login / Page token: never fall back to a public comment or generic DM.
export async function sendInstagramLiveDirect({instagramId, commentId, mediaId, text, token,
  apiVersion='v26.0', fetchImpl=fetch, canRun=()=>true, beforeSubmit=()=>true}) {
  if (![instagramId,commentId,mediaId].every(id=>/^\d+$/.test(String(id||''))) ||
      !/^v\d+\.\d+$/.test(apiVersion) || !token || typeof text!=='string' ||
      !text.trim() || text.length>900) throw Error('instagram_live_invalid_reply');
  const base=`https://graph.facebook.com/${apiVersion}/${instagramId}`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const notSubmitted=code=>Object.assign(Error(code),{notSubmitted:true});
  if(canRun()!==true)throw notSubmitted('instagram_live_paused');
  let response;
  try { response=await fetchImpl(base+'/live_media?fields=id&limit=100',{headers,signal:AbortSignal.timeout(15000)}); }
  catch { throw notSubmitted('instagram_live_status_unavailable'); }
  const live=await response.json().catch(()=>null);
  if (!response.ok || !Array.isArray(live?.data)) throw notSubmitted('instagram_live_status_unavailable');
  if (!live.data.some(item=>String(item.id)===String(mediaId))) throw notSubmitted('instagram_live_ended_or_not_owned');
  const body=JSON.stringify({recipient:{comment_id:String(commentId)},message:{text:text.trim()}});
  // The caller's synchronous callback reserves its durable one-attempt claim
  // only after the live GET. No await separates the final guard and the POST.
  if(canRun()!==true)throw notSubmitted('instagram_live_paused');
  if(beforeSubmit()!==true)throw notSubmitted('instagram_live_not_authorized');
  // Meta validates the window again at send time. A timeout is not safe to retry.
  try { response=await fetchImpl(base+'/messages',{method:'POST',headers,
    body,
    signal:AbortSignal.timeout(15000)}); }
  catch { throw Error('instagram_live_send_unknown_check_direct'); }
  const result=await response.json().catch(()=>null);
  if(response.ok&&typeof result?.message_id==='string'&&result.message_id.length<=300&&result.message_id&&!/[\s\x00-\x1f\x7f]/.test(result.message_id)&&typeof result?.recipient_id==='string'&&/^\d{1,40}$/.test(result.recipient_id)&&!result.error)return {messageId:result.message_id,recipientId:result.recipient_id};
  if(response.status>=400&&response.status<500&&Number.isInteger(result?.error?.code)&&!result?.message_id)throw Object.assign(Error('instagram_live_send_rejected_'+response.status),{rejected:true});
  throw Error('instagram_live_send_unknown_check_direct');
}
