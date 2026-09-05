import json, os, pathlib, secrets, subprocess, time

root = pathlib.Path('/live-studio')
root.mkdir(exist_ok=True)
for name in ('media', 'recordings'):
    (root / name).mkdir(exist_ok=True)
config = pathlib.Path.home() / '.config/obs-studio'
(config / 'plugin_config/obs-websocket').mkdir(parents=True, exist_ok=True)
password = secrets.token_urlsafe(36)
ws = config / 'plugin_config/obs-websocket/config.json'
ws.write_text(json.dumps({'server_enabled': True, 'server_port': 4455, 'auth_required': True, 'server_password': password, 'alerts_enabled': False, 'first_load': False}))
ws.chmod(0o600)
(root / 'obs-password').write_text(password)
(root / 'obs-password').chmod(0o600)
(config / 'global.ini').write_text('[General]\nFirstRun=true\nEnableAutoUpdates=false\n[Basic]\nProfile=VitrineCity\nProfileDir=VitrineCity\nSceneCollection=VitrineCity\nSceneCollectionFile=VitrineCity\n[BasicWindow]\nStudioMode=false\n[OBSWebSocket]\nFirstLoad=false\nServerEnabled=true\nServerPort=4455\nAuthRequired=true\nAlertsEnabled=false\nServerPassword='+password+'\n')
(config / 'global.ini').chmod(0o600)
with (config / 'global.ini').open('a') as output:
    output.write('\n[BasicWindow]\nPreviewEnabled=false\n')
profile = config / 'basic/profiles/VitrineCity'
profile.mkdir(parents=True, exist_ok=True)
(config / 'basic/scenes').mkdir(parents=True, exist_ok=True)
(profile / 'basic.ini').write_text('''[General]
Name=VitrineCity
[Video]
BaseCX=720
BaseCY=1280
OutputCX=720
OutputCY=1280
FPSType=0
FPSCommon=30
[Output]
Mode=Simple
Reconnect=true
RetryDelay=5
MaxRetries=3
[SimpleOutput]
VBitrate=2500
ABitrate=128
StreamEncoder=x264
Preset=ultrafast
UseAdvanced=true
x264Settings=keyint=60
RecQuality=Stream
RecEncoder=x264
RecFormat=mkv
FilePath=/live-studio/recordings
[Audio]
SampleRate=48000
ChannelSetup=Stereo
''')
obs = subprocess.Popen(['xvfb-run','-a','-s','-screen 0 1280x720x24','dbus-run-session','--','obs','--disable-shutdown-check','--disable-updater','--profile','VitrineCity','--collection','VitrineCity','--minimize-to-tray'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
worker = subprocess.Popen(['python3','/opt/studio/worker.py'])
while obs.poll() is None and worker.poll() is None:
    time.sleep(2)
obs.terminate()
worker.terminate()
raise SystemExit(1)
