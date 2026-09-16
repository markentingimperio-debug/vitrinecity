These two ES modules are vendored from Three.js 0.180.0 (MIT; see LICENSE).
Only the bare `three` import was changed to `/vendor/three/three.module.js`,
the existing public route for the application's installed Three.js build.

- `loaders/GLTFLoader.js`
- `utils/BufferGeometryUtils.js`

Keep their release aligned with the application's Three.js dependency when
upgrading. Local GLB architecture needs no external decoder or asset service.
