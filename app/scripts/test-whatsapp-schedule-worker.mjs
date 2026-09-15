import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createWhatsAppScheduleProcessor,whatsappScheduleState,countWhatsAppSchedules} from '../whatsapp-schedule-worker.js';
import {isWhatsAppCommercialGroupAllowed} from '../whatsapp-commercial-policy.js';

function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE whatsapp_qr_schedules(id TEXT PRIMARY KEY,group_jid TEXT,group_name TEXT,sitemap_url TEXT,message TEXT,scheduled_at TEXT,status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','cancelled')),provider_message_id TEXT,error TEXT,sent_at TEXT,product_slug TEXT)`);
  const add=(id,product=false,at='2026-09-09T09:00:00.000Z')=>db.prepare('INSERT INTO whatsapp_qr_schedules(id,group_jid,sitemap_url,message,scheduled_at,product_slug) VALUES(?,?,?,?,?,?)').run(id,'123@g.us','https://vitrinecity.com/ofertas/example','Mensagem',at,product?'example':null);
  const image=item=>({pathname:'/chat/send/image',body:{Phone:item.group_jid,Caption:'Foto e link',Image:'data:image/jpeg;base64,/9j/',Id:item.id.replaceAll('-','').toUpperCase()}});
  const options={db,now:()=>new Date('2026-09-09T10:00:00.000Z'),prepareScheduledMessage:async item=>item.product_slug?image(item):null,whatsappQrData:p=>p.data};
  return {db,add,options};
}

test('private exclusion list is exact and malformed configuration fails closed',()=>{
  const env={WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:' 123@g.us, 456@g.us,123@g.us '};
  assert.equal(isWhatsAppCommercialGroupAllowed('123@g.us',env),false);
  assert.equal(isWhatsAppCommercialGroupAllowed('1234@g.us',env),true);
  assert.equal(isWhatsAppCommercialGroupAllowed('456@g.us',env),false);
  assert.equal(isWhatsAppCommercialGroupAllowed('123@s.whatsapp.net',{}),false);
  assert.equal(isWhatsAppCommercialGroupAllowed('123@g.us',{}),true);
  assert.throws(()=>isWhatsAppCommercialGroupAllowed('123@g.us',{WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:'bad-value'}),error=>error.code==='whatsapp_commercial_policy_invalid'&&error.status===503);
});

test('invalid exclusion configuration cannot send or cancel unrelated pending schedules',async()=>{
  const {db,add,options}=fixture();
  try {
    const run=createWhatsAppScheduleProcessor({...options,isGroupAllowed:jid=>isWhatsAppCommercialGroupAllowed(jid,{WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS:'typo'}),whatsappQrRequest:async()=>assert.fail('No sends under invalid policy')});
    add('pending');const before=db.prepare('SELECT * FROM whatsapp_qr_schedules').get();
    await assert.rejects(run(),error=>error.code==='whatsapp_commercial_policy_invalid');
    assert.deepEqual(db.prepare('SELECT * FROM whatsapp_qr_schedules').get(),before);
  } finally {db.close();}
});

test('excluded text and product schedules are cancelled before claim without starving other groups or changing historical receipts',async()=>{
  const {db,add,options}=fixture(),sent=[],prepared=[];
  try {
    const run=createWhatsAppScheduleProcessor({...options,isGroupAllowed:jid=>jid!=='123@g.us',prepareScheduledMessage:async item=>{prepared.push(item.id);return options.prepareScheduledMessage(item);},whatsappQrRequest:async(_path,request)=>{sent.push(JSON.parse(request.body).Phone);return {data:{Id:'ALLOWED_ACK'}};}});
    for(let i=0;i<5;i++)add('blocked-'+i,i%2===0);
    add('blocked-future',true,'2027-01-01T10:00:00.000Z');add('historic');add('other');
    db.prepare("UPDATE whatsapp_qr_schedules SET status='sent',provider_message_id='HISTORICAL_ACK',sent_at='2026-09-08',confirmation_state='confirmed' WHERE id='historic'").run();
    db.prepare("UPDATE whatsapp_qr_schedules SET group_jid='222@g.us' WHERE id='other'").run();
    const before=db.prepare("SELECT * FROM whatsapp_qr_schedules WHERE id='historic'").get();
    await run();await run();
    assert.deepEqual(sent,['222@g.us']);assert.deepEqual(prepared,['other']);
    for(const row of db.prepare("SELECT * FROM whatsapp_qr_schedules WHERE id LIKE 'blocked-%'").all()) {assert.equal(row.status,'cancelled');assert.equal(row.claimed_at,null);assert.equal(row.provider_message_id,null);assert.ok(row.error);}
    assert.deepEqual(db.prepare("SELECT * FROM whatsapp_qr_schedules WHERE id='historic'").get(),before);
  } finally {db.close();}
});

