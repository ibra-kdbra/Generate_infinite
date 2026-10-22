# Changelog

Every release of Generate Infinite, newest first. The game shows it under Settings → About →
Changelog, with the changes made since the last release listed as Unreleased, read from the commits
when the game is built (tools/changelog). A commit's prefix puts it in its section: `feat:` Added,
`fix:` Fixed, `perf:` Performance, `security:` Security, `docs:` Documentation.

At a release, the Unreleased lines are written up here as a new version, and package.json takes
its number. Versions follow semantic versioning: a minor version for new features, a patch for
fixes only.

## 2.7.0 — 2026-10-22
The far landscape cleaned up, a security pass, and a game that no longer works the machine harder than it has to.

### Added
- Frame rate setting: 30, 60 (the default) or every frame the screen shows.
- Very low quality, for older laptops and integrated graphics: no shadows, no photo-scanned ground, a shorter grass field, coarser distant land. Software renderers start on it.
- This changelog, under Settings → About.
- Probes for the far terrain, its seams, depth precision, memory over a long walk, frame cost per quality, the frame-rate cap and every shader compiled after loading.

### Changed
- A window in the background draws 20 frames a second; automatic resolution aims at the chosen frame rate.
- Automatic world-generation threads take four workers at most.
- three.js 0.186, Vite 8, TypeScript 7: the build takes 2 s instead of 9, the type check about one.
- Shaders are minified in the build.

### Fixed
- Cracks through the ground on distant mountains: neighbouring terrain pieces of different detail stepped by up to 78 m, against a 15 m skirt. Skirts now hang as deep as each quality needs.
- Coarse and fine terrain drawn through each other while a piece split into finer ones.
- The end of the terrain showing as a hard line when seen from high up.
- The captured mouse on Firefox under Wayland: no more jumps at the screen's edges or when events go missing.
- Terrain pieces were never released: 492 kept after 1.8 km, now about 100.
- Loading waited for ground textures that the lowest quality never loads.
- Stutters the first time it rained, the torch was lit or a character was picked: their shaders were compiled for the screen instead of the effects' buffer the scene is drawn into, so they compiled again in the middle of play. Loading now compiles every shader once, the right way (38 programs instead of 58), shadow passes included, and a new character is compiled before it is shown.

### Security
- Content security policy and other security headers on the site.
- The development server listens on this machine only, unless asked otherwise.
- A saved world is checked before it is used; a damaged one starts fresh.
- Seven advisories in the build tools, all resolved by the updates.

### Removed
- The unused chunk debug helper and its text library: 93 kB less to download.
- Unused noise functions, debug helpers, empty methods and commented-out code.

## 2.6.0 — 2026-10-20
Hands that hold, a bow worth drawing, and a world that remembers.

### Added
- Hands that close on what they hold.
- The Ranger raises and lowers his hood with his own hands.
- The world is remembered between visits: where you stood, the time of day, every tree felled and its stump.
- A build number in the console, and a report of the captured mouse with `?mouse`.
- The engine plan for growing the world into a game.

### Changed
- The bow reworked: taken from the back, an arrow drawn from the quiver and nocked each time, drawn to the corner of the mouth, side-on to the mark.
- Carried things rest on the body: the bow on the back, the torch at the belt, no gaps under the axe, hoe and sickle.
- The libraries ship in their own files, so returning visitors keep them cached.
- The README shows the game played: the archer at full draw, a tree coming down, night with the torch.

### Fixed
- Trees flickering in and out 20 to 40 m ahead while walking.
- Rocks and ferns popping as they came into view.
- A game begun at night drew nothing.
- The captured mouse: a sane, even speed; quick movements no longer dropped; read the same way on Firefox.

### Performance
- Deer are reused instead of made anew; far deer are animated less often.

## 2.5.0 — 2026-10-19
Gear carried the way it was, and tools that move like the real thing.

### Added
- A bag on the back, a cover for each tool, and taking a tool out step by step: over the shoulder, out of the bag, the cover slid off.
- Real animation for the sword, axe, sickle and torch, and more moves for each.
- Felling by thickness: cuts where the axe lands, the tree tips toward the notch, comes down and leaves a stump; solid logs and crowns that rustle when pushed through.
- The mouse looks around after a click into the game.
- A logo, a tab icon and a picture for shared links.

### Changed
- A runner's weight: speeds, acceleration, turning, stopping and lean.
- With a tool out, the body runs where it steers and aims steadily.
- A README that shows the game.

### Fixed
- The head kept level, looking where it should.
- Arrows stick where they strike.

## 2.4.0 — 2026-10-18
Climbing as climbers do, and a Ranger with hair under the hood.

### Added
- Climbing one limb at a time: a hand, the opposite foot, the other hand, the other foot.
- Rangers with hair; the hood comes down with G or from the menu.
- A clear message when the browser can't start 3D graphics, instead of a black page.

### Changed
- Settings split into short pages: Game, Graphics, Sound.
- Tools on the hip swing clear of the legs; scrambling up a slope stays upright.

### Fixed
- Axe and hoe strokes that flipped through the body, and a hoe that never reached the ground.
- Keys counted twice, so taking a tool out put it straight back.
- The gear button opened an empty menu.
- No key hints on phone-sized screens.

## 2.3.0 — 2026-10-16
A character with things to do, weather, wildlife and sound.

### Added
- Crouch, slide and dive, with a breath meter under water.
- Three tools for each outfit: sword, bow and torch for the Ranger; axe, hoe and sickle for the Villager.
- Feet placed on the ground, and climbing: grab a steep face, climb along it, pull up over the top.
- A sword moveset of fourteen strokes, and an archer's draw.
- Rain, wet ground, overcast light and storms with lightning and thunder.
- Moving weather, high cirrus, stars by real magnitude and a Milky Way.
- Birds, and deer herds that graze, watch and bolt.
- Sound made entirely in the browser: wind, rain, birdsong, crickets, footsteps, tools, thunder.
- A menu drawer with pages for the game, the sky, the world, visuals, the player, stats and keys.
- Temporal anti-aliasing, and a resolution setting with sharpening.
- A world-generation threads setting, and a loading screen.

### Performance
- Trees in three levels of detail, lighter shadows, ambient occlusion at half resolution: on an RTX 2060 at ultra, a forest frame from 15.3 to 11.3 ms.
- Ground textures compressed on the graphics card to a quarter of the memory; trees hidden behind hills are not drawn.
- Deer drawn as one mesh each: the processor's work per frame from 10–15 ms to about 4 ms.

### Fixed
- Arms twisting with tools, climbing holds that slid, a hop over the top of a climb.

## 2.2.0 — 2026-10-15
A new sky and the light to go with it.

### Added
- A physically based sky: scattering, ozone and the planet's shadow; orange sunsets and blue dusk lighting everything.
- Volumetric clouds that drift with the wind and change shape.
- Cascaded sun shadows: mountains shade the valleys at sunset.
- Photo-scanned boulders and ferns, dense fine grass, and 2K ground textures; wet ground turns glossy.
- Distant forests drawn as tree crowns where the trees themselves end.
- A starting quality chosen from the graphics card.

### Fixed
- Low quality drew nothing but fog.
- A black screen on NVIDIA graphics cards.
- Skin and cloth too glossy in strong sun.

## 2.0.0
The move to TypeScript.

### Changed
- The whole game rewritten from JavaScript in strict TypeScript, with typed state, view and workers, and a type check in the build.

## 1.0.0
Where it began.

### Added
- Infinite World by Bruno Simon: endless terrain generated in workers, grass and a day cycle, in three.js.
