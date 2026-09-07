import {randomUUID} from 'node:crypto';

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

export function createVitrinyNeuralMemoryStore(){
  const events=new Map(),dedupe=new Map(),signals=[],lessons=new Map(),audit=[],meta=new Map();
  let signalId=0;

  function init({version,nodeId}){meta.set('schema_version',String(version));meta.set('active_node',String(nodeId||'memory'));}
  function log(kind,subjectId='',actor='',details={},at=new Date().toISOString()){audit.push({id:randomUUID(),kind,subjectId,actor,details:clone(details),createdAt:at});}

  function enqueueEvent(event){
    if(event.dedupeKey&&dedupe.has(event.dedupeKey)){
      const id=dedupe.get(event.dedupeKey),existing=events.get(id);
      return{accepted:false,duplicate:true,id,status:existing?.status||null};
    }
    if(events.has(event.id))return{accepted:false,duplicate:true,id:event.id,status:events.get(event.id)?.status||null};
    events.set(event.id,{...clone(event),status:'pending',attemptCount:0,leaseOwner:'',leaseUntil:0,outcome:null,errorMessage:'',processedAt:null});
    if(event.dedupeKey)dedupe.set(event.dedupeKey,event.id);
    log('event_ingested',event.id,event.source,{type:event.type,priority:event.priority},event.receivedAt);
    return{accepted:true,duplicate:false,id:event.id,status:'pending'};
  }

  function claimEvents({workerId,limit=25,leaseMs=60000,now}){
    const n=Math.max(1,Math.min(200,Number(limit)||25)),clock=Number(now),leaseUntil=clock+Math.max(5000,Math.min(600000,Number(leaseMs)||60000));
    for(const row of events.values())if(row.status==='processing'&&row.leaseUntil>0&&row.leaseUntil<=clock){row.status='pending';row.leaseOwner='';row.leaseUntil=0;}
    const rows=[...events.values()].filter(x=>x.status==='pending').sort((a,b)=>(b.priority-a.priority)||String(a.receivedAt).localeCompare(String(b.receivedAt))||a.id.localeCompare(b.id)).slice(0,n);
    return rows.map(row=>{row.status='processing';row.leaseOwner=workerId;row.leaseUntil=leaseUntil;row.attemptCount++;return{id:row.id,type:row.type,source:row.source,entityType:row.entityType,entityId:row.entityId,payload:clone(row.payload),priority:row.priority,occurredAt:row.occurredAt,receivedAt:row.receivedAt,attemptCount:row.attemptCount};});
  }

  function ackEvent({id,workerId,outcome,at}){const row=events.get(id);if(!row||row.status!=='processing'||row.leaseOwner!==workerId)return{ok:false};row.status='processed';row.outcome=clone(outcome);row.errorMessage='';row.processedAt=at;row.leaseOwner='';row.leaseUntil=0;log('event_processed',id,workerId,{},at);return{ok:true};}
  function failEvent({id,workerId,error,at}){const row=events.get(id);if(!row||row.status!=='processing'||row.leaseOwner!==workerId)return{ok:false,terminal:false};const terminal=row.attemptCount>=5;row.status=terminal?'dead_letter':'pending';row.errorMessage=String(error||'worker_failed').slice(0,500);row.processedAt=terminal?at:null;row.leaseOwner='';row.leaseUntil=0;log(terminal?'event_dead_letter':'event_failed',id,workerId,{error:row.errorMessage},at);return{ok:true,terminal};}
  function recordSignal(signal){const id=++signalId;signals.push({id,...clone(signal)});return{id};}
  function addLesson(lesson){lessons.set(lesson.id,{...clone(lesson)});log('lesson_created',lesson.id,lesson.nodeId,{domain:lesson.domain,status:lesson.status,confidence:lesson.confidence},lesson.createdAt);return clone(lesson);}
  function transitionLesson({id,status,actor,reason='',at}){const row=lessons.get(id);if(!row)return null;row.status=status;row.reviewActor=actor;row.reviewReason=reason;row.updatedAt=at;log('lesson_'+status,id,actor,{reason},at);return clone(row);}
  function status({now}){
    const countBy=(rows,key)=>Object.entries(rows.reduce((a,row)=>(a[row[key]]=(a[row[key]]||0)+1,a),{})).map(([status,total])=>({status,total}));
    const signalLast=signals.at(-1)?.createdAt||null;
    return{driver:'memory',portable:true,queue:countBy([...events.values()],'status'),lessons:countBy([...lessons.values()],'status'),signals:{total:signals.length,lastAt:signalLast},deadLetters:[...events.values()].filter(x=>x.status==='dead_letter').length,now:new Date(Number(now)).toISOString(),migrationTargets:['sqlite','postgresql','redis-streams','kafka']};
  }
  function inspect(){return{events:[...events.values()].map(clone),signals:signals.map(clone),lessons:[...lessons.values()].map(clone),audit:audit.map(clone),meta:Object.fromEntries(meta)};}

  return{init,enqueueEvent,claimEvents,ackEvent,failEvent,recordSignal,addLesson,transitionLesson,status,inspect};
}