test('an exclusion arriving during preparation stops a claimed message before provider submission',async()=>{
  const {db,add,options}=fixture();let allowed=true,calls=0;
  try {
    add('reserved-during-read',true);
    const run=createWhatsAppScheduleProcessor({...options,isGroupAllowed:()=>allowed,prepareScheduledMessage:async item=>{allowed=false;return options.prepareScheduledMessage(item);},whatsappQrRequest:async()=>{calls++;return {data:{Id:'UNEXPECTED'}};}});
    await run();await run();
    const row=db.prepare('SELECT * FROM whatsapp_qr_schedules').get();
    assert.equal(calls,0);assert.equal(row.status,'cancelled');assert.equal(row.confirmation_state,'not_submitted');assert.equal(row.provider_message_id,null);
  } finally {db.close();}
});

test('a request-specific final guard prevents submission without creating an uncertain retry',async()=>{
  for(const mode of ['false','throw']){
    const {db,add,options}=fixture();let calls=0;
    try{
      add('boundary');
      const run=createWhatsAppScheduleProcessor({...options,prepareScheduledMessage:async()=>({pathname:'/chat/send/text',body:{},beforeSubmit:()=>{if(mode==='throw')throw Error('configuration unavailable');return false;}}),whatsappQrRequest:async()=>{calls++;}});
      await run();await run();const row=db.prepare('SELECT * FROM whatsapp_qr_schedules').get();
      assert.equal(calls,0);assert.equal(row.status,'failed');assert.equal(row.confirmation_state,'not_submitted');
    }finally{db.close();}
  }
});

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
      assert.equal(row.confirmation_state,outcome==='invalid-product'?'not_submitted':'unknown');
      assert.equal(row.sent_at,null);
    } finally {db.close();}
  }
});

test('both text and images require a real string receipt; invalid responses are unknown and never count as sent',async()=>{
  for(const product of [false,true])for(const receipt of [null,{},[],{Id:''},{Id:'   '},{Id:123},{Id:{}},{Id:'undefined'},{Id:'bad\nreceipt'},{Id:'x'.repeat(161)}]) {
    const {db,add,options}=fixture();let attempts=0;
    try{
      add('no-ack',product);
      const run=createWhatsAppScheduleProcessor({...options,whatsappQrRequest:async()=>{attempts++;return {data:receipt};}});
      await run();await run();
      const row=db.prepare('SELECT * FROM whatsapp_qr_schedules').get();
      assert.equal(attempts,1);assert.equal(row.status,'failed');assert.equal(row.confirmation_state,'unknown');
      assert.equal(row.provider_message_id,null);assert.equal(row.sent_at,null);
      assert.deepEqual(countWhatsAppSchedules([row]),{pending:0,processing:0,sent:0,failed:0,unknown:1,cancelled:0});
    }finally{db.close();}
  }
});

test('an explicit pre-submission refusal is failed, not unknown, and is not retried',async()=>{
  const {db,add,options}=fixture();let calls=0;
  try{
    add('no-connection');
    const run=createWhatsAppScheduleProcessor({...options,whatsappQrRequest:async()=>{calls++;throw Object.assign(Error('not configured'),{notSubmitted:true});}});
    await run();await run();
    const row=db.prepare('SELECT * FROM whatsapp_qr_schedules').get();
    assert.equal(row.status,'failed');assert.equal(row.confirmation_state,'not_submitted');assert.equal(calls,1);
    assert.equal(whatsappScheduleState(row),'failed');
  }finally{db.close();}
});

