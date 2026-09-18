import importlib.util
from pathlib import Path
from contextlib import closing
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stage', Path(__file__).with_name('prepare-chat-update-v2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def test_expected_scope(self):
        self.assertEqual(len(m.PAYLOAD), 7)
        self.assertEqual(len(m.GUARDS), 5)
        self.assertIn('app/public/neural-workspace.html', m.PAYLOAD)
        self.assertNotIn('app/Dockerfile', m.PAYLOAD)
        self.assertEqual(m.EXPECTED['app/vitriny-neural/lia-chat-operations.js'], None)
    def test_write_permissions_no_overwrite(self):
        p = self.root / 'a' / 'b'
        m.write(p, b'private')
        self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            m.write(p, b'changed')
        self.assertEqual(p.read_bytes(), b'private')
    def test_reject_symlink(self):
        p = self.root / 'real'; p.write_bytes(b'a')
        q = self.root / 'link'; q.symlink_to(p)
        with self.assertRaises(m.Stop):
            m.regular(q)
    def test_reject_large_file(self):
        p = self.root / 'file'; p.write_bytes(b'ab')
        with self.assertRaises(m.Stop):
            m.regular(p, 1)
    def test_merge_unchanged_base(self):
        merged, clean = m.merge_bytes(b'old\n', b'old\n', b'new\n', self.root)
        self.assertTrue(clean); self.assertEqual(merged, b'new\n')
    def test_merge_identical_change(self):
        merged, clean = m.merge_bytes(b'new\n', b'old\n', b'new\n', self.root)
        self.assertTrue(clean); self.assertEqual(merged, b'new\n')
    def test_merge_preserves_local_html(self):
        base = b'<html>\n<title>old</title>\n' + b'<p>keep</p>\n' * 20 + b'<input old>\n</html>\n'
        active = base.replace(b'<title>old</title>', b'<title>production</title>')
        target = base.replace(b'<input old>', b'<input new>')
        merged, clean = m.merge_bytes(active, base, target, self.root)
        self.assertTrue(clean)
        self.assertIn(b'<title>production</title>', merged)
        self.assertIn(b'<input new>', merged)
    def test_merge_conflict_is_not_approved(self):
        merged, clean = m.merge_bytes(b'local\n', b'base\n', b'remote\n', self.root)
        self.assertFalse(clean); self.assertIn(b'<<<<<<<', merged)
    def test_new_file(self):
        merged, clean = m.merge_bytes(None, None, b'new', self.root)
        self.assertTrue(clean); self.assertEqual(merged, b'new')
    def test_new_file_collision(self):
        _, clean = m.merge_bytes(b'local', None, b'new', self.root)
        self.assertFalse(clean)
    def test_local_deletion(self):
        _, clean = m.merge_bytes(None, b'old', b'new', self.root)
        self.assertFalse(clean)
    def test_no_remote_change_preserves_local(self):
        merged, clean = m.merge_bytes(b'local', b'base', b'base', self.root)
        self.assertTrue(clean); self.assertEqual(merged, b'local')
    def test_download_rejects_other_ref_and_path(self):
        with patch.object(m.urllib.request, 'build_opener') as mocked:
            for rev, path in [('main', m.PAYLOAD[0]), (m.SOURCE, '.env'), (m.BASE, '../secret')]:
                with self.assertRaises(m.Stop):
                    m.source_file(rev, path)
            mocked.assert_not_called()
    def test_reject_redirect(self):
        with self.assertRaises(m.Stop):
            m.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://example.test')
    def test_live_sqlite_backup_with_wal(self):
        src = self.root / 'live.db'; dst = self.root / 'backup.db'
        con = sqlite3.connect(src)
        try:
            con.execute('PRAGMA journal_mode=WAL')
            con.execute('CREATE TABLE x(id INTEGER PRIMARY KEY, value TEXT)')
            con.execute('INSERT INTO x(value) VALUES (?)', ('preserve',)); con.commit()
            before = src.read_bytes()
            result = m.backup_database(src, dst)
            self.assertEqual(result['quickCheck'], 'ok')
            self.assertEqual(dst.stat().st_mode & 0o777, 0o600)
            with closing(sqlite3.connect(dst)) as check:
                self.assertEqual(check.execute('SELECT value FROM x').fetchone(), ('preserve',))
            self.assertEqual(con.execute('SELECT value FROM x').fetchone(), ('preserve',))
            self.assertEqual(src.read_bytes(), before)
        finally:
            con.close()
    def test_backup_refuses_existing_destination(self):
        src = self.root / 'live.db'; dst = self.root / 'backup.db'
        with closing(sqlite3.connect(src)) as db:
            db.execute('CREATE TABLE x(a)')
        dst.write_bytes(b'previous backup')
        with self.assertRaises(m.Stop):
            m.backup_database(src, dst)
        self.assertEqual(dst.read_bytes(), b'previous backup')
    def test_test_container_is_isolated(self):
        with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as mock:
            result = m.isolated_tests(self.root, m.PAYLOAD + m.GUARDS + m.TESTS)
        self.assertEqual(result, 'passed')
        cmd = mock.call_args.args[0]
        for value in ('--read-only', '--cap-drop', '--no-healthcheck', '--memory', '512m', '--cpus', '0.5'):
            self.assertIn(value, cmd)
        self.assertEqual(cmd[cmd.index('--network') + 1], 'none')
        self.assertNotIn('--env-file', cmd)
        self.assertNotIn('--volumes-from', cmd)
        self.assertIn('-i', cmd)
        for item in cmd:
            self.assertNotIn('source=/opt', item)
            self.assertNotIn('vitrinecity_vitrinecity_data', item)
    def test_does_not_apply_production_changes(self):
        text = Path(m.__file__).read_text()
        for bad in ("'restart'", "'compose', 'up'", "'pull', 'main'", "'checkout'", "'reset'", "'commit'", "'tag'"):
            self.assertNotIn(bad, text)
        self.assertIn("'productionChanged': False", text)
        self.assertIn("'publishApproved': False", text)

if __name__ == '__main__':
    unittest.main(verbosity=2)
