import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {createAdminTeachingPilot} from '../vitriny-neural/admin-teaching-pilot.js';
import {teachingPilotConfig,validateTeachingPaths} from './run-admin-teaching-pilot.mjs';

export const DIAGNOSTIC_ID='teaching-openai-connectivity-20260915-v1';
const fail=code=>{throw Object.assign(new Error(code),{code});};

// A NEW, tiny connectivity operation, not a retry of the uncertain reviewer.
// It shares the original private ledger and its persistent R$20 cap. No wallet,
// customer database, refill, background work or automatic retries are involved.
export async function diagnoseOpenAi({args=[],env={},fetchImpl=globalThis.fetch,now=Date.now}={}){
  if(!args.length||args.length===1&&args[0]==='--dry-run')return{mode:'dry-run',modelCalls:0,id:DIAGNOSTIC_ID,maxOutputTokens:64};
  if(![2,3].includes(args.length)||args[0]!=='--execute'||!args[1].startsWith('--ledger=')||args.length===3&&args[2]!=='--profile=plain-text-v1')fail('teaching_args_invalid');
  const profile=args.length===3?'plain-text-v1':null;
  if(typeof env.OPENAI_API_KEY!=='string'||!/^[\x21-\x7e]{1,512}$/.test(env.OPENAI_API_KEY))fail('teaching_provider_keys_missing');
  const ledger=args[1].slice('--ledger='.length);
  const {ledgerPath}=validateTeachingPaths({ledger,report:path.join(path.dirname(ledger),'connectivity.json')},env);
  if(!fs.existsSync(ledgerPath))fail('teaching_ledger_missing');
  const db=new Database(ledgerPath,{fileMustExist:true});
  try{
    const pilot=createAdminTeachingPilot({db,config:{...teachingPilotConfig(),maxOutputTokens:64,...(profile?{openAiRequestProfile:profile}:{})},providerKeys:{openai:env.OPENAI_API_KEY},fetchImpl,now});
    const result=await pilot.executeLesson({id:DIAGNOSTIC_ID+(profile?'-'+profile:''),providerId:'openai',model:'gpt-5.6-luna',role:'reviewer',messages:[{role:'user',content:'Teste administrativo de conectividade. Responda apenas OK.'}]});
    return{mode:'execute',id:result.id,state:result.state,code:result.code,maximumMicroBrl:result.maximumMicroBrl,actualMicroBrl:result.actualMicroBrl,actualMicroUsd:result.actualMicroUsd,receiptId:result.receiptId,httpStatus:result.result?.httpStatus??null,providerError:result.result?.providerError??null,providerRequestId:result.result?.providerRequestId??null,budget:pilot.status()};
  }finally{db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await diagnoseOpenAi({args:process.argv.slice(2),env:process.env});console.log(JSON.stringify(result));if(result.mode==='execute'&&result.state!=='completed')process.exitCode=2;}
  catch(error){console.error(JSON.stringify({state:'failed',code:/^teaching_[a-z_]+$/.test(error.code)?error.code:'teaching_diagnostic_failed'}));process.exitCode=1;}
}
