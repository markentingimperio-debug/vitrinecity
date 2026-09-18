#!/usr/bin/env python3
"""Validate Docker/OCI archive identity before delegating to pinned backup v5.

No daemon import/load, pull, tag, pruning or deployment. Archive validation is
read-only and streams layers without extracting them. Only the explicitly
selected maintenance mode permits v5 to stop/restart the existing app.
"""
from __future__ import annotations
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import tarfile

BACKUP_SHA256 = '1cd5eaf48a9abd210a536a6b88a9e270c4a042813ecbe4b9bd1def223f650bf6'
HELPER_SHA256 = 'a260aff2815395dcebbd15c427acfefdcbe6fea7defb153eb5cc919d68d0889e'
IMAGE = 'sha256:70fba9043ed420c8d3eb0a3e2904aeccd2cb593db598c450e59345dd95f47628'
PREVIOUS = Path('/var/backups/vitrinecity-lia-recovery-wlb4bm95/image.tar')
JSON_LIMIT = 16 * 1024 * 1024
ARCHIVE_LIMIT = 8 * 1024**3
UNPACKED_LIMIT = 8 * 1024**3
CHUNK = 1024 * 1024
INDEX_TYPES = frozenset(('application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json'))
MANIFEST_TYPES = frozenset(('application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json'))

class InvalidArchive(RuntimeError):
    """Fixed codes only: do not echo image configuration or credentials."""

def require(condition, code):
    if not condition:
        raise InvalidArchive(code)

