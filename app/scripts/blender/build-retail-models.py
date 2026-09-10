"""VitrineCity authored retail architecture. Coordinates below use Three.js metres.
Executed in the isolated Blender scene through the verified MCP connection.
"""
import bpy
import bmesh
import math
import random
from mathutils import Vector

ASSETS = bpy.context.scene.get('vc_asset_directory', '')
SOURCE = bpy.context.scene.get('vc_source_directory', '')
if not ASSETS or not SOURCE or bpy.context.scene.get('vitrinecity_connection') != 'local-blender-mcp':
    raise ValueError('Use an isolated modeling scene with vc_asset_directory, vc_source_directory and vitrinecity_connection configured.')
ASSETS = ASSETS.rstrip('/\\') + '/'
SOURCE = SOURCE.rstrip('/\\') + '/'
BATCH = {}
MATERIALS = {}

def linear(hex_color):
    values = [int(hex_color[i:i+2], 16)/255 for i in (1, 3, 5)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in values)

def material(name, color, rough=.6, metal=0, alpha=1, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*linear(color), alpha)
    mat.use_backface_culling = alpha >= 1 and not name.startswith('VC_Leaves')
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear(color), 1)
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Alpha'].default_value = alpha
    if emission:
        shader.inputs['Emission Color'].default_value = (*linear(color), 1)
        shader.inputs['Emission Strength'].default_value = emission
    if alpha < 1:
        mat.surface_render_method = 'DITHERED'
        mat.use_backface_culling = False
    MATERIALS[name] = mat
    return name

def geometry(mat, vertices, faces):
    bucket = BATCH.setdefault(mat, [[], []])
    start = len(bucket[0])
    # Blender Z up, front -Y, exported as Three +Z.
    bucket[0].extend((x, -z, y) for x, y, z in vertices)
    bucket[1].extend(tuple(start+i for i in face) for face in faces)

def box(mat, x, y, z, w, h, d):
    points = [(x+sx*w/2, y+sy*h/2, z+sz*d/2) for sx,sy,sz in
        [(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1),(-1,1,-1),(1,1,-1),(1,1,1),(-1,1,1)]]
    geometry(mat, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

def contour(w,d,r,steps=8):
    points=[]
    for cx,cz,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for n in range(steps+1):
            a=math.radians(start+n*90/steps)
            points.append((cx+math.cos(a)*r,cz+math.sin(a)*r))
    return points

def rounded(mat,x,y,z,w,h,d,r=.35,bevel=.035):
    r=min(r,w/2-.01,d/2-.01)
    bevel=min(bevel,h*.3,r*.3)
    outer=contour(w,d,r)
    inner=contour(w-2*bevel,d-2*bevel,max(.01,r-bevel))
    points=[]
    for ring, yy in [(inner,y-h/2),(outer,y-h/2+bevel),(outer,y+h/2-bevel),(inner,y+h/2)]:
        points.extend((x+xx,yy,z+zz) for xx,zz in ring)
    n=len(outer)
    faces=[tuple(reversed(range(n))),tuple(range(n*3,n*4))]
    for level in range(3):
        for i in range(n):
            j=(i+1)%n
            faces.append((level*n+i,level*n+j,(level+1)*n+j,(level+1)*n+i))
    geometry(mat,points,faces)

def rail(mat,x,y,z,w,d,r,height=.08,thickness=.05):
    outer=contour(w,d,r)
    inner=contour(w-thickness*2,d-thickness*2,max(.02,r-thickness))
    points=[]
    for yy in (y-height/2,y+height/2):
        points.extend((x+xx,yy,z+zz) for xx,zz in outer)
        points.extend((x+xx,yy,z+zz) for xx,zz in inner)
    n=len(outer); faces=[]
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,2*n+j,2*n+i),(n+j,n+i,3*n+i,3*n+j),
            (2*n+i,2*n+j,3*n+j,3*n+i),(j,i,n+i,n+j)])
    geometry(mat,points,faces)

