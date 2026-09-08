import {createHash} from 'node:crypto';
const VERSION='communications-2026-09-08';
function contactDigest(user,channel){const contact=channel==='email'?String(user.email||'').trim().toLowerCase():String(user.whatsapp||'').replace(/\D/g,'');return contact?createHash('sha256').update(`${channel}:${contact}`).digest('hex'):'';}
export function setupCampaignPreferences(app,{db,requireUser,sameOriginOnly,recordConsent}){
  function read(user){const result={email:false,whatsapp:false};for(const channel of Object.keys(result)){
    const row=db.prepare('SELECT granted,evidence_json FROM consent_records WHERE subject_user_id=? AND purpose=? ORDER BY id DESC LIMIT 1').get(user.id,`marketing_${channel}`);
    try{result[channel]=Boolean(row?.granted)&&Boolean(contactDigest(user,channel))&&JSON.parse(row.evidence_json).contactDigest===contactDigest(user,channel);}catch{}
  }return result;}
  function record(req,user,values={},source='communication_preferences'){
    const consent={email:values.email===true,whatsapp:values.whatsapp===true&&String(user.whatsapp||'').replace(/\D/g,'').length>=10};
    db.transaction(()=>{
      for(const channel of Object.keys(consent))recordConsent(req,{userId:user.id,email:user.email,purpose:`marketing_${channel}`,version:VERSION,granted:consent[channel],source,evidence:{channel,contactDigest:contactDigest(user,channel)}});
      recordConsent(req,{userId:user.id,email:user.email,purpose:'marketing_communications',version:VERSION,granted:consent.email||consent.whatsapp,source,evidence:{channels:consent}});
      // A revocation also excludes existing lead campaigns. Opt-in does not create a send job.
      if(!consent.email&&!consent.whatsapp)db.prepare('UPDATE leads SET consent=0 WHERE email=?').run(String(user.email||'').toLowerCase());
    })();return consent;
  }
  app.get('/api/privacy/communications',requireUser,(req,res)=>res.set('Cache-Control','private,no-store').json({preferences:read(req.user),hasWhatsapp:String(req.user.whatsapp||'').replace(/\D/g,'').length>=10}));
  app.put('/api/privacy/communications',sameOriginOnly,requireUser,(req,res)=>{
    if(typeof req.body?.email!=='boolean'||typeof req.body?.whatsapp!=='boolean')return res.status(400).json({error:'Escolha os canais que deseja autorizar.'});
    if(req.body.whatsapp&&String(req.user.whatsapp||'').replace(/\D/g,'').length<10)return res.status(400).json({error:'Cadastre um WhatsApp válido na sua conta antes de autorizar esse canal.'});
    return res.set('Cache-Control','private,no-store').json({ok:true,preferences:record(req,req.user,req.body)});
  });
  return {read,record};
}
