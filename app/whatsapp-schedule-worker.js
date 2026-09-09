export function createWhatsAppScheduleProcessor({db,prepareScheduledMessage,whatsappQrRequest,whatsappQrData,canRun=()=>true,now=()=>new Date()}) {
  let running=false;
  return async function processSchedules() {
    if(running||!canRun())return;
    running=true;
    try {
      const due=db.prepare(`SELECT * FROM whatsapp_qr_schedules WHERE status='pending' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 3`).all(now().toISOString());
      for(const item of due) {
        if(!canRun())break;
        const claimed=db.prepare(`UPDATE whatsapp_qr_schedules SET status='processing',error=NULL WHERE id=? AND status='pending'`).run(item.id);
        if(!claimed.changes)continue;
        let submitted=false;
        try {
          const productMessage=await prepareScheduledMessage(item);
          const request=productMessage||{
            pathname:'/chat/send/text',
            body:{Phone:item.group_jid,Body:`${item.message}\n\n${item.sitemap_url}`.slice(0,4000),Id:item.id.replaceAll('-','').toUpperCase()}
          };
          if(!canRun()){db.prepare("UPDATE whatsapp_qr_schedules SET status='pending' WHERE id=? AND status='processing'").run(item.id);break;}
          submitted=true;
          const payload=await whatsappQrRequest(request.pathname,{method:'POST',body:JSON.stringify(request.body)});
          const data=whatsappQrData(payload),providerId=String(data.Id||data.id||'').slice(0,160);
          if(productMessage&&!providerId)throw Error('O provedor não confirmou o envio com foto. Confira a conversa antes de tentar novamente.');
          db.prepare(`UPDATE whatsapp_qr_schedules SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP WHERE id=?`).run(providerId,item.id);
        } catch(error) {
          if(!submitted&&!canRun()){db.prepare("UPDATE whatsapp_qr_schedules SET status='pending' WHERE id=? AND status='processing'").run(item.id);break;}
          // A timeout can happen after delivery. Never retry uncertain sends automatically.
          db.prepare(`UPDATE whatsapp_qr_schedules SET status='failed',error=? WHERE id=?`).run(String(error?.message||'send_failed').slice(0,300),item.id);
        }
      }
    } finally {running=false;}
  };
}
