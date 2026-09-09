import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {createMetaPhotoApi} from '../meta-photo-api.js';

const hash=value=>createHash('sha256').update(value).digest('hex'),bytes=Buffer.from([255,216,255,217]);
function fixture(t){
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE social_accounts(id INTEGER,user_id INTEGER,page_id TEXT,token_encrypted TEXT,status TEXT);
    INSERT INTO social_accounts VALUES (1,1,'100','CIPHERTEXT_SECRET','connected');`);
  const state={calls:[],identity:'100',grant:{is_valid:true,app_id:'900',scopes:['pages_show_list','pages_read_engagement','pages_manage_posts']},post:{id:'100_701',from:{id:'100'},message:'Receita de bolo com preparo explicado.',is_published:true,permalink_url:'https://www.facebook.com/100/posts/701',attachments:{data:[{target:{id:'700'},type:'photo'}]}},sendResult:{id:'700',post_id:'100_701'}};
  const adapter=createMetaPhotoApi({db,accountAllowed:row=>row.user_id===1,decryptToken:()=> 'RAW_TOKEN_SECRET',env:{META_SOCIAL_APP_ID:'900',META_SOCIAL_APP_SECRET:'APP_SECRET',META_SOCIAL_API_VERSION:'v26.0'},fetchImpl:async(url,options)=>{
    state.calls.push({url,options});const u=new URL(url);assert.equal(u.origin,'https://graph.facebook.com');assert.equal(options.redirect,'error');
    if(options.method==='POST'){if(state.sendHook)return state.sendHook();return new Response(JSON.stringify(state.sendResult),{status:200});}
    return new Response(JSON.stringify(u.pathname.endsWith('/debug_token')?{data:state.grant}:u.pathname.endsWith('/me')?{id:state.identity}:state.post),{status:200});
  }});
  return {db,state,adapter,args:{accountId:1,pageId:'100',credentialVersion:hash('CIPHERTEXT_SECRET'),caption:state.post.message,imageBytes:bytes,imageSha256:hash(bytes),isCurrent:()=>true}};
}

test('inspection only reads exact Page grants; no Advanced Access flag blocks own authorized Page',async t=>{
  const f=fixture(t),result=await f.adapter.inspect({accountId:1,pageId:'100'});
  assert.equal(result.ready,true);assert.equal(result.credentialVersion,hash('CIPHERTEXT_SECRET'));assert.equal(f.state.calls.length,2);
  assert(f.state.calls.every(call=>call.options.method==='GET'));assert(!JSON.stringify(result).includes('SECRET'));
  f.state.grant.scopes=['pages_show_list','pages_read_engagement'];assert.deepEqual((await f.adapter.inspect({accountId:1,pageId:'100'})).missing,['pages_manage_posts']);
});
test('expired, mismatched app, granular target and wrong Page identity fail closed',async t=>{
  const f=fixture(t),inspect=()=>f.adapter.inspect({accountId:1,pageId:'100'});
  f.state.grant.app_id='901';assert.equal((await inspect()).ready,false);f.state.grant.app_id='900';
  f.state.grant.expires_at=1;assert.equal((await inspect()).ready,false);delete f.state.grant.expires_at;
  f.state.grant.granular_scopes=[{scope:'pages_manage_posts',target_ids:['999']}];assert.equal((await inspect()).ready,false);delete f.state.grant.granular_scopes;
  f.state.identity='101';assert.equal((await inspect()).ready,false);
});
test('photo uses one multipart POST with approved bytes and plain caption, no public URL',async t=>{
  const f=fixture(t),receipt=await f.adapter.send(f.args);assert.deepEqual(receipt,{photoId:'700',postId:'100_701',uncertain:false});
  const call=f.state.calls[0];assert.equal(new URL(call.url).pathname,'/v26.0/100/photos');
  assert.equal(call.options.body.get('caption'),f.args.caption);assert.equal(call.options.body.get('published'),'true');
  assert.equal(call.options.body.has('url'),false);assert.equal(call.options.body.get('source').type,'image/jpeg');
  assert.deepEqual(Buffer.from(await call.options.body.get('source').arrayBuffer()),bytes);
  assert(!call.url.includes('TOKEN'));assert.equal(call.options.headers.Authorization,'Bearer RAW_TOKEN_SECRET');
});
test('public link variants, markup, invalid bytes, path targets and changed credentials never POST',async t=>{
  const f=fixture(t);
  for(const caption of ['Confira https://example.com','Acesse wa.me/55123 aqui','Veja bit.ly/receita aqui','Conheça loja.com.br agora','O site oferta.dev tem detalhes','<b>Confira esta receita</b>'])await assert.rejects(f.adapter.send({...f.args,caption}));
  await assert.rejects(f.adapter.send({...f.args,pageId:'100/../../evil'}));
  await assert.rejects(f.adapter.send({...f.args,imageBytes:Buffer.from('<svg>')}));
  await assert.rejects(f.adapter.send({...f.args,imageSha256:'wrong'}));
  await assert.rejects(f.adapter.send({...f.args,isCurrent:()=>false}),error=>error.notSubmitted===true);
  f.db.prepare("UPDATE social_accounts SET token_encrypted='NEW_SECRET'").run();await assert.rejects(f.adapter.send(f.args),error=>error.notSubmitted===true);
  assert.equal(f.state.calls.length,0);
});
test('timeouts and 500 are unknown, explicit 400 is definitive, and no retry is performed',async t=>{
  const f=fixture(t);
  f.state.sendHook=()=>{throw Error('RAW_TOKEN_SECRET');};await assert.rejects(f.adapter.send(f.args),error=>error.uncertain===true&&!error.message.includes('SECRET'));
  f.state.sendHook=()=>new Response(JSON.stringify({error:{message:'RAW_TOKEN_SECRET'}}),{status:500});await assert.rejects(f.adapter.send(f.args),error=>error.uncertain===true);
  f.state.sendHook=()=>new Response(JSON.stringify({error:{code:200,message:'RAW_TOKEN_SECRET'}}),{status:400});await assert.rejects(f.adapter.send(f.args),error=>error.definitive===true&&error.code==='meta_permission_denied');
  assert.equal(f.state.calls.length,3);
});
test('unparseable, transient or HTTP-200 provider errors retain an uncertain outcome',async t=>{
  const f=fixture(t);
  for(const [status,body] of [[400,'not JSON'],[400,JSON.stringify({error:{code:2,is_transient:true}})],[400,JSON.stringify({error:{code:200,is_transient:true}})],[200,JSON.stringify({error:{code:100}})],[429,JSON.stringify({error:{code:4}})]]){
    f.state.sendHook=()=>new Response(body,{status});
    await assert.rejects(f.adapter.send(f.args),error=>error.uncertain===true&&error.definitive===false);
  }
  assert.equal(f.state.calls.length,5);
});
test('missing provider IDs stay uncertain; confirmation binds photo, Page, caption and publication',async t=>{
  const f=fixture(t);f.state.sendResult={id:'700'};assert.equal((await f.adapter.send(f.args)).uncertain,true);
  f.state.sendResult={id:'700',post_id:'999_701'};assert.deepEqual(await f.adapter.send(f.args),{photoId:'700',postId:'',uncertain:true});
  const args={accountId:1,pageId:'100',photoId:'700',postId:'100_701',caption:f.args.caption};
  assert.equal((await f.adapter.confirm(args)).published,true);
  f.state.post.is_published=false;assert.equal((await f.adapter.confirm(args)).published,false);f.state.post.is_published=true;
  for(const change of [{from:{id:'999'}},{message:'Another publication'},{attachments:{data:[{type:'photo',target:{id:'999'}}]}},{id:'100_999'}]){
    const before={...f.state.post};Object.assign(f.state.post,change);await assert.rejects(f.adapter.confirm(args));f.state.post=before;
  }
  f.state.post.permalink_url='https://facebook.com.evil.test/token';assert.equal((await f.adapter.confirm(args)).url,'');
  f.state.post.permalink_url='https://www.facebook.com/anything?access_token=RAW_TOKEN_SECRET#APP_SECRET';
  assert.equal((await f.adapter.confirm(args)).url,'https://www.facebook.com/100/posts/701');
});
