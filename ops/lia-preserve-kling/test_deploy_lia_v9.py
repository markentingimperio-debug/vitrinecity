"""Offline rollout contract tests. Docker/network/production access are mocked."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('lia_deploy',HERE/'deploy-lia-v9.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SHA='b'*40
IMAGE='sha256:'+'a'*64


def sample():
    return {'Id':'a'*64,'Image':m.ORIGINAL_IMAGE,'Name':'/vitrinecity-app-1',
      'State':{'Running':True,'Paused':False,'Restarting':False,'Health':{'Status':'healthy'}},
      'Config':{'Env':['SITE_URL=https://vitrinecity.com','DEEPSEEK_API_KEY=fixture-secret','VALUE=a$b${c}'],
          'Cmd':['node','server.js'],'Entrypoint':None,'WorkingDir':'/app','User':'',
          'Healthcheck':{'Test':['CMD','test-health']},'ExposedPorts':{'3000/tcp':{}},
          'Labels':{'com.docker.compose.project.config_files':','.join(m.BASE_COMPOSE)}},
      'HostConfig':{'ReadonlyRootfs':False,'Privileged':False,'RestartPolicy':{'Name':'unless-stopped'},'Memory':0},
      'Mounts':[{'Destination':p,'Type':v[0],'Name':v[1],'Source':v[2],'RW':v[3]} for p,v in m.EXPECTED_MOUNTS.items()],
      'NetworkSettings':{'Networks':{'vitrinecity_default':{'IPAddress':'172.18.0.5'}}}}


def gates():
    pr={'head':{'sha':SHA}}
    runs={'workflow_runs':[{'id':i,'head_sha':SHA,'event':'pull_request','name':n,'status':'completed','conclusion':'success'} for i,n in enumerate(m.REQUIRED_CI,1)]}
    sonar={'pullRequests':[{'key':'210','commit':{'sha':SHA},'status':{'qualityGateStatus':'OK'}}]}
    gate={'projectStatus':{'status':'OK'}}
    return pr,runs,sonar,gate

class DeploymentTests(unittest.TestCase):
    def test_gate_accepts_exact_reviewed_sha(self):
        self.assertTrue(m.validate_gate(SHA,*gates())['sonarSameRevisionApproved'])
    def test_gate_rejects_stale_pr(self):
        p,r,s,g=gates();p['head']['sha']='a'*40
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_rejects_stale_sonar(self):
        p,r,s,g=gates();s['pullRequests'][0]['commit']['sha']='a'*40
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_rejects_sonar_error(self):
        p,r,s,g=gates();g['projectStatus']['status']='ERROR'
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_rejects_pending_ci(self):
        p,r,s,g=gates();r['workflow_runs'][0]['status']='in_progress'
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_rejects_skipped_ci(self):
        p,r,s,g=gates();r['workflow_runs'][0]['conclusion']='skipped'
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_cannot_reuse_prior_success_after_failure(self):
        p,r,s,g=gates();new=copy.deepcopy(r['workflow_runs'][0]);new.update(id=999,conclusion='failure');r['workflow_runs'].append(new)
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_rejects_other_commit_checks(self):
        p,r,s,g=gates();r['workflow_runs'][0]['head_sha']='a'*40
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_requires_release_script_tests(self):
        p,r,s,g=gates();r['workflow_runs']=[x for x in r['workflow_runs'] if x['name']!='LIA deploy package tests']
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,s,g)
    def test_gate_rejects_missing_sonar(self):
        p,r,s,g=gates()
        with self.assertRaises(m.Blocked):m.validate_gate(SHA,p,r,{},g)
    def test_mount_order_does_not_block_recovery(self):
        a=sample();b=copy.deepcopy(a);b['Mounts'].reverse();self.assertEqual(m.mounts(a),m.mounts(b));m.runtime_equivalent(a,b,m.environment(a))
    def test_mount_source_change_is_refused(self):
        a=sample();b=copy.deepcopy(a);b['Mounts'][0]['Source']='/wrong'
        with self.assertRaises(m.Blocked):m.runtime_equivalent(a,b,m.environment(a))
    def test_read_write_change_refused(self):
        a=sample();b=copy.deepcopy(a);b['Mounts'][0]['RW']=False
        with self.assertRaises(m.Blocked):m.runtime_equivalent(a,b,m.environment(a))
    def test_duplicate_mount_refused(self):
        a=sample();a['Mounts'].append(copy.deepcopy(a['Mounts'][0]))
        with self.assertRaises(m.Blocked):m.topology(a)
    def test_topology_accepts_supplied_mounts(self):m.topology(sample())
    def test_unrelated_site_refused(self):
        a=sample();a['Config']['Env'][0]='SITE_URL=https://example.com'
        with self.assertRaises(m.Blocked):m.topology(a)
    def test_activation_preserves_provider_credentials(self):
        a=sample();e=m.intended_env(a,True,'x'*64)
        self.assertEqual(e['DEEPSEEK_API_KEY'],'fixture-secret');self.assertEqual(e['VALUE'],'a$b${c}')
        self.assertEqual(e['LIA_OPERATIONS_URL'],m.GATEWAY);self.assertEqual(e['LIA_CHAT_OPERATIONS_ENABLED'],'true')
    def test_default_deploy_does_not_enable_workers(self):
        self.assertEqual(m.intended_env(sample(),False)['LIA_CHAT_OPERATIONS_ENABLED'],'false')
    def test_enabling_requires_token(self):
        with self.assertRaises(m.Blocked):m.intended_env(sample(),True,None)
    def test_provider_secret_cannot_be_gateway_token(self):
        a=sample();t='k'*64;a['Config']['Env'][1]='DEEPSEEK_API_KEY='+t;a['Config']['Env'].append('LIA_OPERATIONS_TOKEN='+t)
        with self.assertRaises(m.Blocked):m.obtain_token(a)
    def test_invalid_token_rejected(self):
        a=sample();a['Config']['Env'].append('LIA_OPERATIONS_TOKEN=Bearer secret')
        with self.assertRaises(m.Blocked):m.obtain_token(a)
    def test_token_reused_from_existing_configuration(self):
        a=sample();a['Config']['Env'].append('LIA_OPERATIONS_TOKEN='+'x'*64)
        self.assertEqual(m.obtain_token(a),'x'*64)
    def test_compose_interpolation_escapes_values_not_keys(self):
        self.assertEqual(m.escape_values({'a$b':['a$B','a${B}',5]}),{'a$b':['a$$B','a$${B}',5]})
    def test_env_duplicates_refused(self):
        a=sample();a['Config']['Env'].append(a['Config']['Env'][0])
        with self.assertRaises(m.Blocked):m.environment(a)
    def test_env_changes_detected(self):
        a=sample();b=copy.deepcopy(a);b['Config']['Env'][1]='DEEPSEEK_API_KEY=different'
        with self.assertRaises(m.Blocked):m.runtime_equivalent(a,b,m.environment(a))
    def test_command_change_refused(self):
        a=sample();b=copy.deepcopy(a);b['Config']['Cmd']=['node','wrong.js']
        with self.assertRaises(m.Blocked):m.runtime_equivalent(a,b,m.environment(a))
    def test_privilege_change_refused(self):
        a=sample();b=copy.deepcopy(a);b['HostConfig']['Privileged']=True
        with self.assertRaises(m.Blocked):m.runtime_equivalent(a,b,m.environment(a))
    def test_container_new_ip_allowed(self):
        a=sample();b=copy.deepcopy(a);b['NetworkSettings']['Networks']['vitrinecity_default']['IPAddress']='172.18.0.8'
        m.runtime_equivalent(a,b,m.environment(a))
    def test_network_change_refused(self):
        a=sample();b=copy.deepcopy(a);b['NetworkSettings']['Networks']['wrong']={}
        with self.assertRaises(m.Blocked):m.runtime_equivalent(a,b,m.environment(a))
    def test_paused_not_healthy(self):
        a=sample();a['State']['Paused']=True;self.assertFalse(m.healthy(a))
    def test_missing_health_is_not_success(self):
        a=sample();del a['State']['Health'];self.assertFalse(m.healthy(a))
    def test_tap_52_passes(self):
        d=m.parse_tap('# tests 52\n# pass 52\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
        self.assertEqual(d,{'tests':52,'pass':52,'fail':0,'cancelled':0,'skipped':0,'todo':0})
    def test_empty_tap_not_success(self):self.assertIsNone(m.parse_tap('')['tests'])
    def test_gateway_probe_no_paid_task(self):
        self.assertNotIn('/v1/operations/tasks',m.GATEWAY_JS);self.assertIn('/v1/operations/quote',m.GATEWAY_JS)
        self.assertIn('workerEndToEndVerified:false',m.GATEWAY_JS)
    def test_bad_gateway_aborts(self):
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],2,b'{}')):
            with self.assertRaises(m.Blocked):m.gateway_probe('c','x'*64)
    def test_good_gateway_returns_only_bounded_evidence(self):
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],0,b'{"gatewayAuthenticated":true}')):
            self.assertTrue(m.gateway_probe('c','x'*64)['gatewayAuthenticated'])
    def test_compose_up_never_pulls_builds_or_touches_dependencies(self):
        with patch.object(m,'render',return_value={'services':{'app':{'image':'release-tag'}}}),patch.object(m,'image_id',return_value=IMAGE),patch.object(m,'command') as command:
            m.compose_up(Path('/state/a.json'),Path('/state'),IMAGE)
        args=command.call_args.args[0]
        for value in ('--no-deps','--no-build','never','--wait','app'):self.assertIn(value,args)
        self.assertNotIn('down',args);self.assertNotIn('--remove-orphans',args);self.assertNotIn('-v',args)
    def test_mutated_image_tag_prevents_compose_up(self):
        with patch.object(m,'render',return_value={'services':{'app':{'image':'release-tag'}}}),patch.object(m,'image_id',return_value='sha256:'+'f'*64),patch.object(m,'command') as command:
            with self.assertRaises(m.Blocked):m.compose_up(Path('/state/a.json'),Path('/state'),IMAGE)
            command.assert_not_called()
    def test_resume_original_accepts_mount_reorder(self):
        a=sample();b=copy.deepcopy(a);b['Mounts'].reverse();b['State']['Running']=False
        with patch.object(m,'inspect',return_value=b),patch.object(m,'command') as cmd,patch.object(m,'wait_health',return_value=a):
            m.original_resume(a)
        cmd.assert_called_once_with(['docker','start',a['Id']])
    def test_resume_original_refuses_real_change(self):
        a=sample();b=copy.deepcopy(a);b['Image']=IMAGE
        with patch.object(m,'inspect',return_value=b),patch.object(m,'command') as cmd:
            with self.assertRaises(m.Blocked):m.original_resume(a)
        cmd.assert_not_called()
    def test_rollback_restores_code_when_compose_left_no_container(self):
        a=sample();state={'oldImage':a['Image'],'newImage':IMAGE,'frozenHashes':{}}
        with patch.object(m,'load',return_value=a),patch.object(m,'app_optional',return_value=None),patch.object(m,'pending',return_value=0),patch.object(m,'compose_up') as up,patch.object(m,'wait_health',return_value=a):
            m.rollback_work(Path('/state'),state)
        up.assert_called_once_with(Path('/state/before.private.json'),Path('/state'),a['Image'])
    def test_rollback_blocked_when_operations_unsettled(self):
        a=sample();state={'oldImage':a['Image'],'newImage':IMAGE,'frozenHashes':{}}
        with patch.object(m,'load',return_value=a),patch.object(m,'app_optional',return_value=None),patch.object(m,'pending',return_value=1),patch.object(m,'compose_up') as up:
            with self.assertRaises(m.Blocked):m.rollback_work(Path('/state'),state)
        up.assert_not_called()
    def test_rollback_unknown_container_not_replaced(self):
        a=sample();b=copy.deepcopy(a);b['Image']='sha256:'+'f'*64
        state={'oldImage':a['Image'],'newImage':IMAGE,'frozenHashes':{}}
        with patch.object(m,'load',return_value=a),patch.object(m,'app_optional',return_value=b),patch.object(m,'compose_up') as up:
            with self.assertRaises(m.Blocked):m.rollback_work(Path('/state'),state)
        up.assert_not_called()
    def test_pending_counts_dispatched_real_sqlite(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'controlled'):
            root=Path(tmp);db=sqlite3.connect(root/'vitrinecity.db')
            db.execute('create table neural_durable_jobs(status text)');db.execute("insert into neural_durable_jobs values('dispatched')");db.commit();db.close()
            with patch.object(m,'DATA',root):self.assertEqual(m.pending(),1)
    def test_pending_terminal_rows_not_counted(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'controlled'):
            root=Path(tmp);db=sqlite3.connect(root/'vitrinecity.db');db.execute('create table neural_durable_jobs(status text)');db.execute("insert into neural_durable_jobs values('completed')");db.commit();db.close()
            with patch.object(m,'DATA',root):self.assertEqual(m.pending(),0)
    def test_new_file_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'controlled'):
            p=Path(tmp)/'p';m.write_new(p,b'original')
            with self.assertRaises(FileExistsError):m.write_new(p,b'changed')
            self.assertEqual(p.read_bytes(),b'original')
    def test_new_file_private_permissions(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'controlled'):
            p=Path(tmp)/'p';m.write_new(p,b'private');self.assertEqual(p.stat().st_mode&0o777,0o600)
    def test_health_timeout_is_failure(self):
        a=sample();a['State']['Health']['Status']='unhealthy'
        with patch.object(m,'app',return_value=a),patch.object(m.time,'sleep'),patch.object(m.time,'monotonic',side_effect=[0,0,200]):
            with self.assertRaises(m.Blocked):m.wait_health(a['Image'],a,m.environment(a),timeout=100)
    def test_api_requires_auth_boundary(self):
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],0,b'ok')):m.api_probe('fixture')
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],0,b'html')):
            with self.assertRaises(m.Blocked):m.api_probe('fixture')
    def test_commands_do_not_inherit_ambient_secrets(self):
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'')) as run:
            m.command(['docker','version'])
        self.assertEqual(run.call_args.kwargs['env'],m.SAFE_ENV);self.assertNotIn('DOCKER_HOST',run.call_args.kwargs['env'])
    def test_no_database_restore_code(self):
        source=(HERE/'deploy-lia-v9.py').read_text()
        self.assertNotIn('extractall(',source);self.assertNotIn('git pull',source[source.index('from __future__'):])
        self.assertNotIn("['docker','compose','down'",source)
        self.assertNotIn("sqlite3.connect(str(DATA",source)
    def test_manifest_scope_is_exactly_seven_files(self):
        self.assertEqual(len(m.PAYLOAD),7);self.assertNotIn('app/Dockerfile',m.PAYLOAD);self.assertNotIn('.env',m.PAYLOAD)
        self.assertEqual(m.PAYLOAD['app/vitriny-neural/chat-engine.js'],'21ea860eb44f4bba2f6aa9399758407fb93e581c42c40d5b378d5a5ca79b4cb9')

if __name__=='__main__':unittest.main(verbosity=2)
