"""Offline updater checks with real JS routing and synthetic SQLite only."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
HERE=Path(__file__).resolve().parent

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj

u=module('route_update', HERE/'update-image-route-v93.py')
m=module('helper_fixture', HERE/'deploy-lia-v92.py')

def engine_before():
    cached=HERE/'engine-before.js'
    if cached.exists():return cached.read_bytes()
    r=module('r',HERE/'resolve-chat-engine-v3.py')
    t=(HERE.parents[1]/'app/vitriny-neural/chat-engine.js').read_text()
    anchors={2:"      if(localFirstAdmin&&scope.startsWith('admin:')&&error?.code==='chat_response_invalid'&&run.responseReceived&&!controller.signal.aborted)run.offerExistingApi=true;",3:'        const offered=prepare(scope,{'}
    for i,(before,after) in enumerate(r.REVIEWED_TEXT_DIFFERENCES):
        t=r.once(t,after,before) if after else r.once(t,anchors[i],before+anchors[i])
    data=t.encode();assert u.sha(data)==u.BEFORE_HASH;return data

class PatchTests(unittest.TestCase):
    def test_pins_match_exact_active_engine(self):
        self.assertEqual(u.sha(engine_before()),u.BEFORE_HASH)
        self.assertEqual(u.sha(u.patch_engine(engine_before())),u.AFTER_HASH)
    def test_unknown_engine_refused(self):
        with self.assertRaises(u.Refused):u.patch_engine(b'unknown')
    def test_second_application_refused(self):
        with self.assertRaises(u.Refused):u.patch_engine(u.patch_engine(engine_before()))
    def test_only_routing_copy_changes(self):
        before=engine_before();after=u.patch_engine(before)
        self.assertEqual(after.replace(u.NEW.encode(),u.OLD.encode(),1),before)
    def test_missing_or_duplicate_anchor_refused(self):
        for data in (b'unknown', (u.OLD+'\n'+u.OLD).encode()):
            with patch.object(u,'BEFORE_HASH',u.sha(data)):
                with self.assertRaises(u.Refused):u.patch_engine(data)
    def test_result_hash_is_mandatory(self):
        with patch.object(u,'AFTER_HASH','0'*64):
            with self.assertRaises(u.Refused):u.patch_engine(engine_before())
    def test_pinned_helper_is_same_as_deployed(self):
        self.assertEqual(u.sha((HERE/'deploy-lia-v92.py').read_bytes()),u.HELPER_SHA256)
    def test_provider_confirmation_and_billing_code_unchanged(self):
        before=engine_before().decode();after=u.patch_engine(engine_before()).decode()
        boundary='function strictObject('
        self.assertEqual(before.split(boundary,1)[1],after.split(boundary,1)[1])
    def test_prior_failure_and_22_js_cases(self):
        before=engine_before().decode();after=u.patch_engine(engine_before()).decode()
        def pure(t):return t[t.index('function normalize('):t.index('function strictObject(')]
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'route.mjs';path.write_text(pure(after))
            old=Path(d)/'old.mjs';old.write_text(pure(before))
            js="""import assert from 'node:assert/strict';
const {routeChatIntent:r}=await import(process.argv[1]);
const {routeChatIntent:old}=await import(process.argv[2]);
const cases=JSON.parse(process.argv[3]);
assert.equal(old(cases[0][0]).kind,'text');
for(const [message,kind] of cases)assert.equal(r(message).kind,kind,message);
console.log(JSON.stringify({tests:cases.length,passed:cases.length,paidTaskExecuted:false}));"""
            out=subprocess.run(['node','--input-type=module','-e',js,path.as_uri(),old.as_uri(),json.dumps(u.CASES)],capture_output=True,text=True,timeout=10)
            self.assertEqual(out.returncode,0,out.stderr)
            self.assertEqual(json.loads(out.stdout)['passed'],22)
    def test_route_test_is_isolated(self):
        fake=Mock();fake.Blocked=m.Blocked
        fake.command.return_value=subprocess.CompletedProcess([],0,json.dumps({'ok':True,'tests':22,'paidTaskExecuted':False}).encode())
        u.route_tests(fake,'fixture',Path('/private/release-fixture'))
        args=fake.command.call_args_list[0].args[0]
        self.assertIn('--init',args);self.assertIn('--read-only',args)
        self.assertEqual(args[args.index('--network')+1],'none')
        self.assertNotIn('--mount',args);self.assertNotIn('--env-file',args)
    def test_route_failure_is_not_accepted(self):
        fake=Mock();fake.Blocked=m.Blocked
        fake.command.return_value=subprocess.CompletedProcess([],0,b'{"ok":false}')
        with self.assertRaises(u.Refused):u.route_tests(fake,'fixture',Path('/private/release-fixture'))
    def test_gate_is_extended_not_replaced(self):
        src=(HERE/'update-image-route-v93.py').read_text()
        self.assertIn('m.REQUIRED_CI = (*m.REQUIRED_CI, WORKFLOW)',src)
        self.assertIn('m.quality(args.revision)',src)
        self.assertIn('guards(m, current); m.quality(revision)',src)
        self.assertNotIn('m.validate_gate =',src)
    def test_no_secret_prompt_no_forced_stop_no_restore(self):
        src=(HERE/'update-image-route-v93.py').read_text()
        for forbidden in ('m.obtain_token(', 'm.intended_env(', 'm.gateway_probe(', '--aceitar-parada-forcada-inicial', 'git pull', 'sqlite3.restore'):
            self.assertNotIn(forbidden,src)
        self.assertIn('permit_legacy=False',src)
    def test_quality_failure_prevents_any_backup_build_or_stop(self):
        fake=Mock();fake.quality.side_effect=m.Blocked('SONAR_AINDA_NAO_ANALISOU_ESTA_REVISAO')
        with patch.object(u,'build_image') as build:
            with self.assertRaises(m.Blocked):u.update(fake,{},'a'*40)
            fake.find_backup.assert_not_called();fake.stop_for_rollout.assert_not_called();build.assert_not_called()
    def test_pending_job_blocks_before_new_work(self):
        fake=Mock();fake.consumers.return_value=['a'];fake.pending.return_value=1
        with self.assertRaises(u.Refused):u.guards(fake,{'Id':'a'})
        fake.verify_retest.assert_not_called()
    def test_other_volume_consumer_blocks(self):
        fake=Mock();fake.consumers.return_value=['a','b'];fake.pending.return_value=0
        with self.assertRaises(u.Refused):u.guards(fake,{'Id':'a'})
    def test_nonhealthy_app_refused(self):
        fake=Mock();fake.app.return_value={};fake.healthy.return_value=False
        with self.assertRaises(u.Refused):u.inspect_ready(fake)
    def test_init_required(self):
        fake=Mock();fake.app.return_value={'HostConfig':{'Init':False}};fake.healthy.return_value=True
        with self.assertRaises(u.Refused):u.inspect_ready(fake)
    def test_workers_not_silently_disabled(self):
        fake=Mock();fake.app.return_value={'HostConfig':{'Init':True}};fake.healthy.return_value=True
        fake.environment.return_value={'LIA_CHAT_OPERATIONS_ENABLED':'false'}
        with self.assertRaises(u.Refused):u.inspect_ready(fake)
    def test_exact_successful_release_is_pinned(self):
        self.assertEqual(str(u.SEED),'/var/lib/vitrinecity-lia-deploy/release-20260919T124012Z-673482fd')

if __name__=='__main__':unittest.main(verbosity=2)
