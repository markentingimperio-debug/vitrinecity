#!/usr/bin/env python3
"""Guarded reconciliation for the inventoried VPS. Staging only, never deploy.

Keep the installed local-first engine byte-for-byte except for the reviewed
conversation-deletion function and its export. Prove equivalence to the pinned
PR engine using only the six reviewed comment/message-text differences.
Run with the verified prepare-chat-update-v2.py beside this file.
"""
from __future__ import annotations
import hashlib
import importlib.util
from pathlib import Path
import stat
import sys

PREPARER_BLOB = '0de57860ccf14f950873312f8d8decbbb09ae547'
BASE_BLOB = 'b4a5d4c777bc9fe04ab5ff446c13e98f41ff022c'
ACTIVE_SHA256 = 'c60e7af4022f66b90f96a5ebff8812aa1a9f88ad88fcccdc728b5e9245799eb5'
TARGET_BLOB = 'a0e75a8eac969439206b297ca66422be4db29ce1'
LOCAL_TEST_BLOB = 'd5e741b2e49ec2becbf245eda554a56b172754ca'
LOCAL_TEST_SOURCE = 'ops/lia-preserve-kling/test.mjs'
LOCAL_TEST_DEST = 'app/scripts/test-lia-preserve-kling.mjs'
ANCHOR = '  function messageAttachments(scope,id){'
OLD_EXPORT = '  return {status,list,conversation,submit,cancel,'
NEW_EXPORT = '  return {status,list,conversation,deleteConversation,submit,cancel,'
DELETE_FUNCTION = '''  function deleteConversation(scope,id){
    reap();const conversation=conversationRow(scope,id);
    const pending=db.prepare("SELECT id,status FROM neural_chat_requests WHERE scope=? AND conversation_id=? AND status IN ('awaiting_confirmation','queued','running','interrupted') ORDER BY created_at LIMIT 1").get(scope,id);
    const operationsTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lia_chat_operations'").get();
    const pendingOperation=operationsTable?db.prepare("SELECT id,status FROM lia_chat_operations WHERE conversation_id=? AND status IN ('created','reserved') LIMIT 1").get(id):null;
    if(pending||pendingOperation)throw chatError('chat_delete_blocked',409);
    const attachmentIds=db.prepare(`SELECT DISTINCT a.attachment_id id FROM neural_chat_message_attachments a
      JOIN neural_chat_messages m ON m.id=a.message_id WHERE m.conversation_id=?`).all(id).map(row=>row.id);
    const result=db.transaction(()=>{
      db.prepare('DELETE FROM neural_chat_message_attachments WHERE message_id IN (SELECT id FROM neural_chat_messages WHERE conversation_id=?)').run(id);
      db.prepare('DELETE FROM neural_chat_messages WHERE conversation_id=?').run(id);
      const removed=db.prepare('DELETE FROM neural_chat_conversations WHERE id=? AND scope=?').run(id,scope).changes===1;
      for(const attachmentId of attachmentIds){
        const stillUsed=db.prepare('SELECT 1 FROM neural_chat_message_attachments WHERE attachment_id=? LIMIT 1').get(attachmentId);
        if(!stillUsed)db.prepare('DELETE FROM neural_chat_attachments WHERE id=? AND scope=?').run(attachmentId,scope);
      }
      return removed;
    }).immediate();
    if(!result)throw chatError('chat_not_found',404);
    return {id:conversation.id,deleted:true};
  }
'''
# Comparison-only mappings: these changes are NOT made to the staged engine.
REVIEWED_TEXT_DIFFERENCES = (
    ('  // LIA_PRESERVE_KLING_V1\n',
     '  // LIA_PRESERVE_KLING_V1 — ADMIN usa local-first; DeepSeek/Kling permanecem existentes e pagos somente após confirmação.\n'),
    (' Quando nao tiver informacao suficiente para responder, comece a resposta exatamente com [LIA_PRECISA_API] e explique a limitacao. Isso somente solicita um orcamento, nao autoriza chamada paga.',
     ' Quando não tiver informação suficiente para responder, comece exatamente com [LIA_PRECISA_API] e explique a limitação. Isso solicita apenas um orçamento; não autoriza chamada paga.'),
    ('      // A confirmed response can offer a quote, never start paid inference.\n', ''),
    ('        // New request ID and stable idempotency key: never reuse local dispatch.\n', ''),
    ('O modelo local nao concluiu o pedido. Abaixo foi preparado um novo orcamento para a API de texto ja configurada. Confira e confirme o valor antes de continuar; nenhuma API paga foi chamada.',
     'O modelo local não concluiu o pedido. Foi preparado um novo orçamento para a API de texto já configurada. Confira e confirme o valor antes de continuar; nenhuma API paga foi chamada.'),
    ('    }catch{/* Fail closed: original history remains, no paid POST or retry. */}',
     '    }catch{/* Fail closed: histórico original permanece e nenhuma API é chamada automaticamente. */}'),
)

