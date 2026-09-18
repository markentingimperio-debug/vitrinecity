"""Offline serialization/CLI tests: synthetic values only, no Docker or credentials."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('lia_deploy', HERE / 'deploy-lia-v9.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SerializationTests(unittest.TestCase):
    def test_serialized_environment_is_decoded_once(self):
        raw = {'VALUE': 'a$B${C}$$D'}
        rendered = {'services': {'app': {'environment': m.escape_values(raw)}}}
        self.assertEqual(m.runtime_environment_from_render(rendered), raw)

    def test_unescaped_environment_serialization_refused(self):
        for value in ('a$B', 'abc$$$def', '$'):
            with self.subTest(value=value), self.assertRaises(m.Blocked):
                m.runtime_environment_from_render({'services': {'app': {'environment': {'V': value}}}})

    def test_environment_not_string_refused(self):
        with self.assertRaises(m.Blocked):
            m.runtime_environment_from_render({'services': {'app': {'environment': {'V': None}}}})

    def test_existing_release_id_selects_enumerated_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'release-20260918T230000Z-012345ab'
            (root / name).mkdir()
            with patch.object(m, 'ROOT', root), patch.object(m, 'controlled'):
                self.assertEqual(m.release_by_id(name), root / name)

    def test_paths_and_traversal_cannot_select_a_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'release-20260918T230000Z-012345ab'
            (root / name).mkdir()
            with patch.object(m, 'ROOT', root), patch.object(m, 'controlled'):
                for value in ('../' + name, str(root / name), '/etc', 'missing', name + '/..'):
                    with self.subTest(value=value), self.assertRaises(m.Blocked):
                        m.release_by_id(value)

    def test_symlink_release_is_never_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'release-20260918T230000Z-012345ab'
            (root / 'target').mkdir()
            (root / name).symlink_to(root / 'target', target_is_directory=True)
            with patch.object(m, 'ROOT', root), patch.object(m, 'controlled'), self.assertRaises(m.Blocked):
                m.release_by_id(name)

if __name__ == '__main__':
    unittest.main(verbosity=2)
