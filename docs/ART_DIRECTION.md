# Seedfall art direction

Status: **draft for review**. No art batch starts until this is agreed.

Reference: the original *Serf City* (*The Settlers*, 1993), rebuilt with 2026 techniques.
Decisions taken: **stylised painterly** look, **everything procedural** (no bought or downloaded
assets), **Serf City overview camera** with zoom-out to the planet, **WebGPU first** with a
WebGL2 fallback.

## 1. Pillars

1. **Readable like Serf City.** Every settler, flag and good is legible at play zoom. Each trade
   is recognisable from its silhouette, hat, tool and work animation.
2. **Sunny and alive.** Warm, saturated meadows. Forests of individual trees. Something is always
   moving: carriers, smoke, water, wind, animals.
3. **Painterly, not plastic.** Soft forms, brush-like colour variation, coloured shadows and
   gentle outlines of light. The look of a lovingly painted miniature landscape, lit properly.
4. **Modern light.** Physically based sun and sky, soft shadows, ambient occlusion, aerial
   haze, and a grade that changes with time of day, season and biome.
5. **Everything made by code.** Every model, texture and animation is generated at load time
   from seeded rules. Variety comes for free; nothing looks copy-pasted.

## 2. What we take from Serf City

| Serf City | In Seedfall |
|---|---|
| Steep, fixed, near top-down view of a settlement | Default overview camera: about 55° pitch, narrow 28° field of view (a flat, map-like look), north up. Zooming out shows the whole planet |
| Big, characterful serfs relative to buildings | Settlers about a third of a cottage's height, with slightly large heads and hands, clear hats and tools |
| Goods visible on roads and flags | Real miniatures: log bundles, plank stacks, stone blocks, grain sacks, fish baskets, tool bundles |
| Distinct building silhouettes, visible construction stages | A building kit with signature shapes per trade: sawmill with water wheel or saw frame, windmill, round smelter chimney. Construction shows scaffolding, then frame, then walls, then roof |
| Dithered, hand-pixelled meadows and forests | Painterly ground with brush noise and flowers; dense clumps of trees with rounded, fluffy crowns |
| Bright primary colours, clear ownership | Player colour on pennants, roof trim, wardens' tabards and borders |

## 3. Look

### Palette and light
- The base palette is warm and slightly desaturated. Saturation comes from light, not from albedo.
- Shadows are cool and violet-blue, and light is warm. The hue shift is done in shading, not just brightness.
- **Times of day**, each with its own grade:
  - Dawn: pink haze and long shadows.
  - Noon: clear light with soft shadows.
  - Golden hour.
  - Blue dusk, with window glow and lanterns.
  - Moonlit night: readable, not black.
- **Seasons and biomes** shift the grade: autumn warmer, winter cooler and brighter, wetlands greener and hazier.
- Tone mapping is AgX with a gentle filmic contrast. Bloom is used only on emissive light (windows, lanterns, Star Wells).

### Painterly shading (all materials)
- Diffuse light uses a soft ramp (wrapped lighting quantised into 3–4 soft bands, blended), so forms read as painted planes.
- **Brush noise:** screen-stable, world-anchored noise modulates albedo (±6 %) and normals, breaking up flat surfaces the way brush strokes do.
- A thin rim of warm sky light on silhouettes separates objects from the ground at play zoom.
- Each object gets a small random variation in hue, value and wear, so no two cottages are the same.
- Ambient occlusion comes from two sources: ambient occlusion baked into the procedural geometry (crevices, eaves, under roofs), and screen-space ambient occlusion (GTAO) for contact between objects.

### Terrain
- **Materials:** procedural materials (grass, meadow flowers, soil, sand, rock, snow, mud) blended by slope, moisture, biome and wear, projected from three directions (triplanar). No stretching on cliffs.
- **Shape:**
  - The hex grid disappears from view. Terrain is a smooth, subdivided mesh.
  - Tile borders are drawn only in build mode.
  - Steep slopes grow rock cliffs, and coasts get beaches with pebbles.
- **Detail within a few tiles of the camera:** blades of grass, clumps of flowers, pebbles and fallen leaves by season.
- **Roads:**
  - Packed-earth paths with worn edges, stones and puddles when muddy. Busy roads get cart ruts and edge stones.

### Vegetation
- **Trees:**
  - Crowns are clusters of rounded leaf lumps with normals pointing outward, the fluffy, painted look.
  - Species differ by biome. Trees grow through visible stages and sway in the wind; the leaves are shaded in the shader.
  - Far away they become flat billboard sprites rendered at load time.
- **Undergrowth:** shrubs, ferns, reeds by water, flowers by season.

### Water
- Depth-based colour: turquoise shallows fading to deep blue. Sea and lakes get reflections of sky and shore, soft refraction, foam that laps at shores, caustics in the shallows, and sparkles where the sun glints.
- Rivers flow with animated normals, and foam at bends and where they meet the sea.

### Sky and atmosphere
- The sky is physically based (sun position, scattering) and painted over with stylised clouds (rounded, lit from the side).
- Aerial perspective: distant land fades into sky colour.
- Light shafts at dawn and dusk; fog in valleys in the morning.
- Weather changes clouds, light and grade.

