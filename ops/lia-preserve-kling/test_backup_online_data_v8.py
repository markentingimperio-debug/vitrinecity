"""Real SQLite/filesystem tests. Docker identity responses are simulated, not VPS tests."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('online', HERE / 'backup-online-data-v8.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.work = self.root / 'work'
        self.source.mkdir()
        self.work.mkdir()
        self.db = self.source / 'vitrinecity.db'
        with contextlib.closing(sqlite3.connect(self.db)) as db:
            db.executescript('CREATE TABLE data(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO data(value) VALUES("initial");')
        self.deadline = time.monotonic() + 15

    def tearDown(self):
        self.temp.cleanup()

    def backup(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return m.perform_data_backup(self.source, self.work, self.deadline)

    def old(self):
        return {'Id':m.CID, 'Image':m.IMAGE, 'Config':{'Env':['SECRET=private']}, 'HostConfig':{'RestartPolicy':{'Name':'always'}},
                'Mounts':[{'Destination':'/data','Source':'/root/data'}, {'Destination':'/media','Source':'/root/media'}],
                'State':{'Running':True, 'Health':{'Status':'healthy'}, 'Paused':False,'Restarting':False}}

    def test_complete_backup_real_sqlite_files_and_empty_directory(self):
        (self.source/'uploads').mkdir()
        (self.source/'empty').mkdir()
        (self.source/'uploads'/'small.bin').write_bytes(bytes(range(256)) * 100)
        (self.source/'config.json').write_text('{"value":1}')
        result=self.backup()
        self.assertEqual(result['database']['integrityCheck'],'ok')
        self.assertTrue(result['sourceFilesStableAcrossChecks'])
        self.assertTrue(result['allRegularFilesVerified'])
        self.assertEqual(result['regularFilesVerified'],2)
        self.assertEqual((self.work/'data/uploads/small.bin').read_bytes(),(self.source/'uploads/small.bin').read_bytes())
        self.assertTrue((self.work/'data/empty').is_dir())

    def test_source_database_unchanged(self):
        before=self.db.read_bytes()
        self.backup()
        self.assertEqual(self.db.read_bytes(),before)

    def test_snapshot_includes_committed_wal(self):
        with contextlib.closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0],'wal')
            db.execute('INSERT INTO data(value) VALUES("in-wal")');db.commit()
            self.assertTrue(Path(str(self.db)+'-wal').exists())
            result=self.backup()
            with contextlib.closing(sqlite3.connect(self.work/'data/vitrinecity.db')) as copied:
                self.assertEqual(copied.execute('SELECT value FROM data ORDER BY id').fetchall(),[('initial',),('in-wal',)])
            self.assertFalse((self.work/'data/vitrinecity.db-wal').exists())
            self.assertFalse(result['database']['liveJournalFilesCopied'])

    def test_concurrent_writer_remains_operational(self):
        ready=threading.Event();stop=threading.Event();errors=[];writes=[]
        def writer():
            try:
                with contextlib.closing(sqlite3.connect(self.db,timeout=2)) as db:
                    db.execute('PRAGMA journal_mode=WAL')
                    while not stop.is_set():
                        db.execute('INSERT INTO data(value) VALUES(?)',('x'*1000,));db.commit()
                        writes.append(1);ready.set();time.sleep(.003)
            except Exception as e:errors.append(e);ready.set()
        worker=threading.Thread(target=writer);worker.start()
        try:
            self.assertTrue(ready.wait(3))
            result=m.online_database(self.db,self.work/'snapshot.sqlite')
            count=len(writes);time.sleep(.04)
            self.assertGreater(len(writes),count)
            self.assertEqual(result['integrityCheck'],'ok')
            with contextlib.closing(sqlite3.connect(self.work/'snapshot.sqlite')) as copied:
                self.assertGreater(copied.execute('SELECT COUNT(*) FROM data').fetchone()[0],1)
        finally:stop.set();worker.join(3)
        self.assertFalse(errors)

    def test_does_not_overwrite_existing_backup_file(self):
        destination=self.work/'already.sqlite';destination.write_bytes(b'do not change')
        with self.assertRaises(FileExistsError):m.online_database(self.db,destination)
        self.assertEqual(destination.read_bytes(),b'do not change')

    def test_only_top_level_main_db_sidecars_are_excluded(self):
        (self.source/'nested').mkdir();(self.source/'nested/vitrinecity.db-wal').write_bytes(b'ordinary')
        (self.source/'vitrinecity.db-shm').write_bytes(b'not for copying')
        value=m.inventory(self.source,self.deadline)
        self.assertIn('nested/vitrinecity.db-wal',value['files'])
        self.assertNotIn('vitrinecity.db',value['files'])
        self.assertNotIn('vitrinecity.db-shm',value['files'])

    def test_changed_file_detected_before_copy(self):
        file=self.source/'file';file.write_bytes(b'old')
        expected=m.signature(file.stat());file.write_bytes(b'new bytes')
        with self.assertRaisesRegex(m.Refused,'source_changed_before_copy'):
            m.copy_one(self.source,'file',expected,self.work/'file',self.deadline)

    def test_hash_rechecks_saved_bytes(self):
        file=self.source/'file';file.write_bytes(b'abc')
        with patch.object(m,'hash_stream',return_value='bad'):
            with self.assertRaisesRegex(m.Refused,'copy_hash_mismatch'):
                m.copy_one(self.source,'file',m.signature(file.stat()),self.work/'file',self.deadline)

    def test_source_change_between_inventories_flagged(self):
        (self.source/'file').write_bytes(b'one')
        original=m.inventory;calls=[]
        def changing(*args):
            calls.append(1)
            if len(calls)==2:(self.source/'later').write_bytes(b'new')
            return original(*args)
        with patch.object(m,'inventory',side_effect=changing):result=self.backup()
        self.assertFalse(result['sourceFilesStableAcrossChecks'])

    def test_symlink_file_not_followed(self):
        (self.root/'secret').write_text('must not copy')
        (self.source/'link').symlink_to(self.root/'secret')
        result=self.backup()
        self.assertEqual(result['specialEntriesNotCopied'],1)
        self.assertFalse((self.work/'data/link').exists())

    def test_symlink_directory_not_followed(self):
        (self.root/'outside').mkdir();(self.root/'outside/secret').write_text('private')
        (self.source/'shortcut').symlink_to(self.root/'outside',target_is_directory=True)
        value=m.inventory(self.source,self.deadline)
        self.assertIn('shortcut',value['special']);self.assertFalse(value['files'])
        with self.assertRaises(OSError):m.opened_beneath(self.source,'shortcut/secret')

    def test_symlink_database_refused(self):
        actual=self.root/'real.sqlite';self.db.rename(actual);self.db.symlink_to(actual)
        with self.assertRaises(OSError):m.online_database(self.db,self.work/'copy.sqlite')

    def test_fifo_not_opened(self):
        os.mkfifo(self.source/'pipe')
        self.assertIn('pipe',m.inventory(self.source,self.deadline)['special'])
        with self.assertRaises(m.Refused):m.opened_beneath(self.source,'pipe')

    def test_path_traversal_rejected(self):
        for path in ('../secret','/etc/passwd','sub/../../secret',''):
            with self.subTest(path=path),self.assertRaises(m.Refused):m.opened_beneath(self.source,path)

    def test_zero_byte_and_unicode_files(self):
        (self.source/'arquivo vazio').write_bytes(b'');(self.source/'ação.json').write_bytes(b'{}')
        result=self.backup();self.assertEqual(result['regularFilesVerified'],2)
        self.assertEqual((self.work/'data/arquivo vazio').read_bytes(),b'')

    def test_inventory_limit(self):
        (self.source/'large').write_bytes(b'abcdef')
        with patch.object(m,'MAX_BYTES',3),self.assertRaisesRegex(m.Refused,'inventory_limit'):
            m.inventory(self.source,self.deadline)

    def test_deadline(self):
        with self.assertRaisesRegex(m.Refused,'inventory_deadline'):m.inventory(self.source,0)

    def test_backup_space_guard(self):
        with patch.object(m.shutil,'disk_usage',return_value=type('Disk',(),{'free':0})()):
            with self.assertRaisesRegex(m.Refused,'insufficient_free_space'):self.backup()
        self.assertFalse((self.work/'data').exists())

    def test_mount_order_ignored_without_ignoring_real_change(self):
        old=self.old();current=json.loads(json.dumps(old));current['Mounts'].reverse()
        self.assertTrue(all(m.identity(old,current).values()))
        current['Mounts'][0]['Source']='/other'
        self.assertFalse(m.identity(old,current)['sameMountsIgnoringOrder'])

    def test_identity_checks_configuration_and_health(self):
        old=self.old();current=json.loads(json.dumps(old));current['Config']['Env']=['SECRET=different']
        self.assertFalse(m.identity(old,current)['sameConfiguration'])
        current['State']['Health']['Status']='unhealthy'
        self.assertFalse(m.identity(old,current)['healthy'])

    def test_no_service_lifecycle_or_shell_commands_in_source(self):
        tree=ast.parse((HERE/'backup-online-data-v8.py').read_text())
        commands=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='subprocess']
        self.assertEqual(len(commands),1)
        self.assertEqual(commands[0].func.attr,'run')
        first=commands[0].args[0]
        self.assertEqual([n.value for n in first.elts[:-1]],['docker','inspect','--type=container'])
        self.assertNotIn('shell',[keyword.arg for keyword in commands[0].keywords])

    def test_reports_do_not_print_file_names_or_config_values(self):
        (self.source/'customer-secret-token.txt').write_text('private key')
        with contextlib.redirect_stdout(io.StringIO()) as out:
            result=m.perform_data_backup(self.source,self.work,self.deadline)
        self.assertNotIn('customer-secret-token',out.getvalue()+json.dumps(result))
        self.assertNotIn('private key',out.getvalue()+json.dumps(result))

    def test_new_file_permissions(self):
        with m.new_file(self.work/'private') as file:file.write(b'test')
        self.assertEqual((self.work/'private').stat().st_mode & 0o777,0o600)

    def test_invalid_database_not_approved(self):
        self.db.write_bytes(b'not a sqlite database')
        with self.assertRaises(sqlite3.DatabaseError):m.online_database(self.db,self.work/'bad.sqlite')

    def test_missing_source_file_retains_sqlite_but_marks_partial(self):
        (self.source/'gone').write_text('temporary')
        with patch.object(m,'copy_one',side_effect=FileNotFoundError('secret value')):
            result=self.backup()
        self.assertEqual(result['fileFailures'],1)
        self.assertFalse(result['allRegularFilesVerified'])
        self.assertEqual(result['database']['integrityCheck'],'ok')
        self.assertNotIn('secret value',(self.work/'manifest.private.json').read_text())

    def run_main(self, changed_after=False):
        prior=self.root/'prior';prior.mkdir()
        parent=self.root/'backups';parent.mkdir()
        settings=self.root/'settings';settings.write_text('private-setting')
        os.chmod(settings,0o600)
        info=self.old()
        info['Mounts']=[{'Destination':'/data','Source':str(self.source),'Name':'vitrinecity_vitrinecity_data'}]
        info['State']['StartedAt']='unchanged-start'
        m.write_json(prior/'container-inspect.private.json',info)
        after=json.loads(json.dumps(info))
        if changed_after:after['State']['StartedAt']='new-start'
        with contextlib.ExitStack() as stack:
            for name,value in [('PRIOR',prior),('PARENT',parent),('SOURCE',self.source),('CONFIGS',(settings,)),('LOCK',self.root/'lock')]:
                stack.enter_context(patch.object(m,name,value))
            stack.enter_context(patch.object(m,'checked_directory',return_value=None))
            stack.enter_context(patch.object(m,'inspect_app',side_effect=[info,after]))
            stack.enter_context(patch.object(m.socket,'gethostname',return_value=m.HOST))
            stack.enter_context(patch.object(m.os,'geteuid',return_value=0))
            stack.enter_context(patch.object(m.os,'nice',return_value=0))
            stack.enter_context(patch.object(m.sys,'argv',['script','--backup-online']))
            output=stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            status=m.main()
        backup=list(parent.iterdir())[0]
        report=json.loads((backup/'online-backup-report.json').read_text())
        return status,report,output.getvalue()

    def test_main_success_report_is_not_deploy_or_atomic_snapshot_approval(self):
        status,report,output=self.run_main()
        self.assertEqual(status,0)
        self.assertEqual(report['status'],'ONLINE_BACKUP_COMPONENTS_VERIFIED')
        self.assertTrue(report['sameStartTime'])
        for key in ('deployed','publishApproved','fullVpsSnapshot','jointPointInTimeSnapshot','databaseFilesConsistencyVerified','serviceLifecycleCommands'):
            self.assertIs(report[key],False)
        self.assertNotIn('private-setting',output)
        self.assertNotIn('SECRET=private',output)

    def test_main_external_restart_cannot_get_success(self):
        status,report,_=self.run_main(changed_after=True)
        self.assertEqual(status,2)
        self.assertEqual(report['status'],'APP_CHANGED_REVIEW_REQUIRED')
        self.assertFalse(report['sameStartTime'])

    def test_main_incomplete_copy_cannot_get_success(self):
        (self.source/'file').write_bytes(b'content')
        with patch.object(m,'copy_one',side_effect=FileNotFoundError('secret-name')):
            status,report,output=self.run_main()
        self.assertEqual(status,2)
        self.assertEqual(report['status'],'ONLINE_BACKUP_REVIEW_REQUIRED')
        self.assertEqual(report['data']['fileFailures'],1)
        self.assertNotIn('secret-name',output)

    def test_busy_database_backup_has_deadline(self):
        with contextlib.closing(sqlite3.connect(self.db)) as writer:
            writer.execute('BEGIN EXCLUSIVE')
            try:
                start=time.monotonic()
                with self.assertRaisesRegex(m.Refused,'database_backup_deadline'):
                    m.online_database(self.db,self.work/'busy.sqlite',timeout=.1)
                self.assertLess(time.monotonic()-start,4)
            finally:writer.rollback()

if __name__=='__main__':unittest.main(verbosity=2)
