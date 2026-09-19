"""CI ONLY, NOT A VPS COMMAND: real Docker Compose freeze/activate/rollback test.
Creates an isolated randomly named fixture; never mounts a production directory.
"""
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import os
import shutil

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('deploy',HERE/'deploy-lia-v9.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def run():
    if os.geteuid()!=0 or not os.environ.get('GITHUB_ACTIONS')=='true':
        raise RuntimeError('Integration fixture may only run as root on a GitHub Actions runner.')
    directory=Path(tempfile.mkdtemp(prefix='lia-v9-ci-',dir='/var/lib'))
    project='liav9ci'+secrets.token_hex(6)
    m.APP_ROOT=directory;m.PROJECT=project
    try:
        server="const http=require('http');http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');if(q.url==='/api/neural/chat/operations/status'){s.statusCode=401;s.end('{}');}else{s.end(JSON.stringify({ok:true}));}}).listen(3000,'0.0.0.0');"
        dockerfile='FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32\nWORKDIR /app\nCOPY server.cjs /app/server.cjs\nCMD ["node","server.cjs"]\n'
        m.write_new(directory/'Dockerfile',dockerfile.encode());m.write_new(directory/'server.cjs',server.encode())
        tag=project+':fixture'
        m.command(['docker','build','-t',tag,str(directory)],timeout=240,log=directory/'build.log')
        definition={'name':project,'services':{'app':{'image':tag,'environment':{'SITE_URL':'https://vitrinecity.com','VALUE':'a$$B$${C}','FAKE_API_KEY':'fixture-only'},
           'read_only':True,'restart':'unless-stopped','volumes':['data:/data'],
           'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],'interval':'1s','timeout':'2s','retries':20}}},
           'volumes':{'data':{}}}
        cfg=directory/'compose.json';m.write_new(cfg,json.dumps(definition).encode())
        m.command(m.compose([cfg])+['up','-d','--wait','--wait-timeout','60','app'],timeout=90,log=directory/'up.log')
        old=m.app();m.EXPECTED_MOUNTS={x['Destination']:(x.get('Type'),x.get('Name'),x.get('Source'),x.get('RW')) for x in old['Mounts']}
        work=directory/'release';work.mkdir(mode=0o700)
        m.write_new(work/'before-inspect.private.json',json.dumps(old).encode())
        env=m.intended_env(old,True,'test-token-'+'x'*64)
        print('SYNTHETIC_VALUE_ONLY',json.dumps({'runtime':m.environment(old)['VALUE'],'composeConfig':m.render([cfg])['services']['app']['environment']['VALUE']}),flush=True)
        try:
            m.frozen_files(work,old,tag,tag,env)
        except m.Blocked:
            if (work/'before.private.json').exists():
                rendered=m.render([work/'before.private.json'])['services']['app']['environment']
                print('SYNTHETIC_VALUE_ONLY_FROZEN',json.dumps({'runtime':m.environment(old)['VALUE'],'composeConfig':rendered.get('VALUE'),'differentKeys':[k for k in set(rendered)|set(m.environment(old)) if rendered.get(k)!=m.environment(old).get(k)]}),flush=True)
            raise
        m.command(['docker','stop','--time','10',old['Id']])
        m.original_resume(old,60)
        assert m.healthy(m.app())
        print('PASS real Docker: original resume keeps mounts and configuration.')
        m.compose_up(work/'after.private.json',work,old['Image'])
        current=m.wait_health(old['Image'],old,env,60)
        assert current['Id']!=old['Id'];m.api_probe(current['Id'])
        assert m.environment(current)['VALUE']=='a$B${C}'
        print('PASS real Docker: frozen Compose preserves literal dollars, volumes and process options.')
        state={'oldImage':old['Image'],'newImage':old['Image'],'frozenHashes':{n:m.sha(m.private_read(work/n)) for n in ('before.private.json','after.private.json')}}
        m.pending=lambda:0
        restored=m.rollback_work(work,state);assert m.environment(restored)==m.environment(old)
        print('PASS real Docker: configuration-only rollback returns the original environment.')
        again=m.rollback_work(work,state);assert again['Id']==restored['Id']
        print('PASS real Docker: repeated rollback is idempotent.')
        m.command(['docker','rm','-f',restored['Id']]);assert m.app_optional() is None
        restored=m.rollback_work(work,state);assert m.healthy(restored)
        print('PASS real Docker: rollback works after a failed recreation leaves no app container.')
    finally:
        if project.startswith('liav9ci') and len(project)==19:
            subprocess.run(['docker','compose','--project-directory',str(directory),'-p',project,'-f',str(directory/'compose.json'),'down','--volumes'],capture_output=True,timeout=60)
            subprocess.run(['docker','image','rm',project+':fixture'],capture_output=True,timeout=30)
        shutil.rmtree(directory)

if __name__=='__main__':run()
