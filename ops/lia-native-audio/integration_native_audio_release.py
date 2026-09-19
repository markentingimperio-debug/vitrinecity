"""Real Docker deployment/rollback test; only in a disposable GitHub runner.
Uses the locked app dependencies, synthetic HTTP server and synthetic database.
Remote approval APIs are simulated here; production always checks their real gates.
"""
import copy,hashlib,importlib.util,json,os,secrets,shutil,socket,sqlite3,subprocess,tempfile
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
REGRESSION=('test-kling-paid-video.mjs','test-kling-paid-image.mjs','test-neural-chat-artifacts.mjs',
 'test-neural-paid-chat-http.mjs','test-neural-paid-credit-flow.mjs','test-neural-deepseek-paid-chat.mjs',
 'test-neural-ai-credit-wallet.mjs','test-neural-ai-credit-pricing.mjs')

def mod(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.geteuid()!=0 or socket.gethostname().split('.')[0] in ('srv1901029','srv1987582'):
  raise RuntimeError('DISPOSABLE_CI_ONLY')
 os.umask(0o077)
 root=Path(tempfile.mkdtemp(prefix='lia-audio-ci-',dir='/root'))
 project='lia-native-ci-'+secrets.token_hex(5)
 assert project.startswith('lia-native-ci-') and project!='vitrinecity'
 m=mod('helper',REPO/'ops/lia-preserve-kling/deploy-lia-v92.py')
 u=mod('updater',HERE/'update-native-audio-v94.py');b=mod('builder',HERE/'build-native-audio-v94.py')
 m.PROJECT=project;m.APP_ROOT=root;m.ROOT=root/'releases';m.ROOT.mkdir();m.STAGED=root/'stage';m.STAGED.mkdir()
 context=root/'base-context';shutil.copytree(REPO/'app',context,ignore=shutil.ignore_patterns('node_modules','.env','.env.*'))
 engine=context/'vitriny-neural/chat-engine.js'
 raw=engine.read_text();anchor='  const text=normalize(message).trim();'
 assert raw.count(anchor)==1
 engine.write_text(raw.replace(anchor,"  const text=normalize(message).trim().replace(/\\bimage\\b/g,'imagem');",1))
 u.ENGINE_HASH=m.sha(engine.read_bytes())
 m.PAYLOAD={p:m.sha((context/p.removeprefix('app/')).read_bytes()) for p in m.PAYLOAD}
 for p in m.GUARDS:
  m.write_new(m.STAGED/'candidate'/p,(context/p.removeprefix('app/')).read_bytes())
 # Re-test attestation belongs to production. Here its files are synthetic fixture pins.
 m.verify_retest=lambda:None
 seed=m.ROOT/'release-20260919T000000Z-01234567';seed.mkdir();u.ROUTE_SEED=seed
 cfg=seed/'after.private.json';tag=project+':base'
 m.command(['docker','build','--pull=false','-t',tag,str(context)],timeout=600,log=root/'base-build.log')
 program="require('http').createServer((q,r)=>{r.setHeader('content-type','application/json');if(q.url==='/api/health'){r.end('{\\\"ok\\\":true}')}else{r.statusCode=403;r.end('{\\\"ok\\\":false}')}}).listen(3000,'0.0.0.0')"
 # Use plain JSON strings in program (one slash level, no shell).
 program=program.replace('\\"','"')
 health=['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
 env={'SITE_URL':'https://vitrinecity.com','LIA_CHAT_OPERATIONS_ENABLED':'true','LIA_OPERATIONS_TOKEN':'synthetic-not-a-credential',
      u.CONFIG_KEY:json.dumps({'enabled':True,'chat':{'model':'synthetic'},'fx':{'usdToBrl':'5'},'kling':{'videoUsdPerSecond':'0.084','imageUsdEach':'0.028','accountBinding':'synthetic','unitUsd':{'video':'0.14'}}})}
 definition={'name':project,'services':{'app':{'image':tag,'init':True,'restart':'no','network_mode':'none',
      'command':['node','-e',program],'environment':env,'volumes':['data:/data'],
      'healthcheck':{'test':health,'interval':'1s','timeout':'2s','retries':30}}},'volumes':{'data':{}}}
 m.write_new(cfg,json.dumps(definition).encode())
 results={}
 try:
  m.command(m.compose([cfg])+['up','-d','--no-build','--pull','never','--wait','--wait-timeout','60','app'],timeout=90,log=root/'base-up.log')
  old=m.app();m.EXPECTED_MOUNTS={x['Destination']:(x.get('Type'),x.get('Name'),x.get('Source'),x.get('RW')) for x in old['Mounts']}
  volume=next(x for x in old['Mounts'] if x['Destination']=='/data');assert volume['Name']==project+'_data';m.DATA=Path(volume['Source'])
  m.consumers=lambda:m.command(['docker','ps','--no-trunc','--filter','volume='+project+'_data','--format','{{.ID}}']).stdout.decode().splitlines()
  # Freeze ALL effective variables, including the defaults from the Node base image.
  frozen=m.render([cfg]);frozen['services']['app']['environment']=m.escape_values(m.environment(old));m.atomic_json(cfg,frozen)
  m.write_new(root/'.env',b'')
  dbpath=m.DATA/'vitrinecity.db'
  with sqlite3.connect(dbpath) as db:
   db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE neural_durable_jobs(status TEXT)')
   db.execute('CREATE TABLE retained_marker(id INTEGER)');db.execute('INSERT INTO retained_marker VALUES(42)')
  m.write_new(m.DATA/'marker.txt',b'private synthetic attachment')
  m.write_new(seed/'before-inspect.private.json',json.dumps(old).encode())
  m.write_new(seed/'state.private.json',json.dumps({'phase':'DEPLOYED','newImage':old['Image'],'frozenHashes':{'after.private.json':m.sha(m.private_read(cfg))}}).encode())
  original_latest={'directory':str(seed),'image':old['Image']};m.atomic_json(m.ROOT/'latest.private.json',original_latest)
  backup=root/'backup';backup.mkdir();database=m.sqlite_snapshot(backup/'data/vitrinecity.db')
  m.write_new(backup/'data/marker.txt',b'private synthetic attachment')
  m.write_new(backup/'manifest.private.json',json.dumps({'copiedFiles':{'marker.txt':{'sha256':m.sha(b'private synthetic attachment')}},'failedFiles':{}}).encode())
  report={'data':{'regularFilesVerified':1,'database':database}}
  m.find_backup=lambda:(backup,report)
  files={n:(HERE/n).read_bytes() for n in u.BUNDLE_HASHES}
  assert all(m.sha(v)==u.BUNDLE_HASHES[n] for n,v in files.items())
  def regression(work,image):
   args=['docker','run','--init','--rm','--pull','never','--network','none','--read-only','--no-healthcheck','--cap-drop','ALL',
    '--security-opt','no-new-privileges','--memory','768m','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,nodev,size=192m','--tmpfs','/data:rw,nosuid,nodev,size=32m','-w','/app']
   for name in REGRESSION:
    p=work/'regression'/name;m.write_new(p,(REPO/'app/scripts'/name).read_bytes());args+=['--mount',f'type=bind,source={p},target=/app/scripts/{name},readonly']
   args+=['--entrypoint','/usr/bin/env',image,'-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','TMPDIR=/tmp','node','--test','--test-reporter=tap',*('scripts/'+n for n in REGRESSION)]
   r=m.command(args,timeout=300,log=work/'regression.log',allow_failure=True)
   counts=m.parse_tap(m.private_read(work/'regression.log').decode());assert r.returncode==0 and counts==dict(tests=85,**{'pass':85},fail=0,cancelled=0,skipped=0,todo=0),counts
   return counts
  m.test_image=regression
  with patch.object(u,'quality',return_value={'syntheticFixtureOnly':True}):
   assert u.inspect_ready(m,b)[1] is False
   assert u.update(m,b,files,old,'a'*40)==0
  latest=m.load(m.ROOT/'latest.private.json');work=Path(latest['directory']);state=m.load(work/'state.private.json');new=m.app()
  assert state['phase']=='DEPLOYED' and new['Image']!=old['Image'] and m.healthy(new)
  assert u.inspect_ready(m,b)[1] is True and new['HostConfig']['Init'] is True
  assert m.runtime_hashes(new['Id'],[u.ENGINE])[u.ENGINE]==u.ENGINE_HASH
  assert m.mounts(new)==m.mounts(old) and m.environment(new)==u.wanted_environment(m.environment(old))
  with sqlite3.connect(dbpath) as db:
   assert db.execute('SELECT id FROM retained_marker').fetchall()==[(42,)];db.execute('INSERT INTO retained_marker VALUES(99)')
  m.rollback_work(work,state);m.atomic_json(m.ROOT/'latest.private.json',original_latest)
  restored=m.app();assert restored['Image']==old['Image'] and m.environment(restored)==m.environment(old)
  assert m.healthy(restored) and u.inspect_ready(m,b)[1] is False
  with sqlite3.connect(dbpath) as db:assert db.execute('SELECT id FROM retained_marker ORDER BY id').fetchall()==[(42,),(99,)]
  results={'regression':state['tests']['regression'],'nativeAudio':state['tests']['nativeAudio'],
   'realDockerUpdate':True,'codeOnlyRollback':True,'postDeploymentDatabaseWritePreserved':True,'forcedStopUsed':False}
  # A real post-swap API failure must restore the former image, without rewinding data.
  with patch.object(u,'quality',return_value={'syntheticFixtureOnly':True}),patch.object(m,'api_probe',side_effect=m.Blocked('SIMULATED_POST_SWAP_FAILURE')):
   assert u.update(m,b,files,restored,'a'*40)==2
  assert m.load(m.ROOT/'latest.private.json')==original_latest and m.app()['Image']==old['Image'] and m.healthy(m.app())
  with sqlite3.connect(dbpath) as db:assert db.execute('SELECT id FROM retained_marker ORDER BY id').fetchall()==[(42,),(99,)]
  results.update(automaticRollbackAfterFailure=True,productionAccess=False,providerCalls=0,databaseRestored=False)
  print('=== REAL AUDIO RELEASE CI RESULT ===',flush=True);print(json.dumps(results,indent=2),flush=True)
 finally:
  # Cleanup is bounded to the random test project, never to all Docker resources.
  if cfg.exists():m.command(m.compose([cfg])+['down','--volumes','--remove-orphans'],timeout=60,log=root/'cleanup.log',allow_failure=True)
  print('CI_PRIVATE_LOG_DIRECTORY='+str(root),flush=True)
if __name__=='__main__':main()
