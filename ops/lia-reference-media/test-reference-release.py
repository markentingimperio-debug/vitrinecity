"""Offline release contracts. No access to the VPS, Docker, credentials or APIs."""
import copy,hashlib,importlib.util,json,sys,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def mod(name,p):
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
u=mod('updater',HERE/'update-reference-media-v95.py');b=mod('builder',HERE/'build-reference-media-v95.py');a=mod('audio',HERE/'build-native-audio-v94.py')
class Contracts(unittest.TestCase):
 def test_bundle_hashes(self):
  for name,h in u.BUNDLE_HASHES.items():self.assertEqual(u.sha((HERE/name).read_bytes()),h)
 def test_public_module_is_identical(self):self.assertEqual((HERE/'neural-reference-media.js').read_bytes(),(REPO/b.MODULE).read_bytes())
 def test_module_hash(self):self.assertEqual(u.sha((HERE/'neural-reference-media.js').read_bytes()),b.MODULE_HASH)
 def test_helper_hash(self):self.assertEqual(u.HELPER_HASH,'27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44')
 def test_unknown_source_refused(self):
  for name in b.MANIFEST:
   with self.assertRaises(ValueError):b.patch(name,b'unknown')
 def test_missing_anchor_refused(self):
  with self.assertRaises(ValueError):b.once('abc','x','y')
 def test_duplicate_anchor_refused(self):
  with self.assertRaises(ValueError):b.once('xx','x','y')
 def test_silent_environment_unchanged(self):
  env={'SECRET':'not-real',u.CONFIG_KEY:'invalid is not parsed without audio'};self.assertEqual(u.desired_environment(env,False),env)
 def env(self):return {'PRESERVE':'literal$secret','OTHER':'same',u.CONFIG_KEY:json.dumps({'enabled':True,'fx':{'usdToBrl':'5.42'},'kling':{'unitUsd':{'video':'0.14'},'videoUsdPerSecond':'0.084'},'chat':{'model':'unchanged'}})}
 def test_only_audio_member_changes(self):
  env=self.env();original=copy.deepcopy(env);new=u.desired_environment(env,True);self.assertEqual(env,original)
  self.assertEqual({k:v for k,v in new.items() if k!=u.CONFIG_KEY},{k:v for k,v in env.items() if k!=u.CONFIG_KEY})
  cfg=json.loads(new[u.CONFIG_KEY]);self.assertEqual(cfg['kling'].pop('nativeAudio720'),u.TARIFF);self.assertEqual(cfg,json.loads(env[u.CONFIG_KEY]))
 def test_audio_environment_idempotent(self):
  new=u.desired_environment(self.env(),True);self.assertEqual(u.desired_environment(new,True),new)
 def test_conflicting_tariff_refused(self):
  env=self.env();cfg=json.loads(env[u.CONFIG_KEY]);cfg['kling']['nativeAudio720']={'enabled':True,'usdPerSecond':'0.0001'};env[u.CONFIG_KEY]=json.dumps(cfg)
  with self.assertRaises(u.Refused):u.desired_environment(env,True)
 def test_missing_config_refused(self):
  with self.assertRaises(u.Refused):u.desired_environment({},True)
 def test_quality_fails_before_build_or_backup(self):
  m=Mock();m.Blocked=RuntimeError
  with patch.object(u,'quality',side_effect=u.Refused('BLOCKED')),patch.object(u,'build_image') as build:
   with self.assertRaises(u.Refused):u.update(m,b,a,{},None,False,'a'*40,True)
   build.assert_not_called();m.find_backup.assert_not_called();m.stop_for_rollout.assert_not_called()
 def test_reference_output_pins(self):
  self.assertEqual(b.MANIFEST[b.ENGINE][0],'9e1307f3b134e6de70cd652c3c8567da551bbb8665769c013b0898e88ab50426')
  self.assertEqual(len(b.MANIFEST),2);self.assertEqual(len(a.MANIFEST),4)
 def test_no_provider_task_or_forced_exception(self):
  text=(HERE/'update-reference-media-v95.py').read_text();self.assertNotIn('obtain_token(',text);self.assertNotIn('permit_legacy=True',text);self.assertNotIn('git checkout',text);self.assertNotIn('git pull',text)
 def test_audio_off_defaults_preserved(self):self.assertEqual(a.MANIFEST['app/vitriny-neural/paid-chat-runtime.js'][0],'4c7a22ec6bcbb9a546525c5e7368698c1938ad0b504f166279acacef6d8de59c')
 def test_core_confirmation_not_replaced(self):
  text=(HERE/'build-reference-media-v95.py').read_text();self.assertNotIn('coinWallet.reserve',text);self.assertNotIn('audioMode',text);self.assertIn('!missingReference&&!referenceConflict',text)
 def test_exact_pr_gate(self):
  self.assertEqual(u.PR,212);text=(HERE/'update-reference-media-v95.py').read_text();self.assertIn('m.validate_gate(revision,pr',text);self.assertIn('quality(m,revision);guards',text)
if __name__=='__main__':unittest.main(verbosity=2)
