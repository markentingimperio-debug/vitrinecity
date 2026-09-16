import * as THREE from '/vendor/three/three.module.js';

// Original procedural landscape assets, in metres. A small number of shared
// geometries supplies the entire boulevard; no downloaded models are required.
function randomSource(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function combinedGeometry(parts) {
  const positions = [], normals = [];
  for (const {geometry, matrix} of parts) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = source.attributes.position, n = source.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      positions.push(...new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix).toArray());
      normals.push(...new THREE.Vector3().fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize().toArray());
    }
    if (source !== geometry) source.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.computeBoundingSphere();
  return result;
}

function branchMatrix(start, end, radius) {
  const direction = end.clone().sub(start), midpoint = end.clone().add(start).multiplyScalar(.5);
  return new THREE.Matrix4().compose(midpoint,
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
    new THREE.Vector3(radius, direction.length(), radius));
}

function treeGeometry(lite, variant) {
  const random = randomSource(48271 + variant * 709), branches = [], clusters = [];
  const cylinder = new THREE.CylinderGeometry(.68, 1, 1, lite ? 6 : 8);
  const crownHeight = 4.5 + variant * .13;
  const base = new THREE.Vector3(), fork = new THREE.Vector3(.13, 2.65, -.08);
  branches.push({geometry: cylinder, matrix: branchMatrix(base, fork, .19)});
  branches.push({geometry: cylinder, matrix: branchMatrix(fork, new THREE.Vector3(.07, crownHeight + .85, -.08), .125)});
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399 + variant * .51, radius = 1.25 + random() * .6;
    const end = new THREE.Vector3(Math.cos(angle) * radius, crownHeight + random() * 1.55, Math.sin(angle) * radius);
    const shoulder = new THREE.Vector3(Math.cos(angle) * .52, 3.4 + random() * .6, Math.sin(angle) * .52);
    branches.push({geometry: cylinder, matrix: branchMatrix(fork, shoulder, .08)});
    branches.push({geometry: cylinder, matrix: branchMatrix(shoulder, end, .042)});
    clusters.push({center: end, scale: new THREE.Vector3(1.02 + random() * .42, .87 + random() * .37, 1.01 + random() * .4)});
  }
  clusters.push({center: new THREE.Vector3(0, crownHeight + 1.3, 0), scale: new THREE.Vector3(1.5, 1.3, 1.5)});
  // Overlapping foliage at the inner fork fills the canopy from within while
  // individual irregular leaves retain its silhouette; there is no solid crown.
  clusters.push({center: new THREE.Vector3(.05, crownHeight - .25, -.07), scale: new THREE.Vector3(1.5, 1.06, 1.38)});
  const trunk = combinedGeometry(branches);
  cylinder.dispose();
  const crown = leafGeometry({seed: 9841 + variant * 193, count: lite ? 540 : 1080,
    clusters, leafSize: lite ? .27 : .23, leafWidth: .62, volumePower: .48, coherentColor: true});
  return {trunk, crown};
}

