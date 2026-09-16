# Architectural lighting assets

`kloppenheim06-sunset-1k.hdr` is the unmodified 1K HDR version of **Kloppenheim 06 (Pure Sky)**, original photography by Greg Zaal and sky edits by Jarod Guest, published by Poly Haven under CC0.

- Asset: https://polyhaven.com/a/kloppenheim_06_puresky
- License: https://polyhaven.com/license
- Download: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_06_puresky_1k.hdr
- Source MD5: `995d68b1656f26452572645c0ffe898b`
- Downloaded and license verified: 2026-09-10
- Size: 1,173,154 bytes

`kloppenheim06-sky-4k.webp` (150,966 bytes) and `kloppenheim06-sky-2k.webp` (44,024 bytes) are resized WebP versions of the same asset's official 8K tone-mapped JPEG. Only Lanczos resizing and WebP compression were applied; no sky or clouds were generated.

- Original JPEG: https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/kloppenheim_06_puresky.jpg
- Original MD5: `958a8792cecb20d602dab110ebc23e06`
- Sizes: 4096x2048 at WebP quality 84, 2048x1024 at quality 80
- Original HDR brightest sample: (627, 242) in 1024x512; azimuth 0.705631 radians, elevation 0.085903 radians. Environment rotation 1.927362 radians places the sun 20 degrees east of north. The directional light uses the same direction.

The environment is hosted with the application. Visitors do not call Poly Haven's API or download from a third-party host.

`HDRLoader.js` is from the installed three.js r180 package, under the MIT license in `THREE-LICENSE.txt`. Only its `three` import was changed to the application's existing `/vendor/three/three.module.js` URL.