def beam(mat,a,b,r=.055,sides=8,end_r=None):
    direction=Vector(b)-Vector(a)
    if direction.length < .0001:
        return
    axis=direction.normalized()
    normal=axis.cross(Vector((1,0,0)) if abs(axis.x)<.8 else Vector((0,0,1))).normalized()
    tangent=axis.cross(normal).normalized()
    points=[]
    for center,radius in [(Vector(a),r),(Vector(b),r if end_r is None else end_r)]:
        for i in range(sides):
            p=center+radius*(normal*math.cos(i*math.tau/sides)+tangent*math.sin(i*math.tau/sides))
            points.append(tuple(p))
    faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
    for i in range(sides):
        j=(i+1)%sides;faces.append((i,j,sides+j,sides+i))
    geometry(mat,points,faces)

def leaf(mat,x,y,z,length,width,angle,tilt):
    axis=Vector((math.cos(angle)*length, math.sin(tilt)*length*.35, math.sin(angle)*length))
    side=Vector((-math.sin(angle)*width, .018, math.cos(angle)*width))
    center=Vector((x,y,z)); tip=center+axis*.5; base=center-axis*.5
    ridge=center+Vector((0,.04,0))
    geometry(mat,[tuple(base),tuple(center+side),tuple(tip),tuple(center-side),tuple(ridge)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)])

def bush(x,y,z,w,d,height,seed,count=105):
    rng=random.Random(seed)
    for n in range(count):
        a=rng.random()*math.tau; radial=math.sqrt(rng.random())
        xx=x+math.cos(a)*w*.46*radial
        zz=z+math.sin(a)*d*.46*radial
        yy=y+height*(.15+.85*rng.random())*(1-.45*radial)
        leaf(['VC_Leaves_Shadow','VC_Leaves_Olive','VC_Leaves_Light'][n%3],xx,yy,zz,.26+rng.random()*.23,.10+rng.random()*.06,a,rng.random())

def tree(x,y,z,height=3.8,spread=1.15,seed=0):
    rng=random.Random(seed)
    beam('VC_Wood_Dark',(x,y,z),(x+.12,y+height*.8,z),.12,8,.045)
    for n in range(7):
        a=n*2.399
        end=(x+math.cos(a)*spread*.72,y+height*(.58+.24*rng.random()),z+math.sin(a)*spread*.72)
        beam('VC_Wood_Dark',(x+.07,y+height*.42,z),end,.045,6,.016)
    for n in range(320):
        a=rng.random()*math.tau;r=math.sqrt(rng.random())
        yy=y+height*(.54+.40*rng.random())
        leaf(['VC_Leaves_Shadow','VC_Leaves_Olive','VC_Leaves_Light'][n%3],x+math.cos(a)*spread*r,yy,z+math.sin(a)*spread*r,.30+rng.random()*.24,.10+rng.random()*.08,a,rng.random())

def planter(x,y,z,w,d,seed,tree_height=0):
    rounded('VC_Stone',x,y+.34,z,w,.68,d,min(.48,d*.33))
    rounded('VC_Soil',x,y+.69,z,w-.16,.07,d-.16,min(.4,d*.3))
    rail('VC_Brass',x,y+.16,z,w+.02,d+.02,min(.49,d*.33),.035,.045)
    bush(x,y+.7,z,w-.2,d-.2,.95,seed,190)
    if tree_height:
        tree(x,y+.72,z,tree_height,min(w,d)*.72,seed+10)

def sofa(x,y,z):
    rounded('VC_Wood_Dark',x,y+.26,z,2.5,.35,1.12,.18)
    rounded('VC_Linen',x,y+.5,z,2.34,.24,1.03,.18)
    rounded('VC_Linen',x,y+.88,z-.43,2.4,.84,.23,.1)
    for s in (-1,1):
        rounded('VC_Linen',x+s*1.2,y+.67,z,.19,.55,1.08,.08)
        beam('VC_Brass',(x+s*.98,y+.03,z-.36),(x+s*.98,y+.26,z-.36),.034)
        beam('VC_Brass',(x+s*.98,y+.03,z+.36),(x+s*.98,y+.26,z+.36),.034)
    rounded('VC_Wood',x,y+.46,z+1.55,1.75,.14,.85,.20)
    for s in (-1,1):
        beam('VC_Brass',(x+s*.59,y+.06,z+1.55),(x+s*.59,y+.39,z+1.55),.032)

