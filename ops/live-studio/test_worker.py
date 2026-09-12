import copy
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import worker as worker_module
from worker import (AnswerPlayback, ANSWER_SOURCE, ANSWER_LABEL, BASE_LABEL, SCENE, SOURCE,
                    continuous_session, session_expired, validate_server)


class SessionTests(unittest.TestCase):
    def test_platform_servers(self):
        for platform,server in [('instagram','rtmps://live-upload.instagram.com/rtmp/'),('youtube','rtmps://a.rtmps.youtube.com:443/live2'),('tiktok','rtmp://push.tiktok.com/live'),('tiktok','rtmps://push.tiktokv.com/live')]:
            validate_server({'platform':platform,'server':server,'key':'test'})
        for platform,server in [('youtube','rtmp://a.rtmp.youtube.com/live2'),('tiktok','rtmp://localhost/live'),('tiktok','rtmps://tiktok.com.evil.test/live'),('youtube','rtmps://youtube.com:1935/live2'),('unknown','rtmps://youtube.com/live2')]:
            with self.assertRaises(ValueError):
                validate_server({'platform':platform,'server':server,'key':'test'})

    def test_only_explicit_stream_session_is_continuous(self):
        self.assertTrue(continuous_session({'action': 'start', 'continuous': True}))
        for session in ({}, {'continuous': True}, {'action': 'preview', 'continuous': True},
                        {'action': 'start', 'continuous': 'true'}):
            self.assertFalse(continuous_session(session))
            self.assertTrue(session_expired(session, 100))

    def test_deadline_survives_controller_restart(self):
        self.assertFalse(session_expired({'action': 'preview', 'deadline': 115}, 100))
        self.assertTrue(session_expired({'action': 'preview', 'deadline': 115}, 115))
        self.assertFalse(session_expired({'action': 'start', 'deadline': 200}, 199))
        self.assertTrue(session_expired({'action': 'start', 'deadline': 200}, 201))

    def test_continuous_has_no_countdown(self):
        self.assertFalse(session_expired({'action': 'start', 'continuous': True,
                                         'deadline': None}, 9999999999))


class FakeOBS:
    """OBS requests only; no socket, encoder, microphone or real broadcast is used."""
    def __init__(self, streaming=True, recording=False, base=True):
        self.streaming, self.recording = streaming, recording
        self.scene = SCENE
        self.scenes = {SCENE}
        self.inputs, self.items, self.media, self.calls = {}, {}, {}, []
        self.before_mutation = None
        self.crash_after_restart = False
        self.record_start_delay = self.record_stop_delay = 0
        self.pending_record = None
        if base:
            self.add(SOURCE, 'ffmpeg_source', True)
            self.add(BASE_LABEL, 'text_ft2_source_v2', True)
            self.media[SOURCE] = 'OBS_MEDIA_STATE_PLAYING'

    def add(self, name, kind, enabled, settings=None):
        item_id = len(self.inputs) + 1
        self.inputs[name] = {'inputName': name, 'inputKind': kind, 'settings': settings or {}, 'muted': False}
        self.items[name] = {'sourceName': name, 'sceneItemId': item_id, 'sceneItemEnabled': enabled}
        self.media[name] = 'OBS_MEDIA_STATE_STOPPED'
        return item_id

    def call(self, kind, **data):
        self.calls.append((kind, copy.deepcopy(data)))
        if not kind.startswith('Get') and self.before_mutation:
            self.before_mutation(kind, data)
        if kind == 'GetStreamStatus': return {'outputActive': self.streaming}
        if kind == 'GetRecordStatus':
            if self.pending_record is not None:
                active, polls = self.pending_record
                if polls == 0:
                    self.recording = active
                    self.pending_record = None
                else:
                    self.pending_record = (active, polls - 1)
            return {'outputActive': self.recording}
        if kind == 'GetStats': return {'cpuUsage': 0, 'activeFps': 30}
        if kind == 'GetVersion': return {'obsVersion': 'fake-obs'}
        if kind == 'GetCurrentProgramScene': return {'currentProgramSceneName': self.scene}
        if kind == 'GetSceneList': return {'scenes': [{'sceneName': name} for name in self.scenes]}
        if kind == 'GetSceneItemList': return {'sceneItems': copy.deepcopy(list(self.items.values()))}
        if kind == 'GetInputList': return {'inputs': copy.deepcopy(list(self.inputs.values()))}
        if kind == 'GetInputMute': return {'inputMuted': self.inputs[data['inputName']]['muted']}
        if kind == 'GetMediaInputStatus': return {'mediaState': self.media[data['inputName']]}
        if kind == 'CreateScene': self.scenes.add(data['sceneName'])
        elif kind == 'SetCurrentProgramScene': self.scene = data['sceneName']
        elif kind == 'CreateInput':
            return {'sceneItemId': self.add(data['inputName'], data['inputKind'], data['sceneItemEnabled'], data['inputSettings'])}
        elif kind == 'SetInputSettings': self.inputs[data['inputName']]['settings'].update(data['inputSettings'])
        elif kind == 'SetInputMute': self.inputs[data['inputName']]['muted'] = data['inputMuted']
        elif kind == 'SetSceneItemEnabled':
            item = next(item for item in self.items.values() if item['sceneItemId'] == data['sceneItemId'])
            item['sceneItemEnabled'] = data['sceneItemEnabled']
        elif kind in ('SetSceneItemTransform', 'SetSceneItemIndex'): pass
        elif kind == 'TriggerMediaInputAction':
            action = data['mediaAction'].removeprefix('OBS_WEBSOCKET_MEDIA_INPUT_ACTION_')
            self.media[data['inputName']] = 'OBS_MEDIA_STATE_' + {'STOP': 'STOPPED', 'PAUSE': 'PAUSED', 'PLAY': 'PLAYING', 'RESTART': 'PLAYING'}[action]
            if self.crash_after_restart and data['inputName'] == ANSWER_SOURCE and action == 'RESTART':
                raise SystemExit('simulated controller crash after OBS accepted RESTART')
        elif kind == 'StartRecord':
            if self.record_start_delay: self.pending_record = (True, self.record_start_delay)
            else: self.recording = True
        elif kind == 'StopRecord':
            if self.record_stop_delay: self.pending_record = (False, self.record_stop_delay)
            else: self.recording = False
        elif kind in ('StartStream', 'SetStreamServiceSettings'):
            raise AssertionError('Answer playback must never start a stream or modify credentials')
        else: raise AssertionError('Unhandled OBS request: ' + kind)
        return {}


class AnswerPlaybackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lia-worker-test-', dir=pathlib.Path.cwd())
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.directory = self.root / 'lia-answers'
        self.directory.mkdir()
        self.clock = 1000.0
        self.command = {'id': 'command-1', 'action': 'play-answer', 'createdAt': 1000000,
                        'answerId': 'answer-1', 'file': 'answer-1.mp4', 'duration': 12.0}
        # The byte fixture exercises real hashing; media probing is an explicit injected boundary.
        self.media = self.directory / self.command['file']
        self.media.write_bytes(b'reviewed-video-bytes-for-hash-test')
        self.command['sha256'] = hashlib.sha256(self.media.read_bytes()).hexdigest()
        self.manifest = {key: self.command[key] for key in ('answerId', 'file', 'sha256', 'duration')}
        self.manifest.update(bytes=self.media.stat().st_size, width=720, height=1280)
        self.save_manifest()
        self.info = {'format': {'duration': '12.0'}, 'streams': [
            {'codec_type': 'video', 'codec_name': 'h264', 'width': 720, 'height': 1280},
            {'codec_type': 'audio', 'codec_name': 'aac'}]}
        self.session = {'action': 'start', 'continuous': True, 'deadline': None, 'relay': True, 'targets': ['youtube']}
        self.player = self.make_player()
        self.obs = FakeOBS()

    def save_manifest(self):
        (self.directory / 'answer-1.json').write_text(json.dumps(self.manifest))

    def make_player(self, probe=None):
        return AnswerPlayback(self.root, now=lambda: self.clock, probe=probe or (lambda _: copy.deepcopy(self.info)))

    def actions(self, name):
        return [data['mediaAction'] for kind, data in self.obs.calls
                if kind == 'TriggerMediaInputAction' and data['inputName'] == name]

    def test_play_answer_pauses_base_and_restores_it_without_changing_session_or_config(self):
        config = b'{"media":"base.mp4","repetitions":0,"server":"fixture-only","key":"fixture-only"}'
        (self.root / 'config.json').write_bytes(config)
        original = copy.deepcopy(self.session)
        def check_claim(kind, data):
            self.assertTrue((self.root / 'answer-command-claims/command-1.json').is_file())
            saved = json.loads((self.root / 'answer-state.json').read_text())
            self.assertEqual(saved['commandId'], 'command-1')
        self.obs.before_mutation = check_claim
        result = self.player.start(self.obs, self.command, self.session)
        self.assertEqual(result['state'], 'playing')
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PAUSED')
        self.assertTrue(self.obs.inputs[SOURCE]['muted'])
        self.assertFalse(self.obs.inputs[ANSWER_SOURCE]['muted'])
        self.assertFalse(self.obs.items[BASE_LABEL]['sceneItemEnabled'])
        self.assertTrue(self.obs.items[ANSWER_SOURCE]['sceneItemEnabled'])
        self.assertFalse(self.obs.inputs[ANSWER_SOURCE]['settings']['looping'])
        self.assertIn('Retrato estático', self.obs.inputs[ANSWER_LABEL]['settings']['text'])
        self.assertEqual(self.actions(SOURCE), ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'])
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.clock += 12
        self.assertFalse(self.player.tick(self.obs, self.session))
        self.assertEqual(self.player.snapshot()['state'], 'finished')
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PLAYING')
        self.assertFalse(self.obs.inputs[SOURCE]['muted'])
        self.assertTrue(self.obs.inputs[ANSWER_SOURCE]['muted'])
        self.assertFalse(self.obs.items[ANSWER_SOURCE]['sceneItemEnabled'])
        self.assertTrue(self.obs.items[BASE_LABEL]['sceneItemEnabled'])
        self.assertEqual(self.session, original)
        self.assertEqual((self.root / 'config.json').read_bytes(), config)
        self.assertTrue(self.obs.streaming)
        self.assertFalse(any(kind in ('StartStream', 'StartRecord', 'StopRecord') for kind, _ in self.obs.calls))
        self.assertNotIn('file', self.player.snapshot())

    def test_one_answer_at_a_time_even_for_a_second_controller(self):
        self.player.start(self.obs, self.command, self.session)
        calls = len(self.obs.calls)
        other = dict(self.command, id='command-2')
        with self.assertRaisesRegex(ValueError, 'andamento'):
            self.player.start(self.obs, other, self.session)
        with self.assertRaisesRegex(ValueError, 'andamento'):
            self.make_player().start(self.obs, other, self.session)
        self.assertEqual(len(self.obs.calls), calls)

    def test_same_command_is_not_replayed_after_finished_or_restart(self):
        self.player.start(self.obs, self.command, self.session)
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.player.tick(self.obs, self.session)
        self.obs.calls.clear()
        with self.assertRaisesRegex(ValueError, 'não será repetido'):
            self.make_player().start(self.obs, self.command, self.session)
        self.assertFalse(any(not kind.startswith('Get') for kind, _ in self.obs.calls))

    def test_recovery_stops_answer_once_and_never_restarts_it(self):
        self.obs.crash_after_restart = True
        with self.assertRaises(SystemExit): self.player.start(self.obs, self.command, self.session)
        self.obs.crash_after_restart = False
        self.obs.calls.clear()
        recovered = self.make_player()
        self.assertFalse(recovered.recover(self.obs, self.session))
        self.assertEqual(recovered.snapshot()['state'], 'interrupted')
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PLAYING')
        self.assertEqual(self.actions(ANSWER_SOURCE), ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'])
        self.assertFalse((self.root / 'answer-active.json').exists())
        self.obs.calls.clear()
        recovered.recover(self.obs, self.session)
        self.assertEqual(self.obs.calls, [])

    def test_preview_needs_no_base_config_and_only_records_locally(self):
        self.obs = FakeOBS(streaming=False, base=False)
        self.obs.scene = 'Cena anterior'
        self.obs.scenes.add(self.obs.scene)
        result = self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        self.assertEqual(result['state'], 'playing')
        self.assertTrue(self.obs.recording)
        self.assertFalse((self.root / 'config.json').exists())
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.assertTrue(self.player.tick(self.obs, {}))
        self.assertFalse(self.obs.recording)
        self.assertEqual(self.obs.scene, 'Cena anterior')
        self.assertEqual([kind for kind, _ in self.obs.calls if kind in ('StartRecord', 'StopRecord')], ['StartRecord', 'StopRecord'])

    def test_preview_pauses_a_base_playing_while_idle_before_recording_then_restores_it(self):
        self.obs.streaming = False
        def no_overlap(kind, data):
            if kind == 'StartRecord':
                self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PAUSED')
                self.assertTrue(self.obs.inputs[SOURCE]['muted'])
                self.assertTrue(self.obs.inputs[ANSWER_SOURCE]['muted'])
        self.obs.before_mutation = no_overlap
        self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PAUSED')
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.player.tick(self.obs, {})
        self.assertFalse(self.obs.streaming)
        self.assertFalse(self.obs.recording)
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PLAYING')
        self.assertFalse(self.obs.inputs[SOURCE]['muted'])
        self.assertEqual(self.actions(SOURCE), ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'])

    def test_preview_waits_for_async_recording_start_and_stop_without_repeating_commands(self):
        self.obs = FakeOBS(streaming=False, base=False)
        self.obs.record_start_delay, self.obs.record_stop_delay = 3, 2
        def check_audio_boundary(kind, data):
            if kind == 'TriggerMediaInputAction' and data['mediaAction'].endswith('_RESTART'):
                self.assertTrue(self.obs.recording)
                self.assertIsNone(self.obs.pending_record)
        self.obs.before_mutation = check_audio_boundary
        with patch.object(worker_module.time, 'sleep') as wait:
            result = self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
            self.assertEqual(result['state'], 'playing')
            self.assertEqual(wait.call_count, 3)
            self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
            self.assertTrue(self.player.tick(self.obs, {}))
            self.assertEqual(wait.call_count, 5)
        self.assertEqual(self.player.snapshot()['state'], 'finished')
        self.assertFalse(self.obs.recording)
        self.assertFalse(self.player.busy())
        self.assertEqual([kind for kind, _ in self.obs.calls if kind in ('StartRecord', 'StopRecord')], ['StartRecord', 'StopRecord'])
        self.assertFalse(any(kind in ('StartStream', 'SetStreamServiceSettings', 'SetProfileParameter') for kind, _ in self.obs.calls))

    def test_unconfirmed_record_start_retains_claim_until_late_recording_is_stopped(self):
        self.obs = FakeOBS(streaming=False, base=False)
        self.obs.record_start_delay = 1000
        with patch.object(worker_module.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'não confirmou'):
                self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        self.assertEqual(self.player.snapshot()['state'], 'failed')
        self.assertTrue(self.player.snapshot()['cleanupPending'])
        self.assertTrue(self.player.state['recordStartPending'])
        self.assertTrue(self.player.busy())
        self.assertNotIn('OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART', self.actions(ANSWER_SOURCE))
        with self.assertRaisesRegex(ValueError, 'andamento'):
            self.make_player().start(self.obs, dict(self.command, id='command-2', action='preview-answer'), {})
        recovered = self.make_player()
        self.assertFalse(recovered.recover(self.obs, {}))
        self.assertTrue(recovered.busy())
        self.obs.pending_record = (True, 0)
        self.assertTrue(recovered.tick(self.obs, {}))
        self.assertFalse(self.obs.recording)
        self.assertFalse(recovered.busy())
        self.assertFalse(recovered.state['recordStartPending'])
        self.assertEqual(recovered.snapshot()['state'], 'failed')
        self.assertEqual([kind for kind, _ in self.obs.calls if kind in ('StartRecord', 'StopRecord')], ['StartRecord', 'StopRecord'])
        self.assertTrue((self.root / 'answer-command-claims/command-1.json').is_file())

    def test_unconfirmed_record_stop_does_not_release_the_answer_or_claim_finished(self):
        self.obs = FakeOBS(streaming=False, base=False)
        self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        self.obs.record_stop_delay = 1000
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        with patch.object(worker_module.time, 'sleep'):
            self.assertFalse(self.player.tick(self.obs, {}))
        self.assertTrue(self.obs.recording)
        self.assertEqual(self.player.snapshot()['state'], 'failed')
        self.assertTrue(self.player.snapshot()['cleanupPending'])
        self.assertTrue(self.player.busy())
        self.assertNotIn('finishedAt', self.player.snapshot())
        self.obs.pending_record = (False, 0)
        self.assertTrue(self.player.tick(self.obs, {}))
        self.assertFalse(self.player.busy())
        self.assertFalse(self.obs.recording)
        self.assertEqual(self.player.snapshot()['state'], 'failed')
        self.assertEqual([kind for kind, _ in self.obs.calls if kind in ('StartRecord', 'StopRecord')], ['StartRecord', 'StopRecord'])

    def test_partial_cleanup_failure_still_hides_other_elements_and_never_claims_finished(self):
        self.player.start(self.obs, self.command, self.session)
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        label_id = self.obs.items[ANSWER_LABEL]['sceneItemId']
        failed = []
        def once(kind, data):
            if kind == 'SetSceneItemEnabled' and data['sceneItemId'] == label_id and not data['sceneItemEnabled'] and not failed:
                failed.append(True)
                raise RuntimeError('OBS label cleanup failed once')
        self.obs.before_mutation = once
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.player.snapshot()['state'], 'failed')
        self.assertTrue(self.player.snapshot()['cleanupPending'])
        self.assertNotIn('finishedAt', self.player.snapshot())
        self.assertFalse(self.obs.items[ANSWER_SOURCE]['sceneItemEnabled'])
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PAUSED')
        self.assertTrue((self.root / 'answer-active.json').exists())
        with self.assertRaises(ValueError): self.make_player().start(self.obs, dict(self.command, id='command-2'), self.session)
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.player.snapshot()['state'], 'failed')
        self.assertFalse(self.player.snapshot()['cleanupPending'])
        self.assertFalse(self.obs.items[ANSWER_LABEL]['sceneItemEnabled'])
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PLAYING')
        self.assertEqual(self.actions(ANSWER_SOURCE).count('OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'), 1)

    def test_explicit_abort_remains_no_resume_even_after_interrupted_cleanup(self):
        self.obs.streaming = False
        self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        def crash(kind, data):
            if kind == 'TriggerMediaInputAction' and data['inputName'] == ANSWER_SOURCE:
                raise SystemExit('crash while stopping')
        self.obs.before_mutation = crash
        with self.assertRaises(SystemExit): self.player.finish(self.obs, {}, state='interrupted', resume=False)
        self.obs.before_mutation = None
        self.make_player().recover(self.obs, {})
        self.assertNotIn('OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY', self.actions(SOURCE))
        self.assertFalse(self.obs.recording)

    def test_preview_is_rejected_during_stream_and_play_is_rejected_while_idle(self):
        with self.assertRaises(ValueError): self.player.start(self.obs, dict(self.command, action='preview-answer'), self.session)
        self.obs.streaming = False
        with self.assertRaises(ValueError): self.player.start(self.obs, self.command, self.session)
        self.assertFalse(any(not kind.startswith('Get') for kind, _ in self.obs.calls))

    def test_original_deadline_and_user_stop_never_resume_base(self):
        self.session = {'action': 'preview', 'deadline': self.clock + 3}
        self.obs.streaming, self.obs.recording = False, True
        self.player.start(self.obs, self.command, self.session)
        self.clock += 3
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.player.snapshot()['state'], 'interrupted')
        self.assertNotIn('OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY', self.actions(SOURCE))
        self.assertEqual(self.session['deadline'], 1003)

    def test_a_previously_paused_base_is_not_started_after_answer(self):
        self.obs.media[SOURCE] = 'OBS_MEDIA_STATE_PAUSED'
        self.player.start(self.obs, self.command, self.session)
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.actions(SOURCE), [])
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PAUSED')

    def test_existing_base_mute_is_preserved(self):
        self.obs.inputs[SOURCE]['muted'] = True
        self.player.start(self.obs, self.command, self.session)
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PLAYING')
        self.assertTrue(self.obs.inputs[SOURCE]['muted'])

    def test_stalled_answer_finishes_failed_and_never_extends_session(self):
        self.player.start(self.obs, self.command, self.session)
        self.clock += 15
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.player.snapshot()['state'], 'failed')
        self.assertTrue(self.obs.streaming)
        self.assertEqual(self.obs.media[SOURCE], 'OBS_MEDIA_STATE_PLAYING')
        self.assertIsNone(self.session['deadline'])

    def test_preview_crash_recovery_stops_recording_without_new_record_or_stream(self):
        self.obs = FakeOBS(streaming=False, base=False)
        self.obs.crash_after_restart = True
        with self.assertRaises(SystemExit): self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        self.obs.crash_after_restart = False
        self.obs.calls.clear()
        self.assertTrue(self.make_player().recover(self.obs, {'action': 'preview-answer', 'deadline': 1060}))
        self.assertFalse(self.obs.recording)
        self.assertFalse(any(kind in ('StartRecord', 'StartStream') for kind, _ in self.obs.calls))

    def test_invalid_paths_metadata_hash_and_overlong_media_have_no_obs_effects(self):
        changes = [{'file': '../answer-1.mp4'}, {'answerId': '../answer'}, {'sha256': '0' * 64},
                   {'duration': 61}, {'duration': True}, {'duration': float('nan')},
                   {'createdAt': 1}, {'createdAt': 2000000}, {'id': '../command'}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.player.start(self.obs, dict(self.command, **change), self.session)
        self.assertEqual(self.obs.calls, [])
        self.assertFalse((self.root / 'answer-active.json').exists())
        self.manifest['bytes'] += 1
        self.save_manifest()
        with self.assertRaises(ValueError): self.player.start(self.obs, self.command, self.session)
        self.assertEqual(self.obs.calls, [])

    def test_measured_audio_video_dimensions_and_duration_are_required(self):
        original = copy.deepcopy(self.info)
        for mutate in (lambda i: i['streams'].pop(), lambda i: i['streams'][0].update(width=1280),
                       lambda i: i['streams'][0].update(codec_name='other'),
                       lambda i: i['format'].update(duration='61'), lambda i: i['format'].update(duration='20')):
            self.info = copy.deepcopy(original)
            mutate(self.info)
            with self.assertRaises(ValueError): self.player.start(self.obs, self.command, self.session)
        self.assertEqual(self.obs.calls, [])

    def test_file_changed_during_probe_and_session_expired_during_validation_are_blocked(self):
        def changed(_):
            self.media.write_bytes(b'changed-file-with-other-bytes')
            return copy.deepcopy(self.info)
        with self.assertRaises(ValueError): self.make_player(probe=changed).start(self.obs, self.command, self.session)
        self.assertEqual(self.obs.calls, [])
        self.media.write_bytes(b'reviewed-video-bytes-for-hash-test')
        self.session = {'action': 'preview', 'deadline': 1002}
        def expired(_):
            self.clock = 1003
            return copy.deepcopy(self.info)
        with self.assertRaises(ValueError): self.make_player(probe=expired).start(self.obs, self.command, self.session)
        self.assertFalse(any(not kind.startswith('Get') for kind, _ in self.obs.calls))

    def test_output_ended_and_explicit_abort_do_not_restart_base(self):
        self.player.start(self.obs, self.command, self.session)
        self.obs.streaming = False
        self.player.tick(self.obs, self.session)
        self.assertEqual(self.player.snapshot()['state'], 'interrupted')
        self.assertNotIn('OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY', self.actions(SOURCE))

    def test_command_claim_without_obs_scene_is_recovered_without_playback(self):
        initial = {'commandId': 'crashed-claim', 'answerId': 'answer-1', 'state': 'claimed', 'mode': 'preview-answer'}
        (self.root / 'answer-active.json').write_text(json.dumps(initial))
        self.obs = FakeOBS(streaming=False, base=False)
        self.obs.scenes.clear()
        recovered = self.make_player()
        recovered.recover(self.obs, {})
        self.assertEqual(recovered.snapshot()['state'], 'interrupted')
        self.assertFalse(any(kind in ('StartRecord', 'StartStream', 'TriggerMediaInputAction') for kind, _ in self.obs.calls))

    def test_new_claim_takes_precedence_over_old_finished_state_on_restart(self):
        (self.root / 'answer-state.json').write_text(json.dumps({'commandId': 'older', 'state': 'finished'}))
        claim = dict(self.command, commandId=self.command['id'], state='claimed', mode='play-answer')
        (self.root / 'answer-active.json').write_text(json.dumps(claim))
        recovered = self.make_player()
        self.assertEqual(recovered.snapshot()['commandId'], 'command-1')
        recovered.recover(self.obs, self.session)
        self.assertEqual(recovered.snapshot()['state'], 'interrupted')
        self.assertFalse((self.root / 'answer-active.json').exists())
        self.assertTrue((self.root / 'answer-command-claims/command-1.json').exists())
        with self.assertRaises(ValueError): recovered.start(self.obs, self.command, self.session)
        self.assertEqual(self.actions(ANSWER_SOURCE), [])

    def test_restart_after_confirmed_cleanup_preserves_finished_receipt(self):
        self.player.start(self.obs, self.command, self.session)
        active = (self.root / 'answer-active.json').read_bytes()
        self.obs.media[ANSWER_SOURCE] = 'OBS_MEDIA_STATE_ENDED'
        self.player.tick(self.obs, self.session)
        (self.root / 'answer-active.json').write_bytes(active)
        self.obs.calls.clear()
        recovered = self.make_player()
        recovered.recover(self.obs, self.session)
        self.assertEqual(recovered.snapshot()['state'], 'finished')
        self.assertEqual(self.obs.calls, [])
        self.assertFalse((self.root / 'answer-active.json').exists())

    def test_real_main_blocks_normal_start_and_preview_when_answer_cleanup_is_unconfirmed(self):
        self.obs.streaming = False
        self.player.start(self.obs, dict(self.command, action='preview-answer'), {})
        def cannot_remove_answer(kind, data):
            if (data.get('inputName') == ANSWER_SOURCE and kind in ('SetInputMute', 'TriggerMediaInputAction')) or (
                    kind == 'SetSceneItemEnabled' and data.get('sceneItemId') == self.obs.items[ANSWER_SOURCE]['sceneItemId']):
                raise RuntimeError('persistent OBS answer cleanup failure')
        self.obs.before_mutation = cannot_remove_answer
        self.player.finish(self.obs, {}, state='interrupted')
        self.assertFalse(self.obs.recording)
        self.assertTrue(self.obs.items[ANSWER_SOURCE]['sceneItemEnabled'])
        self.assertFalse(self.obs.inputs[ANSWER_SOURCE]['muted'])
        self.assertTrue(self.player.snapshot()['cleanupPending'])
        config = {'media': 'base.mp4', 'repetitions': 0, 'platform': 'youtube', 'targets': ['youtube'],
                  'profiles': {'youtube': {'server': 'rtmps://a.rtmps.youtube.com/live2', 'key': 'fixture-only'}}}
        (self.root / 'config.json').write_text(json.dumps(config))
        (self.root / 'media.json').write_text(json.dumps([{'file': 'base.mp4', 'duration': 12}]))
        (self.root / 'media').mkdir()
        (self.root / 'media/base.mp4').write_bytes(b'fixture-base')
        class RelayFixture:
            def __init__(self): self.starts = []
            def snapshot(self): return {}
            def active(self): return False
            def start(self, profiles): self.starts.append(profiles)
            def stop(self, platform=None): pass
        for action in ('start', 'preview', 'stop'):
            with self.subTest(action=action):
                (self.root / 'last-command.json').unlink(missing_ok=True)
                (self.root / 'command.json').write_text(json.dumps({'id': 'normal-' + action, 'action': action, 'createdAt': self.clock * 1000}))
                self.obs.calls.clear()
                relay = RelayFixture()
                recovered = self.make_player()
                with patch.object(worker_module, 'ROOT', self.root), patch.object(worker_module, 'OBS', lambda: self.obs), \
                     patch.object(worker_module, 'Relay', lambda: relay), patch.object(worker_module, 'AnswerPlayback', lambda: recovered), \
                     patch.object(worker_module.time, 'time', lambda: self.clock), patch.object(worker_module.time, 'sleep', side_effect=SystemExit('one loop only')):
                    with self.assertRaises(SystemExit): worker_module.main()
                self.assertEqual(relay.starts, [])
                self.assertFalse(any(kind in ('StartRecord', 'StartStream', 'SetStreamServiceSettings') for kind, _ in self.obs.calls))
                self.assertFalse(any(kind == 'TriggerMediaInputAction' and data['inputName'] == SOURCE and data['mediaAction'].endswith('_RESTART') for kind, data in self.obs.calls))
                self.assertEqual(json.loads((self.root / 'last-command.json').read_text())['action'], action)
                status = json.loads((self.root / 'status.json').read_text())
                self.assertIn('Parada solicitada' if action == 'stop' else 'retirada confirmada', status['lastMessage'])
                self.assertTrue(status['answer']['cleanupPending'])
                self.assertFalse(status['streaming'])
                self.assertEqual(json.loads((self.root / 'config.json').read_text()), config)

    def test_clip_above_thirty_mib_is_rejected_before_probe_or_obs(self):
        with self.media.open('r+b') as output:
            output.truncate(30 * 1024 * 1024 + 1)
        self.manifest['bytes'] = self.media.stat().st_size
        self.save_manifest()
        def no_probe(_): raise AssertionError('Oversized file must fail before probing')
        with self.assertRaisesRegex(ValueError, 'Metadados'):
            self.make_player(probe=no_probe).start(self.obs, self.command, self.session)
        self.assertEqual(self.obs.calls, [])


if __name__ == '__main__':
    unittest.main()
