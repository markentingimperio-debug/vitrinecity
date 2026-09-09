import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createWhatsAppScheduleProcessor} from '../whatsapp-schedule-worker.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE whatsapp_qr_schedules(id TEXT PRIMARY KEY,group_jid TEXT,group_name TEXT,sitemap_url TEXT,message TEXT,scheduled_at TEXT,status TEXT DEFAULT 'pending',provider_message_id TEXT,error TEXT,sent_at TEXT,product_slug TEXT)`);
  const add=(id,product=false,at='2026-09-09T09:00:00.000Z')=>db.prepare('INSERT INTO whatsapp_qr_schedules(id,group_jid,sitemap_url,message,scheduled_at,product_slug) VALUES(?,?,?,?,?,?)').run(id,'123@g.us','https://vitrinecity.com/ofertas/example','Mensagem',at,product?'example':null);
  const image=item=>({pathname:'/chat/send/image',body:{Phone:item.group_jid,Caption:'Foto e link',Image:'data:image/jpeg;base64,/9j/',Id:item.id.replaceAll('-','').toUpperCase()}});
  const options={db,now:()=>new Date('2026-09-09T10:00:00.000Z'),prepareScheduledMessage:async item=>item.product_slug?image(item):null,whatsappQrData:p=>p.data};
  return {db,add,options};
}

test('sends image plus caption and preserves text schedules without sending future or cancelled rows',async()=>{
  const {db,add,options}=fixture(),sent=[];
  try {
    add('image-1',true);add('text-1');add('future',true,'2026-09-10T10:00:00.000Z');add('cancelled',true);
    db.prepare("UPDATE whatsapp_qr_schedules SET status='cancelled' WHERE id='cancelled'").run();
    const run=createWhatsAppScheduleProcessor({...options,whatsappQrRequest:async(path,request)=>{sent.push({path,body:JSON.parse(request.body)});return {data:{Id:'ack-'+sent.length}};}});
    await run();await run();
    assert.equal(sent.length,2);assert.equal(sent[0].path,'/chat/send/image');assert.equal(sent[0].body.Id,'IMAGE1');assert.equal(sent[0].body.Caption,'Foto e link');
    assert.equal(sent[1].path,'/chat/send/text');assert.equal(sent[1].body.Body,'Mensagem\n\nhttps://vitrinecity.com/ofertas/example');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM whatsapp_qr_schedules WHERE status='sent'").get().n,2);
    assert.equal(db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='future'").get().status,'pending');
  } finally {db.close();}
});

test('claims each row once across concurrent processors and enforces a three-row batch',async()=>{
  const {db,add,options}=fixture(),sent=[];
  try {
    for(let i=0;i<7;i++)add('job-'+i,true);
    const request=async(_path,req)=>{const body=JSON.parse(req.body);sent.push(body.Id);await new Promise(resolve=>setImmediate(resolve));return {data:{Id:body.Id}};};
    const a=createWhatsAppScheduleProcessor({...options,whatsappQrRequest:request}),b=createWhatsAppScheduleProcessor({...options,whatsappQrRequest:request});
    await Promise.all([a(),a(),b()]);
    assert.equal(sent.length,new Set(sent).size);assert.ok(sent.length<=6);
    await a();await a();await a();assert.equal(sent.length,7);assert.equal(new Set(sent).size,7);
  } finally {db.close();}
});

test('a timeout or missing acknowledgment is left for review and never automatically resent',async()=>{
  for(const outcome of ['timeout','missing-id','invalid-product']) {
    const {db,add,options}=fixture();let attempts=0;
    try {
      add('uncertain',true);
      const run=createWhatsAppScheduleProcessor({...options,prepareScheduledMessage:async item=>{if(outcome==='invalid-product')throw Error('Produto pausado');return options.prepareScheduledMessage(item);},whatsappQrRequest:async()=>{attempts++;if(outcome==='timeout')throw Error('Timeout');return {data:{Details:'Unknown'}};}});
      await run();await run();
      const row=db.prepare("SELECT * FROM whatsapp_qr_schedules WHERE id='uncertain'").get();
      assert.equal(row.status,'failed');assert.equal(row.provider_message_id,null);assert.ok(row.error);assert.equal(attempts,outcome==='invalid-product'?0:1);
    } finally {db.close();}
  }
});

test('global pause keeps unsubmitted work pending and resumes once; uncertain sends stay terminal',async()=>{
  const {db,add,options}=fixture();let paused=true,attempts=0,pauseDuringPrepare=false;
  try{
    add('paused',true);
    const run=createWhatsAppScheduleProcessor({...options,canRun:()=>!paused,prepareScheduledMessage:async item=>{if(pauseDuringPrepare)paused=true;return options.prepareScheduledMessage(item);},whatsappQrRequest:async()=>{attempts++;return {data:{Id:'confirmed'}};}});
    await run();assert.equal(attempts,0);assert.equal(db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='paused'").get().status,'pending');
    paused=false;pauseDuringPrepare=true;await run();assert.equal(attempts,0);assert.equal(db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='paused'").get().status,'pending');
    paused=false;pauseDuringPrepare=false;await run();await run();assert.equal(attempts,1);
    add('unknown',true);
    const uncertain=createWhatsAppScheduleProcessor({...options,canRun:()=>!paused,whatsappQrRequest:async()=>{attempts++;paused=true;throw Error('timeout after submission');}});
    await uncertain();paused=false;await uncertain();assert.equal(attempts,2);assert.equal(db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='unknown'").get().status,'failed');
  }finally{db.close();}
});
