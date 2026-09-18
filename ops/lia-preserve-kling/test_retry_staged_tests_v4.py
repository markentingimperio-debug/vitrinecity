"""Focused tests; no Docker, VPS, credentials or paid providers are used."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('retry', HERE/'retry-staged-tests-v4.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def log(failure=None, code='ERR_ASSERTION', operator='match'):
    name=m.FAILURE if failure is None else failure
    return (f'not ok 3 - {name}\n  code: \'{code}\'\n  operator: \'{operator}\'\n'
            f'  error: {m.OLD}\n  actual: {m.LEGACY_TEXT}\n'
            '# tests 55\n# pass 54\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n')

class RetryTests(unittest.TestCase):
    def test_exact_failure_is_recognized(self):
        self.assertTrue(m.summary(log())['legacyTextMismatch'])
    def test_other_failure_is_not_misclassified(self):
        self.assertFalse(m.summary(log('some other test'))['legacyTextMismatch'])
    def test_multiple_failures_refused(self):
        self.assertFalse(m.summary(log()+'not ok 4 - another\n')['legacyTextMismatch'])
    def test_wrong_error_code_refused(self):
        self.assertFalse(m.summary(log(code='ERR_MODULE_NOT_FOUND'))['legacyTextMismatch'])
    def test_wrong_operator_refused(self):
        self.assertFalse(m.summary(log(operator='strictEqual'))['legacyTextMismatch'])
    def test_missing_legacy_text_refused(self):
        self.assertFalse(m.summary(log().replace(m.LEGACY_TEXT,'other message'))['legacyTextMismatch'])
    def test_private_strings_are_not_printed(self):
        data=m.summary(log('sk-'+'x'*40)+'\nsecret=fixture-private-token\n')
        rendered=json.dumps(data)
        self.assertNotIn('fixture-private-token',rendered);self.assertNotIn('sk-',rendered)
        self.assertNotIn('actual',rendered)
    def test_docker_error_is_not_a_pass(self):
        info=m.summary('docker: Error response from daemon. permission denied')
        self.assertFalse(m.approved_test_result('failed',info));self.assertFalse(info['legacyTextMismatch'])
    def test_strict_passing_totals(self):
        text='# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
        self.assertTrue(m.approved_test_result('passed',m.summary(text)))
        self.assertFalse(m.approved_test_result('failed',m.summary(text)))
    def test_skipped_tests_do_not_approve(self):
        text='# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n'
        self.assertFalse(m.approved_test_result('passed',m.summary(text)))
    def test_empty_suite_not_approved(self):
        text='# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
        self.assertFalse(m.approved_test_result('passed',m.summary(text)))
    def test_unknown_test_content_rejected(self):
        with self.assertRaises(m.Refused):m.patch_test(b'unknown')
    def test_patch_changes_only_the_reviewed_regex(self):
        data=('header\nassert.match(message,'+m.OLD+');\nassert.equal(calls,0);\n').encode()
        with patch.dict(m.TEST_SHA256,{'app/scripts/test-vitriny-neural-chat.mjs':m.content_sha256(data)}):
            result=m.patch_test(data)
        self.assertEqual(result.replace(m.NEW.encode(),m.OLD.encode()),data)
        self.assertIn(b'assert.equal(calls,0);',result)
    def test_duplicate_assertion_rejected(self):
        data=(m.OLD+'\n'+m.OLD).encode()
        with patch.dict(m.TEST_SHA256,{'app/scripts/test-vitriny-neural-chat.mjs':m.content_sha256(data)}):
            with self.assertRaises(m.Refused):m.patch_test(data)
    def test_node_assertion_reproduced_and_fixed(self):
        js='''import assert from 'node:assert/strict';
const text=JSON.parse(process.argv[1]);
assert.throws(()=>assert.match(text,/modelo local não concluiu/i),{code:'ERR_ASSERTION'});
assert.match(text,/modelo local n[ãa]o concluiu/i);
assert.match('O modelo local não concluiu o pedido.',/modelo local n[ãa]o concluiu/i);
for(const bad of ['O modelo local concluiu o pedido.','O modelo local xyz concluiu o pedido.'])
 assert.throws(()=>assert.match(bad,/modelo local n[ãa]o concluiu/i),{code:'ERR_ASSERTION'});
'''
        result=subprocess.run(['node','--input-type=module','-e',js,json.dumps(m.LEGACY_TEXT)],capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr.decode())
    def test_preparer_has_expected_content_sha256(self):
        data=(HERE/'prepare-chat-update-v2.py').read_bytes()
        self.assertEqual(m.content_sha256(data),m.HELPER_SHA256)

def integration():
    """CI only: reproduce the exact staged engine and run all four suites before/after."""
    import shutil
    import tempfile
    root=HERE.parents[1]
    app=root/'app'
    if not (app/'node_modules').is_dir():
        raise RuntimeError('Install locked CI dependencies before the integration test.')
    resolver_spec=importlib.util.spec_from_file_location('resolver',HERE/'resolve-chat-engine-v3.py')
    resolver=importlib.util.module_from_spec(resolver_spec);resolver_spec.loader.exec_module(resolver)
    target=(app/'vitriny-neural/chat-engine.js').read_bytes()
    assert resolver.content_sha256(target)==resolver.TARGET_SHA256
    text=target.decode('utf-8')
    anchors={
        2:"      if(localFirstAdmin&&scope.startsWith('admin:')&&error?.code==='chat_response_invalid'&&run.responseReceived&&!controller.signal.aborted)run.offerExistingApi=true;",
        3:'        const offered=prepare(scope,{',
    }
    for i,(before,after) in enumerate(resolver.REVIEWED_TEXT_DIFFERENCES):
        text=resolver.once(text,after,before) if after else resolver.once(text,anchors[i],before+anchors[i])
    engine=text.encode('utf-8')
    assert m.digest(engine)==m.CANDIDATE['app/vitriny-neural/chat-engine.js']
    with tempfile.TemporaryDirectory(prefix='lia-ci-staged-') as directory:
        work=Path(directory)/'app'
        shutil.copytree(app,work,ignore=shutil.ignore_patterns('node_modules','.env','.env.*'))
        (work/'node_modules').symlink_to(app/'node_modules',target_is_directory=True)
        (work/'vitriny-neural/chat-engine.js').write_bytes(engine)
        (work/'scripts/test-lia-preserve-kling.mjs').write_bytes((HERE/'test.mjs').read_bytes())
        for path,expected in m.TEST_SHA256.items():
            data=(work/Path(path).relative_to('app')).read_bytes()
            if path == 'app/scripts/test-vitriny-neural-lia-chat-operations.mjs':
                # The VPS still has the immutable original fixture. Only the CI
                # fixture changes: remove the header and test its absence.
                # Verify its exact SHA-256, without widening any other test pin.
                assert m.content_sha256(data) == 'c2d4053c3949c7f818c495aef0e4b0d9018a18c474a6e87e714618fdf02d86bd'
            else:
                assert m.content_sha256(data)==expected
        command=['node','--test','--test-reporter=tap',*[str(Path(p).relative_to('app')) for p in m.TEST_SHA256]]
        import os
        env={'PATH':os.environ['PATH'],'HOME':directory,'TMPDIR':directory,'DATA_DIR':str(Path(directory)/'data')}
        before=subprocess.run(command,cwd=work,env=env,capture_output=True,text=True,timeout=240)
        info=m.summary(before.stdout+before.stderr)
        assert before.returncode!=0 and info['legacyTextMismatch'],json.dumps(info)
        print('REPRODUCED: the full staged-engine suite fails on the reviewed accent-only assertion.')
        test=work/'scripts/test-vitriny-neural-chat.mjs'
        test.write_bytes(m.patch_test(test.read_bytes()))
        after=subprocess.run(command,cwd=work,env=env,capture_output=True,text=True,timeout=240)
        info=m.summary(after.stdout+after.stderr)
        print(json.dumps(info,indent=2))
        assert m.approved_test_result('passed' if after.returncode==0 else 'failed',info)
        assert m.digest((work/'vitriny-neural/chat-engine.js').read_bytes())==m.CANDIDATE['app/vitriny-neural/chat-engine.js']
        print('PASS: all four suites passed; the exact staged engine remained unchanged.')

if __name__=='__main__':
    import sys
    if sys.argv[1:]==['--integration']:integration()
    else:unittest.main(verbosity=2)
