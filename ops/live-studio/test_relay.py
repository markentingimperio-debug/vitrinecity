import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
import relay


class RelayTests(unittest.TestCase):
    def test_four_outputs_keep_existing_ports_and_stop_facebook_without_restarting(self):
        self.assertEqual(relay.PORTS, {'instagram': 19401, 'youtube': 19402, 'tiktok': 19403, 'facebook': 19404})
        profiles = {p: {'server': 'rtmps://live-api-s.facebook.com:443/rtmp/', 'key': 'private-fixture-'+p} for p in relay.PLATFORMS}
        processes = []
        def launch(*_args, **_kwargs):
            process = Mock(); process.poll.return_value = None
            process.terminate.side_effect = lambda: setattr(process.poll, 'return_value', 0)
            processes.append(process); return process
        manager = relay.Relay()
        with patch.object(relay.subprocess, 'Popen', side_effect=launch) as start, patch.object(relay.threading, 'Thread'), patch.object(relay.time, 'sleep'):
            manager.start(profiles)
            self.assertEqual(start.call_count, 5)
            for p in relay.PLATFORMS:
                args = start.call_args_list[list(relay.PLATFORMS).index(p)].args[0]
                self.assertIn(f'127.0.0.1:{relay.PORTS[p]}', args[args.index('-i')+1])
                self.assertEqual(args[args.index('-c')+1], 'copy')
                self.assertIn('-tls_verify', args)
            self.assertNotIn('private-fixture', json.dumps(manager.snapshot()))
            manager.stop('facebook')
            self.assertEqual(manager.snapshot()['facebook']['state'], 'stopped')
            self.assertTrue(all(manager.snapshot()[p]['state'] == 'connecting' for p in ('instagram','youtube','tiktok')))
            processes[-1].terminate.assert_not_called()
            manager.stop()
            self.assertFalse(manager.active())
            self.assertEqual(start.call_count, 5)
            self.assertTrue(all(p.poll() == 0 for p in processes))

    def test_urls_and_secret_free_telemetry(self):
        for host in ('rtmp-api.facebook.com', 'live-api-s.facebook.com'):
            self.assertEqual(relay.target_url({'server':f'rtmps://{host}:443/rtmp/','key':'abc?token=def'}), f'rtmps://{host}:443/rtmp/abc?token=def')
        self.assertEqual(relay.target_url({'server':'rtmps://a.rtmps.youtube.com/live2','key':'abc?token=def'}), 'rtmps://a.rtmps.youtube.com/live2/abc?token=def')
        for server,key in [('rtmps://youtube.com/live2?bad=1','abc'),('rtmps://youtube.com/live2','/bad'),('rtmps://youtube.com/live2','abc#bad')]:
            with self.assertRaises(ValueError): relay.target_url({'server':server,'key':key})
        args=relay.output_args('youtube','rtmps://youtube.com/live2/test')
        self.assertIn('-tls_verify',args)
        self.assertEqual(args[args.index('-c')+1],'copy')
        self.assertIn('127.0.0.1',relay.INGEST)
        self.assertEqual(relay.Relay().snapshot(),{})

    def test_four_real_local_outputs_and_independent_stop(self):
        # Only loopback synthetic media. No platform credential or public network.
        processes=[]
        manager=relay.Relay()
        original=relay.output_args
        with tempfile.TemporaryDirectory(prefix='vc-relay-test-') as directory:
            destinations={p:f'rtmp://127.0.0.1:{19501+i}/live/test' for i,p in enumerate(relay.PLATFORMS)}
            try:
                for p,url in destinations.items():
                    process=subprocess.Popen(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-listen','1','-i',url,'-c','copy','-f','flv',str(Path(directory)/(p+'.flv'))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                    processes.append(process)
                time.sleep(0.4)
                with patch.object(relay,'output_args',side_effect=lambda p,url: original(p,destinations[p])):
                    manager.start({p:{'server':'rtmps://youtube.com/live2','key':'dummy'} for p in relay.PLATFORMS})
                source=subprocess.Popen(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=180x320:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-c:v','libx264','-preset','ultrafast','-g','30','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-f','flv',relay.INGEST],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                processes.append(source)
                deadline=time.monotonic()+30
                while time.monotonic()<deadline:
                    states=manager.snapshot()
                    if all(s['state']=='sending' for s in states.values()): break
                    time.sleep(1)
                self.assertEqual([s['state'] for s in states.values()],['sending']*len(relay.PLATFORMS),states)
                before=states['youtube']['seconds']
                manager.stop('instagram')
                time.sleep(3)
                states=manager.snapshot()
                self.assertEqual(states['instagram']['state'],'stopped')
                self.assertEqual(states['youtube']['state'],'sending')
                self.assertGreater(states['youtube']['seconds'],before)
                # Failed destination must not stop another destination.
                manager.outputs['tiktok']['process'].kill()
                manager.outputs['tiktok']['process'].wait(timeout=3)
                states=manager.snapshot()
                self.assertEqual(states['tiktok']['state'],'failed')
                self.assertEqual(states['youtube']['state'],'sending')
                self.assertNotIn('dummy',json.dumps(states))
                manager.stop()
                self.assertFalse(manager.active())
                for p in relay.PLATFORMS:
                    self.assertGreater((Path(directory)/(p+'.flv')).stat().st_size,1000)
            finally:
                manager.stop()
                for process in processes: relay.terminate(process)


if __name__=='__main__': unittest.main()
