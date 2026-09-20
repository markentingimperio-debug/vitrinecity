#!/usr/bin/env python3
"""Two-file overlay for the deployed v95 engine; never runs Docker or edits Git."""
import hashlib
ENGINE='app/vitriny-neural/chat-engine.js'
MODULE='app/public/neural-reference-media.js'
MANIFEST={'app/vitriny-neural/chat-engine.js': ['8a23ae0be37933ac53703c05dc36e3eadee4987fa7c74ae52ca031f7bef0788f', '2ac4ad026621e6e32230dfaf10453ae521f95bdbc3e07fef0dc4aaef889387ab'], 'app/public/neural-reference-media.js': ['b838281d028ed3e0764098c727de40766d2f4b7e038fd2be1e096d484ab68cf9', '6d7d83ac42573abf19cce96a1eabbd757f7dc872364a9921dcb1dd072e0014c1']}
def digest(data):return hashlib.sha256(data).hexdigest()
def transform(source):
    text=source.decode('utf8')
    replacements=[
      ('const UNAVAILABLE={\n',"const UNAVAILABLE={\n  reference_clarify:'Você quer criar uma imagem ou um vídeo? Especifique um único formato para preparar o orçamento. Nenhuma geração paga foi enviada.',\n  reference_cancelled:'Não iniciei uma geração para este pedido porque ele contém uma instrução para não gerar mídia. Nenhuma geração paga foi enviada.',\n"),
      ("const unavailable=referenceConflict?'reference_conflict':", "const unavailable=intent.referenceHold||(referenceConflict?'reference_conflict':"),
      ("!qualified(intent.capability).length?'model':null;", "!qualified(intent.capability).length?'model':null);"),
      ("if(!missingReference&&!referenceConflict&&paidRuntime?.enabled", "if(!intent.referenceHold&&!missingReference&&!referenceConflict&&paidRuntime?.enabled")]
    for old,new in replacements:
        if text.count(old)!=1:raise ValueError('FLEX_PATCH_ANCHOR_MISMATCH')
        text=text.replace(old,new,1)
    return text.encode('utf8')
def patch(name,source,module=None):
    if name not in MANIFEST or digest(source)!=MANIFEST[name][0]:raise ValueError('FLEX_SOURCE_HASH_MISMATCH')
    result=transform(source) if name==ENGINE else module
    if not isinstance(result,bytes) or digest(result)!=MANIFEST[name][1]:raise ValueError('FLEX_OUTPUT_HASH_MISMATCH')
    return result
