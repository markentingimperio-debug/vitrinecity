"""GitHub CI only: real one-file image rollout and rollback with synthetic data.
The 52 production-image regression tests are NOT run by this synthetic fixture;
they remain required on the VPS before its stop. Gate failures are tested offline.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent

def module(name,path):
    s=importlib.util.spec_from_file_location(name,path)
    o=importlib.util.module_from_spec(s);s.loader.exec_module(o);return o

def main():
    if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':
        raise RuntimeError('CI only: never execute this fixture on a VPS.')
    u=module('updater',HERE/'update-image-route-v93.py')
    m=module('helper',HERE/'deploy-lia-v92.py')
    tests=module('offline',HERE/'test_image_route_v93.py')
    basepath=Path(tempfile.mkdtemp(prefix='lia-route-ci-',dir='/var/lib'))
    project='liarouteci'+secrets.token_hex(6)
    m.APP_ROOT=basepath;m.PROJECT=project;m.ROOT=basepath/'releases';m.ROOT.mkdir(mode=0o700)
    seed=m.ROOT/'release-20260919T000000Z-01234567';seed.mkdir(mode=0o700);u.SEED=seed
    cfg=seed/'after.private.json'
    app_source=HERE.parents[1]/'app'
    tag=project+':fixture'
    try:
        engine_dir=basepath/'vitriny-neural';engine_dir.mkdir()
        m.write_new(engine_dir/'chat-engine.js',tests.engine_before())
        for n in ('chat-attachments.js','durable-job-queue.js','response-state.js'):
            m.write_new(engine_dir/n,(app_source/'vitriny-neural'/n).read_bytes())
        m.write_new(basepath/'web-story-assets.js',(app_source/'web-story-assets.js').read_bytes())
        m.write_new(basepath/'package.json',b'{"type":"module"}')
        server="const http=require('http');http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');if(q.url==='/api/neural/chat/operations/status'){s.statusCode=401;s.end('{}');}else{s.end(JSON.stringify({ok:true}));}}).listen(3000);"
        m.write_new(basepath/'fixture.cjs',server.encode())
        dockerfile='FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32\nWORKDIR /app\nCOPY vitriny-neural ./vitriny-neural\nCOPY package.json web-story-assets.js fixture.cjs ./\nCMD ["node","fixture.cjs"]\n'
        m.write_new(basepath/'Dockerfile',dockerfile.encode())
        m.command(['docker','build','-t',tag,str(basepath)],timeout=240,log=basepath/'build.log')
        definition={'name':project,'services':{'app':{'image':tag,'init':True,
            'environment':{'SITE_URL':'https://vitrinecity.com','LIA_CHAT_OPERATIONS_ENABLED':'true','LIA_OPERATIONS_TOKEN':'fixture-only-token-not-real','DOLLAR':'literal$$X$${Y}'},
            'read_only':True,'restart':'unless-stopped','volumes':['data:/data'],
            'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                           'interval':'1s','timeout':'2s','retries':20}}},'volumes':{'data':{}}}
        m.write_new(cfg,json.dumps(definition).encode())
        m.command(m.compose([cfg])+['up','-d','--wait','--wait-timeout','60','app'],timeout=90,log=basepath/'up.log')
        old=m.app()
        m.EXPECTED_MOUNTS={x['Destination']:(x.get('Type'),x.get('Name'),x.get('Source'),x.get('RW')) for x in old['Mounts']}
        volume=next(x for x in old['Mounts'] if x['Destination']=='/data')
        assert volume.get('Name')==project+'_data';m.DATA=Path(volume['Source'])
        m.consumers=lambda: m.command(['docker','ps','--no-trunc','--filter','volume='+project+'_data','--format','{{.ID}}']).stdout.decode().splitlines()
        with m.sqlite3.connect(m.DATA/'vitrinecity.db') as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE neural_durable_jobs(status TEXT)')
            db.execute('CREATE TABLE retained_marker(id INTEGER)')
            db.execute('INSERT INTO retained_marker VALUES(42)')
        m.write_new(seed/'before-inspect.private.json',json.dumps(old).encode())
        m.write_new(seed/'state.private.json',json.dumps({'phase':'DEPLOYED','newImage':old['Image'],
                     'frozenHashes':{'after.private.json':m.sha(m.private_read(cfg))}}).encode())
        m.atomic_json(m.ROOT/'latest.private.json',{'directory':str(seed),'image':old['Image']})
        m.write_new(basepath/'.env',b'FIXTURE=true\n')
        # These three original checks require the real deployed instance; separately unit-tested.
        m.PAYLOAD={u.ENGINE:u.BEFORE_HASH};m.GUARDS=()
        m.verify_retest=lambda: None
        m.quality=lambda revision:{'syntheticCiOnly':True}
        m.find_backup=lambda:(basepath,{'synthetic':True})
        m.verify_backup=lambda *a:{'syntheticCiOnly':True}
        m.test_image=lambda *a:{'notRunInSyntheticFixture':True}
        assert u.inspect_ready(m)[1] is False
        assert u.update(m,old,'a'*40)==0
        active,applied=u.inspect_ready(m)
        assert applied and m.healthy(active) and active['HostConfig']['Init'] is True
        assert m.environment(active)==m.environment(old) and m.mounts(active)==m.mounts(old)
        print('PASS real Docker: routing updated, init/token/settings/volumes preserved; no providers called.',flush=True)
        latest=m.load(m.ROOT/'latest.private.json');work=Path(latest['directory']);state=m.load(work/'state.private.json')
        assert state['tests']['routing']['tests']==22
        assert state['stopEvidence']['legacyForcedStopUsed'] is False
        with m.sqlite3.connect(m.DATA/'vitrinecity.db') as db:db.execute('INSERT INTO retained_marker VALUES(43)')
        restored=m.rollback_work(work,state)
        assert m.healthy(restored) and restored['Image']==old['Image'] and restored['HostConfig']['Init'] is True
        assert m.runtime_hashes(restored['Id'],m.PAYLOAD)==m.PAYLOAD
        with m.sqlite3.connect(m.DATA/'vitrinecity.db') as db:
            assert db.execute('SELECT id FROM retained_marker ORDER BY id').fetchall()==[(42,),(43,)]
        assert m.rollback_work(work,state)['Id']==restored['Id']
        print('PASS real Docker: rollback preserved old routing and rows written after update; idempotent.',flush=True)
    finally:
        if re.fullmatch(r'liarouteci[0-9a-f]{12}',project):
            subprocess.run(['docker','compose','--project-directory',str(basepath),'-p',project,'-f',str(cfg),'down','--volumes','--timeout','2'],capture_output=True,timeout=60)
            subprocess.run(['docker','image','rm',tag],capture_output=True,timeout=30)
        shutil.rmtree(basepath)

if __name__=='__main__':main()
