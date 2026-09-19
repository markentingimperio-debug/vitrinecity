#!/usr/bin/env python3
"""Hash-pinned reference-media integration. This builder never accesses Docker."""
import hashlib
from pathlib import Path

MODULE = 'app/public/neural-reference-media.js'
ENGINE = 'app/vitriny-neural/chat-engine.js'
OPERATIONS = 'app/vitriny-neural/lia-chat-operations.js'
# Filled from independently checked source and deterministic output before release.
MANIFEST = {'app/vitriny-neural/chat-engine.js': ['9e1307f3b134e6de70cd652c3c8567da551bbb8665769c013b0898e88ab50426', '8a23ae0be37933ac53703c05dc36e3eadee4987fa7c74ae52ca031f7bef0788f'], 'app/vitriny-neural/lia-chat-operations.js': ['f74d1190347d9cbffbf86870658dda08ff8da83afe368ef6c03bb6132154b07f', '1f5336bf0d98bca8b0363ace4099a2913b1bf0c4b190acaf9f2f55c3def3eb6f']}
MODULE_HASH = 'b838281d028ed3e0764098c727de40766d2f4b7e038fd2be1e096d484ab68cf9'

REFERENCE_LOOKUP = '''  function latestReferenceImages(scope,conversationId){
    if(!conversationId)return [];
    conversationRow(scope,conversationId);
    const last=db.prepare(`SELECT m.id FROM neural_chat_messages m
      JOIN neural_chat_message_attachments ma ON ma.message_id=m.id
      JOIN neural_chat_attachments a ON a.id=ma.attachment_id
      WHERE m.conversation_id=? AND m.role='user' AND a.scope=? AND a.kind='image'
      ORDER BY m.sequence DESC LIMIT 1`).get(conversationId,scope);
    return last?messageAttachments(scope,last.id).filter(a=>a.kind==='image'):[];
  }
'''
OLD_ROUTE = '''    const intent=routeChatIntent(message,{previousKind:previous?.intent_kind});
    const referencedImage=selected.some(a=>a.kind==='image')||(!selected.length&&previous&&messageAttachments(scope,previous.user_message_id).some(a=>a.kind==='image')&&/\\b(essa|esta|imagem|foto|anexo|isso)\\b/.test(normalize(message)));
    const unavailable=intent.kind!=='text'?intent.kind:referencedImage?'image_context':apiFallback||!enabled()||!qualified(intent.capability).length?'model':null;'''
NEW_ROUTE = '''    const intent=routeReferenceMedia(message,routeChatIntent(message,{previousKind:previous?.intent_kind}));
    const reuseReference=requestsImageReference(message);
    const imageReferences=selected.filter(a=>a.kind==='image');
    if(!selected.length&&reuseReference)imageReferences.push(...latestReferenceImages(scope,input.conversationId));
    const referencedImage=imageReferences.length>0;
    const referenceConflict=refusesImageReference(message)&&referencedImage;
    const missingReference=['image','video'].includes(intent.kind)&&reuseReference&&!referencedImage;
    const unavailable=referenceConflict?'reference_conflict':missingReference?'reference_required':intent.kind!=='text'?intent.kind:referencedImage?'image_context':apiFallback||!enabled()||!qualified(intent.capability).length?'model':null;'''

def digest(data):return hashlib.sha256(data).hexdigest()
def once(text,old,new):
    if text.count(old)!=1:raise ValueError('REFERENCE_PATCH_ANCHOR_MISMATCH')
    return text.replace(old,new,1)
def transform(name,source):
    text=source.decode('utf8')
    if name==ENGINE:
        anchor="import {createDurableJobQueue} from './durable-job-queue.js';\n"
        text=once(text,anchor,anchor+"import {routeReferenceMedia,requestsImageReference,refusesImageReference} from '../public/neural-reference-media.js';\n")
        anchor='const UNAVAILABLE={\n'
        text=once(text,anchor,anchor+"  reference_required:'Anexe uma imagem PNG ou JPEG do produto nesta conversa antes de pedir o vídeo ou a imagem com referência. Nenhuma geração paga foi enviada.',\n  reference_conflict:'O pedido diz para não usar a imagem, mas há uma referência anexada. Remova o anexo e envie o pedido novamente. Nenhuma geração paga foi enviada.',\n")
        text=once(text,'  function messageAttachments(scope,id){',REFERENCE_LOOKUP+'  function messageAttachments(scope,id){')
        text=once(text,OLD_ROUTE,NEW_ROUTE)
        text=once(text,"    ids.forEach((id,i)=>db.prepare('INSERT INTO neural_chat_message_attachments(message_id,attachment_id,position) VALUES(?,?,?)').run(messageId,id,i));", "    const linkedIds=[...new Set([...ids,...imageReferences.map(a=>a.id)])];\n    linkedIds.forEach((id,i)=>db.prepare('INSERT INTO neural_chat_message_attachments(message_id,attachment_id,position) VALUES(?,?,?)').run(messageId,id,i));")
        text=once(text,"    if(paidRuntime?.enabled&&(unavailable||preferPaidText)","    if(!missingReference&&!referenceConflict&&paidRuntime?.enabled&&(unavailable||preferPaidText)")
        text=once(text,"      const imageReferences=selected.filter(a=>a.kind==='image');\n      if(!imageReferences.length&&referencedImage&&previous)imageReferences.push(...messageAttachments(scope,previous.user_message_id).filter(a=>a.kind==='image'));\n",'')
    elif name==OPERATIONS:
        anchor="import {atomsFromMicroBRL,coinsFromAtoms} from '../public/vitrine-coins-contract.js';\n"
        text=once(text,anchor,anchor+"import {referenceMediaKind} from '../public/neural-reference-media.js';\n")
        anchor="function classifier(instruction,mime=''){\n"
        text=once(text,anchor,anchor+"  // A new generation with an image belongs to Kling, not the FFmpeg resize worker.\n  if(/^image\\//.test(mime)&&referenceMediaKind(instruction))return {kind:'unsupported',supported:false,needsUpload:false};\n")
    else:raise ValueError('REFERENCE_PATH_NOT_ALLOWED')
    return text.encode('utf8')

def patch(name,source):
    if name not in MANIFEST or digest(source)!=MANIFEST[name][0]:raise ValueError('REFERENCE_SOURCE_HASH_MISMATCH')
    result=transform(name,source)
    if digest(result)!=MANIFEST[name][1]:raise ValueError('REFERENCE_OUTPUT_HASH_MISMATCH')
    return result

def build(source,target,module):
    source=Path(source).resolve();target=Path(target).resolve()
    if source==target or target in source.parents:raise ValueError('ISOLATED_TARGET_REQUIRED')
    if digest(module)!=MODULE_HASH:raise ValueError('REFERENCE_MODULE_HASH_MISMATCH')
    values={name:patch(name,(source/name).read_bytes()) for name in MANIFEST};values[MODULE]=module
    for name,data in values.items():
        p=target/name;p.parent.mkdir(parents=True,exist_ok=True)
        with p.open('xb') as out:out.write(data)
    return values
