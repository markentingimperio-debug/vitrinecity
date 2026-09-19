"""Synthetic archive tests; no Docker daemon, VPS, credentials or network."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('image_validator', HERE / 'backup-image-identity-v6.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

MAN = 'application/vnd.oci.image.manifest.v1+json'
IDX = 'application/vnd.oci.image.index.v1+json'
CONFIG = 'application/vnd.oci.image.config.v1+json'
LAYER = 'application/vnd.oci.image.layer.v1.tar'

def j(value):
    return json.dumps(value, separators=(',', ':')).encode()

def fixture(mode='classic', compressed=False, nested=False, attestation=False):
    # These are test bytes, not files extracted into a container.
    layer = b'example-layer-content\0' * 80
    stored = gzip.compress(layer, mtime=0) if compressed else layer
    cfg = j({'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':[m.sha(layer)]},
             'config':{'Env':['TEST_SECRET=never-display-this-value']}})
    entries = {}
    def add(data, media):
        digest = m.sha(data)
        entries['blobs/sha256/' + digest[7:]] = data
        return {'mediaType':media, 'digest':digest, 'size':len(data)}
    cdesc = add(cfg, CONFIG)
    ldesc = add(stored, LAYER + ('+gzip' if compressed else ''))
    cp = 'blobs/sha256/' + cdesc['digest'][7:]
    lp = 'blobs/sha256/' + ldesc['digest'][7:]
    entries['manifest.json'] = j([{'Config':cp,'RepoTags':None,'Layers':[lp]}])
    if mode == 'classic':
        return entries, cdesc['digest'], cp, lp
    md = add(j({'schemaVersion':2,'mediaType':MAN,'config':cdesc,'layers':[ldesc]}), MAN)
    children = [md]
    if attestation:
        ac = add(j({}), CONFIG)
        al = add(j({'evidence':'fixture'}), 'application/vnd.in-toto+json')
        children.append(add(j({'schemaVersion':2,'mediaType':MAN,'config':ac,'layers':[al]}), MAN))
    rootdesc = add(j({'schemaVersion':2,'mediaType':IDX,'manifests':children}), IDX)
    expected = md['digest'] if mode == 'manifest' else rootdesc['digest']
    if nested:
        rootdesc = add(j({'schemaVersion':2,'mediaType':IDX,'manifests':[rootdesc]}), IDX)
    entries['oci-layout'] = j({'imageLayoutVersion':'1.0.0'})
    entries['index.json'] = j({'schemaVersion':2,'mediaType':IDX,'manifests':[rootdesc]})
    return entries, expected, cp, lp

def write_tar(path, entries, extras=()):
    with tarfile.open(path, 'w') as tar:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        for info, data in extras:
            tar.addfile(info, io.BytesIO(data) if data is not None else None)

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'image.tar'

    def verify(self, data, expected, extras=()):
        write_tar(self.path, data, extras)
        return m.verify_image_archive(self.path, expected)

    def rejected(self, data, expected, code=None, extras=()):
        with self.assertRaises(m.InvalidArchive) as ctx:
            self.verify(data, expected, extras)
        if code:
            self.assertEqual(str(ctx.exception), code)
        self.assertNotIn('never-display-this-value', str(ctx.exception))

    def test_classic_config_identity(self):
        d,e,_,_=fixture()
        r=self.verify(d,e)
        self.assertEqual(r['mode'],'config_digest')
        self.assertEqual(r['layersVerified'],1)
        self.assertFalse(r['archiveExtracted'])

    def test_oci_manifest_identity(self):
        d,e,cp,_=fixture('manifest')
        self.assertNotEqual(m.sha(d[cp]),e)  # v5 would reject at this exact check.
        self.assertEqual(self.verify(d,e)['mode'],'oci_manifest_or_index')

    def test_oci_index_identity(self):
        d,e,_,_=fixture('index')
        self.assertTrue(self.verify(d,e)['identityVerified'])

    def test_nested_index_identity(self):
        d,e,_,_=fixture('index',nested=True)
        self.assertTrue(self.verify(d,e)['identityVerified'])

    def test_index_json_itself_can_be_root(self):
        d,_,_,_=fixture('index')
        self.assertTrue(self.verify(d,m.sha(d['index.json']))['identityVerified'])

    def test_oci_index_with_attestation(self):
        d,e,_,_=fixture('index',attestation=True)
        self.assertEqual(self.verify(d,e)['ociManifestsVerified'],2)

    def test_classic_gzip_diff_id(self):
        d,e,_,_=fixture(compressed=True)
        self.assertEqual(self.verify(d,e)['layersVerified'],1)

    def test_oci_gzip_layer(self):
        d,e,_,_=fixture('index',compressed=True)
        self.assertTrue(self.verify(d,e)['identityVerified'])

    def test_config_mutation_refused(self):
        d,e,cp,_=fixture('index')
        d[cp]=d[cp].replace(b'amd64',b'arm64')
        self.rejected(d,e,'descriptor_digest_mismatch')

    def test_layer_mutation_refused_classic(self):
        d,e,_,lp=fixture()
        d[lp]=b'wrong'
        self.rejected(d,e,'layer_diff_id_mismatch')

    def test_layer_mutation_refused_oci(self):
        d,e,_,lp=fixture('index')
        d[lp]=b'x'*len(d[lp])
        self.rejected(d,e,'descriptor_digest_mismatch')

    def test_wrong_expected_digest_refused(self):
        d,_,_,_=fixture('index')
        self.rejected(d,'sha256:'+'f'*64,'expected_id_not_linked_to_saved_config')

    def test_unlinked_blob_not_accepted_as_expected(self):
        d,_,_,_=fixture('index')
        unrelated=j({'schemaVersion':2,'mediaType':IDX,'manifests':[]})
        e=m.sha(unrelated)
        d['blobs/sha256/'+e[7:]]=unrelated
        self.rejected(d,e,'expected_id_not_linked_to_saved_config')

    def test_attestation_id_does_not_authorize_image(self):
        d,_,_,_=fixture('index',attestation=True)
        root=json.loads(d['index.json'])['manifests'][0]['digest']
        index=json.loads(d['blobs/sha256/'+root[7:]])
        self.rejected(d,index['manifests'][1]['digest'],'expected_id_not_linked_to_saved_config')

    def test_expected_string_only_in_annotation_not_accepted(self):
        d,_,_,_=fixture('index')
        e='sha256:'+'f'*64
        root=json.loads(d['index.json'])
        root['annotations']={'fakeImageId':e}
        d['index.json']=j(root)
        self.rejected(d,e,'expected_id_not_linked_to_saved_config')

    def test_missing_layer_refused(self):
        d,e,_,lp=fixture('index')
        del d[lp]
        self.rejected(d,e,'missing_regular_entry')

    def test_wrong_descriptor_size(self):
        d,e,_,_=fixture('index')
        index=json.loads(d['index.json'])
        index['manifests'][0]['size']+=1
        d['index.json']=j(index)
        self.rejected(d,e,'descriptor_size_mismatch')

    def test_multiple_docker_images_refused(self):
        d,e,_,_=fixture()
        d['manifest.json']=j(json.loads(d['manifest.json'])*2)
        self.rejected(d,e,'expected_one_docker_image')

    def test_layer_list_length_refused(self):
        d,e,_,_=fixture()
        df=json.loads(d['manifest.json']);df[0]['Layers']=[]
        d['manifest.json']=j(df)
        self.rejected(d,e,'invalid_image_layer_list')

    def test_duplicate_member_refused(self):
        d,e,_,_=fixture()
        info=tarfile.TarInfo('manifest.json');info.size=len(d['manifest.json'])
        self.rejected(d,e,'duplicate_archive_path',[(info,d['manifest.json'])])

    def test_duplicate_json_key_refused(self):
        d,e,_,_=fixture()
        d['manifest.json']=b'[{"Config":"x","Config":"y"}]'
        self.rejected(d,e,'duplicate_json_key')

    def test_parent_traversal_refused(self):
        d,e,_,_=fixture();d['../secret']=b'x'
        self.rejected(d,e,'invalid_path')

    def test_absolute_path_refused(self):
        d,e,_,_=fixture();d['/etc/shadow']=b'x'
        self.rejected(d,e,'invalid_path')

    def test_symlink_refused(self):
        d,e,_,_=fixture()
        info=tarfile.TarInfo('symlink');info.type=tarfile.SYMTYPE;info.linkname='/etc/shadow'
        self.rejected(d,e,'archive_link_or_special_file',[(info,None)])

    def test_hardlink_refused(self):
        d,e,_,_=fixture()
        info=tarfile.TarInfo('hardlink');info.type=tarfile.LNKTYPE;info.linkname='manifest.json'
        self.rejected(d,e,'archive_link_or_special_file',[(info,None)])

    def test_truncated_tar_refused(self):
        d,e,_,_=fixture();write_tar(self.path,d)
        self.path.write_bytes(self.path.read_bytes()[:2000])
        with self.assertRaises(m.InvalidArchive):
            m.verify_image_archive(self.path,e)

    def test_no_extract_or_subprocess(self):
        d,e,_,_=fixture('index')
        with patch.object(tarfile.TarFile,'extractall',side_effect=AssertionError('must not extract')), \
             patch('subprocess.run',side_effect=AssertionError('must not use Docker')):
            r=self.verify(d,e)
        self.assertTrue(r['identityVerified'])
        self.assertEqual(list(Path(self.temp.name).iterdir()),[self.path])

    def test_oversize_metadata_refused(self):
        d,e,_,_=fixture()
        with patch.object(m,'JSON_LIMIT',4):
            self.rejected(d,e,'metadata_too_large')

    def test_decompression_limit_refused(self):
        d,e,_,_=fixture(compressed=True)
        with patch.object(m,'UNPACKED_LIMIT',10):
            self.rejected(d,e,'expanded_layers_too_large')

    def test_unsupported_zstd_stops_without_installing(self):
        d,e,_,lp=fixture();d[lp]=b'\x28\xb5\x2f\xfd'+b'fixture'
        self.rejected(d,e,'zstd_layer_requires_review')

    def test_plain_wrong_archive_identity_refused(self):
        d,_,_,_=fixture()
        self.rejected(d,'sha256:'+'f'*64,'identity_not_proven_no_oci_index')

    def test_only_verifier_is_replaced(self):
        main=object();cold_copy=object();resume=object();writes=[]
        b=SimpleNamespace(Refused=RuntimeError,main=main,cold_copy=cold_copy,resume=resume,
                          verify_image_archive=None,write=lambda p,d:writes.append((p,d)))
        m.configure(b)
        self.assertIs(b.main,main);self.assertIs(b.cold_copy,cold_copy);self.assertIs(b.resume,resume)
        with patch.object(m,'verify_image_archive',side_effect=m.InvalidArchive('wrong_identity')):
            with self.assertRaisesRegex(RuntimeError,'wrong_identity'):
                b.verify_image_archive(self.path,'sha256:'+'0'*64)
        self.assertEqual(writes,[])

    def test_missing_explicit_mode_never_loads_backup(self):
        with patch.object(m.sys,'argv',['script']), patch.object(m,'load_backup') as load:
            with self.assertRaisesRegex(m.InvalidArchive,'explicit_mode_required'):
                m.main()
            load.assert_not_called()

    def test_evidence_has_no_config_secret(self):
        d,e,_,_=fixture('index')
        self.assertNotIn('TEST_SECRET',json.dumps(self.verify(d,e)))

if __name__=='__main__':
    unittest.main(verbosity=2)
