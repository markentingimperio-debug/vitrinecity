const STALE_CLAIM_MS=120000;
const UNKNOWN='Confirmação do envio ausente. Confira a conversa antes de qualquer novo envio; não haverá repetição automática.';

export function ensureWhatsAppScheduleConfirmation(db) {
  const columns=new Set(db.prepare('PRAGMA table_info(whatsapp_qr_schedules)').all().map(row=>row.name));
  if(!columns.size)throw Error('whatsapp_qr_schedules must be initialized first');
  if(!columns.has('confirmation_state'))db.exec("ALTER TABLE whatsapp_qr_schedules ADD COLUMN confirmation_state TEXT NOT NULL DEFAULT ''");
  if(!columns.has('claimed_at'))db.exec('ALTER TABLE whatsapp_qr_schedules ADD COLUMN claimed_at INTEGER');
}

export function validWhatsAppReceiptId(value) {
  return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.trim())&&!/^(null|undefined|true|false|0)$/i.test(value.trim());
}

// Projection preserves historical rows: an old "sent" without a receipt is
// unverified, not proof that it failed or that it should be sent again.
export function whatsappScheduleState(row,at=Date.now()) {
  if(row.confirmation_state==='unknown'||row.confirmationState==='unknown')return 'unknown';
  if(row.status==='sent'&&!validWhatsAppReceiptId(row.provider_message_id??row.providerMessageId))return 'unknown';
  const claimed=row.claimed_at??row.claimedAt;
  if(row.status==='processing'&&(claimed==null||Number(claimed)<at-STALE_CLAIM_MS))return 'unknown';
  return row.status;
}

export function countWhatsAppSchedules(rows,at=Date.now()) {
  const counts={pending:0,processing:0,sent:0,failed:0,unknown:0,cancelled:0};
  for(const row of rows){const state=whatsappScheduleState(row,at);if(Object.hasOwn(counts,state))counts[state]++;}
  return counts;
}

export function createWhatsAppScheduleProcessor({db,prepareScheduledMessage,whatsappQrRequest,whatsappQrData,canRun=()=>true,now=()=>new Date(),isGroupAllowed=isWhatsAppCommercialGroupAllowed}) {
  ensureWhatsAppScheduleConfirmation(db);
  let running=false;
  return async function processSchedules() {
    if(running)return;
    running=true;
    try {
      // An interrupted process may have submitted the message before crashing.
      // Record uncertainty even while paused; never put these rows back in pending.
      db.prepare("UPDATE whatsapp_qr_schedules SET status='failed',confirmation_state='unknown',error=? WHERE status='processing' AND (claimed_at IS NULL OR claimed_at<?)").run(UNKNOWN,now().getTime()-STALE_CLAIM_MS);
      if(!canRun())return;
      // Cancel only unsubmitted commercial schedules. Keep historical receipts,
      // drafts and uncertain submissions intact, and avoid starving other groups.
      for(const row of db.prepare("SELECT * FROM whatsapp_qr_schedules WHERE status='pending'").all()) {
        if(!isGroupAllowed(row.group_jid,row))db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled',error=? WHERE id=? AND status='pending'").run(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,row.id);
      }
      const due=db.prepare(`SELECT * FROM whatsapp_qr_schedules WHERE status='pending' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 3`).all(now().toISOString());
      for(const item of due) {
        if(!canRun())break;
        if(!isGroupAllowed(item.group_jid,item)) {
          db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled',error=? WHERE id=? AND status='pending'").run(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,item.id);
          continue;
        }
        const claimTime=now().getTime();
        const claimed=db.prepare("UPDATE whatsapp_qr_schedules SET status='processing',confirmation_state='submitting',claimed_at=?,error=NULL WHERE id=? AND status='pending'").run(claimTime,item.id);
        if(!claimed.changes)continue;
        const restorePending=()=>db.prepare("UPDATE whatsapp_qr_schedules SET status='pending',confirmation_state='',claimed_at=NULL WHERE id=? AND status='processing' AND claimed_at=?").run(item.id,claimTime);
        let submitted=false;
        try {
          const productMessage=await prepareScheduledMessage(item);
          const request=productMessage||{
            pathname:'/chat/send/text',
            body:{Phone:item.group_jid,Body:`${item.message}\n\n${item.sitemap_url}`.slice(0,4000),Id:item.id.replaceAll('-','').toUpperCase()}
          };
          if(!canRun()){restorePending();break;}
          const live=db.prepare('SELECT status,confirmation_state,claimed_at FROM whatsapp_qr_schedules WHERE id=?').get(item.id);
          if(live?.status!=='processing'||live.confirmation_state!=='submitting'||live.claimed_at!==claimTime)continue;
          if(!isGroupAllowed(item.group_jid,item)) {
            db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled',confirmation_state='not_submitted',error=? WHERE id=? AND status='processing' AND claimed_at=?").run(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,item.id,claimTime);
            continue;
          }
          if(typeof request.beforeSubmit==='function'&&request.beforeSubmit()!==true)throw Object.assign(Error('scheduled_state_changed'),{notSubmitted:true});
          submitted=true;
          const payload=await whatsappQrRequest(request.pathname,{method:'POST',body:JSON.stringify(request.body)});
          const data=whatsappQrData(payload),providerId=[data?.Id,data?.id].find(validWhatsAppReceiptId)?.trim();
          if(!providerId)throw Error('missing_whatsapp_receipt');
          // A late real receipt may resolve this same claim after a stale projection.
          db.prepare("UPDATE whatsapp_qr_schedules SET status='sent',confirmation_state='confirmed',provider_message_id=?,error=NULL,sent_at=CURRENT_TIMESTAMP WHERE id=? AND claimed_at=? AND status IN ('processing','failed') AND confirmation_state IN ('submitting','unknown')").run(providerId,item.id,claimTime);
        } catch(error) {
          if(!submitted&&!canRun()){restorePending();break;}
          const uncertain=submitted&&error?.notSubmitted!==true;
          const detail=uncertain?UNKNOWN:error?.campaignSafe?String(error.message).slice(0,300):'O envio não foi submetido. Revise a configuração ou o conteúdo antes de preparar outra campanha.';
          db.prepare("UPDATE whatsapp_qr_schedules SET status='failed',confirmation_state=?,error=? WHERE id=? AND claimed_at=? AND status='processing'").run(uncertain?'unknown':'not_submitted',detail,item.id,claimTime);
        }
      }
    } finally {running=false;}
  };
}
import {isWhatsAppCommercialGroupAllowed,WHATSAPP_COMMERCIAL_EXCLUDED_REASON} from './whatsapp-commercial-policy.js';
