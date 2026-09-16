#!/usr/bin/env python3
"""Only patch the reviewed chat engine. Paid providers and media remain existing."""
import argparse
import hashlib
from pathlib import Path
EXPECTED_BLOB='b4a5d4c777bc9fe04ab5ff446c13e98f41ff022c'
MARKER='// LIA_PRESERVE_KLING_V1'
RELATIVE='app/vitriny-neural/chat-engine.js'
def blob_sha(data):
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def patch(data):
    source=data.decode('utf-8')
    if MARKER in source: raise ValueError('Atualizacao ja presente. Nenhum arquivo substituido.')
    if blob_sha(data)!=EXPECTED_BLOB: raise ValueError('Versao do chat diferente da revisada. Parei sem substituir arquivos.')
    def once(old,new):
        nonlocal source
        if source.count(old)!=1: raise ValueError('Contrato do chat mudou. Nenhuma alteracao aplicada.')
        source=source.replace(old,new,1)
    once('  const attachments=createChatAttachments({db,now}),active=new Map();',
         '  '+MARKER+"\n  const localFirstAdmin=env.LIA_LOCAL_FIRST_ADMIN==='1';\n  const attachments=createChatAttachments({db,now}),active=new Map();")
    once("Código e conteúdo são rascunhos.'};", "Código e conteúdo são rascunhos.'+(localFirstAdmin&&scope.startsWith('admin:')?' Quando nao tiver informacao suficiente para responder, comece a resposta exatamente com [LIA_PRECISA_API] e explique a limitacao. Isso somente solicita um orcamento, nao autoriza chamada paga.':'')};")
    once("      finish(scope,id,'completed',answer.trim(),lease);", """      if(localFirstAdmin&&scope.startsWith('admin:')&&answer.trim().startsWith('[LIA_PRECISA_API]')){
        run.offerExistingApi=true;
        finish(scope,id,'unavailable','O modelo local informou que precisa de ajuda. Nenhuma API paga foi chamada.',lease);
        return;
      }
      finish(scope,id,'completed',answer.trim(),lease);""")
    once("    }catch{if(mayWrite())finish(scope,id,'failed','Não foi possível concluir esta resposta com segurança. Seu pedido foi preservado. Nenhuma API paga foi consultada.',lease);}", """    }catch(error){
      if(mayWrite())finish(scope,id,'failed','Não foi possível concluir esta resposta com segurança. Seu pedido foi preservado. Nenhuma API paga foi consultada.',lease);
      // A confirmed response can offer a quote, never start paid inference.
      if(localFirstAdmin&&scope.startsWith('admin:')&&error?.code==='chat_response_invalid'&&run.responseReceived&&!controller.signal.aborted)run.offerExistingApi=true;
    }""")
    once('  const prepare=db.transaction((scope,input)=>{','  const prepare=db.transaction((scope,input,{apiFallback=false}={})=>{')
    once("referencedImage?'image_context':!enabled()||!qualified(intent.capability).length?'model':null;", "referencedImage?'image_context':apiFallback||!enabled()||!qualified(intent.capability).length?'model':null;")
    once("const preferPaidText=intent.kind==='text'&&!referencedImage&&paidRuntime?.prefersText===true;", "const preferPaidText=intent.kind==='text'&&!referencedImage&&(apiFallback||paidRuntime?.prefersText===true&&(!localFirstAdmin||!scope.startsWith('admin:')));")
    once('  function kick(){', """  function offerExistingApi(scope,id){
    if(closed||!db.open||!localFirstAdmin||!scope.startsWith('admin:')||!paidRuntime?.enabled)return;
    try{
      db.transaction(()=>{
        const original=row(scope,id);
        if(original.intent_kind!=='text'||!['failed','unavailable'].includes(original.status)||paidRuntime.owns(scope,id))return;
        if(paidRuntime.status(scope)?.capabilities?.chat!==true)return;
        const user=db.prepare('SELECT text FROM neural_chat_messages WHERE id=?').get(original.user_message_id);
        if(!user)return;
        // New request ID and stable idempotency key: never reuse local dispatch.
        const offered=prepare(scope,{
          message:user.text,conversationId:original.conversation_id,
          attachmentIds:messageAttachments(scope,original.user_message_id).map(a=>a.id),
          idempotencyKey:'lia_api_'+id.replace(/-/g,'')
        },{apiFallback:true});
        if(offered.status!=='awaiting_confirmation'||!offered.payment)throw chatError('chat_payment_unavailable',503);
        db.prepare('UPDATE neural_chat_messages SET text=? WHERE id=? AND request_id=?')
          .run('O modelo local nao concluiu o pedido. Abaixo foi preparado um novo orcamento para a API de texto ja configurada. Confira e confirme o valor antes de continuar; nenhuma API paga foi chamada.',original.assistant_message_id,id);
      }).immediate();
    }catch{/* Fail closed: original history remains, no paid POST or retry. */}
  }
  function kick(){""")
    once('try{await run.transport;}catch{}finally{if(active.get(job.id)===run)active.delete(job.id);kick();}', 'try{await run.transport;}catch{}finally{if(active.get(job.id)===run)active.delete(job.id);if(run.offerExistingApi&&!run.controller.signal.aborted)offerExistingApi(job.scope,job.id);kick();}')
    return source.encode('utf-8')
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--root',default='.');ap.add_argument('--output');a=ap.parse_args()
    target=Path(a.root).resolve()/RELATIVE
    (Path(a.output) if a.output else target).write_bytes(patch(target.read_bytes()))
    print('Patch preparado: chat existente; Kling, chaves e cobranca preservados.')
