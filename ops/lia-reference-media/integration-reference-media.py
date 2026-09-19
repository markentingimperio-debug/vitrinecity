"""Real Docker/SQLite lifecycle test in a disposable runner, never production."""
import copy,importlib.util,json,os,secrets,shutil,socket,sqlite3,tempfile
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def mod(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.geteuid()!=0 or socket.gethostname().split('.')[0] in ('srv1901029','srv1987582'):
  raise RuntimeError('DISPOSABLE_CI_ONLY')
 os.umask(0o077);root=Path(tempfile.mkdtemp(prefix='lia-reference-ci-',dir='/root'));project='lia-ref-ci-'+secrets.token_hex(5)
 m=mod('helper',REPO/'ops/lia-preserve-kling/deploy-lia-v92.py');u=mod('updater',HERE/'update-reference-media-v95.py');b=mod('builder',HERE/'build-reference-media-v95.py');a=mod('audio',HERE/'build-native-audio-v94.py')
 m.PROJECT=project;m.APP_ROOT=root;m.ROOT=root/'releases';m.ROOT.mkdir();m.STAGED=root/'stage';m.STAGED.mkdir()
 ctx=root/'base-context';shutil.copytree(REPO/'app',ctx,ignore=shutil.ignore_patterns('node_modules','.env','.env.*'))
 (ctx/'public/neural-reference-media.js').unlink()
 e=ctx/'vitriny-neural/chat-engine.js';source=e.read_text()
 reviewed=mod('reviewed',REPO/'ops/lia-preserve-kling/resolve-chat-engine-v3.py')
 for old,canonical in reviewed.REVIEWED_TEXT_DIFFERENCES:
  if canonical:
   assert source.count(canonical)==1;source=source.replace(canonical,old,1)
 for anchor,comment in [("      if(localFirstAdmin&&scope.startsWith('admin:')&&error?.code==='chat_response_invalid'",'      // A confirmed response can offer a quote, never start paid inference.\n'),('        const offered=prepare(scope,{','        // New request ID and stable idempotency key: never reuse local dispatch.\n')]:
  assert source.count(anchor)==1;source=source.replace(anchor,comment+anchor,1)
 assert m.sha(source.encode())=='21ea860eb44f4bba2f6aa9399758407fb93e581c42c40d5b378d5a5ca79b4cb9'
 source=source.replace('  const text=normalize(message).trim();',"  // Normalize only the routing copy; preserve the original prompt and its billing fingerprint.\n  const text=normalize(message).trim().replace(/\\bimage\\b/g,'imagem');",1)
 assert m.sha(source.encode())==b.MANIFEST[b.ENGINE][0];e.write_text(source)
 m.PAYLOAD={p:m.sha((ctx/p.removeprefix('app/')).read_bytes()) for p in m.PAYLOAD}
 for p in m.GUARDS:m.write_new(m.STAGED/'candidate'/p,(ctx/p.removeprefix('app/')).read_bytes())
 # Only this disposable fixture uses the later stronger HTTP-header regression.
 # Production's immutable helper and its attested staged tests are not changed.
 m.TEST_HASHES={**m.TEST_HASHES,'app/scripts/test-vitriny-neural-lia-chat-operations.mjs':'c2d4053c3949c7f818c495aef0e4b0d9018a18c474a6e87e714618fdf02d86bd'}
 for p,expected in m.TEST_HASHES.items():
  original=REPO/p
  data=(REPO/'ops/lia-preserve-kling/test.mjs').read_bytes() if p.endswith('/test-lia-preserve-kling.mjs') else original.read_bytes()
  if p.endswith('/test-vitriny-neural-chat.mjs'):data=data.replace('/modelo local não concluiu/i'.encode(),'/modelo local n[ãa]o concluiu/i'.encode())
  assert m.sha(data)==expected;m.write_new(m.STAGED/'candidate'/p,data)
 m.verify_retest=lambda:None
 seed=m.ROOT/'release-20260919T000000Z-01234567';seed.mkdir();cfg=seed/'after.private.json';tag=project+':base'
 m.command(['docker','build','--pull=false','-t',tag,str(ctx)],timeout=600,log=root/'base-build.log')
 program="require('http').createServer((q,r)=>{r.setHeader('content-type','application/json');if(q.url==='/api/health'){r.end('{\"ok\":true}')}else{r.statusCode=403;r.end('{\"ok\":false}')}}).listen(3000,'0.0.0.0')"
 health=['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
 env={'SITE_URL':'https://vitrinecity.com','LIA_CHAT_OPERATIONS_ENABLED':'true','LIA_OPERATIONS_TOKEN':'synthetic-not-a-credential',u.CONFIG_KEY:json.dumps({'enabled':True,'fx':{'usdToBrl':'5'},'kling':{'videoUsdPerSecond':'0.084','accountBinding':'synthetic'}})}
 definition={'name':project,'services':{'app':{'image':tag,'init':True,'restart':'no','network_mode':'none','command':['node','-e',program],'environment':env,'volumes':['data:/data'],'healthcheck':{'test':health,'interval':'1s','timeout':'2s','retries':30}}},'volumes':{'data':{}}}
 m.write_new(cfg,json.dumps(definition).encode());results=[]
 try:
  m.command(m.compose([cfg])+['up','-d','--no-build','--pull','never','--wait','--wait-timeout','60','app'],timeout=90,log=root/'base-up.log')
  original=m.app();m.EXPECTED_MOUNTS={x['Destination']:(x.get('Type'),x.get('Name'),x.get('Source'),x.get('RW')) for x in original['Mounts']}
  built=m.runtime_hashes(original['Id'],m.PAYLOAD);assert {p for p in built if built[p]!=m.PAYLOAD[p]}<={'app/public/neural-workspace.html'};m.PAYLOAD=built
  volume=next(x for x in original['Mounts'] if x['Destination']=='/data');assert volume['Name']==project+'_data';m.DATA=Path(volume['Source'])
  m.consumers=lambda:m.command(['docker','ps','--no-trunc','--filter','volume='+project+'_data','--format','{{.ID}}']).stdout.decode().splitlines()
  frozen=m.render([cfg]);frozen['services']['app']['environment']=m.escape_values(m.environment(original));m.atomic_json(cfg,frozen);m.write_new(root/'.env',b'')
  dbpath=m.DATA/'vitrinecity.db'
  with sqlite3.connect(dbpath) as db:
   db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE neural_durable_jobs(status TEXT)');db.execute('CREATE TABLE marker(id INTEGER)');db.execute('INSERT INTO marker VALUES(1)')
  m.write_new(m.DATA/'marker.txt',b'synthetic private attachment');m.write_new(seed/'before-inspect.private.json',json.dumps(original).encode())
  m.write_new(seed/'state.private.json',json.dumps({'kind':'LIA_IMAGE_ROUTE_V93','phase':'DEPLOYED','newImage':original['Image'],'frozenHashes':{'after.private.json':m.sha(m.private_read(cfg))}}).encode())
  latest={'directory':str(seed),'image':original['Image']};m.atomic_json(m.ROOT/'latest.private.json',latest)
  backup=root/'backup';backup.mkdir();database=m.sqlite_snapshot(backup/'data/vitrinecity.db');m.write_new(backup/'data/marker.txt',b'synthetic private attachment')
  m.write_new(backup/'manifest.private.json',json.dumps({'copiedFiles':{'marker.txt':{'sha256':m.sha(b'synthetic private attachment')}},'failedFiles':{}}).encode());report={'data':{'regularFilesVerified':1,'database':database}};m.find_backup=lambda:(backup,report)
  files={n:(HERE/n).read_bytes() for n in u.BUNDLE_HASHES};assert all(m.sha(v)==u.BUNDLE_HASHES[n] for n,v in files.items())
  for enable_audio in (False,True):
   info,audio,done=u.inspect_ready(m,b,a);assert not audio and not done
   with patch.object(u,'quality',return_value={'fixtureOnly':True}):assert u.update(m,b,a,files,info,audio,'a'*40,enable_audio)==0
   newer,has_audio,done=u.inspect_ready(m,b,a);assert has_audio==enable_audio and done and m.healthy(newer)
   work=Path(m.load(m.ROOT/'latest.private.json')['directory']);state=m.load(work/'state.private.json');assert state['phase']=='DEPLOYED'
   with sqlite3.connect(dbpath) as db:db.execute('INSERT INTO marker VALUES(?)',(2+int(enable_audio),))
   m.rollback_work(work,state);m.atomic_json(m.ROOT/'latest.private.json',latest)
   old=m.app();assert old['Image']==original['Image'] and m.environment(old)==m.environment(original) and m.healthy(old)
   with sqlite3.connect(dbpath) as db:assert db.execute('SELECT count(*) FROM marker').fetchone()[0]==2+int(enable_audio)
   results.append({'audioEnabled':enable_audio,'tests':state['tests'],'rollbackPreservedNewDatabaseWrites':True})
  info,audio,done=u.inspect_ready(m,b,a)
  with patch.object(u,'quality',return_value={'fixtureOnly':True}),patch.object(m,'api_probe',side_effect=m.Blocked('SIMULATED_POST_SWAP_FAILURE')):
   assert u.update(m,b,a,files,info,audio,'a'*40,True)==2
  assert m.app()['Image']==original['Image'] and m.healthy(m.app()) and m.load(m.ROOT/'latest.private.json')==latest
  with sqlite3.connect(dbpath) as db:assert db.execute('SELECT count(*) FROM marker').fetchone()[0]==3
  print('REFERENCE_DOCKER_RESULT='+json.dumps({'cases':results,'automaticRollbackAfterFailure':True,'databaseRestored':False,'productionAccess':False,'providerCalls':0}),flush=True)
 finally:
  m.command(m.compose([cfg])+['down','--volumes','--remove-orphans'],timeout=60,log=root/'cleanup.log',allow_failure=True)
  print('CI_PRIVATE_LOG_DIRECTORY='+str(root),flush=True)
if __name__=='__main__':main()
