# Authored retail buildings

`build-retail-models.py` creates the three retail architecture families in Blender 4.5 LTS. These are original VitrineCity geometry/material assets; no external model library or generated product photography is included. The scene is exported to self-contained glTF 2 binary files.

Run only in an isolated Blender modeling scene: the builder replaces that scene's objects. Before executing through Blender MCP or Blender's Python entry point, create the destination directories and set these scene properties:

```python
bpy.context.scene['vitrinecity_connection'] = 'local-blender-mcp'
bpy.context.scene['vc_asset_directory'] = '/absolute/checkout/app/public/assets/architecture'
bpy.context.scene['vc_source_directory'] = '/absolute/private/model-sources'
```

The source directory receives editable `.blend` files. The public asset directory receives `vc-retail-botanical-v1.glb`, `vc-retail-country-v1.glb`, and `vc-retail-gallery-v1.glb`. Build with telemetry disabled. Blender MCP is the authoring bridge and is not a runtime dependency of the website.

## Scene contract

- Units: metres; glTF/Three Y up; front +Z; body 24 by 18; origin at the pavement.
- Exterior planting and base remain inside 28 by 22; maximum height below 30.1.
- Clear entrance: x within +/-2.2, y above 0.5 through 4.4, front z about 9. There is a low plinth; existing avatar movement does not simulate step physics.
- Live catalog windows: centers x +/-6.96, y 3.75, z 9.12, each 5.2 by 5.2.
- Live landscape billboard: center (0, 21.3, 9.55), width 20.8, height 6.8.
- Store name: center (0, 17.05, 9.62), width 20.4, height 1.35.
- `VC_Accent` materials (including Blender numerical suffixes) are recolored by the real store identity. The GLBs contain no fixed store names, product offers, destinations or credentials.

Opaque geometry normals are recalculated outward before export. Geometry is batched by the 15 shared material families. Each asset is under 3 MiB and 60,000 triangles. The browser caches the three files and shares geometry between instances. A failed or invalid asset retains the existing procedural building.

Run `npm run test:city-exploration` after regeneration. It checks integration, fallback, layout, embedded assets, finite geometry, budgets, front-facing stone normals and unobstructed doors/catalog planes. Then inspect the actual city on desktop and mobile: these tests do not establish photorealism or device-wide frame rates.
