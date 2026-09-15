"""Build the clothed visitor from MakeHuman CC0 geometry, without its program code.
Blender 4.5: blender -b --python scripts/build-realistic-avatar.py -- --source-dir DIR
The pinned source files and their license are documented beside the GLB.
"""
import bpy, math, json, argparse, sys
from pathlib import Path
from mathutils import Vector, Quaternion

args=argparse.ArgumentParser();args.add_argument('--source-dir',required=True)
options=args.parse_args(sys.argv[sys.argv.index('--')+1:])
source=Path(options.source_dir);output=Path(__file__).resolve().parents[1]/'public/assets/avatars'
output.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
verts=[];faces=[];group=''
for line in (source/'base.obj').read_text().splitlines():
    p=line.split()
    if not p:continue
    if p[0]=='v':verts.append(Vector(tuple(map(float,p[1:4]))))
    elif p[0]=='g':group=p[1]
    elif p[0]=='f' and group=='body':faces.append([int(v.split('/')[0])-1 for v in p[1:]])
for shape in ['caucasian','african','asian']:
    for line in (source/(shape+'-male-young.target')).read_text().splitlines():
        if line.startswith('#'):continue
        p=line.split()
        if len(p)==4:verts[int(p[0])]+=Vector(tuple(float(x)/3 for x in p[1:]))
used=sorted(set(i for face in faces for i in face));floor=min(verts[i].y for i in used)
scale=1.82/(max(verts[i].y for i in used)-floor)
def convert(v):return Vector((v.x*scale,-v.z*scale,(v.y-floor)*scale))
points=[convert(v) for v in verts]
spec=json.loads((source/'default.mhskel').read_text());weights=json.loads((source/'default_weights.mhw').read_text())['weights']
def joint(name):return sum((points[i] for i in spec['joints'][name]),Vector())/len(spec['joints'][name])
keep=set(['root','head']+['spine%02d'%i for i in range(1,6)]+['neck%02d'%i for i in range(1,4)])
for side in ['L','R']:
    keep.update(name+'.'+side for name in ['clavicle','shoulder01','upperarm01','upperarm02','lowerarm01','lowerarm02','wrist','pelvis','upperleg01','upperleg02','lowerleg01','lowerleg02','foot'])
def ancestor(name):
    while name and name not in keep:name=spec['bones'][name]['parent']
    return name or 'root'
mapped={i:{} for i in used}
for bone,rows in weights.items():
    for idx,value in rows:
        if idx in mapped:
            name=ancestor(bone);mapped[idx][name]=mapped[idx].get(name,0)+value
armdata=bpy.data.armatures.new('VisitorSkeleton');rig=bpy.data.objects.new('VisitorRig',armdata);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name in sorted(keep):
    definition=spec['bones'][name];b=armdata.edit_bones.new(name);b.head=joint(definition['head']);b.tail=joint(definition['tail'])
for name in sorted(keep):
    parent=spec['bones'][name]['parent']
    if parent:armdata.edit_bones[name].parent=armdata.edit_bones[ancestor(parent)]
bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)

def material(name,color,roughness=.65,metallic=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness;bs.inputs['Metallic'].default_value=metallic
    return m
skin=material('AvatarSkin',(.56,.29,.15),.57);shirt=material('AvatarShirt',(.027,.14,.19),.92)
pants=material('AvatarTrousers',(.035,.045,.065),.94);hair=material('AvatarHair',(.023,.015,.011),.86)
white=material('AvatarEyeWhite',(.80,.76,.68),.35);iris=material('AvatarIris',(.06,.035,.016),.42)
pupil=material('AvatarPupil',(.006,.004,.003),.19);lip=material('AvatarLips',(.30,.10,.068),.58)
shoe=material('AvatarShoe',(.027,.028,.031),.73);sole=material('AvatarSole',(.70,.69,.64),.82)
seam=material('AvatarSeam',(.08,.10,.11),.82);gold=material('AvatarOrbitGold',(.63,.42,.15),.29,.78)
glow=material('AvatarOrbitLight',(.1,.65,.7),.3,.35)
glow.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.06,.42,.5,1)
glow.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.5
meshes=[]
def bind(obj,indices=None,bone=None):
    obj.parent=rig;mod=obj.modifiers.new('VisitorDeformation','ARMATURE');mod.object=rig
    if bone:obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    else:
        groups={name:obj.vertex_groups.new(name=name) for name in keep}
        for local,original in enumerate(indices):
            rows=sorted(mapped[original].items(),key=lambda x:x[1],reverse=True)[:4];total=sum(w for _,w in rows)
            for name,value in rows:groups[name].add([local],value/total,'REPLACE')
    for face in obj.data.polygons:face.use_smooth=True
    meshes.append(obj);return obj