function leafGeometry({seed, count, clusters, leafSize, leafWidth = .43, volumePower = .25, coherentColor = false}) {
  const random = randomSource(seed), positions = [], colors = [];
  const shades = (coherentColor ? ['#355b35', '#3d6138', '#4b6e3b', '#57783d', '#456c39', '#648147']
    : ['#23432c', '#315239', '#4c6536', '#68773e', '#385d3c', '#657b48']).map(c => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const cluster = clusters[i % clusters.length], angle = random() * Math.PI * 2;
    const elevation = Math.acos(random() * 2 - 1), radius = Math.pow(random(), volumePower);
    const center = new THREE.Vector3(Math.sin(elevation) * Math.cos(angle), Math.cos(elevation), Math.sin(elevation) * Math.sin(angle))
      .multiply(cluster.scale).multiplyScalar(radius).add(cluster.center);
    const yaw = random() * Math.PI * 2, inclination = .25 + random() * 1.1;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const length = leafSize * (.72 + random() * .65);
    const up = new THREE.Vector3(Math.sin(yaw) * Math.cos(inclination), Math.sin(inclination), Math.cos(yaw) * Math.cos(inclination));
    const points = [center.clone().addScaledVector(up, -length),
      center.clone().addScaledVector(right, length * leafWidth).addScaledVector(up, -length * .12),
      center.clone().addScaledVector(up, length),
      center.clone().addScaledVector(right, -length * leafWidth).addScaledVector(up, -length * .12)];
    const color = shades[Math.floor(random() * shades.length)];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...points[index].toArray());
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function grassGeometry(lite) {
  const random = randomSource(1058), positions = [], colors = [];
  const palette = ['#717844', '#71824e', '#9b9460', '#536938'].map(c => new THREE.Color(c));
  for (let i = 0; i < (lite ? 13 : 21); i++) {
    const angle = random() * Math.PI * 2, height = .35 + random() * .52, lean = .17 + random() * .45;
    const origin = new THREE.Vector3((random() - .5) * .3, 0, (random() - .5) * .3);
    const side = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const points = [];
    for (let row = 0; row < 4; row++) {
      const t = row / 3, width = .027 * (1 - t * .92);
      const center = origin.clone().add(new THREE.Vector3(Math.sin(angle) * lean * t * t, height * t, Math.cos(angle) * lean * t * t));
      points.push(center.clone().addScaledVector(side, -width), center.clone().addScaledVector(side, width));
    }
    const color = palette[i % palette.length];
    for (let row = 0; row < 3; row++) for (const index of [row * 2, row * 2 + 1, row * 2 + 2, row * 2 + 1, row * 2 + 3, row * 2 + 2]) {
      positions.push(...points[index].toArray()); colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

function parasolGeometry() {
  const positions = [], colors = [], panels = 12, rings = 4;
  const ivory = new THREE.Color('#f0e8d4'), shadow = new THREE.Color('#d6ccba');
  function point(panel, ring) {
    const angle = panel / panels * Math.PI * 2, t = ring / rings;
    return new THREE.Vector3(Math.cos(angle) * t, .49 * (1 - t) + .08 * Math.sin(t * Math.PI), Math.sin(angle) * t);
  }
  for (let panel = 0; panel < panels; panel++) for (let ring = 0; ring < rings; ring++) {
    const quad = [point(panel, ring), point(panel + 1, ring), point(panel + 1, ring + 1), point(panel, ring + 1)];
    const color = panel % 2 ? ivory : shadow;
    for (const index of [0, 1, 2, 0, 2, 3]) { positions.push(...quad[index].toArray()); colors.push(color.r, color.g, color.b); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); return geometry;
}

export function createLandscapeModels({architecture, lite = false}) {
  const a = architecture;
  const trackGeometry = geometry => { a.geometries.add(geometry); return geometry; };
  const material = options => { const result = new THREE.MeshStandardMaterial(options); a.materials.add(result); return result; };
  const bark = material({color: '#65543e', roughness: .95});
  const leaves = material({color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, roughness: .9});
  const soil = material({color: '#494d33', roughness: 1});
  const planterStone = material({color: '#ded6c7', roughness: .68});
  const darkMetal = material({color: '#343e3a', metalness: .65, roughness: .32});
  const ivory = material({color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, roughness: .9});
  const flower = material({color: '#e1d8b5', roughness: .9});
  const cylinder = trackGeometry(new THREE.CylinderGeometry(1, 1, 1, lite ? 8 : 12));
  const flowerStem = trackGeometry(new THREE.CylinderGeometry(1, 1, 1, 4));
  const bloom = trackGeometry(new THREE.IcosahedronGeometry(.075, 0));
  const grass = trackGeometry(grassGeometry(lite));
  const shrub = trackGeometry(leafGeometry({seed: 410, count: lite ? 45 : 70, leafSize: .135,
    clusters: [{center: new THREE.Vector3(0, .4, 0), scale: new THREE.Vector3(.72, .42, .65)}]}));
  const trees = Array.from({length: 3}, (_, variant) => {
    const geometry = treeGeometry(lite, variant);
    trackGeometry(geometry.trunk); trackGeometry(geometry.crown); return geometry;
  });
  const canopy = trackGeometry(parasolGeometry());
  function mesh(parent, geometry, mat, x, y, z, sx = 1, sy = sx, sz = sx, yaw = 0) {
    const result = new THREE.Mesh(geometry, mat); result.position.set(x, y, z);
    result.scale.set(sx, sy, sz); result.rotation.y = yaw;
    result.castShadow = true; result.receiveShadow = true; result.userData.architecturalPart = true;
    parent.add(result); return result;
  }
  function tree(parent, x, z, scale = 1, ground = 1.15, variant = 0) {
    const geometry = trees[((variant % trees.length) + trees.length) % trees.length], yaw = variant * 1.137;
    mesh(parent, geometry.trunk, bark, x, ground, z, scale, scale, scale, yaw);
    mesh(parent, geometry.crown, leaves, x, ground, z, scale, scale, scale, yaw);
  }
  function planting(parent, {x = 0, z = 0, y = 1.14, width = 8, depth = 15, seed = 1, dense = true} = {}) {
    const random = randomSource(seed), count = Math.round(width * depth / (lite ? 7 : 5));
    for (let i = 0; i < count; i++) {
      // Rounded distribution leaves the masonry rim visible at every corner.
      const angle = i * 2.399, r = Math.sqrt((i + .5) / count);
      const px = x + Math.cos(angle) * r * (width / 2 - .45), pz = z + Math.sin(angle) * r * (depth / 2 - .45);
      const size = (dense ? .83 : .65) + random() * .35;
      if (i % 4 === 0) mesh(parent, grass, leaves, px, y, pz, size, size * 1.15, size, random() * 6.28);
      else mesh(parent, shrub, leaves, px, y, pz, size, size * (.78 + random() * .35), size, random() * 6.28);
      if (i % (lite ? 6 : 4) === 0) for (let n = 0; n < 4; n++) {
        const fx = px + (random() - .5) * .45, fz = pz + (random() - .5) * .45, height = .43 + random() * .2;
        mesh(parent, flowerStem, bark, fx, y + height / 2, fz, .012, height, .012);
        mesh(parent, bloom, flower, fx, y + height, fz, .65, 1.2, .65);
      }
    }
  }
  function bed(parent, {x = 0, z = 0, width = 8, depth = 16, radius = 3.3, y = .59, seed = 1, planted = true} = {}) {
    const height = .58;
    a.roundedPart(parent, planterStone, x, y + height / 2, z, width, height, depth, radius);
    a.roundedPart(parent, a.warm, x, y + .12, z, width + .02, .035, depth + .02, radius);
    a.roundedPart(parent, planterStone, x, y + height + .025, z, width + .08, .09, depth + .08, radius);
    a.roundedPart(parent, soil, x, y + height + .08, z, width - .48, .045, depth - .48, Math.max(.3, radius - .24));
    if (planted) planting(parent, {x, z, y: y + height + .105, width: width - .5, depth: depth - .5, seed});
    return y + height + .105;
  }
  function bench(parent, x, z, length = 5.8, yaw = 0) {
    const group = new THREE.Group(); group.position.set(x, .59, z); group.rotation.y = yaw; parent.add(group);
    for (let slat = 0; slat < 5; slat++) a.roundedPart(group, a.wood, 0, .53, -.32 + slat * .16, length, .11, .125, .045);
    for (const sx of [-length * .36, length * .36]) {
      a.part(group, darkMetal, sx, .24, 0, .11, .46, .7);
      a.part(group, darkMetal, sx, .68, -.41, .07, 1.2, .07);
    }
    for (let row = 0; row < 3; row++) a.roundedPart(group, a.wood, 0, .85 + row * .16, -.43, length, .12, .085, .04);
  }
  function lamp(parent, x, z, height = 4.6) {
    mesh(parent, cylinder, darkMetal, x, .59 + height / 2, z, .055, height, .055);
    mesh(parent, cylinder, a.brass, x, .74, z, .12, .3, .12);
    mesh(parent, cylinder, darkMetal, x, .59 + height, z, .37, .13, .37);
    mesh(parent, cylinder, a.warm, x, .49 + height, z, .28, .07, .28);
  }
  function cafe(parent, x, z, yaw = 0, parasol = true) {
    const group = new THREE.Group(); group.position.set(x, .59, z); group.rotation.y = yaw; parent.add(group);
    mesh(group, cylinder, planterStone, 0, .76, 0, .77, .10, .77);
    mesh(group, cylinder, darkMetal, 0, .38, 0, .065, .7, .065);
    mesh(group, cylinder, darkMetal, 0, .07, 0, .35, .09, .35);
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3 + .3, chair = new THREE.Group();
      chair.position.set(Math.sin(angle) * 1.23, 0, Math.cos(angle) * 1.23); chair.rotation.y = angle; group.add(chair);
      for (const xx of [-.22, .22]) for (const zz of [-.2, .2]) mesh(chair, cylinder, darkMetal, xx, .25, zz, .02, .48, .02);
      for (let slat = 0; slat < 4; slat++) a.part(chair, a.wood, -.21 + slat * .14, .48, 0, .105, .065, .51);
      for (const xx of [-.22, .22]) mesh(chair, cylinder, darkMetal, xx, .7, .23, .025, .55, .025);
      for (let row = 0; row < 3; row++) a.part(chair, a.wood, 0, .7 + row * .105, .245, .51, .075, .035);
    }
    if (parasol) {
      mesh(group, cylinder, darkMetal, .22, 1.7, -.18, .035, 3.3, .035);
      mesh(group, canopy, ivory, .22, 2.9, -.18, 2.45, 1.3, 2.45, yaw);
      mesh(group, cylinder, a.brass, .22, 3.57, -.18, .065, .1, .065);
    }
    mesh(group, cylinder, planterStone, -.25, .87, .23, .065, .13, .065);
    mesh(group, bloom, flower, .27, .94, -.14, 1.5, 1.5, 1.5);
    return group;
  }
  return {tree, planting, bed, bench, lamp, cafe, mesh, soil, planterStone, darkMetal, trackGeometry, material, cylinder};
}
