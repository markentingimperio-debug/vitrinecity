"""Offline unit tests of reconciliation; NOT production/app regression tests."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('resolver', HERE / 'resolve-chat-engine-v3.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def fixture():
    active = ('// synthetic engine fixture\n' +
              '\n'.join(old for old, _ in m.REVIEWED_TEXT_DIFFERENCES) + '\n' +
              m.ANCHOR + 'return []; }\n' + m.OLD_EXPORT + 'close};\n').encode()
    candidate = active.decode().replace(m.ANCHOR, m.DELETE_FUNCTION + m.ANCHOR)
    candidate = candidate.replace(m.OLD_EXPORT, m.NEW_EXPORT)
    target = candidate
    for old, new in m.REVIEWED_TEXT_DIFFERENCES:
        target = target.replace(old, new, 1)
    return active, target.encode(), candidate.encode()

class ReconciliationTests(unittest.TestCase):
    def test_only_deletion_and_export_are_added(self):
        active, target, expected = fixture()
        result = m.reconcile_content(active, target)
        self.assertEqual(result, expected)
        restored = result.decode().replace(m.DELETE_FUNCTION, '').replace(m.NEW_EXPORT, m.OLD_EXPORT)
        self.assertEqual(restored.encode(), active)

    def test_original_messages_and_comments_preserved(self):
        active, target, _ = fixture()
        result = m.reconcile_content(active, target).decode()
        for old, _ in m.REVIEWED_TEXT_DIFFERENCES:
            self.assertIn(old, result)
        self.assertNotEqual(result.encode(), target)

    def test_unreviewed_target_difference_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a, t + b'// not reviewed\n')

    def test_missing_anchor_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a.replace(m.ANCHOR.encode(), b'changed'), t)

    def test_duplicate_anchor_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a + m.ANCHOR.encode(), t)

    def test_missing_export_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a.replace(m.OLD_EXPORT.encode(), b'changed'), t)

    def test_duplicate_export_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a + m.OLD_EXPORT.encode(), t)

    def test_existing_deletion_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a + b'function deleteConversation(', t)

    def test_missing_reviewed_text_rejected(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.reconcile_content(a.replace(m.REVIEWED_TEXT_DIFFERENCES[1][0].encode(), b'changed'), t)

    def test_actual_pin_rejects_unknown_active(self):
        a, t, _ = fixture()
        with self.assertRaises(m.Refused):
            m.resolve_engine(a, b'base', t)

    def test_all_three_hash_guards(self):
        a, t, expected = fixture()
        base = b'base'
        with patch.object(m, 'ACTIVE_SHA256', hashlib.sha256(a).hexdigest()), \
             patch.object(m, 'BASE_BLOB', m.blob(base)), patch.object(m, 'TARGET_BLOB', m.blob(t)):
            self.assertEqual(m.resolve_engine(a, base, t), expected)
            for args in ((a+b'x',base,t),(a,base+b'x',t),(a,base,t+b'x')):
                with self.subTest(args=[len(v) for v in args]), self.assertRaises(m.Refused):
                    m.resolve_engine(*args)

    def test_deletion_guards_remain_in_function(self):
        for text in ("conversationRow(scope,id)", "'interrupted'", "'reserved'", "chat_delete_blocked",
                     "id=? AND scope=?", "stillUsed", ").immediate()"):
            self.assertIn(text, m.DELETE_FUNCTION)

    def test_blob_matches_git(self):
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fixture';p.write_bytes(b'abc\n')
            expected=subprocess.check_output(['git','hash-object',str(p)],text=True).strip()
            self.assertEqual(m.blob(p.read_bytes()), expected)

    def test_verified_preparer_loads_without_running_main(self):
        stage=m.load_preparer()
        self.assertEqual(stage.SOURCE,'67b48e632ae6e0ca7776cb27a924fd6eb12a60c0')
        self.assertEqual(stage.EXPECTED['app/vitriny-neural/chat-engine.js'],m.ACTIVE_SHA256)

    def test_changed_preparer_is_refused(self):
        with patch.object(m, 'PREPARER_BLOB', '0'*40), self.assertRaises(m.Refused):
            m.load_preparer()

    def test_other_files_still_use_three_way_merge(self):
        stage=m.configure(m.load_preparer())
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(stage.merge_bytes(b'base',b'base',b'new',Path(d)),(b'new',True))

    def test_local_first_test_is_included_and_origin_pinned(self):
        stage=m.configure(m.load_preparer())
        self.assertIn(m.LOCAL_TEST_DEST,stage.TESTS)
        self.assertIn(m.LOCAL_TEST_SOURCE,stage.ALLOWED)
        with self.assertRaises(stage.Stop):
            stage.source_file(stage.BASE,m.LOCAL_TEST_DEST)

    def test_unexpected_first_test_content_refused(self):
        stage=m.load_preparer()
        stage.source_file=lambda *a,**k:b'wrong file'
        stage=m.configure(stage)
        with self.assertRaises(stage.Stop):
            stage.source_file(stage.SOURCE,m.LOCAL_TEST_DEST)

if __name__=='__main__':
    unittest.main(verbosity=2)
