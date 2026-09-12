import {randomUUID} from 'node:crypto';

const MINUTE=60000,DAY=86400000;
const STATUSES=new Set(['pending','authorized','in_process','in_mediation','approved','rejected','cancelled','refunded','charged_back']);
const PROTECTED=new Set(['approved','in_mediation','refunded','charged_back']);
const TERMINAL=new Set(['refunded','charged_back']);
const courseReference=value=>typeof value==='string'&&/^course_[A-Za-z0-9-]{1,100}$/.test(value)?value:'';
const paymentId=value=>(typeof value==='string'||Number.isSafeInteger(value))&&/^\d{1,30}$/.test(String(value))?String(value):'';
const providerTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const cents=value=>{
  if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
  const raw=Number(value)*100,rounded=Math.round(raw);
  return Number.isSafeInteger(rounded)&&rounded>0&&Math.abs(raw-rounded)<0.000001?rounded:null;
};

/** Only authenticated provider GET results enter settlement. Browser return
 * parameters never create a receipt. The worker cannot create a payment. */
export function setupCoursePaymentReconciliation({db,request,onSettlement=()=>{},canRun=()=>true,schedule=true,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS course_payment_receipts(
    payment_id TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES course_orders(reference),
    status TEXT NOT NULL,amount_cents INTEGER NOT NULL,provider_updated_ms INTEGER NOT NULL,
    approved_ms INTEGER,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_course_receipts_order ON course_payment_receipts(order_reference,provider_updated_ms);
    CREATE TABLE IF NOT EXISTS course_payment_reconciliation(
    order_reference TEXT PRIMARY KEY REFERENCES course_orders(reference),attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_ms INTEGER NOT NULL,last_checked_ms INTEGER,last_result TEXT NOT NULL DEFAULT 'pending',
    lease_until_ms INTEGER NOT NULL DEFAULT 0,lease_token TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS course_payment_effects(
    order_reference TEXT PRIMARY KEY REFERENCES course_orders(reference),payment_id TEXT NOT NULL,status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,next_attempt_ms INTEGER NOT NULL,applied_ms INTEGER,last_result TEXT NOT NULL DEFAULT 'pending');`);
  const orderFor=reference=>courseReference(reference)?db.prepare('SELECT * FROM course_orders WHERE reference=?').get(reference):null;
  const cashOrder=order=>order&&String(order.mp_preference_id||'').trim()&&courseReference(order.reference);
  let running=false,closed=false;

  function flushEffects(reference){
    const effect=db.prepare('SELECT * FROM course_payment_effects WHERE order_reference=? AND applied_ms IS NULL AND next_attempt_ms<=?').get(reference,now());
    if(!effect)return false;
    try{
      return db.transaction(()=>{
        const order=orderFor(reference);
        if(!order||order.status!==effect.status||String(order.mp_payment_id)!==effect.payment_id)return false;
        onSettlement(order,{id:effect.payment_id,status:effect.status,external_reference:reference,transaction_amount:order.amount_cents/100,currency_id:'BRL',live_mode:true});
        db.prepare("UPDATE course_payment_effects SET applied_ms=?,last_result='applied' WHERE order_reference=? AND payment_id=? AND status=?")
          .run(now(),reference,effect.payment_id,effect.status);
        return true;
      }).immediate();
    }catch{
      db.prepare("UPDATE course_payment_effects SET attempt_count=attempt_count+1,next_attempt_ms=?,last_result='effects_pending' WHERE order_reference=?")
        .run(now()+Math.min(60,2**Math.min(effect.attempt_count,6))*MINUTE,reference);
      return false;
    }
  }

  function settle(reference,payment){
    const id=paymentId(payment?.id),status=String(payment?.status||''),updated=providerTime(payment?.date_last_updated);
    const initial=orderFor(reference),amount=cents(payment?.transaction_amount);
    if(!cashOrder(initial))return {ok:false,reason:'order_not_eligible'};
    if(!id||payment.external_reference!==reference||payment.currency_id!=='BRL'||payment.live_mode!==true||amount!==initial.amount_cents||!STATUSES.has(status)||updated===null)
      return {ok:false,reason:'payment_mismatch'};
    const result=db.transaction(()=>{
      const order=orderFor(reference),previous=db.prepare('SELECT * FROM course_payment_receipts WHERE payment_id=?').get(id);
      if(!cashOrder(order)||order.amount_cents!==amount||(previous&&previous.order_reference!==reference))return {ok:false,reason:'payment_mismatch'};
      if(previous&&(updated<previous.provider_updated_ms||(updated===previous.provider_updated_ms&&status!==previous.status)))return {ok:true,reason:'older_payment',status:order.status};
      if(previous&&TERMINAL.has(previous.status)&&!TERMINAL.has(status))return {ok:true,reason:'protected_payment',status:order.status};
      if(previous&&PROTECTED.has(previous.status)&&['pending','authorized','in_process'].includes(status))return {ok:true,reason:'protected_payment',status:order.status};
      const stamp=now(),reportedApproval=providerTime(payment.date_approved),approved=reportedApproval>0&&reportedApproval<=updated?reportedApproval:null;
      db.prepare(`INSERT INTO course_payment_receipts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET
        status=excluded.status,provider_updated_ms=excluded.provider_updated_ms,approved_ms=COALESCE(course_payment_receipts.approved_ms,excluded.approved_ms),updated_ms=excluded.updated_ms`)
        .run(id,reference,status,amount,updated,approved,stamp,stamp);
      const receipts=db.prepare('SELECT * FROM course_payment_receipts WHERE order_reference=? ORDER BY provider_updated_ms DESC,payment_id').all(reference);
      const current=receipts.find(row=>row.payment_id===String(order.mp_payment_id||''));
      // A declined second attempt cannot revoke an already paid order. A later
      // genuine approved attempt can recover an order whose first card failed.
      let chosen=receipts.find(row=>row.status==='approved'&&row.payment_id===String(order.mp_payment_id||''))||receipts.find(row=>row.status==='approved');
      if(!chosen&&PROTECTED.has(order.status)&&!current)return {ok:true,reason:'other_payment_ignored',status:order.status};
      chosen=chosen||(current&&PROTECTED.has(order.status)?current:receipts[0]);
      if(order.status===chosen.status&&String(order.mp_payment_id)===chosen.payment_id){
        // Recover a legacy webhook that updated the order before access or
        // reporting was written. Existing manually revoked access is preserved.
        if(chosen.status==='approved')db.prepare("INSERT OR IGNORE INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES(?,?,?,'active')").run(order.user_id,order.course_slug,reference);
        db.prepare('INSERT OR IGNORE INTO course_payment_effects(order_reference,payment_id,status,next_attempt_ms) VALUES(?,?,?,?)').run(reference,chosen.payment_id,chosen.status,stamp);
        return {ok:true,reason:'unchanged',status:order.status};
      }
      db.prepare('UPDATE course_orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?').run(chosen.status,chosen.payment_id,reference);
      if(chosen.status==='approved')db.prepare(`INSERT INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES(?,?,?,'active')
        ON CONFLICT(order_reference) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`).run(order.user_id,order.course_slug,reference);
      else if(['refunded','charged_back','cancelled','rejected','in_mediation'].includes(chosen.status))db.prepare("UPDATE course_enrollments SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE order_reference=?").run(reference);
      db.prepare(`INSERT INTO course_payment_effects(order_reference,payment_id,status,next_attempt_ms) VALUES(?,?,?,?) ON CONFLICT(order_reference)
        DO UPDATE SET payment_id=excluded.payment_id,status=excluded.status,attempt_count=0,next_attempt_ms=excluded.next_attempt_ms,applied_ms=NULL,last_result='pending'`)
        .run(reference,chosen.payment_id,chosen.status,stamp);
      return {ok:true,reason:'settled',status:chosen.status};
    }).immediate();
    if(result.ok)flushEffects(reference);
    return result;
  }

  const owns=(reference,token)=>!closed&&canRun()&&!!db.prepare('SELECT 1 FROM course_payment_reconciliation WHERE order_reference=? AND lease_token=? AND lease_until_ms>?').get(reference,token,now());
  async function reconcile(reference){
    const initial=orderFor(reference);if(closed||!canRun()||!cashOrder(initial))return {ok:false,reason:'not_eligible'};
    const token=randomUUID(),stamp=now();
    const claim=db.transaction(()=>{
      db.prepare('INSERT OR IGNORE INTO course_payment_reconciliation(order_reference,next_attempt_ms) VALUES(?,?)').run(reference,stamp);
      return db.prepare(`UPDATE course_payment_reconciliation SET lease_token=?,lease_until_ms=?,attempt_count=attempt_count+1
        WHERE order_reference=? AND lease_until_ms<=? AND next_attempt_ms<=?`).run(token,stamp+2*MINUTE,reference,stamp,stamp).changes;
    }).immediate();
    if(!claim)return {ok:false,reason:'not_due'};
    let reason='payment_not_found';
    try{
      const known=paymentId(initial.mp_payment_id);let ids=[];
      if(known&&PROTECTED.has(initial.status))ids=[known];
      else{
        const query=new URLSearchParams({external_reference:reference,sort:'date_last_updated',criteria:'desc',limit:'10'});
        const search=await request('/v1/payments/search?'+query);
        if(!Array.isArray(search?.results))throw Error('provider_unavailable');
        ids=search.results.filter(item=>item.external_reference===reference&&paymentId(item.id))
          .sort((a,b)=>Number(b.status==='approved')-Number(a.status==='approved')).map(item=>paymentId(item.id));
        if(known)ids.push(known);
      }
      for(const id of [...new Set(ids)].slice(0,3)){
        if(!owns(reference,token))return {ok:false,reason:'lease_lost'};
        const payment=await request('/v1/payments/'+id);
        if(!owns(reference,token))return {ok:false,reason:'lease_lost'};
        const result=paymentId(payment?.id)===id?settle(reference,payment):{ok:false,reason:'payment_mismatch'};
        if(result.reason==='settled'||reason!=='settled')reason=result.reason;
      }
    }catch{reason='provider_unavailable';}
    finally{
      const state=db.prepare('SELECT attempt_count FROM course_payment_reconciliation WHERE order_reference=? AND lease_token=?').get(reference,token);
      if(state){
        const paid=PROTECTED.has(orderFor(reference)?.status),delay=paid?6*60*MINUTE:Math.min(360,2**Math.min(state.attempt_count,9))*MINUTE;
        db.prepare('UPDATE course_payment_reconciliation SET next_attempt_ms=?,last_checked_ms=?,last_result=?,lease_until_ms=0,lease_token=\'\' WHERE order_reference=? AND lease_token=?')
          .run(now()+delay,now(),reason,reference,token);
      }
    }
    return {ok:!['provider_unavailable','payment_mismatch'].includes(reason),reason,status:orderFor(reference)?.status};
  }

  async function sweep(){
    if(running||closed||!canRun())return {checked:0,reason:'paused_or_running'};
    running=true;let checked=0;
    try{
      for(const row of db.prepare('SELECT order_reference FROM course_payment_effects WHERE applied_ms IS NULL AND next_attempt_ms<=? ORDER BY next_attempt_ms LIMIT 5').all(now()))flushEffects(row.order_reference);
      const cutoff=new Date(now()-7*DAY).toISOString();
      db.prepare(`INSERT OR IGNORE INTO course_payment_reconciliation(order_reference,next_attempt_ms)
        SELECT reference,? FROM course_orders WHERE reference GLOB 'course_*' AND reference NOT GLOB 'course_coin_*'
        AND COALESCE(mp_preference_id,'')!='' AND datetime(created_at)>=datetime(?)
        AND status IN ('created','pending','authorized','in_process','approved','in_mediation','rejected','cancelled','failed')
        ORDER BY created_at DESC LIMIT 100`).run(now(),cutoff);
      const rows=db.prepare(`SELECT r.order_reference FROM course_payment_reconciliation r JOIN course_orders o ON o.reference=r.order_reference
        WHERE r.next_attempt_ms<=? AND r.lease_until_ms<=? AND datetime(o.created_at)>=datetime(?)
        AND o.status NOT IN ('refunded','charged_back') ORDER BY r.next_attempt_ms,o.created_at LIMIT 2`).all(now(),now(),cutoff);
      for(const row of rows){if(closed||!canRun())break;await reconcile(row.order_reference);checked++;}
      return {checked};
    }finally{running=false;}
  }
  let timer=null,startup=null;
  if(schedule){const run=()=>{sweep().catch(()=>{});};startup=setTimeout(run,20000);startup.unref?.();timer=setInterval(run,2*MINUTE);timer.unref?.();}
  return {settle,reconcile,sweep,flushEffects,close(){closed=true;clearTimeout(startup);clearInterval(timer);}};
}
