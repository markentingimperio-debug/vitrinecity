"""CI ONLY: real Docker transition without init -> init and code-only rollback.
Only synthetic app/config/database, no provider/network requests or production access.
Docker stop uses a 2-second grace period in this disposable fixture (production: 60).
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

def main():
    if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':
        raise RuntimeError('CI runner only; never run on a production VPS.')
    spec=importlib.util.spec_from_file_location('fixture_deploy',HERE/'deploy-lia-v92.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    directory=Path(tempfile.mkdtemp(prefix='lia-init-ci-',dir='/var/lib'))
    project='liainitci'+secrets.token_hex(6)
    m.APP_ROOT=directory;m.PROJECT=project
    real_command=m.command
    def command(args,**kwargs):
        args=list(args)
        if args[:4]==['docker','stop','--time','60']:
            args[3]='2'
        return real_command(args,**kwargs)
    m.command=command
    cfg=directory/'compose.json'
    try:
        server="""const http=require('http');http.createServer((q,s)=>{
s.setHeader('Content-Type','application/json');
if(q.url==='/api/neural/chat/operations/status'){s.statusCode=401;s.end('{}');}
else{s.end(JSON.stringify({ok:true}));}}).listen(3000,'0.0.0.0');"""
        dockerfile='FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32\nWORKDIR /app\nCOPY server.cjs /app/server.cjs\nCMD ["node","server.cjs"]\n'
        m.write_new(directory/'Dockerfile',dockerfile.encode());m.write_new(directory/'server.cjs',server.encode())
        tag=project+':fixture'
        m.command(['docker','build','-t',tag,str(directory)],timeout=240,log=directory/'build.log')
        definition={'name':project,'services':{'app':{'image':tag,'environment':{'SITE_URL':'https://vitrinecity.com','VALUE':'literal$$D$${TEST}','FAKE_API_KEY':'fixture-only'},
          'read_only':True,'restart':'unless-stopped','volumes':['data:/data'],
          'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                        'interval':'1s','timeout':'2s','retries':20}}},'volumes':{'data':{}}}
        m.write_new(cfg,json.dumps(definition).encode())
        m.command(m.compose([cfg])+['up','-d','--wait','--wait-timeout','60','app'],timeout=90,log=directory/'up.log')
        old=m.app();m.LEGACY_CONTAINER=old['Id'];m.ORIGINAL_IMAGE=old['Image']
        m.EXPECTED_MOUNTS={x['Destination']:(x.get('Type'),x.get('Name'),x.get('Source'),x.get('RW')) for x in old['Mounts']}
        actual=next(x for x in old['Mounts'] if x['Destination']=='/data')
        assert actual.get('Name')==project+'_data'
        m.DATA=Path(actual['Source'])
        m.consumers=lambda: m.command(['docker','ps','--no-trunc','--filter','volume='+project+'_data','--format','{{.ID}}']).stdout.decode().splitlines()
        with m.sqlite3.connect(m.DATA/'vitrinecity.db') as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE neural_durable_jobs(status TEXT)')
            db.execute('CREATE TABLE retained_marker(id INTEGER)')
            db.execute('INSERT INTO retained_marker VALUES(42)')
        work=directory/'release';work.mkdir(mode=0o700)
        m.write_new(work/'before-inspect.private.json',json.dumps(old).encode())
        env=m.intended_env(old,True,'fixture-only-'+'x'*64)
        m.frozen_files(work,old,tag,tag,env)
        state={'oldImage':old['Image'],'newImage':old['Image'],
               'frozenHashes':{n:m.sha(m.private_read(work/n)) for n in ('before.private.json','after.private.json')}}
        stop=m.stop_for_rollout(old,work,True)
        assert stop['legacyForcedStopUsed'] is True and stop['exitCode']==137 and stop['oomKilled'] is False
        assert m.sqlite_snapshot(work/'after-stop.sqlite')['integrityCheck']=='ok'
        print('PASS: real PID-1 fixture forced-stop recorded honestly; real SQLite backup and fence used.',flush=True)
        m.compose_up(work/'after.private.json',work,old['Image'])
        active=m.wait_health(old['Image'],old,env,60)
        assert active['HostConfig']['Init'] is True and active['Id']!=old['Id']
        m.api_probe(active['Id'])
        print('PASS: new app uses init; environment, mounts, API and literal dollars preserved.',flush=True)
        # A forced-stop exception must NOT apply to the new container.
        next_work=directory/'next-stop';next_work.mkdir(mode=0o700)
        stop=m.stop_for_rollout(active,next_work,False)
        assert stop['legacyForcedStopUsed'] is False and stop['exitCode']==143
        print('PASS: subsequent shutdown exits 143, without forced-stop exception.',flush=True)
        m.original_resume(active,60)
        restored=m.rollback_work(work,state)
        assert m.healthy(restored) and m.environment(restored)==m.environment(old)
        assert restored['HostConfig'].get('Init') in (None,False)
        with m.sqlite3.connect(m.DATA/'vitrinecity.db') as db:
            assert db.execute('SELECT id FROM retained_marker').fetchall()==[(42,)]
            assert db.execute('PRAGMA integrity_check').fetchone()==('ok',)
        assert m.rollback_work(work,state)['Id']==restored['Id']
        print('PASS: code/config-only rollback is idempotent and never restores database rows.',flush=True)
    finally:
        if re.fullmatch(r'liainitci[0-9a-f]{12}',project):
            if cfg.exists():
                subprocess.run(['docker','compose','--project-directory',str(directory),'-p',project,'-f',str(cfg),'down','--volumes','--timeout','2'],capture_output=True,timeout=60)
            subprocess.run(['docker','image','rm',project+':fixture'],capture_output=True,timeout=30)
        shutil.rmtree(directory)

if __name__=='__main__':main()
