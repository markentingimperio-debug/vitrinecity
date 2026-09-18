"""Offline serialization tests: synthetic values only, no Docker or credentials."""
import importlib.util
from pathlib import Path
import unittest

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

if __name__ == '__main__':
    unittest.main(verbosity=2)
