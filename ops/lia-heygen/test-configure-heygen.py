#!/usr/bin/env python3
"""No account/network access; private directories and synthetic keys only."""
import contextlib
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

P=Path(__file__).with_name('configure-heygen.py')
loader=importlib.util.spec_from_file_location('heygen_config',P)
m=importlib.util.module_from_spec(loader);loader.loader.exec_module(m)
KEY='artificial-test-key-DO-NOT-USE'

def response(**changes):
    result={'data':{'key_id':'key_test01','status':'active','scope_mode':'scoped',
          'scopes':['lipsync:write','assets:write','account:read'],'expires_at':None}}
    result['data'].update(changes)
    return result

class FakeResponse(io.BytesIO):
    status=200
    def __init__(self, value, mime='application/json',url=m.URL):
        super().__init__(json.dumps(value).encode());self.url=url
        from email.message import Message
        self.headers=Message();self.headers['content-type']=mime
    def geturl(self):return self.url

class MetadataTests(unittest.TestCase):
    def test_restricted_grants(self):
        r=m.access_metadata(response());self.assertTrue(all(r['requiredScopesVerified'].values()))
        self.assertEqual(len(r['accountBinding']),64);self.assertFalse(r['broadAccess'])
    def test_full_grants(self):
        self.assertTrue(m.access_metadata(response(scope_mode='full',scopes=[]))['broadAccess'])
    def test_account_write_includes_read(self):
        r=m.access_metadata(response(scopes=['lipsync:write','assets:write','account:write']))
        self.assertTrue(r['requiredScopesVerified']['account:read'])
    def test_readonly_cannot_generate(self):
        with self.assertRaisesRegex(m.Refused,'PERMISSOES_INSUFICIENTES'):
            m.access_metadata(response(scopes=['lipsync:read','assets:read','account:read']))
    def test_revoked_key(self):
        with self.assertRaisesRegex(m.Refused,'NAO_ATIVA'):m.access_metadata(response(status='revoked'))
    def test_expired(self):
        with self.assertRaisesRegex(m.Refused,'EXPIRADA'):m.access_metadata(response(expires_at='2020-01-01T00:00:00Z'))
    def test_future_expiry(self):
        future=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=30)
        self.assertEqual(m.access_metadata(response(expires_at=future.isoformat()))['expiresAt'],future.isoformat())
    def test_no_timezone(self):
        with self.assertRaisesRegex(m.Refused,'EXPIRADA'):m.access_metadata(response(expires_at='2099-01-01T00:00:00'))
    def test_missing_expiry_not_silently_infinite(self):
        r=response();del r['data']['expires_at']
        with self.assertRaisesRegex(m.Refused,'VALIDADE_HEYGEN_NAO_INFORMADA'):m.access_metadata(r)
    def test_bad_metadata(self):
        for value in [None,[],{}, {'data':[]},{'error':{'code':'bad'}},response(scopes=None),response(key_id='../key')]:
            with self.subTest(value=value),self.assertRaises(m.Refused):m.access_metadata(value)
    def test_masked_key_and_voice_id(self):
        for key in ['********','short','Bearer '+KEY,'x-api-key:'+KEY,'"'+KEY+'"','cgSgspJ2msm6clMCkdW9','part...rest']:
            with self.subTest(key=key),self.assertRaises(m.Refused):m.key_value(key)
    def test_strip_whitespace_only(self):self.assertEqual(m.key_value(' '+KEY+'\n'),KEY)
    def test_redirect_not_followed(self):
        with self.assertRaisesRegex(m.Refused,'REDIRECIONAMENTO'):
            m.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://bad.example')
    def test_one_get_with_no_query_or_body(self):
        calls=[]
        class Opener:
            def open(_,request,timeout):
                calls.append(request);return FakeResponse(response())
        with patch.object(m.urllib.request,'build_opener',return_value=Opener()):m.verify_key(KEY)
        self.assertEqual(len(calls),1);r=calls[0]
        self.assertEqual(r.full_url,'https://api.heygen.com/v3/api_keys/self')
        self.assertEqual(r.get_method(),'GET');self.assertIsNone(r.data)
        self.assertEqual(r.get_header('X-api-key'),KEY)
    def test_auth_error_is_filtered(self):
        raw={'error':{'code':'unauthorized','message':KEY}}
        error=urllib.error.HTTPError(m.URL,401,'raw '+KEY,{},io.BytesIO(json.dumps(raw).encode()))
        opener=unittest.mock.Mock();opener.open.side_effect=error
        with patch.object(m.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(m.Refused) as caught:m.verify_key(KEY)
        self.assertEqual(str(caught.exception),'CHAVE_HEYGEN_INVALIDA_OU_EXPIRADA')
        self.assertNotIn(KEY,str(caught.exception))
    def test_permission_error_is_filtered(self):
        raw={'error':{'code':'insufficient_api_key_scope','message':KEY}}
        error=urllib.error.HTTPError(m.URL,403,'',{},io.BytesIO(json.dumps(raw).encode()))
        opener=unittest.mock.Mock();opener.open.side_effect=error
        with patch.object(m.urllib.request,'build_opener',return_value=opener):
            with self.assertRaisesRegex(m.Refused,'PERMISSOES_HEYGEN_INSUFICIENTES'):m.verify_key(KEY)
    def test_html_not_printed(self):
        error=urllib.error.HTTPError(m.URL,403,'',{},io.BytesIO(('<html>'+KEY).encode()))
        opener=unittest.mock.Mock();opener.open.side_effect=error
        with patch.object(m.urllib.request,'build_opener',return_value=opener):
            with self.assertRaisesRegex(m.Refused,'CONSULTA_HEYGEN_HTTP_403'):m.verify_key(KEY)
    def test_oversize_body(self):
        opener=unittest.mock.Mock();opener.open.return_value=FakeResponse({'data':'x'*132000})
        with patch.object(m.urllib.request,'build_opener',return_value=opener):
            with self.assertRaisesRegex(m.Refused,'MUITO_GRANDE'):m.verify_key(KEY)
    def test_does_not_print_key(self):
        opener=unittest.mock.Mock();opener.open.return_value=FakeResponse(response())
        text=io.StringIO()
        with patch.object(m.urllib.request,'build_opener',return_value=opener),contextlib.redirect_stdout(text):m.verify_key(KEY)
        self.assertNotIn(KEY,text.getvalue())

@unittest.skipUnless(os.geteuid()==0,'root-only filesystem contract')
class StorageTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(tempfile.mkdtemp(prefix='lia-heygen-test-',dir='/root'))
        os.chmod(self.root,0o700);self.folder=self.root/'new'/'heygen'
        self.patch=patch.object(m,'FOLDER',str(self.folder));self.patch.start()
    def tearDown(self):self.patch.stop();shutil.rmtree(self.root)
    def test_read_check_no_create(self):
        self.assertFalse(m.exists());self.assertFalse(self.folder.exists())
    def test_save_private(self):
        m.save_new(KEY,m.access_metadata(response()))
        p=self.folder/m.NAME;cfg=json.loads(p.read_text())
        self.assertEqual(p.stat().st_mode&0o777,0o600)
        self.assertEqual(self.folder.stat().st_mode&0o777,0o700)
        self.assertEqual(cfg['allowedUserIds'],[1]);self.assertFalse(cfg['generationPermissionVerified'])
        self.assertEqual(cfg['apiKey'],KEY);self.assertEqual(list(self.folder.iterdir()),[p])
    def test_no_overwrite(self):
        m.save_new(KEY,m.access_metadata(response()));p=self.folder/m.NAME;before=p.read_bytes()
        with self.assertRaisesRegex(m.Refused,'JA_EXISTE'):m.save_new(KEY+'-new',m.access_metadata(response()))
        self.assertEqual(p.read_bytes(),before)
    def test_dangling_config_symlink_refused(self):
        self.folder.mkdir(parents=True,mode=0o700);p=self.folder/m.NAME;p.symlink_to(self.root/'missing')
        self.assertTrue(m.exists())
        with self.assertRaisesRegex(m.Refused,'JA_EXISTE'):m.save_new(KEY,m.access_metadata(response()))
        self.assertTrue(p.is_symlink());self.assertFalse((self.root/'missing').exists())
    def test_parent_symlink_not_followed(self):
        self.folder.parent.mkdir(mode=0o700);dest=self.root/'different';dest.mkdir(mode=0o700);self.folder.symlink_to(dest)
        with self.assertRaises(OSError):m.save_new(KEY,m.access_metadata(response()))
        self.assertEqual(list(dest.iterdir()),[])
    def test_group_writable_parent_refused(self):
        self.folder.parent.mkdir(mode=0o700);os.chmod(self.folder.parent,0o770)
        with self.assertRaisesRegex(m.Refused,'DIRETORIO_INSEGURO'):m.save_new(KEY,m.access_metadata(response()))
    def test_shared_final_directory_refused(self):
        self.folder.mkdir(parents=True,mode=0o700);os.chmod(self.folder,0o755)
        with self.assertRaisesRegex(m.Refused,'DEVE_SER_PRIVADA'):m.save_new(KEY,m.access_metadata(response()))
    def test_entrypoint_checks_hostname_before_access(self):
        with patch.object(m.socket,'gethostname',return_value='srv1987582'),patch.object(m,'verify_key') as network:
            with self.assertRaisesRegex(m.Refused,'SRV1901029'):m.main()
        network.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
