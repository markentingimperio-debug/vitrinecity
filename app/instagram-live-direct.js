// Facebook Login / Page token: never fall back to a public comment or generic DM.
export async function sendInstagramLiveDirect({instagramId, commentId, mediaId, text, token,
  apiVersion='v26.0', fetchImpl=fetch}) {
  if (![instagramId,commentId,mediaId].every(id=>/^\d+$/.test(String(id||''))) ||
      !/^v\d+\.\d+$/.test(apiVersion) || !token || typeof text!=='string' ||
      !text.trim() || text.length>900) throw Error('instagram_live_invalid_reply');
  const base=`https://graph.facebook.com/${apiVersion}/${instagramId}`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  let response;
  try { response=await fetchImpl(base+'/live_media?fields=id&limit=100',{headers,signal:AbortSignal.timeout(15000)}); }
  catch { throw Error('instagram_live_status_unavailable'); }
  const live=await response.json().catch(()=>null);
  if (!response.ok || !Array.isArray(live?.data)) throw Error('instagram_live_status_unavailable');
  if (!live.data.some(item=>String(item.id)===String(mediaId))) throw Error('instagram_live_ended_or_not_owned');
  // Meta validates the window again at send time. A timeout is not safe to retry.
  try { response=await fetchImpl(base+'/messages',{method:'POST',headers,
    body:JSON.stringify({recipient:{comment_id:String(commentId)},message:{text:text.trim()}}),
    signal:AbortSignal.timeout(15000)}); }
  catch { throw Error('instagram_live_send_unknown_check_direct'); }
  const result=await response.json().catch(()=>null);
  if (!response.ok) throw Error('instagram_live_send_rejected_'+response.status);
  if (!result?.message_id) throw Error('instagram_live_send_unknown_check_direct');
  return {messageId:String(result.message_id)};
}
