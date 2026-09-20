"""Offline release contracts: never run Docker, touch production, or call APIs."""
import hashlib,importlib.util,json,re,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def load(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
u=load('u',HERE/'update-flex-media-v96.py');f=load('f',HERE/'build-flex-media-v96.py')
b=load('b',HERE/'build-reference-media-v95.py');a=load('a',HERE/'build-native-audio-v94.py')
class Contracts(unittest.TestCase):
 def test_bundle_hashes(self):
  for p,h in u.BUNDLE_HASHES.items():self.assertEqual(u.sha((HERE/p).read_bytes()),h,p)
 def test_before_manifest_is_v95(self):
  self.assertEqual(f.MANIFEST[f.ENGINE][0],b.MANIFEST[b.ENGINE][1]);self.assertEqual(f.MANIFEST[f.MODULE][0],b.MODULE_HASH)
 def test_only_two_runtime_files(self):self.assertEqual(set(f.MANIFEST),{f.ENGINE,f.MODULE})
 def test_module_digest(self):self.assertEqual(u.sha((HERE/'neural-reference-media-v96.js').read_bytes()),f.MANIFEST[f.MODULE][1])
 def test_unknown_path_rejected(self):
  with self.assertRaises(ValueError):f.patch('app/server.js',b'')
 def test_bad_source_rejected(self):
  for p in f.MANIFEST:
   with self.assertRaises(ValueError):f.patch(p,b'changed')
 def test_bad_module_rejected(self):
  original=(REPO/'app/public/neural-reference-media.js').read_bytes()
  with self.assertRaises(ValueError):f.patch(f.MODULE,original,b'tampered')
 def test_exact_module(self):
  original=(REPO/'app/public/neural-reference-media.js').read_bytes();new=(HERE/'neural-reference-media-v96.js').read_bytes()
  self.assertEqual(f.patch(f.MODULE,original,new),new)
 def test_all_four_expected_variants(self):
  m=SimpleNamespace(PAYLOAD={'sentinel':'unchanged'})
  for audio in (False,True):
   for flex in (False,True):
    actual=u.expected_files(m,b,a,f,audio,flex);self.assertEqual(actual['sentinel'],'unchanged')
    for p,values in a.MANIFEST.items():self.assertEqual(actual[p],values[int(audio)])
    for p,values in f.MANIFEST.items():self.assertEqual(actual[p],values[int(flex)])
 def test_reference_operations_preserved(self):
  m=SimpleNamespace(PAYLOAD={});self.assertEqual(u.expected_files(m,b,a,f,True,True)[b.OPERATIONS],b.MANIFEST[b.OPERATIONS][1])
 def test_no_audio_activation_option(self):self.assertNotIn('--ativar-audio',(HERE/'update-flex-media-v96.py').read_text())
 def test_hardening(self):
  src=(HERE/'update-flex-media-v96.py').read_text()
  for required in ['--network=none','--pull=false','no-new-privileges','--read-only',"'-i'",'fcntl.LOCK_EX','os.O_NOFOLLOW','sameEnvironment','permit_legacy=False','quality(m,revision)']:
   self.assertIn(required,src)
 def test_holds_are_before_paid(self):
  src=(HERE/'build-flex-media-v96.py').read_text();self.assertIn('if(!intent.referenceHold&&!missingReference',src);self.assertIn('const unavailable=intent.referenceHold||',src)
 def test_no_checkout_or_database_restore_commands(self):
  src=(HERE/'update-flex-media-v96.py').read_text()
  for forbidden in ['git pull','git checkout','databaseRestored\':True','shutil.copyfile','sqlite3.connect']:
   self.assertNotIn(forbidden,src)
 def test_wrong_revision_rejected_before_http(self):
  m=SimpleNamespace(public_json=Mock())
  with self.assertRaises(u.Refused):u.quality(m,'main')
  m.public_json.assert_not_called()
 def test_quality_wrong_branch_rejected(self):
  m=SimpleNamespace(REPO='markentingimperio-debug/vitrinecity',public_json=Mock(return_value={'head':{}}))
  with self.assertRaises(u.Refused):u.quality(m,'a'*40)
 def test_saved_helper_pinned(self):
  self.assertEqual(u.HELPER_HASH,'27fbe7defefd38b77263f82317171aa5acb3bd6cd6bbc59dc3c2017e28853c44')
 def test_all_gates_fail_closed(self):
  m=load('helper_gate',REPO/'ops/lia-preserve-kling/deploy-lia-v92.py');m.PR=u.PR
  m.REQUIRED_CI=(*m.REQUIRED_CI,'LIA image routing hotfix tests','LIA native audio validation','LIA reference media validation',u.WORKFLOW)
  revision='a'*40;pr={'head':{'sha':revision}};rows={'pullRequests':[{'key':str(u.PR),'commit':{'sha':revision},'status':{'qualityGateStatus':'OK'}}]};gate={'projectStatus':{'status':'OK'}}
  runs={'workflow_runs':[{'id':i,'name':n,'head_sha':revision,'event':'pull_request','conclusion':'success','status':'completed'} for i,n in enumerate(m.REQUIRED_CI)]}
  self.assertTrue(m.validate_gate(revision,pr,runs,rows,gate)['sonarSameRevisionApproved'])
  for run in runs['workflow_runs']:
   run['conclusion']='failure'
   with self.assertRaises(m.Blocked):m.validate_gate(revision,pr,runs,rows,gate)
   run['conclusion']='success'
  rows['pullRequests'][0]['commit']['sha']='b'*40
  with self.assertRaises(m.Blocked):m.validate_gate(revision,pr,runs,rows,gate)
if __name__=='__main__':unittest.main(verbosity=2)
