# VitrineCity visitor avatar v1

This local GLB replaces the visitor's primitive model. Crowd/NPC models are unchanged.
It contains a continuous clothed human surface, facial anatomy and hands, a compact
36-bone skeleton, Idle and Walk clips, separately tintable skin/shirt materials and
an Orbit overlay. The runtime enables the overlay only after the existing account
entitlement response. The asset has no external textures, services or URLs.

## Provenance

Upstream: MakeHuman Community, revision `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.

- Repository: https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482
- License statement: https://static.makehumancommunity.org/about/license.html
- Pinned license: https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md
- Exact CC0 text: `LICENSE-MAKEHUMAN-CC0.txt` beside this file.

Only graphical assets were used; no MakeHuman application/source code was copied.
The following upstream core assets are CC0 1.0: `makehuman/data/3dobjs/base.obj`,
`makehuman/data/rigs/default.mhskel`, `makehuman/data/rigs/default_weights.mhw`, and
`makehuman/data/targets/macrodetails/{african,asian,caucasian}-male-young.target`.
The three target shapes are averaged into one adult character; skin choices tint
that character and do not select a customer's ethnicity.

VitrineCity adjustments: garment surfaces and hems, sneakers, eyes, short hair,
anatomical weight consolidation, animation, material personalization and Orbit
details. The upstream CC0 permission covers the included source assets; this notice
does not change the project's license for its original code and adjustments.

Rebuild with Blender 4.5 and `app/scripts/build-realistic-avatar.py --source-dir DIR`.
Download the six source files listed above from the pinned revision into DIR first.
No download takes place when a visitor opens the city except for this first-party GLB.

Visual limit: this is an anatomical game avatar, not a scanned or photoreal person.
Its face is neutral; speech, facial expressions and individual face customization
are not implemented. The standard avatar remains available if loading fails.