# Continuous surfaces retain the original facial anatomy and articulated fingers.
# Clothes replace covered skin, so the downloadable mesh contains no nude torso/pelvis.
buckets={name:[] for name in ['skin','shirt','pants']}
for face in faces:
    c=sum((points[i] for i in face),Vector())/len(face)
    if c.z<.13:continue
    if c.z<.97:kind='pants'
    elif c.z<1.58 and (c.z<1.505 or abs(c.x)>.07) and (abs(c.x)<.235 or c.z>1.30):kind='shirt'
    else:kind='skin'
    buckets[kind].append(face)
edge_counts={}
for face in buckets['shirt']:
    for a,b in zip(face,face[1:]+face[:1]):
        key=tuple(sorted((a,b)));edge_counts[key]=edge_counts.get(key,0)+1
boundary={}
for (a,b),count in edge_counts.items():
    if count==1:boundary.setdefault(a,[]).append(b);boundary.setdefault(b,[]).append(a)
for _ in range(8):
    updates={i:points[i].lerp(sum((points[n] for n in adjacent),Vector())/len(adjacent),.65) for i,adjacent in boundary.items()}
    for i,p in updates.items():points[i]=p
for i in boundary:
    if points[i].z<1.06:points[i].z=.94
cuffs=[];unseen=set(boundary)
while unseen:
    component=[];todo=[unseen.pop()]
    while todo:
        i=todo.pop();component.append(i)
        for n in boundary[i]:
            if n in unseen:unseen.remove(n);todo.append(n)
    center=sum((points[i] for i in component),Vector())/len(component)
    if abs(center.x)>.20 and 1.15<center.z<1.48:
        side='L' if center.x>0 else 'R'
        axis=(joint(spec['bones']['upperarm02.'+side]['tail'])-joint(spec['bones']['upperarm01.'+side]['head'])).normalized()
        for i in component:points[i]-=axis*(points[i]-center).dot(axis)
        cuffs.append((component,center,axis,side))
for kind,fs in buckets.items():
    indices=sorted(set(i for f in fs for i in f));remap={i:n for n,i in enumerate(indices)}
    mesh=bpy.data.meshes.new('Visitor'+kind.title());mesh.from_pydata([points[i] for i in indices],[],[[remap[i] for i in f] for f in fs]);mesh.update()
    obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append({'skin':skin,'shirt':shirt,'pants':pants}[kind])
    if kind!='skin':
        # Offset the garment and soften muscle definition; seams remain continuous.
        for v in mesh.vertices:
            v.co+=v.normal*(.014 if kind=='shirt' else .016)
            if kind=='shirt' and 1.01<v.co.z<1.47 and abs(v.co.x)<.205 and v.co.y<0:
                v.co.y=-.142*math.sqrt(max(.12,1-(v.co.x/.24)**2))
        smooth=obj.modifiers.new('GarmentDrape','SMOOTH');smooth.factor=.85;smooth.iterations=9
        if kind=='shirt':
            interior=obj.vertex_groups.new(name='GarmentInterior');interior.add([n for n,i in enumerate(indices) if i not in boundary],1,'REPLACE');smooth.vertex_group=interior.name
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=smooth.name)
    bind(obj,indices=indices)