def shelving(x,y,z,width=5):
    box('VC_Wood_Dark',x,y+2.1,z,width,4.2,.32)
    for offset in (-width/2,width/2):
        box('VC_Brass',x+offset,y+2.1,z+.44,.055,4.2,.055)
    for row in range(4):
        yy=y+.55+row*1.05
        box('VC_Wood',x,yy,z+.4,width,.095,.86)
        box('VC_Light',x,yy-.06,z+.8,width-.15,.018,.035)

def initialize(style):
    BATCH.clear(); MATERIALS.clear()
    # This is our isolated modeling session, whose source .blend is saved per family.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    accent={'botanical':'#245E46','country':'#9A4D31','gallery':'#315A78'}[style]
    material('VC_Stone','#C2B297',.73)
    material('VC_Stone_Light','#D6C8AC',.62)
    material('VC_Accent',accent,.46,.19)
    material('VC_Graphite','#1D3035',.31,.55)
    material('VC_Brass','#B69251',.27,.78)
    material('VC_Wood','#90633E',.65)
    material('VC_Wood_Dark','#4E3528',.79)
    material('VC_Linen','#D1BFA0',.88,emission=.12)
    material('VC_Interior','#BD9569',.77,emission=.28)
    material('VC_Glass','#6A9399',.13,.16,.18)
    material('VC_Light','#FFD29B',.46,emission=1.6)
    material('VC_Soil','#342D20',.98)
    material('VC_Leaves_Shadow','#27452C',.89)
    material('VC_Leaves_Olive','#4D7039',.92)
    material('VC_Leaves_Light','#73904B',.88)

