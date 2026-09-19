"""Offline + real SQLite tests. Docker and network are mocked, never production."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE/filename)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

builder = module('init_builder', 'fix-deploy-init-v92.py')
selector = module('selector', 'fix-deploy-selector-v91.py')
source = selector.build((HERE/'deploy-lia-v9.py').read_bytes())
result = builder.build(source)
m = type(module('baseline', 'deploy-lia-v9.py'))('generated_init_deploy')
exec(compile(result, str(HERE/'deploy-lia-v92.py'), 'exec'), m.__dict__)
base_tests = module('baseline_tests', 'test_deploy_lia_v9.py'); base_tests.m = m
serialization_tests = module('serialization_tests', 'test_compose_serialization_v9.py'); serialization_tests.m = m

def sample(init=None):
    info = base_tests.sample()
    info['Id'] = m.LEGACY_CONTAINER
    info['HostConfig']['Init'] = init
    info['State'].update(Status='running', StartedAt='2026-09-19T11:40:41Z', OOMKilled=False)
    return info

def stopped(info, code=137):
    value = copy.deepcopy(info)
    value['State'].update(Status='exited', Running=False, ExitCode=code)
    return value

class InitMigrationTests(unittest.TestCase):
    def test_build_requires_exact_original(self):
        with self.assertRaises(ValueError): builder.build(source+b'\n')
    def test_expected_result_hash(self):
        self.assertEqual(hashlib.sha256(result).hexdigest(), builder.RESULT_SHA256)
    def test_app_payload_pins_unchanged(self):
        old=module('old_init_test','deploy-lia-v9.py')
        self.assertEqual(m.PAYLOAD,old.PAYLOAD);self.assertEqual(m.ORIGINAL,old.ORIGINAL)
        self.assertEqual(m.TEST_HASHES,old.TEST_HASHES);self.assertEqual(m.GUARDS,old.GUARDS)
    def test_gate_function_not_patched(self):
        a=source.decode().split('def validate_gate(',1)[1].split('def quality(',1)[0]
        b=result.decode().split('def validate_gate(',1)[1].split('def quality(',1)[0]
        self.assertEqual(a,b);self.assertIn('LIA init migration tests',m.REQUIRED_CI)
    def test_backup_requires_full_integrity_check(self):
        self.assertIn("dest.execute('PRAGMA integrity_check')",result.decode())
    def test_force_only_exact_legacy(self):
        a=sample();self.assertTrue(m.legacy_runtime(a))
        for field,value in [('Id','f'*64),('Image','sha256:'+'a'*64),('Name','/other')]:
            b=copy.deepcopy(a);b[field]=value;self.assertFalse(m.legacy_runtime(b))
        self.assertFalse(m.legacy_runtime(sample(True)))
    def test_137_without_consent_rejected(self):
        a=sample()
        with self.assertRaises(m.Blocked):m.evaluate_stop(a,stopped(a),False)
    def test_137_for_unknown_container_rejected(self):
        a=sample();a['Id']='f'*64
        with self.assertRaises(m.Blocked):m.evaluate_stop(a,stopped(a),True)
    def test_137_for_init_container_rejected(self):
        a=sample(True)
        with self.assertRaises(m.Blocked):m.evaluate_stop(a,stopped(a),True)
    def test_137_classified_as_forced_not_graceful(self):
        a=sample();r=m.evaluate_stop(a,stopped(a),True)
        self.assertTrue(r['legacyForcedStopUsed']);self.assertFalse(r['gracefulExit'])
    def test_normal_exits_are_distinct(self):
        a=sample(True)
        for code in (0,143):
            r=m.evaluate_stop(a,stopped(a,code),False)
            self.assertFalse(r['legacyForcedStopUsed']);self.assertTrue(r['gracefulExit'])
    def test_running_paused_restarting_oom_and_unknown_exit_refused(self):
        a=sample()
        for key,value in [('Running',True),('Paused',True),('Restarting',True),('OOMKilled',True),('OOMKilled',None),('ExitCode',1),('ExitCode',False),('Status','dead')]:
            b=stopped(a);b['State'][key]=value
            with self.subTest(key=key,value=value), self.assertRaises(m.Blocked): m.evaluate_stop(a,b,True)
    def test_identity_drift_rejected(self):
        a=sample()
        for field in ('Id','Image','Config','HostConfig','Mounts'):
            b=stopped(a);b[field]=None
            with self.subTest(field=field),self.assertRaises((m.Blocked,TypeError)):m.evaluate_stop(a,b,True)
    def test_mount_reordering_is_allowed(self):
        a=sample();b=stopped(a);b['Mounts'].reverse()
        self.assertTrue(m.evaluate_stop(a,b,True)['legacyForcedStopUsed'])
    def test_no_consent_causes_no_docker_command(self):
        with patch.object(m,'command') as call,patch.object(m,'sqlite_snapshot') as snap:
            with self.assertRaises(m.Blocked):m.stop_for_rollout(sample(),Path('/unused'))
            call.assert_not_called();snap.assert_not_called()
    def test_frozen_configuration_only_new_app_gets_init(self):
        a=sample()
        doc={'name':m.PROJECT,'services':{'app':{'image':'before','environment':m.escape_values(m.environment(a))}},'volumes':{},'networks':{}}
        with tempfile.TemporaryDirectory() as d,patch.object(m,'controlled'):
            work=Path(d)
            def render(paths):
                return copy.deepcopy(doc) if len(paths)>1 else json.loads(Path(paths[0]).read_text())
            with patch.object(m,'render',side_effect=render):
                before,after=m.frozen_files(work,a,'oldtag','newtag',m.environment(a))
            self.assertNotIn('init',before['services']['app'])
            self.assertIs(after['services']['app']['init'],True)
            after['services']['app'].pop('init');after['services']['app']['image']='oldtag'
            self.assertEqual(before,after)
    def run_fenced(self, pending=False, fail_stop=False):
        with tempfile.TemporaryDirectory() as d,patch.object(m,'controlled'),contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);data=root/'data';data.mkdir();work=root/'work';work.mkdir()
            dbpath=data/'vitrinecity.db'
            with sqlite3.connect(dbpath) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE neural_durable_jobs(status TEXT)')
                db.execute('CREATE TABLE dummy(id INTEGER)')
                if pending:db.execute("INSERT INTO neural_durable_jobs VALUES('dispatched')")
            a=sample();b=stopped(a)
            calls=[]
            def command(args,**kwargs):
                calls.append(args)
                self.assertEqual(args,['docker','stop','--time','60',a['Id']])
                self.assertTrue((work/'pre-stop-database.sqlite').is_file())
                with sqlite3.connect(dbpath,timeout=0.02) as concurrent:
                    with self.assertRaises(sqlite3.OperationalError):concurrent.execute('INSERT INTO dummy VALUES(1)')
                if fail_stop:raise m.Blocked('SIMULATED_STOP_FAILURE')
                return subprocess.CompletedProcess(args,0,b'')
            with patch.object(m,'DATA',data),patch.object(m,'inspect',side_effect=[a,a,b]),patch.object(m,'consumers',side_effect=[[a['Id']],[a['Id']],[]]),patch.object(m,'command',side_effect=command):
                if pending or fail_stop:
                    with self.assertRaises(m.Blocked):m.stop_for_rollout(a,work,True)
                else:
                    r=m.stop_for_rollout(a,work,True)
                    self.assertTrue(r['legacyForcedStopUsed'])
                    self.assertTrue((work/'stop-evidence.json').exists())
                self.assertEqual(len(calls),0 if pending else 1)
            with sqlite3.connect(dbpath,timeout=0.1) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM dummy').fetchone()[0],0)
                db.execute('INSERT INTO dummy VALUES(2)')
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
    def test_writer_fence_blocks_concurrent_writes_and_does_not_restore(self):self.run_fenced()
    def test_pending_job_prevents_stop_even_with_consent(self):self.run_fenced(pending=True)
    def test_failed_stop_releases_writer_fence(self):self.run_fenced(fail_stop=True)

if __name__=='__main__':
    suite=unittest.TestSuite()
    for cls in (base_tests.DeploymentTests,serialization_tests.SerializationTests,InitMigrationTests):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    res=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if res.wasSuccessful() else 1)
