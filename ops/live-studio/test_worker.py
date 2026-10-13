import unittest
from worker import canvas_for_media, continuous_session, fit_transform, session_expired, validate_server


class SessionTests(unittest.TestCase):
    def test_canvas_supports_youtube_lofi_and_vertical_live(self):
        self.assertEqual(canvas_for_media({'width':1920,'height':1080}), (1280,720))
        self.assertEqual(canvas_for_media({'width':1080,'height':1920}), (720,1280))
        with self.assertRaises(ValueError):
            canvas_for_media({'width':1000,'height':1000})
        landscape=fit_transform(1920,1080,1280,720)
        portrait=fit_transform(1080,1920,720,1280)
        self.assertAlmostEqual(landscape['scaleX'], 2/3)
        self.assertAlmostEqual(landscape['scaleY'], 2/3)
        self.assertAlmostEqual(portrait['scaleX'], 2/3)
        self.assertAlmostEqual(portrait['scaleY'], 2/3)
        self.assertEqual(landscape['alignment'], 5)

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


if __name__ == '__main__':
    unittest.main()
