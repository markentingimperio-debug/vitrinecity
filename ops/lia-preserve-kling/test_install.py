import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch as mock
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import install as mod
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
 def test_configuration_drift_stops(self):
  info={'Config':{'Labels':{'com.docker.compose.config-hash':'old'}}}
  with mock.object(mod,'run',return_value='app changed'):
   with self.assertRaises(RuntimeError):mod.check_config(['compose'],info,Path('/tmp'))
  with mock.object(mod,'run',return_value='app old'):mod.check_config(['compose'],info,Path('/tmp'))
 def test_unknown_chat_source_never_patched(self):
  with self.assertRaises(ValueError):mod.patch(b'// unknown version')
 def test_rollback_recovers_when_container_absent_without_database_restore(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d)/'backup';root=Path(d)/'project';folder.mkdir();root.mkdir()
   live_file=root/'code.js';live_file.write_bytes(b'new')
   (folder/'files').mkdir();(folder/'files/code.js').write_bytes(b'old')
   mount={'Type':'volume','Source':'/data-volume','Destination':'/data'}
   m={'root':str(root),'compose':['compose'],'configHash':'ok','oldImage':'old-id','newImage':'new-id','oldTag':'app:live','dataMount':mount,'files':[{'path':'code.js','before':mod.sha(b'old'),'after':mod.sha(b'new'),'mode':0o644}]}
   (folder/'manifest.json').write_text(json.dumps(m));calls=[]
   def run(args,**kw):
    calls.append(args)
    if 'config' in args:return 'app ok'
    if 'ps' in args:return ''
    return ''
   with mock.object(mod,'run',side_effect=run),mock.object(mod,'wait_health',return_value='restored'),mock.object(mod,'inspect',return_value={'Image':'old-id'}),mock.object(mod,'data_mount',return_value=mount):mod.restore(folder)
   self.assertEqual(live_file.read_bytes(),b'old');self.assertIn(['docker','tag','old-id','app:live'],calls)
   self.assertFalse(any('database.sqlite' in str(c) for c in calls))
 def test_rollback_refuses_later_edits(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);(folder/'code').write_bytes(b'later edit')
   (folder/'manifest.json').write_text(json.dumps({'root':d,'files':[{'path':'code','before':mod.sha(b'old'),'after':mod.sha(b'new')}]}))
   with mock.object(mod,'run') as called:
    with self.assertRaises(RuntimeError):mod.restore(folder)
    called.assert_not_called()
if __name__=='__main__':unittest.main()