def sphere(name,center,size,mat,bone='head',segments=20,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=center);o=bpy.context.object;o.name=name;o.scale=size
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.data.materials.append(mat);bind(o,bone=bone);return o
def curve(name,coords,radius,mat,bone='head'):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=3;c.bevel_depth=radius;c.bevel_resolution=2
    s=c.splines.new('BEZIER');s.bezier_points.add(len(coords)-1)
    for p,co in zip(s.bezier_points,coords):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);bind(o,bone=bone);return o

# Inset eyes, dark pupils and small corneal catchlights sit inside the real sockets.
eye_centers=[]
for side in ['L','R']:
    c=joint(spec['bones']['eye.'+side]['head']);eye_centers.append(c)
    sphere('Eye.'+side,c,(.0127,.0127,.0127),white)
    sphere('Iris.'+side,c+Vector((0,-.0118,0)),(.0058,.002,.0058),iris)
    sphere('Pupil.'+side,c+Vector((0,-.0133,0)),(.0027,.001,.0027),pupil)
    sphere('Catchlight.'+side,c+Vector((-.0017,-.014,.0021)),(.001,.0005,.001),white,segments=10,rings=6)
    brow=[c+Vector((x,-.006, .023+(.003 if abs(x)<.009 else 0))) for x in [-.019,-.009,.006,.019]]
    curve('Eyebrow.'+side,brow,.0024,hair)

# Short sculpted hair follows the head's actual scalp, with restrained strand ridges.
head_faces=[]
eye_height=sum(c.z for c in eye_centers)/2;eye_front=sum(c.y for c in eye_centers)/2
for face in faces:
    c=sum((points[i] for i in face),Vector())/len(face)
    if c.z>eye_height+.069 or (c.z>eye_height+.018 and c.y>eye_front+.044):head_faces.append(face)
indices=sorted(set(i for f in head_faces for i in f));remap={i:n for n,i in enumerate(indices)}
mesh=bpy.data.meshes.new('SculptedHair');mesh.from_pydata([points[i] for i in indices],[],[[remap[i] for i in f] for f in head_faces]);mesh.update()
o=bpy.data.objects.new('SculptedHair',mesh);bpy.context.collection.objects.link(o);o.data.materials.append(hair)
for v in mesh.vertices:v.co+=v.normal*.006
bind(o,bone='head')

for side in ['L','R']:
    c=joint(spec['bones']['foot.'+side]['head']);x=c.x
    sphere('AnkleSock.'+side,(x,c.y,.143),(.043,.050,.074),pants,bone='foot.'+side,segments=20,rings=10)
    # Sneakers have separate soles, uppers, tongues and laces; no exposed toe geometry.
    for name,z,rx,ry,rz,mat in [('Sole',.026,.061,.132,.025,sole),('Upper',.074,.057,.126,.058,shoe)]:
        sphere(name+'.'+side,(x,c.y-.051,z),(rx,ry,rz),mat,bone='foot.'+side,segments=24,rings=10)
    for k in range(4):curve('Lace.'+side+str(k),[(x-.028,c.y-.061-k*.013,.126-k*.004),(x,c.y-.068-k*.013,.13-k*.004),(x+.028,c.y-.061-k*.013,.126-k*.004)],.002,sole,bone='foot.'+side)

# Raised collar and placket give the shirt a garment silhouette rather than body paint.
neck=joint(spec['bones']['neck01']['head'])
for component,center,axis,side in cuffs:
    u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u)
    coords=sorted((points[i] for i in component),key=lambda p:math.atan2((p-center).dot(v),(p-center).dot(u)))
    curve('SleeveHem.'+side,coords+[coords[0]],.003,shirt,bone='upperarm02.'+side)
neckline=[points[i].copy() for i in boundary if points[i].z>1.47 and abs(points[i].x)<.13]
neckline.sort(key=lambda p:math.atan2(p.y-neck.y,p.x))
if len(neckline)>5:curve('Neckline',neckline+[neckline[0]],.006,shirt,bone='spine01')
curve('CollarLeft',[(-.063,neck.y-.025,1.535),(-.050,neck.y-.061,1.49),(0,neck.y-.094,1.47)],.010,shirt,bone='spine01')
curve('CollarRight',[(.063,neck.y-.025,1.535),(.050,neck.y-.061,1.49),(0,neck.y-.094,1.47)],.010,shirt,bone='spine01')
for z in [1.34,1.37,1.40]:sphere('ShirtButton',(0,neck.y-.122,z),(.0038,.002,.0038),sole,bone='spine01',segments=10,rings=6)

