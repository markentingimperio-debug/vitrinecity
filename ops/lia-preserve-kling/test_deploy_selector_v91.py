"""Selector regression plus existing rollout tests. No VPS/network/Docker in unit mode."""
import copy
import hashlib
import importlib.util
import itertools
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def imported(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

repair = imported('selector_repair', HERE / 'fix-deploy-selector-v91.py')
original = (HERE / 'deploy-lia-v9.py').read_bytes()
fixed = repair.build(original)
m = types.ModuleType('selector_fixed_deploy')
m.__file__ = str(HERE / 'deploy-lia-v9-fixed.py')
exec(compile(fixed, m.__file__, 'exec'), m.__dict__)
MAIN_ID = '98ad009a8cfab575d34c62c293e669d452edc4f2d529fd26e2042183a850e5f1'

def container(cid=MAIN_ID, name='/vitrinecity-app-1', status='running'):
    return {'Id':cid, 'Name':name,
            'State':{'Status':status, 'Running':status=='running', 'Paused':False, 'Restarting':False},
            'Config':{'Labels':{'com.docker.compose.project':'vitrinecity',
                                'com.docker.compose.service':'app',
                                'com.docker.compose.oneoff':'False'}}}

def inventory():
    rows=[container()]
    for cid, name in m.RETIRED_APPS.items():
        row=container(cid,name,'exited')
        del row['Config']['Labels']['com.docker.compose.oneoff']
        rows.append(row)
    return rows

class SelectorTests(unittest.TestCase):
    def test_exact_report_selects_primary_in_all_orders(self):
        for rows in itertools.permutations(inventory()):
            with self.subTest(order=[r['Id'][:4] for r in rows]):
                self.assertEqual(m.select_app(rows)['Id'], MAIN_ID)
    def test_only_primary_works(self):
        self.assertEqual(m.select_app([container()])['Id'],MAIN_ID)
    def test_empty_list_is_not_a_historical_fallback(self):
        self.assertIsNone(m.select_app([]))
    def test_missing_primary_with_historical_checks_returns_none_for_rollback(self):
        self.assertIsNone(m.select_app(inventory()[1:]))
    def test_stopped_primary_is_found_for_recovery(self):
        rows=inventory(); rows[0]['State'].update(Status='exited',Running=False)
        self.assertEqual(m.select_app(rows)['Id'],MAIN_ID)
    def test_new_primary_id_is_allowed_after_recreation(self):
        rows=inventory();rows[0]['Id']='f'*64
        self.assertEqual(m.select_app(rows)['Id'],'f'*64)
    def test_unknown_extra_never_ignored_even_stopped(self):
        for status in ('exited','running','paused','created','dead'):
            with self.subTest(status=status),self.assertRaises(m.Blocked):
                m.select_app(inventory()+[container('e'*64,'/unknown-app',status)])
    def test_known_name_with_different_id_is_not_allowlisted(self):
        rows=inventory();rows[1]['Id']='d'*64
        with self.assertRaises(m.Blocked):m.select_app(rows)
    def test_known_id_with_different_name_is_not_allowlisted(self):
        rows=inventory();rows[1]['Name']='/renamed-check'
        with self.assertRaises(m.Blocked):m.select_app(rows)
    def test_historical_status_must_be_exited(self):
        for status in ('running','paused','created','restarting','removing','dead',None):
            rows=inventory();rows[1]['State']['Status']=status
            with self.subTest(status=status),self.assertRaises(m.Blocked):m.select_app(rows)
    def test_historical_flags_must_be_explicitly_false(self):
        for key in ('Running','Paused','Restarting'):
            for value in (True,None,'false',0):
                rows=inventory();rows[1]['State'][key]=value
                with self.subTest(key=key,value=value),self.assertRaises(m.Blocked):m.select_app(rows)
    def test_historical_missing_state_refused(self):
        rows=inventory();rows[1].pop('State')
        with self.assertRaises(m.Blocked):m.select_app(rows)
    def test_duplicate_id_refused(self):
        rows=inventory();rows.append(copy.deepcopy(rows[0]))
        with self.assertRaises(m.Blocked):m.select_app(rows)
    def test_two_primary_names_refused(self):
        rows=inventory();rows.append(container('c'*64))
        with self.assertRaises(m.Blocked):m.select_app(rows)
    def test_invalid_id_refused(self):
        rows=inventory();rows[0]['Id']='abc'
        with self.assertRaises(m.Blocked):m.select_app(rows)
    def test_wrong_labels_refused(self):
        for key,value in (('com.docker.compose.project','wrong'),('com.docker.compose.service','wrong')):
            rows=inventory();rows[0]['Config']['Labels'][key]=value
            with self.subTest(key=key),self.assertRaises(m.Blocked):m.select_app(rows)
    def test_main_oneoff_or_missing_label_refused(self):
        for value in ('True','',None):
            rows=inventory();rows[0]['Config']['Labels']['com.docker.compose.oneoff']=value
            with self.subTest(value=value),self.assertRaises(m.Blocked):m.select_app(rows)
    def test_selection_does_not_mutate_inspection(self):
        rows=inventory();before=copy.deepcopy(rows);m.select_app(rows);self.assertEqual(rows,before)
    def test_only_inventory_and_inspection_commands(self):
        rows=inventory();mapping={r['Id']:r for r in rows}
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],0,('\n'.join(mapping)+'\n').encode())) as cmd,patch.object(m,'inspect',side_effect=mapping.__getitem__) as ins:
            self.assertEqual(m.app_optional()['Id'],MAIN_ID)
        args=cmd.call_args.args[0];self.assertEqual(args[:3],['docker','ps','-a'])
        self.assertEqual(cmd.call_count,1);self.assertEqual(ins.call_count,3)
    def test_duplicate_listing_refused_before_inspect(self):
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],0,(MAIN_ID+'\n'+MAIN_ID+'\n').encode())),patch.object(m,'inspect') as ins:
            with self.assertRaises(m.Blocked):m.app_optional()
            ins.assert_not_called()
    def test_missing_container_during_inspect_blocks(self):
        with patch.object(m,'command',return_value=subprocess.CompletedProcess([],0,(MAIN_ID+'\n').encode())),patch.object(m,'inspect',side_effect=m.Blocked('MISSING')):
            with self.assertRaises(m.Blocked):m.app_optional()
    def test_exact_source_and_result_hashes(self):
        self.assertEqual(hashlib.sha256(original).hexdigest(),repair.SOURCE_SHA256)
        self.assertEqual(hashlib.sha256(fixed).hexdigest(),repair.RESULT_SHA256)
    def test_no_change_outside_selection(self):
        self.assertEqual(fixed.replace(repair.NEW_SELECTION.encode(),repair.OLD_SELECTION.encode(),1),original)
    def test_altered_source_is_not_patched(self):
        with self.assertRaises(ValueError):repair.build(original+b'\n')


