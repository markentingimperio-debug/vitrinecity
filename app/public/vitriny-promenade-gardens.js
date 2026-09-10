import * as THREE from '/vendor/three/three.module.js';
import {createLandscapeModels} from './vitriny-landscape-models.js';

function annularGeometry(inner, outer, segments = 48) {
  const shape = new THREE.Shape(), hole = new THREE.Path();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: 1, bevelEnabled: false, curveSegments: segments / 4});
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -.5, 0); return geometry;
}

function curvedSeatGeometry(radius, width, arc) {
  const outer = radius + width / 2, inner = radius - width / 2, shape = new THREE.Shape();
  shape.absarc(0, 0, outer, -arc / 2, arc / 2, false);
  shape.lineTo(Math.cos(arc / 2) * inner, Math.sin(arc / 2) * inner);
  shape.absarc(0, 0, inner, arc / 2, -arc / 2, true); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: 1, bevelEnabled: false, curveSegments: 18});
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -.5, 0); return geometry;
}

export function mountPromenadeGardens({scene, architecture, lite = false}) {
  const a = architecture, group = new THREE.Group(); group.name = 'promenade-gardens';
  const l = createLandscapeModels({architecture: a, lite});
  const paving = a.pavingMaterial({color: '#c2bba9', repeat: 18, formal: true});
  paving.map.repeat.set(18, 54);
  const foregroundPaving = a.pavingMaterial({color: '#c2bba9', repeat: 18, formal: true});
  foregroundPaving.map.repeat.set(18, 26);
  // The transverse street stays open; the store references and entrances are untouched.
  a.part(group, paving, -164, .51, -56, 92, .14, 276);
  a.part(group, foregroundPaving, -164, .51, 185, 92, .14, 134);
  const inset = l.material({color: '#afa99a', roughness: .79});
  for (const x of [-192, -136]) for (const [center, length] of [[-56, 276], [185, 134]]) {
    a.part(group, inset, x, .59, center, .24, .035, length);
  }
  // Staggered islands leave generous paths around both sides. Soil sits below
  // layered foliage instead of forming a flat green rectangle.
  for (const [index, z] of [-156, -107, -54, -5, 66].entries()) {
    const x = -164 + (index % 2 ? 2.5 : -2.5), y = l.bed(group, {x, z, width: 10.4, depth: 22, radius: 4.5, seed: 30 + index});
    l.tree(group, x - .8, z - 4.2, 1.25, y, index);
    l.tree(group, x + 1.1, z + 4.4, .91, y, index + 1);
    l.bench(group, x - 6.1, z, 7.2, Math.PI / 2);
    l.bench(group, x + 6.1, z, 7.2, -Math.PI / 2);
  }
  for (const [side, x] of [-183, -145].entries()) {
    for (const [index, z] of [-171, -124, -76, -27, 56, 133, 181, 220].entries()) {
      const y = l.bed(group, {x, z, width: 6.8, depth: 17, radius: 3, seed: 92 + index * 7 + side});
      l.tree(group, x + (side ? -.4 : .4), z - 3.4, 1.08 + (index % 3) * .09, y, index + side);
      l.tree(group, x + (side ? .55 : -.55), z + 3.7, .8, y, index + side + 1);
      l.bench(group, x + (side ? 4.3 : -4.3), z, 5.4, side ? -Math.PI / 2 : Math.PI / 2);
      l.lamp(group, x + (side ? -4.5 : 4.5), z - 9.2);
    }
  }
  for (const [x, z, yaw] of [[-184, 237, .3], [-144, 237, -.3], [-184, 195, .3], [-144, 195, -.3], [-185, -43, .5], [-143, 7, -.7]]) {
    l.cafe(group, x, z, yaw, true);
    if (!lite) l.cafe(group, x + (x < -164 ? 3 : -3), z - 4.5, yaw + .7, false);
  }

  const water = new THREE.MeshPhysicalMaterial({color: '#426c70', roughness: .2, metalness: .42, clearcoat: 1});
  a.materials.add(water);
  const basinDisc = l.trackGeometry(new THREE.CylinderGeometry(1, 1, 1, lite ? 36 : 56));
  const fountainRim = l.trackGeometry(annularGeometry(7.6, 8.35));
  const waterDisc = l.trackGeometry(new THREE.CircleGeometry(7.55, lite ? 40 : 64));
  const fountain = new THREE.Group(); fountain.name = 'promenade-fountain'; fountain.position.set(-164, .59, 31); group.add(fountain);
  l.mesh(fountain, basinDisc, l.planterStone, 0, .12, 0, 9.1, .24, 9.1);
  l.mesh(fountain, fountainRim, a.warm, 0, .25, 0, 1, .045, 1);
  l.mesh(fountain, fountainRim, l.planterStone, 0, .65, 0, 1, .6, 1);
  const surface = l.mesh(fountain, waterDisc, water, 0, .68, 0); surface.rotation.x = -Math.PI / 2;
  // Animated normals use the existing render loop, without another reflection pass.
  water.onBeforeCompile = shader => {
    shader.uniforms.landscapeTime = {value: 0};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 landscapePosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nlandscapePosition = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float landscapeTime;\nvarying vec3 landscapePosition;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal.xy += vec2(sin(landscapePosition.x * 7.0 + landscapeTime), cos(landscapePosition.y * 9.0 - landscapeTime * .8)) * .065;\nnormal = normalize(normal);');
    surface.onBeforeRender = () => { shader.uniforms.landscapeTime.value = performance.now() * .00075; };
  };
  water.customProgramCacheKey = () => 'vitrinecity-landscape-water-v1';
  const streamMaterial = l.material({color: '#dcebe9', emissive: '#a9d0ca', emissiveIntensity: .5, roughness: .18, metalness: .12});
  const streamGeometry = l.trackGeometry(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5.6, 0), new THREE.Vector3(2, 0, 0)), lite ? 14 : 22, .043, 5, false));
  const jetRing = l.trackGeometry(new THREE.TorusGeometry(.27, .045, 5, 16));
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12, radius = 3.55;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    l.mesh(fountain, streamGeometry, streamMaterial, x, .75, z, 1, 1 + (i % 2) * .23, 1, -angle + Math.PI);
    const nozzle = l.mesh(fountain, jetRing, a.warm, x, .73, z); nozzle.rotation.x = Math.PI / 2;
  }
  const centralStream = l.trackGeometry(new THREE.CylinderGeometry(.03, .13, 5.2, 7));
  l.mesh(fountain, centralStream, streamMaterial, 0, 3.25, 0);
  const seatGeometry = l.trackGeometry(curvedSeatGeometry(9.05, .82, Math.PI * .57));
  for (const yaw of [0, Math.PI]) {
    l.mesh(fountain, seatGeometry, l.planterStone, 0, .31, 0, 1, .42, 1, yaw);
    l.mesh(fountain, seatGeometry, a.wood, 0, .57, 0, 1, .12, 1, yaw);
  }
  for (const x of [-174.7, -153.3]) for (const z of [21, 41]) l.lamp(group, x, z, 3.9);

  // A planted armillary globe marks the first block, as in the reference view.
  const globeGarden = new THREE.Group(); globeGarden.name = 'promenade-globe-garden';
  globeGarden.position.set(-164, .59, 159); group.add(globeGarden);
  const outerRing = l.trackGeometry(annularGeometry(3.1, 8.8));
  const soilRing = l.trackGeometry(annularGeometry(3.36, 8.52));
  l.mesh(globeGarden, basinDisc, l.planterStone, 0, .13, 0, 9.6, .26, 9.6);
  l.mesh(globeGarden, outerRing, a.warm, 0, .27, 0, 1, .035, 1);
  l.mesh(globeGarden, outerRing, l.planterStone, 0, .59, 0, 1, .55, 1);
  l.mesh(globeGarden, soilRing, l.soil, 0, .88, 0, 1, .045, 1);
  for (let sector = 0; sector < 14; sector++) {
    const angle = sector * Math.PI * 2 / 14, r = 6.35;
    l.planting(globeGarden, {x: Math.cos(angle) * r, z: Math.sin(angle) * r, y: .92, width: 3.8, depth: 3.8, seed: sector + 420});
  }
  for (const [index, angle] of [.3, Math.PI - .3, Math.PI + .42, Math.PI * 2 - .42].entries()) {
    l.tree(globeGarden, Math.cos(angle) * 6.7, Math.sin(angle) * 6.7, .82, .92, index);
  }
  l.mesh(globeGarden, basinDisc, l.darkMetal, 0, .55, 0, 2.8, 1.05, 2.8);
  l.mesh(globeGarden, basinDisc, a.brass, 0, 1.14, 0, 2.45, .18, 2.45);
  l.mesh(globeGarden, basinDisc, l.planterStone, 0, 1.8, 0, 1.1, 1.2, 1.1);
  const globe = new THREE.Group(); globe.position.y = 5.5; globe.rotation.z = -.19; globeGarden.add(globe);
  const longitude = l.trackGeometry(new THREE.TorusGeometry(3.4, .047, 6, lite ? 40 : 64));
  for (let i = 0; i < 6; i++) l.mesh(globe, longitude, a.brass, 0, 0, 0, 1, 1, 1, i * Math.PI / 6);
  for (const latitude of [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]) {
    const ring = l.mesh(globe, longitude, a.brass, 0, Math.sin(latitude) * 3.4, 0, Math.cos(latitude), Math.cos(latitude), Math.cos(latitude));
    ring.rotation.x = Math.PI / 2;
  }
  const cradle = l.trackGeometry(new THREE.TorusGeometry(3.72, .115, 8, lite ? 40 : 64, Math.PI * 1.3));
  const support = l.mesh(globeGarden, cradle, a.brass, 0, 5.5, 0); support.rotation.z = -Math.PI * .65;
  const globeSeat = l.trackGeometry(curvedSeatGeometry(9.15, .72, Math.PI * .48));
  for (const yaw of [-Math.PI / 2, Math.PI / 2]) {
    l.mesh(globeGarden, globeSeat, l.planterStone, 0, .34, 0, 1, .42, 1, yaw);
    l.mesh(globeGarden, globeSeat, a.wood, 0, .59, 0, 1, .12, 1, yaw);
  }

  // The existing civic plaza keeps its clear centre and operational walkways.
  for (const [index, [x, z]] of [[-39, -31], [39, -31], [-39, 34], [39, 34]].entries()) {
    a.roundedPart(group, paving, x, .35, z, 21, .3, 15, 5);
    const y = l.bed(group, {x, z, width: 16, depth: 10, radius: 4, y: .5, seed: index + 560});
    l.tree(group, x - 4, z, 1.2, y, index); l.tree(group, x + 4, z - 1, .94, y, index + 1);
    l.bench(group, x, z + 6.2, 10.8);
  }
  a.batch(group); scene.add(group); return group;
}