# Preserve the paid Orbit appearance as a rigged material overlay, hidden by runtime until verified.
orbit=[]
for name,coords in [('OrbitLeft',[(-.14,-.122,1.05),(-.16,-.147,1.25),(-.15,-.11,1.41)]),('OrbitRight',[(.14,-.122,1.05),(.16,-.147,1.25),(.15,-.11,1.41)])]:
    o=curve(name,coords,.009,gold,bone='spine02');orbit.append(o)
o=curve('OrbitEmblem',[(-.024,-.17,1.3),(0,-.175,1.273),(.024,-.17,1.3)],.005,glow,bone='spine01');orbit.append(o)

# A compact skeleton: skin weights are merged to anatomical limb bones, never rigid egg parts.
def world_rotation(name,axis,angle):
    local=rig.data.bones[name].matrix_local.to_3x3().inverted()@Vector(axis)
    return Quaternion(local,angle)
def pose_frame(frame,phase,moving):
    for b in rig.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion()
    for side,sign in [('L',1),('R',-1)]:
        stride=math.sin(phase+(0 if sign==1 else math.pi)) if moving else 0
        for bone,axis,angle in [
            ('upperarm01',(0,1,0),sign*.56),('lowerarm01',(1,0,0),.48),
            ('upperleg01',(0,1,0),sign*.10),('lowerleg01',(1,0,0),max(0,-stride)*.58),
        ]:
            n=bone+'.'+side;rig.pose.bones[n].rotation_quaternion=world_rotation(n,axis,angle)
        n='upperarm01.'+side;rig.pose.bones[n].rotation_quaternion @=world_rotation(n,(1,0,0),stride*.28)
        n='upperleg01.'+side;rig.pose.bones[n].rotation_quaternion @=world_rotation(n,(1,0,0),-stride*.39)
    rig.pose.bones['spine01'].rotation_quaternion=world_rotation('spine01',(0,0,1),math.sin(phase)*(.016 if moving else .004))
    rig.pose.bones['head'].rotation_quaternion=world_rotation('head',(0,0,1),math.sin(phase)*.012)
    for b in rig.pose.bones:b.keyframe_insert(data_path='rotation_quaternion',frame=frame)
for action_name,duration,moving in [('Idle',72,False),('Walk',30,True)]:
    action=bpy.data.actions.new(action_name);rig.animation_data_create();rig.animation_data.action=action
    for frame in range(0,duration+1,3):pose_frame(frame,2*math.pi*frame/duration,moving)
    track=rig.animation_data.nla_tracks.new();track.name=action_name;strip=track.strips.new(action_name,0,action);strip.action_frame_end=duration
rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
pose_frame(0,0,False);rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=False

# Merge compatible pieces into a handful of skinned draw calls while preserving material names.
for mat in [white,iris,pupil,hair,sole,shoe,shirt,pants,gold,glow]:
    objects=[o for o in bpy.data.objects if o.type=='MESH' and o.parent==rig and o.data.materials and o.data.materials[0]==mat]
    if len(objects)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=mat.name
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for child in rig.children:child.select_set(True)
bpy.context.scene.render.fps=30
bpy.ops.export_scene.gltf(filepath=str(output/'vc-visitor-realistic-v1.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_anim_slide_to_zero=True,export_skins=True,export_yup=True,export_materials='EXPORT')
print('AVATAR_EXPORT',json.dumps({'file':str(output/'vc-visitor-realistic-v1.glb'),'bones':len(keep),'sourceVertices':len(used),'eyeHeight':eye_height,'eyeFront':eye_front,'foot':[list(joint(spec['bones']['foot.'+s]['head'])) for s in ['L','R']]}))
