"""Verify the exact inventoried engine against real repository content in CI.

Run at a revision retaining the pinned PR engine. Does not access a VPS,
credentials, providers, production databases, or the network.
"""
import hashlib
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('resolver', HERE / 'resolve-chat-engine-v3.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def verify(target: bytes) -> str:
    if m.blob(target) != m.TARGET_BLOB:
        raise AssertionError('Repository engine is not the reviewed target.')
    text = target.decode('utf-8')
    text = m.once(text, m.DELETE_FUNCTION, '')
    text = m.once(text, m.NEW_EXPORT, m.OLD_EXPORT)
    comment_anchors = {
        2: "      if(localFirstAdmin&&scope.startsWith('admin:')&&error?.code==='chat_response_invalid'&&run.responseReceived&&!controller.signal.aborted)run.offerExistingApi=true;",
        3: '        const offered=prepare(scope,{',
    }
    for index, (before, after) in enumerate(m.REVIEWED_TEXT_DIFFERENCES):
        if after:
            text = m.once(text, after, before)
        else:
            anchor = comment_anchors[index]
            text = m.once(text, anchor, before + anchor)
    active = text.encode('utf-8')
    if hashlib.sha256(active).hexdigest() != m.ACTIVE_SHA256:
        raise AssertionError('Reconstructed active engine does not match the supplied VPS inventory.')
    result = m.reconcile_content(active, target)
    restored = m.once(result.decode('utf-8'), m.DELETE_FUNCTION, '')
    restored = m.once(restored, m.NEW_EXPORT, m.OLD_EXPORT)
    if restored.encode('utf-8') != active:
        raise AssertionError('Existing engine changed beyond deletion and its export.')
    return hashlib.sha256(result).hexdigest()

if __name__ == '__main__':
    target = (HERE.parents[1] / 'app/vitriny-neural/chat-engine.js').read_bytes()
    digest = verify(target)
    print('PASS: real repository engine reproduces the exact VPS inventory.')
    print('PASS: deletion-only candidate SHA256=' + digest)