def integration():
    """Reuse real Compose tests, adding stopped labelled extras in the isolated CI project."""
    fixture=imported('compose_selector_fixture',HERE/'integration_compose_v9.py')
    fixture.m=m
    extras={}
    signatures={}
    actual_app=m.app
    def signature(row):
        return {k:row[k] for k in ('Id','Name','Image','Config','HostConfig','State')}
    def unchanged():
        for cid,expected in signatures.items():
            assert signature(m.inspect(cid))==expected,'historical fixture was modified'
    def guarded_app():
        result=actual_app()
        if not extras:
            assert m.PROJECT.startswith('liav9ci') and len(m.PROJECT)==19
            for suffix in ('search-final-check','search-check'):
                name=m.PROJECT+'-'+suffix
                m.command(['docker','run','--name',name,'--label','com.docker.compose.project='+m.PROJECT,
                           '--label','com.docker.compose.service=app','--entrypoint','node',
                           result['Image'],'-e','process.exit(0)'],timeout=30)
                row=m.inspect(name);cid=row['Id']
                assert row['State']['Status']=='exited'
                assert not (row['Config'].get('Labels') or {}).get('com.docker.compose.oneoff')
                extras[cid]='/'+name;signatures[cid]=signature(row)
            m.RETIRED_APPS=extras.copy()
            result=actual_app()
            print('PASS real Docker: stopped labelled checks do not obscure the primary app.')
        unchanged()
        return result
    m.app=guarded_app
    try:
        fixture.run()
        print('PASS real Docker: historical checks remained unchanged through activation and rollback.')
    finally:
        for cid in extras:
            subprocess.run(['docker','rm','-f',cid],capture_output=True,timeout=30)


if __name__=='__main__':
    if sys.argv[1:]==['--integration']:
        integration()
    else:
        loader=unittest.TestLoader()
        suites=[loader.loadTestsFromTestCase(SelectorTests)]
        for name in ('test_deploy_lia_v9','test_compose_serialization_v9'):
            previous=imported(name,HERE/(name+'.py'))
            previous.m=m
            suites.append(loader.loadTestsFromModule(previous))
        result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(suites))
        raise SystemExit(0 if result.wasSuccessful() else 1)
