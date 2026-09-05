import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import relay


class RelayTests(unittest.TestCase):
    def test_urls_and_secret_free_telemetry(self):
        self.assertEqual(relay.target_url({'server':'rtmps://a.rtmps.youtube.com/live2','key':'abc?token=def'}), 'rtmps://a.rtmps.youtube.com/live2/abc?token=def')
        for server,key in [('rtmps://youtube.com/live2?bad=1','abc'),('rtmps://youtube.com/live2','/bad'),('rtmps://youtube.com/live2','abc#bad')]:
            with self.assertRaises(ValueError): relay.target_url({'server':server,'key':key})
        args=relay.output_args('youtube','rtmps://youtube.com/live2/test')
        self.assertIn('-tls_verify',args)
        self.assertEqual(args[args.index('-c')+1],'copy')
        self.assertIn('127.0.0.1',relay.INGEST)
        self.assertEqual(relay.Relay().snapshot(),{})

    def test_three_real_local_outputs_and_independent_stop(self):
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
                self.assertEqual([s['state'] for s in states.values()],['sending']*3,states)
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
