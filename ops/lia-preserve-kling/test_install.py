import importlib.util
import io
import json
from contextlib import redirect_stdout,redirect_stderr
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch as mock
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import install as mod
HASH='a'*64
OTHER='b'*64
MODEL=json.dumps({'name':'vitrinecity','services':{'app':{'environment':{'TEST_SECRET':'private-fixture-value'}}}})
INFO={'Config':{'Labels':{'com.docker.compose.config-hash':HASH}}}
COMPOSE=['docker','compose','--project-directory','/tmp/project','-p','vitrinecity','-f','/tmp/project/compose.yml','-f','/tmp/project/override.yml']
class SafetyTests(unittest.TestCase):
 def test_atomic_preserves_file_mode(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'file';p.write_bytes(b'old');mod.atomic(p,b'new',0o640)
   self.assertEqual(p.read_bytes(),b'new');self.assertEqual(p.stat().st_mode&0o777,0o640)
 def test_atomic_refuses_symlink(self):
  with tempfile.TemporaryDirectory() as d:
   real=Path(d)/'real';real.write_text('old');link=Path(d)/'link';link.symlink_to(real)
   with self.assertRaises(RuntimeError):mod.atomic(link,b'new')
   self.assertEqual(real.read_text(),'old')
 def test_database_requires_persistent_writable_mount(self):
  base={'Config':{'Env':['DATA_DIR=/data']},'Mounts':[]}
  with self.assertRaises(RuntimeError):mod.data_mount(base)
  base['Mounts']=[{'Destination':'/data','Source':'/srv/db','Type':'bind','RW':True}]
  self.assertEqual(mod.data_mount(base)['Source'],'/srv/db')
  base['Mounts'][0]['RW']=False
  with self.assertRaises(RuntimeError):mod.data_mount(base)
 def test_normalized_match_is_accepted_without_direct_hash_bypass(self):
  with mock.object(mod,'run',side_effect=[MODEL,'app '+HASH]) as called:
   self.assertEqual(mod.check_config(COMPOSE,INFO,Path('/tmp/project')),HASH)
   self.assertEqual(called.call_count,2)
   self.assertEqual(called.call_args_list[0].args[0],COMPOSE+['config','--format','json','app'])
   second=called.call_args_list[1]
   self.assertEqual(second.args[0],COMPOSE[:7]+['-f','-','config','--hash','app'])
   self.assertEqual(second.kwargs['input'],MODEL)
 def test_configuration_drift_stops_after_normalization(self):
  with mock.object(mod,'run',side_effect=[MODEL,'app '+OTHER]):
   with self.assertRaisesRegex(RuntimeError,'mesmo apos normalizacao'):
    mod.check_config(COMPOSE,INFO,Path('/tmp/project'))
 def test_secrets_only_pass_through_stdin_not_argv_or_output(self):
  output=io.StringIO()
  with mock.object(mod,'run',side_effect=[MODEL,'app '+HASH]) as called,redirect_stdout(output),redirect_stderr(output):
   mod.check_config(COMPOSE,INFO,Path('/tmp/project'))
   for call in called.call_args_list:
    self.assertNotIn('private-fixture-value',str(call.args[0]))
   self.assertEqual(called.call_args_list[1].kwargs['input'],MODEL)
  self.assertNotIn('private-fixture-value',output.getvalue())
 def test_malformed_label_stops_before_config_read(self):
  for value in [None,'','old','a'*63,'a'*65,'A'*64]:
   with self.subTest(value=value),mock.object(mod,'run') as called:
    with self.assertRaises(RuntimeError):
     mod.check_config(COMPOSE,{'Config':{'Labels':{'com.docker.compose.config-hash':value}}},Path('/tmp'))
    called.assert_not_called()
 def test_invalid_resolved_config_stops_without_secret_disclosure(self):
  for value in ['private-fixture-value','{}','[]',json.dumps({'services':{'app':None}})]:
   with self.subTest(value=value),mock.object(mod,'run',return_value=value) as called:
    with self.assertRaises(RuntimeError) as caught:mod.check_config(COMPOSE,INFO,Path('/tmp'))
    self.assertNotIn('private-fixture-value',str(caught.exception))
    self.assertEqual(called.call_count,1)
 def test_invalid_normalized_hash_stops(self):
  for value in ['',HASH,'app invalid','other '+HASH,'app '+HASH+'\nother '+HASH]:
   with self.subTest(value=value),mock.object(mod,'run',side_effect=[MODEL,value]):
    with self.assertRaises(RuntimeError):mod.check_config(COMPOSE,INFO,Path('/tmp'))
 def test_stdin_keeps_env_files_project_and_profile_but_not_source_files(self):
  cmd=['docker','compose','--env-file','/tmp/private.env','-p','site','--profile','lia','-f','one.yml','--file','two.yml','--file=three.yml','-ffour.yml']
  self.assertEqual(mod.stdin_compose(cmd),['docker','compose','--env-file','/tmp/private.env','-p','site','--profile','lia','-f','-'])
  with self.assertRaises(RuntimeError):mod.stdin_compose(['docker','compose','-f'])
 def test_config_command_failure_stops(self):
  for results in [[RuntimeError('read failed')],[MODEL,RuntimeError('hash failed')]]:
   with mock.object(mod,'run',side_effect=results):
    with self.assertRaises(RuntimeError):mod.check_config(COMPOSE,INFO,Path('/tmp'))
 def test_unknown_chat_source_never_patched(self):
  with self.assertRaises(ValueError):mod.patch(b'// unknown version')
 def test_rollback_recovers_when_container_absent_without_database_restore(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d)/'backup';root=Path(d)/'project';folder.mkdir();root.mkdir()
   live_file=root/'code.js';live_file.write_bytes(b'new')
   (folder/'files').mkdir();(folder/'files/code.js').write_bytes(b'old')
   mount={'Type':'volume','Source':'/data-volume','Destination':'/data'}
   m={'root':str(root),'compose':['docker','compose'],'configHash':HASH,'oldImage':'old-id','newImage':'new-id','oldTag':'app:live','dataMount':mount,'files':[{'path':'code.js','before':mod.sha(b'old'),'after':mod.sha(b'new'),'mode':0o644}]}
   (folder/'manifest.json').write_text(json.dumps(m));calls=[]
   def run(args,**kw):
    calls.append(args)
    if '--format' in args:return MODEL
    if '--hash' in args:return 'app '+HASH
    if 'ps' in args:return ''
    return ''
   with mock.object(mod,'run',side_effect=run),mock.object(mod,'wait_health',return_value='restored'),mock.object(mod,'inspect',return_value={'Image':'old-id'}),mock.object(mod,'data_mount',return_value=mount):mod.restore(folder)
   self.assertEqual(live_file.read_bytes(),b'old');self.assertIn(['docker','tag','old-id','app:live'],calls)
   self.assertFalse(any('database.sqlite' in str(c) for c in calls))
   self.assertTrue(any('--hash' in c for c in calls))
 def test_rollback_refuses_later_edits(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);(folder/'code').write_bytes(b'later edit')
   (folder/'manifest.json').write_text(json.dumps({'root':d,'files':[{'path':'code','before':mod.sha(b'old'),'after':mod.sha(b'new')}]}))
   with mock.object(mod,'run') as called:
    with self.assertRaises(RuntimeError):mod.restore(folder)
    called.assert_not_called()
if __name__=='__main__':unittest.main()