### Buildings (procedural kit)
- **Parts:**
  - Bevelled stone plinths.
  - Timber-framed walls: posts, braces and plaster panels.
  - Log walls.
  - Roofs with real tile or shingle rows and ridge caps.
  - Doors, windows with frames and shutters, chimneys.
- **Silhouettes and details:**
  - Every trade has one signature element (the sawmill's saw frame and log pile, the fisher's jetty, the bakery's oven dome, the smelter's tall chimney, the windmill's turning sails).
  - Small props show the trade: barrels, crates, tools, flower boxes, washing lines.
- **Construction stages:** marked-out ground, then scaffolding with a frame, then walls, then roof, then finished. Stranded buildings get overgrown and dark.
- **Player colour:** roof trim, banners and pennants.

### Settlers and animals
- **Figures:** simple rounded shapes with a head, torso, arms and legs, hat and tool. They are built from instanced parts and animated in the shader (no skinning), so thousands stay cheap.
- **Animations:** walk, carry (loads over the shoulder or on the back), chop, saw, hammer, dig, sow, reap, fish, mine, bake, duel, wave, sit and rest.
- **Trades:** told apart by hat shape, colour and tool. Carriers wear simple caps, wardens wear helmets and tabards in the player's colour.
- **Animals:** deer, sheep, cows, birds and fish, with the same kind of procedural figures and animation.

### Effects
- Chimney smoke with soft volume, sawdust, sparks at forges and duels, dust on dry roads, and splashes.
- Rain streaks with ripples on puddles and water; snow that settles on roofs.
- Fireflies at summer dusk and falling leaves in autumn.

## 4. Camera

- **Overview (default):** 55° pitch, 28° field of view, and a zoom range from a village scene to a region.
- **Close-up:** tilts toward 35°, with a subtle tilt-shift depth-of-field for the miniature feel. It can be turned off.
- **Planet:** zooming out past the region smoothly releases to the orbital view.
- North stays up in the overview unless the player rotates. Pressing R resets the view.

## 5. Technology

- **Renderer:**
  - three.js `WebGPURenderer` with node materials written in TSL, three.js's shader language.
  - The same materials compile to WebGL2 as the fallback.
  - The Electron (Steam) build always has WebGPU.
- **Post-processing pipeline:** GTAO ambient occlusion, depth of field (close-up only), bloom, AgX tone mapping, and a colour-grade lookup table per time and season.
- **Shadows:** cascaded shadow maps (2–3 cascades) with soft edges, plus contact shadows in the ambient occlusion pass.
- **Instancing:** GPU instancing everywhere (trees, grass, settlers, goods, props) and GPU culling where WebGPU allows it.
- **Procedural textures:** generated into texture arrays at load time (terrain materials, bark, plaster, roof tiles). They are cached per seed.
- **Quality presets:**

  | Preset | Target | What's on |
  |---|---|---|
  | Low | WebGL2, 30 fps | No ambient occlusion, no depth of field, 1 shadow cascade, reduced grass |
  | Medium | Steam Deck, 45–60 fps | Everything |
  | High | Desktop, 60+ fps | Everything, at higher resolution |

- **Budgets at medium in the overview camera:**
  - Under 600 draw calls.
  - Under 1.5 M triangles.
  - 12 ms GPU on Steam Deck class hardware.

## 6. How we check it

- **Fixed shot list:** hamlet at noon, hamlet at dusk, forest edge, river valley, coast, snow, battle, and the planet from orbit. It is rendered after every art batch and shown side by side with the previous version.
- **A visual target scene first:** a riverside hamlet with every element at final quality. It needs your approval before the look is rolled out to everything else.
- **Screenshot honesty:** the sandbox has no GPU, so screenshots come from a software renderer.
  - I'll enable the highest settings for stills (slow, but they match what you see).
  - I'll check whether WebGPU runs on the software renderer, and fall back to WebGL2 stills if it doesn't.
  - Any difference from real hardware will be stated with each screenshot.

## 7. Proposed art track (inserted before batch 11)

| # | Batch | Result |
|---|---|---|
| A1 | Renderer foundation | WebGPU renderer with WebGL2 fallback; current materials ported to TSL; new post-processing pipeline (ambient occlusion, AgX, grading); cascaded shadows; overview camera |
| A2 | **Visual target scene** | A riverside hamlet at final quality: terrain, water, trees, three buildings, settlers, goods, day/night. **Approval gate** |
| A3 | Terrain, water and sky everywhere | Material blending, cliffs, beaches, roads, rivers, lakes, clouds, weather and seasons in the new style |
| A4 | Building kit | All buildings and construction stages rebuilt from the kit; player colours; stranded and captured variants |
| A5 | Settlers, animals and goods | Articulated settlers with all work animations; goods miniatures; animals |
| A6 | Vegetation, effects and polish | Tree species per biome, grass, flowers, particles, shot-list pass, performance tuning on the presets |

After A6 we return to batch 11. The later biome batches (13–16) follow this document.