def sha(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()

def valid_digest(value):
    return isinstance(value, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', value) is not None

def normalized(name):
    require(isinstance(name, str) and 0 < len(name) <= 512, 'invalid_path')
    name = name[2:] if name.startswith('./') else name
    name = name.rstrip('/')
    require(name and not PurePosixPath(name).is_absolute() and
            all(p not in ('', '.', '..') for p in name.split('/')) and
            '\\' not in name and not any(ord(c) < 32 or ord(c) == 127 for c in name), 'invalid_path')
    return name

def strict_json(data):
    def unique(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=unique,
                          parse_constant=lambda _: require(False, 'invalid_json_constant'))
    except (UnicodeError, ValueError, RecursionError):
        raise InvalidArchive('invalid_json') from None

class Archive:
    def __init__(self, tar, size):
        self.tar, self.members, self.digests = tar, {}, {}
        self.unpacked = 0
        for number, member in enumerate(tar):
            require(number < 20000, 'too_many_entries')
            if member.name in ('.', './') and member.isdir():
                continue
            name = normalized(member.name)
            require(name not in self.members, 'duplicate_archive_path')
            require(member.isdir() or member.isfile(), 'archive_link_or_special_file')
            require(not getattr(member, 'sparse', None), 'sparse_image_entry')
            require(0 <= member.size <= ARCHIVE_LIMIT and
                    member.offset_data + member.size <= size, 'truncated_archive_entry')
            self.members[name] = member

    def entry(self, name):
        name = normalized(name)
        require(name in self.members and self.members[name].isfile(), 'missing_regular_entry')
        return self.members[name]

    def small(self, name):
        member = self.entry(name)
        require(member.size <= JSON_LIMIT, 'metadata_too_large')
        with self.tar.extractfile(member) as stream:
            data = stream.read(JSON_LIMIT + 1)
        require(len(data) == member.size, 'metadata_truncated')
        return data

    def stream_hash(self, name):
        name = normalized(name)
        if name not in self.digests:
            member = self.entry(name)
            digest, length = hashlib.sha256(), 0
            with self.tar.extractfile(member) as stream:
                for chunk in iter(lambda: stream.read(CHUNK), b''):
                    length += len(chunk)
                    digest.update(chunk)
            require(length == member.size, 'content_truncated')
            self.digests[name] = 'sha256:' + digest.hexdigest()
        return self.digests[name]

    def descriptor(self, desc, metadata=False):
        require(isinstance(desc, dict) and valid_digest(desc.get('digest')) and
                type(desc.get('size')) is int and desc['size'] >= 0, 'invalid_descriptor')
        name = 'blobs/sha256/' + desc['digest'][7:]
        require(self.entry(name).size == desc['size'], 'descriptor_size_mismatch')
        require(self.stream_hash(name) == desc['digest'], 'descriptor_digest_mismatch')
        return (strict_json(self.small(name)) if metadata else None), name

    def diff_id(self, name):
        member = self.entry(name)
        digest = hashlib.sha256()
        with self.tar.extractfile(member) as raw:
            magic = raw.read(4)
            raw.seek(0)
            require(magic != b'\x28\xb5\x2f\xfd', 'zstd_layer_requires_review')
            compressed = magic[:2] == b'\x1f\x8b'
            stream = gzip.GzipFile(fileobj=raw, mode='rb') if compressed else raw
            try:
                for chunk in iter(lambda: stream.read(CHUNK), b''):
                    self.unpacked += len(chunk)
                    require(self.unpacked <= UNPACKED_LIMIT, 'expanded_layers_too_large')
                    digest.update(chunk)
            finally:
                if compressed:
                    stream.close()
        return 'sha256:' + digest.hexdigest()

    def oci_identity(self, expected, config_id, layers):
        require('index.json' in self.members and 'oci-layout' in self.members,
                'identity_not_proven_no_oci_index')
        layout = strict_json(self.small('oci-layout'))
        require(isinstance(layout, dict) and layout.get('imageLayoutVersion') == '1.0.0', 'invalid_oci_layout')
        root_bytes = self.small('index.json')
        root = strict_json(root_bytes)
        require(isinstance(root, dict) and root.get('schemaVersion') == 2 and
                isinstance(root.get('manifests'), list) and 0 < len(root['manifests']) <= 128,
                'invalid_oci_index')
        root_match = sha(root_bytes) == expected
        visited, matched = {}, []
        budget = [0]
        def walk(desc, anchored=False, depth=0):
            budget[0] += 1
            require(depth <= 8 and budget[0] <= 512, 'oci_graph_too_large')
            node, name = self.descriptor(desc, metadata=True)
            media = desc.get('mediaType')
            require(isinstance(node, dict) and node.get('schemaVersion') == 2,
                    'invalid_oci_node')
            require(node.get('mediaType', media) == media, 'oci_media_type_mismatch')
            anchored = anchored or desc['digest'] == expected
            if media in INDEX_TYPES:
                children = node.get('manifests')
                require(isinstance(children, list) and 0 < len(children) <= 128, 'invalid_oci_children')
                for child in children:
                    walk(child, anchored, depth + 1)
                return
            require(media in MANIFEST_TYPES, 'unsupported_oci_manifest')
            config, _ = self.descriptor(node.get('config'), metadata=True)
            require(isinstance(config, dict), 'invalid_oci_config')
            children = node.get('layers')
            require(isinstance(children, list) and len(children) <= 512, 'invalid_oci_layers')
            layer_names = []
            for child in children:
                _, layer_name = self.descriptor(child)
                layer_names.append(layer_name)
            if node['config']['digest'] == config_id:
                require(len(layer_names) == len(layers), 'oci_layer_count_mismatch')
                for saved, oci in zip(layers, layer_names):
                    require(self.stream_hash(saved) == self.stream_hash(oci), 'oci_layer_order_mismatch')
                if anchored:
                    matched.append(desc['digest'])
            visited[desc['digest']] = True
        for descriptor in root['manifests']:
            walk(descriptor, root_match)
        require(matched, 'expected_id_not_linked_to_saved_config')
        return 'oci_manifest_or_index', len(visited)

def verify_image_archive(path, expected):
    """Return safe evidence; never accept an unrelated blob or unverified layer."""
    require(valid_digest(expected), 'invalid_expected_digest')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        with os.fdopen(fd, 'rb') as file:
            before = os.fstat(file.fileno())
            require(stat.S_ISREG(before.st_mode) and 1024 <= before.st_size <= ARCHIVE_LIMIT,
                    'invalid_archive_size_or_type')
            with tarfile.open(fileobj=file, mode='r:') as tar:
                archive = Archive(tar, before.st_size)
                entries = strict_json(archive.small('manifest.json'))
                require(isinstance(entries, list) and len(entries) == 1 and isinstance(entries[0], dict),
                        'expected_one_docker_image')
                config_path = normalized(entries[0].get('Config'))
                config_data = archive.small(config_path)
                config_id = sha(config_data)
                config = strict_json(config_data)
                require(isinstance(config, dict) and isinstance(config.get('rootfs'), dict) and
                        config['rootfs'].get('type') == 'layers', 'invalid_image_rootfs')
                layers = entries[0].get('Layers')
                diffs = config['rootfs'].get('diff_ids')
                require(isinstance(layers, list) and isinstance(diffs, list) and
                        len(layers) == len(diffs) and len(layers) <= 512 and
                        all(valid_digest(x) for x in diffs), 'invalid_image_layer_list')
                layers = [normalized(x) for x in layers]
                mode, graph_count = 'config_digest', 0
                if config_id != expected:
                    mode, graph_count = archive.oci_identity(expected, config_id, layers)
                for layer, expected_diff in zip(layers, diffs):
                    require(archive.diff_id(layer) == expected_diff, 'layer_diff_id_mismatch')
                result = {'identityVerified': True, 'mode': mode, 'expectedImage': expected,
                          'configDigest': config_id, 'layersVerified': len(layers),
                          'ociManifestsVerified': graph_count, 'archiveExtracted': False}
            after = os.fstat(file.fileno())
            require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                    (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'archive_changed_during_read')
            return result
    except (tarfile.TarError, EOFError, gzip.BadGzipFile):
        raise InvalidArchive('invalid_or_truncated_archive') from None

def load_backup():
    here = Path(__file__).resolve().parent
    for name, expected in (('backup-chat-recovery-v5.py', BACKUP_SHA256),
                           ('prepare-chat-update-v2.py', HELPER_SHA256)):
        path = here / name
        require(not path.is_symlink() and path.is_file() and path.stat().st_size <= 65536,
                'invalid_backup_helper')
        require(hashlib.sha256(path.read_bytes()).hexdigest() == expected, 'backup_helper_hash_mismatch')
    spec = importlib.util.spec_from_file_location('lia_verified_backup_v5', here / 'backup-chat-recovery-v5.py')
    require(spec is not None and spec.loader is not None, 'backup_loader_unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def configure(backup):
    def verifier(path, image):
        try:
            evidence = verify_image_archive(path, image)
        except InvalidArchive as error:
            raise backup.Refused('Identidade/integridade da imagem nao confirmada: ' + str(error)) from None
        backup.write(path.parent / 'image-verification-v6.json',
                     json.dumps(evidence, ensure_ascii=False, indent=2).encode())
        print('=== VERIFICACAO DA IMAGEM: SHA-256 ===', flush=True)
        print(json.dumps(evidence, ensure_ascii=False, indent=2), flush=True)
    backup.verify_image_archive = verifier
    return backup

def main():
    # Keep v5's explicit maintenance authorization; no implicit stop in diagnostics.
    require(sys.argv[1:] in (['--verify-existing-only'], ['--backup-with-app-stop']), 'explicit_mode_required')
    backup = configure(load_backup())
    if sys.argv[1:] == ['--verify-existing-only']:
        backup.protected_dir(PREVIOUS.parent)
        result = verify_image_archive(PREVIOUS, IMAGE)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    signal.signal(signal.SIGTERM, backup.terminate)
    return backup.main()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        code = str(error) if isinstance(error, InvalidArchive) else 'verification_incomplete'
        print('PARADO: ' + code + '. Nenhum deploy solicitado.', file=sys.stderr)
        sys.exit(1)