def construct(style):
    initialize(style)
    rounded('VC_Stone',0,.17,0,26.1,.34,20.0,2.3)
    rounded('VC_Interior',0,.39,0,23.1,.15,17.1,1.7)
    # An uninterrupted central doorway and live-catalog display windows.
    for x in (-11.25,11.25):
        rounded('VC_Stone',x,12.65,7.96,1.5,25.05,2.1,.34,.045)
        box('VC_Accent',x,12.5,9.035,1.17,24.65,.055)
        box('VC_Brass',x-.63,12.5,9.08,.045,24.65,.06)
        for yy in (3.4,6.7,9.9,13.1,16.3,19.5,22.7):
            box('VC_Graphite',x,yy,9.073,1.2,.028,.022)
    box('VC_Stone',0,12.65,-8.64,23.5,25.0,.65)
    for x in (-11.56,11.56):
        box('VC_Stone',x,12.65,-5.4,.62,25.0,6.9)
        for yy in (4.2,8.5,12.7,16.8,21):
            box('VC_Graphite',x+(-.32 if x<0 else .32),yy,-5.4,.022,.027,6.8)
    # Deep, softly rounded floor plates, soffits and narrow recessed light lines.
    for yy in (8.5,16.55,25.2):
        rounded('VC_Stone',0,yy,0,24.5,.42,18.5,1.9,.055)
        rail('VC_Stone_Light',0,yy+.15,0,24.64,18.64,1.95,.075,.13)
        rail('VC_Graphite',0,yy-.24,0,24.1,18.1,1.8,.045,.14)
        rail('VC_Light',0,yy-.20,0,24.24,18.24,1.85,.027,.045)
        rounded('VC_Interior',0,yy-.31,0,22.6,.09,16.55,1.45)
        box('VC_Light',0,yy-.37,8.28,20.8,.065,.22)
        if yy<25:
            rounded('VC_Wood',0,yy+.26,0,22.65,.065,16.4,1.35)
    for level,(bottom,top) in enumerate(((.52,8.17),(8.85,16.25))):
        mid=(bottom+top)/2; height=top-bottom
        # Front glass is set behind the actual catalog content, including doors.
        if level == 0:
            for x in (-6.85,6.85):
                box('VC_Glass',x,mid,8.97,7.95,height,.028)
            for x in (-1.04,1.04):
                box('VC_Glass',x,2.5,9.0,2.04,4.2,.025)
                box('VC_Brass',x+(.72 if x<0 else -.72),2.1,9.06,.034,.75,.06)
            box('VC_Glass',0,6.49,8.97,4.55,3.35,.028)
            box('VC_Brass',0,4.63,9.0,4.6,.075,.075)
        else:
            box('VC_Glass',0,mid,8.97,21.65,height,.028)
        for x in (-10.5,-3.15,3.15,10.5):
            box('VC_Graphite',x,mid,8.99,.11,height,.11)
            box('VC_Brass',x-.038,mid,9.055,.026,height,.023)
        if level:
            for x in (-7.0,0,7.0):
                box('VC_Brass',x,mid,9.01,.065,height,.085)
        for side in (-1,1):
            box('VC_Glass',side*11.94,mid,2.6,.025,height,11.2)
            for z in (-2.7,.2,3.1,6):
                box('VC_Graphite',side*11.96,mid,z,.095,height,.095)
                box('VC_Brass',side*12.015,mid,z,.026,height,.033)
            box('VC_Brass',side*11.99,bottom+1.25,2.6,.04,.045,11.2)
            shelving(side*6.35,bottom,-7.8,6.4)
            sofa(side*6.15,bottom+.1,2.2 if level else -.9)
            for z in (-3.5,3.6):
                beam('VC_Brass',(side*6.0,top,z),(side*6.0,top-1.65,z),.025)
                rounded('VC_Linen',side*6,top-1.8,z,1.75,.27,.8,.2)
                rounded('VC_Light',side*6,top-1.945,z,1.4,.027,.62,.18)
        # Interior partitions and slatted feature wall produce depth through the glass.
        box('VC_Interior',0,mid,-7.93,5.4,height,.13)
        for n in range(13):
            box('VC_Wood',-2.4+n*.4,mid,-7.8,.09,height-.4,.15)
    # A thin canopy projects over the usable entrance, never across the doorway.
    rounded('VC_Graphite',0,6.25,9.22,8.6,.15,2.6,.62)
    rail('VC_Brass',0,6.32,9.22,8.68,2.68,.65,.035,.05)
    box('VC_Light',0,6.16,10.45,7.7,.025,.045)
    # Upper billboard is separate live content; only its stone/green surround is authored.
    box('VC_Accent',0,21.35,8.98,22.0,7.18,.32)
    for side in (-1,1):
        box('VC_Stone',side*10.83,21.3,9.18,.48,7.6,.5)
        box('VC_Brass',side*10.54,21.3,9.445,.055,7.07,.04)
        box('VC_Stone',0,21.3+side*3.63,9.18,21.85,.34,.5)
        box('VC_Light',0,21.3+side*3.43,9.44,20.9,.025,.035)
    # Dedicated sign recess below the landscape display.
    box('VC_Accent',0,17.02,9.19,21.0,1.33,.42)
    for side in (-1,1):
        box('VC_Brass',0,17.02+side*.64,9.42,20.85,.038,.032)
    for side in (-1,1):
        box('VC_Glass',side*11.94,21.02,1.9,.035,7.6,12.35)
        for z in (-4,-1,2,5,7.3):
            box('VC_Brass',side*11.98,21.02,z,.06,7.7,.07)
        # Deep vertical fins vary the facade rhythm and reveal shadows at oblique views.
        for z in (-6.3,-5.8,-5.3,-4.8):
            box('VC_Wood' if style=='country' else 'VC_Accent',side*12.12,13,z,.28,23.5,.16)
        sofa(side*6.0,16.9,1.8)
        shelving(side*6.35,17.0,-7.8,6.4)
        beam('VC_Brass',(side*6,24.82,2),(side*6,23.15,2),.025)
        rounded('VC_Linen',side*6,23.05,2,1.75,.25,.8,.2)
        rounded('VC_Light',side*6,22.91,2,1.4,.04,.62,.18)
    box('VC_Interior',0,21,-8.2,21.8,7.6,.12)
    # Accessible roof garden, glass rails, planted beds and an airy pergola.
    rounded('VC_Wood',0,25.48,-.4,22.7,.09,16.5,1.6)
    rail('VC_Glass',0,26.08,0,23.7,17.7,1.75,1.04,.027)
    rail('VC_Brass',0,26.62,0,23.72,17.72,1.76,.055,.045)
    for x in (-10.9,-7.1,0,7.1,10.9):
        box('VC_Brass',x,26.05,8.7,.048,1.13,.048)
    for side in (-1,1):
        planter(side*7.4,25.49,6.55,6.0,2.1,100+(side+1)*30)
        planter(side*10.15,25.49,1.65,1.55,5.4,200+(side+1)*30)
    tree(-7.3,26.2,6.55,3.1,1.65,41)
    tree(7.35,26.2,6.55,3.4,1.7,62)
    planter(0,25.49,6.55,4.9,2.1,191)
    tree(.2,26.2,6.55,3.25,1.3,83)
    # Rear pavilion set well back from the parapet; no oversized roof box.
    pavilion_x=-3.2 if style=='botanical' else -2.1
    rounded('VC_Graphite',pavilion_x,28.65,-3.7,12.8,.18,6.0,1.2)
    rounded('VC_Stone_Light',pavilion_x,28.81,-3.7,13.05,.15,6.15,1.26)
    box('VC_Glass',pavilion_x,27.05,-.79,12.1,2.96,.03)
    for side in (-1,1):
        box('VC_Glass',pavilion_x+side*6.27,27.05,-3.7,.03,2.95,5.5)
        box('VC_Brass',pavilion_x+side*5.96,27.05,-.78,.07,3,.08)
    for x in (-3,0,3):
        box('VC_Brass',pavilion_x+x,27.05,-.76,.065,3,.085)
    rail('VC_Light',pavilion_x,28.55,-3.7,12.6,5.8,1.1,.025,.04)
    sofa(pavilion_x-2,25.55,-3.25)
    for x in (5.0,10.0):
        for z in (-5.8,-1):
            beam('VC_Brass',(x,25.5,z),(x,28.28,z),.065)
    for n in range(10):
        box('VC_Wood',5+n*.56,28.33,-3.4,.15,.22,5.1)
    # Two slim planters frame the entry without occupying the central path.
    for side in (-1,1):
        planter(side*12.64,.35,7.65,1.48,3.5,315+(side+1)*10,3.0)
    if style=='country':
        # Terracotta vertical frame and timber soffits distinguish the second family.
        for side in (-1,1):
            for offset in (-.32,0,.32):
                box('VC_Wood',side*11.25+offset,12.8,9.10,.09,24.7,.08)
        for n in range(16):
            box('VC_Wood_Dark',-10.5+n*1.4,8.15,5.2,.09,.16,6.7)
    elif style=='gallery':
        for side in (-1,1):
            box('VC_Stone_Light',side*11.4,13.3,9.1,.31,24.4,.16)
            box('VC_Brass',side*10.9,13.3,9.15,.08,24.4,.08)

def export(style):
    meshes=[]; triangle_count=0
    for name,(vertices,faces) in BATCH.items():
        mesh=bpy.data.meshes.new(name+'_geometry')
        mesh.from_pydata(vertices,[],faces)
        mesh.update()
        topology=bmesh.new()
        topology.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(topology,faces=list(topology.faces))
        topology.to_mesh(mesh)
        topology.free()
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(MATERIALS[name])
        obj['vitrinecity_architecture']=True
        meshes.append(obj)
        triangle_count += sum(len(face)-2 for face in faces)
    bpy.context.scene.name='VitrineCity - '+style
    bpy.context.scene['vitrinecity_connection']='local-blender-mcp'
    bpy.context.scene['asset_contract']='24x18 metres; front +Z glTF; ground entrance; horizontal live billboard'
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=ASSETS+'vc-retail-'+style+'-v1.glb',export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=SOURCE+'vc-retail-'+style+'-v1.blend')
    print('VC_MODEL_EXPORTED',style,'meshes',len(meshes),'triangles',triangle_count)

for family in ('botanical','country','gallery'):
    construct(family)
    export(family)
print('VC_RETAIL_MODELS_COMPLETE')