class Refused(RuntimeError):
    """Only fixed, non-sensitive error messages."""

def blob(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise Refused('Trecho revisado ausente ou repetido; reconciliacao recusada.')
    return text.replace(old, new, 1)

def reconcile_content(active: bytes, target: bytes) -> bytes:
    """Pure transformation; caller must validate both inputs' pinned hashes."""
    original = active.decode('utf-8')
    if 'function deleteConversation(' in original:
        raise Refused('Exclusao ja presente; nenhuma substituicao realizada.')
    candidate = once(original, ANCHOR, DELETE_FUNCTION + ANCHOR)
    candidate = once(candidate, OLD_EXPORT, NEW_EXPORT)
    projection = candidate
    for before, after in REVIEWED_TEXT_DIFFERENCES:
        projection = once(projection, before, after)
    if projection.encode('utf-8') != target:
        raise Refused('Ha diferencas alem da exclusao e dos textos revisados. Nenhuma versao foi escolhida automaticamente.')
    restored = once(candidate, DELETE_FUNCTION, '')
    restored = once(restored, NEW_EXPORT, OLD_EXPORT)
    if restored.encode('utf-8') != active:
        raise Refused('A preservacao integral do motor instalado nao foi comprovada.')
    return candidate.encode('utf-8')

def resolve_engine(active: bytes, base: bytes, target: bytes) -> bytes:
    if (hashlib.sha256(active).hexdigest() != ACTIVE_SHA256 or
            blob(base) != BASE_BLOB or blob(target) != TARGET_BLOB):
        raise Refused('Uma versao do motor mudou; reconciliacao interrompida.')
    return reconcile_content(active, target)

def load_preparer():
    path = Path(__file__).resolve().with_name('prepare-chat-update-v2.py')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
        raise Refused('Preparador auxiliar invalido.')
    if blob(path.read_bytes()) != PREPARER_BLOB:
        raise Refused('Preparador auxiliar diferente da versao revisada.')
    spec = importlib.util.spec_from_file_location('lia_stage_v2_pinned', path)
    if spec is None or spec.loader is None:
        raise Refused('Nao foi possivel carregar o preparador verificado.')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def configure(stage):
    original_merge = stage.merge_bytes
    original_download = stage.source_file
    original_write = stage.write
    resolutions = []
    stage.TESTS = stage.TESTS + (LOCAL_TEST_DEST,)
    stage.ALLOWED.update({LOCAL_TEST_SOURCE, LOCAL_TEST_DEST})

    def merge(active, base, target, work):
        if active is not None and hashlib.sha256(active).hexdigest() == ACTIVE_SHA256:
            try:
                result = resolve_engine(active, base, target)
            except (Refused, UnicodeError) as error:
                raise stage.Stop(str(error) if isinstance(error, Refused) else 'Codificacao do motor invalida.') from None
            resolutions.append({'path': 'app/vitriny-neural/chat-engine.js',
                'method': 'reviewed_delete_only', 'existingEnginePreserved': True,
                'candidateSha256': hashlib.sha256(result).hexdigest()})
            print('Motor reconciliado em copia: local-first preservado; somente exclusao e exportacao adicionadas.', flush=True)
            return result, True
        return original_merge(active, base, target, work)

    def download(rev, path, *, absent=False):
        if path == LOCAL_TEST_DEST:
            if rev != stage.SOURCE or absent:
                raise stage.Stop('Origem do teste local-first nao permitida.')
            data = original_download(rev, LOCAL_TEST_SOURCE)
            if blob(data) != LOCAL_TEST_BLOB:
                raise stage.Stop('Teste local-first diferente da versao revisada.')
            return data
        return original_download(rev, path, absent=absent)

    def write(path, data):
        if path.name == 'report.json':
            report = stage.json.loads(data)
            report['reconciliation'] = resolutions
            report['localFirstRegressionSuiteIncluded'] = True
            original_write(path.parent / 'reconciliation-v3.json',
                           stage.json.dumps(report, ensure_ascii=False, indent=2).encode())
        return original_write(path, data)

    stage.merge_bytes, stage.source_file, stage.write = merge, download, write
    return stage

def main() -> int:
    return configure(load_preparer()).main()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('PARADO: ' + (str(error) if isinstance(error, Refused) else
              'Preparacao interrompida; detalhes privados omitidos. Nenhum deploy solicitado.'), file=sys.stderr)
        sys.exit(1)