test('bootstrap is additive and preserves every legacy value; read-only projection does not invent old receipts',async()=>{
  const {db,add,options}=fixture();
  try{
    for(const id of ['sent-with-id','sent-without-id','old-processing','old-failed','pending'])add(id);
    db.prepare("UPDATE whatsapp_qr_schedules SET status='sent',sent_at='2026-09-08' WHERE id LIKE 'sent-%'").run();
    db.prepare("UPDATE whatsapp_qr_schedules SET provider_message_id='LEGACY_ACK' WHERE id='sent-with-id'").run();
    db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id='old-processing'").run();
    db.prepare("UPDATE whatsapp_qr_schedules SET status='failed',error='Legacy failure with unknown cause' WHERE id='old-failed'").run();
    const columns=db.prepare('PRAGMA table_info(whatsapp_qr_schedules)').all(),names=columns.map(x=>x.name).join(','),read=()=>db.prepare('SELECT '+names+' FROM whatsapp_qr_schedules ORDER BY id').all(),before=read();
    createWhatsAppScheduleProcessor({...options,whatsappQrRequest:async()=>assert.fail('No bootstrap send')});
    assert.deepEqual(read(),before);
    const afterColumns=db.prepare('PRAGMA table_info(whatsapp_qr_schedules)').all();
    assert.deepEqual(afterColumns.slice(0,columns.length),columns);
    assert.deepEqual(afterColumns.slice(columns.length).map(x=>({name:x.name,type:x.type,notnull:x.notnull,dflt_value:x.dflt_value})),[{name:'confirmation_state',type:'TEXT',notnull:1,dflt_value:"''"},{name:'claimed_at',type:'INTEGER',notnull:0,dflt_value:null}]);
    const counts=countWhatsAppSchedules(db.prepare('SELECT * FROM whatsapp_qr_schedules').all(),options.now().getTime());
    assert.deepEqual(counts,{pending:1,processing:0,sent:1,failed:1,unknown:2,cancelled:0});
    assert.deepEqual(read(),before,'Counting must not rewrite legacy rows');
  }finally{db.close();}
});

test('stale and untimed processing claims become unknown even while paused; recent claims are preserved',async()=>{
  const {db,add,options}=fixture();let calls=0;
  try{
    for(const id of ['legacy','stale','recent'])add(id);
    const run=createWhatsAppScheduleProcessor({...options,canRun:()=>false,whatsappQrRequest:async()=>{calls++;}});
    db.prepare("UPDATE whatsapp_qr_schedules SET status='processing' WHERE id='legacy'").run();
    db.prepare("UPDATE whatsapp_qr_schedules SET status='processing',confirmation_state='submitting',claimed_at=? WHERE id='stale'").run(options.now().getTime()-120001);
    db.prepare("UPDATE whatsapp_qr_schedules SET status='processing',confirmation_state='submitting',claimed_at=? WHERE id='recent'").run(options.now().getTime()-1000);
    await run();await run();
    for(const id of ['legacy','stale']){const row=db.prepare('SELECT * FROM whatsapp_qr_schedules WHERE id=?').get(id);assert.equal(row.status,'failed');assert.equal(row.confirmation_state,'unknown');assert.equal(row.sent_at,null);}
    assert.equal(db.prepare("SELECT status FROM whatsapp_qr_schedules WHERE id='recent'").get().status,'processing');
    assert.equal(calls,0);
  }finally{db.close();}
});

test('slow preparation retired by another worker never submits; a late valid receipt can resolve its original claim once',async()=>{
  for(const phase of ['preparation','request']){
    const {db,add,options}=fixture();let clock=options.now().getTime(),release,entered,calls=0;
    const enteredPromise=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    try{
      add('slow');
      const a=createWhatsAppScheduleProcessor({...options,now:()=>new Date(clock),prepareScheduledMessage:async()=>{if(phase==='preparation'){entered();await gate;}return null;},whatsappQrRequest:async()=>{calls++;entered();await gate;return {data:{id:'LATE_ACK'}};}});
      const pending=a();await enteredPromise;clock+=120001;
      const b=createWhatsAppScheduleProcessor({...options,now:()=>new Date(clock),canRun:()=>false,whatsappQrRequest:async()=>assert.fail('Recovery cannot send')});
      await b();assert.equal(db.prepare('SELECT confirmation_state FROM whatsapp_qr_schedules').get().confirmation_state,'unknown');
      release();await pending;await a();await b();
      const row=db.prepare('SELECT * FROM whatsapp_qr_schedules').get();
      assert.equal(calls,phase==='request'?1:0);
      assert.equal(row.confirmation_state,phase==='request'?'confirmed':'unknown');
      assert.equal(row.status,phase==='request'?'sent':'failed');
    }finally{release?.();db.close();}
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
