"""Index only reviewed MP4s already copied by an operator into /live-studio/media."""
import json, pathlib, re, subprocess, time
root=pathlib.Path('/live-studio')
items=[]
for media in sorted((root/'media').glob('*.mp4')):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+\.mp4',media.name) or media.is_symlink():
        continue
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(media)]))
    duration=float(probe['format']['duration'])
    video=next(s for s in probe['streams'] if s['codec_type']=='video')
    # AAC encoder padding may add a few milliseconds to an exact ten-minute video.
    if not 0<duration<=601 or video['width']*16 != video['height']*9:
        raise ValueError('Somente vídeos 9:16 com até 10 minutos: '+media.name)
    items.append({'file':media.name,'label':media.stem.replace('-',' '),'duration':duration})
temp=root/'media.json.import.tmp'
temp.write_text(json.dumps(items));temp.chmod(0o600);temp.replace(root/'media.json')
if items and not (root/'config.json').exists():
    config={'title':'Conheça a VitrineCity','media':items[0]['file'],'duration':items[0]['duration'],'destination':'https://vitrinecity.com/','repetitions':3,'server':'','key':'','updatedAt':int(time.time()*1000)}
    (root/'config.json').write_text(json.dumps(config));(root/'config.json').chmod(0o600)
print(json.dumps({'imported':len(items),'files':[i['file'] for i in items]}))
