"""Offline contract tests. No production access, no credentials, no provider calls."""
import copy,hashlib,importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
HERE=Path(__file__).resolve().parent

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
u=load('update','update-native-audio-v94.py');b=load('builder','build-native-audio-v94.py')
class Contracts(unittest.TestCase):
 def test_exact_four_files(self):self.assertEqual(len(b.MANIFEST),4);self.assertNotIn(u.ENGINE,b.MANIFEST)
 def test_sha_source_refused(self):
  for p in b.MANIFEST:
   with self.assertRaises(ValueError):b.patch(p,b'unknown')
 def test_new_policy_hash(self):self.assertEqual(b.digest(b.patch('app/vitriny-neural/video-audio-policy.js',None)),b.MANIFEST['app/vitriny-neural/video-audio-policy.js'][1])
 def test_tariff_is_native_not_turbo(self):self.assertEqual((u.TARIFF['model'],u.TARIFF['usdPerSecond']),('kling-3.0','0.126'))
 def test_real_bundle_hashes(self):
  for n,h in u.BUNDLE_HASHES.items():self.assertEqual(u.sha((HERE/n).read_bytes()),h)
 def env(self):return {u.CONFIG_KEY:json.dumps({'enabled':True,'chat':{'model':'existing'},'fx':{'usdToBrl':'5.12'},'kling':{'accountBinding':'existing','videoUsdPerSecond':'0.084','unitUsd':{'video':'0.14'}}}), 'KLING_API_KEY':'synthetic-only','LIA_OPERATIONS_TOKEN':'synthetic-gateway','LIA_CHAT_OPERATIONS_ENABLED':'true'}
 def test_environment_changes_only_audio_config(self):
  old=self.env();new=u.wanted_environment(old);self.assertEqual(set(old),set(new))
  for k in old:
   if k!=u.CONFIG_KEY:self.assertEqual(old[k],new[k])
  cfg=json.loads(new[u.CONFIG_KEY]);self.assertEqual(cfg['kling'].pop('nativeAudio720'),u.TARIFF);self.assertEqual(cfg,json.loads(old[u.CONFIG_KEY]))
 def test_original_env_not_mutated(self):
  old=self.env();saved=copy.deepcopy(old);u.wanted_environment(old);self.assertEqual(old,saved)
 def test_audio_settings_idempotent(self):
  a=u.wanted_environment(self.env());self.assertEqual(u.wanted_environment(a),a)
 def test_conflicting_rate_never_overwritten(self):
  a=self.env();cfg=json.loads(a[u.CONFIG_KEY]);cfg['kling']['nativeAudio720']={'enabled':True,'usdPerSecond':'0.001'};a[u.CONFIG_KEY]=json.dumps(cfg)
  with self.assertRaises(u.Refused):u.wanted_environment(a)
 def test_invalid_configuration_refused(self):
  for value in ('','null','[]','{"enabled":false}','{"enabled":true,"kling":[]}'):
   with self.assertRaises(u.Refused):u.wanted_environment({u.CONFIG_KEY:value})
 def test_missing_configuration_refused(self):
  with self.assertRaises(u.Refused):u.wanted_environment({})
 def test_helper_hash_is_deployed_helper(self):self.assertEqual(u.HELPER_HASH,'27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44')
 def test_previous_route_release_pinned(self):self.assertEqual(u.ROUTE_SEED.name,'release-20260919T133801Z-7be67bbb')
 def test_expected_files_preserve_route(self):
  m=Mock();m.PAYLOAD={'app/server.js':'before',u.ENGINE:'old'}
  for enabled in (False,True):self.assertEqual(u.expected_files(m,b,enabled)[u.ENGINE],u.ENGINE_HASH)
 def test_quality_rejects_short_revision_before_network(self):
  m=Mock()
  with self.assertRaises(u.Refused):u.quality(m,'abc')
  m.public_json.assert_not_called()
 def test_quality_uses_exact_pr_and_keeps_gate(self):
  m=Mock();m.REPO='owner/repo';r='a'*40
  pr={'head':{'ref':'feat/lia-native-audio-20260919','repo':{'full_name':m.REPO}},'base':{'ref':'feat/lia-prod-chat-delete-20260918'}}
  m.public_json.side_effect=[pr,{'runs':1},{'prs':1},{'gate':1}];u.quality(m,r)
  self.assertTrue(m.public_json.call_args_list[0].args[0].endswith('/pulls/211'))
  m.validate_gate.assert_called_once_with(r,pr,{'runs':1},{'prs':1},{'gate':1})
 def test_failed_quality_never_builds_or_stops(self):
  m=Mock()
  with patch.object(u,'quality',side_effect=u.Refused('BLOCKED')):
   with self.assertRaises(u.Refused):u.update(m,b,{}, {},'a'*40)
  for method in ('command','find_backup','verify_backup','stop_for_rollout','compose_up'):getattr(m,method).assert_not_called()
 def test_pending_prevents_update_before_build(self):
  m=Mock();m.consumers.return_value=['other'];m.pending.return_value=0
  with patch.object(u,'quality',return_value={}):
   with self.assertRaises(u.Refused):u.update(m,b,{}, {'Id':'expected'},'a'*40)
  m.find_backup.assert_not_called();m.command.assert_not_called()
 def test_no_forced_exception_or_token_prompt(self):
  text=(HERE/'update-native-audio-v94.py').read_text()
  self.assertNotIn('obtain_token(',text);self.assertNotIn('permit_legacy=True',text);self.assertNotIn('--aceitar-parada-forcada-inicial',text)
  self.assertIn('permit_legacy=False',text)
 def test_no_provider_task_or_database_restore(self):
  text=(HERE/'update-native-audio-v94.py').read_text()
  self.assertNotIn('/v1/operations/tasks',text);self.assertNotIn('api-singapore',text)
  self.assertNotIn('git pull',text.split('"""',2)[-1]);self.assertNotIn('shutil.copy',text)
 def test_test_runtime_is_isolated(self):
  text=(HERE/'update-native-audio-v94.py').read_text()
  self.assertIn("'--network','none'",text);self.assertIn("'--entrypoint','/usr/bin/env'",text)
  self.assertIn("'REQUIRE_BETTER_SQLITE3=1'",text)
 def test_foreign_branch_is_rejected(self):
  m=Mock();m.REPO='owner/repo';m.public_json.return_value={'head':{'ref':'unknown'},'base':{}}
  with self.assertRaises(u.Refused):u.quality(m,'a'*40)
  m.validate_gate.assert_not_called()
 def test_patch_outputs_exact_known_files(self):
  root=Path(os.environ.get('LIA_TEST_SOURCE',str(HERE.parents[1])))
  for p,(before,after) in b.MANIFEST.items():
   data=(root/p).read_bytes() if before else None
   self.assertEqual(hashlib.sha256(b.patch(p,data)).hexdigest(),after)
if __name__=='__main__':unittest.main(verbosity=2)
