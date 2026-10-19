# Infinite World in TypeScript

### An immersive, infinite, procedurally generated world built with Three.js and WebGL, fully refactored in TypeScript.

This project is a TypeScript-based evolution of the original [Infinite World](https://github.com/brunosimon/infinite-world) concept by the creative developer Bruno Simon. It serves as a technical demonstration of procedural generation and a case study in migrating a JavaScript codebase to TypeScript for enhanced scalability and maintainability.

![Infinite World Screenshot](/public/social/share-1200x630.png)

## Key Features

* **Infinite Procedural Terrain:** A unique, dynamically generated world every time that changes as you travel — lowland plains, rolling hills worn smooth by an eroded noise, ridged mountain ranges with wide valleys, and lakes filling the basins.
* **Built with Three.js:** Leverages the power of **Three.js** for efficient **WebGL** rendering.
* **Fully Typed Codebase:** Migrated from JavaScript to **TypeScript** for robust, maintainable, and error-free code.
* **Physically Based Rendering:** The world is lit in linear HDR by one atmosphere model and rendered through a post-processing chain (`postprocessing` + N8AO): ambient occlusion, bloom on the brightest highlights (the sun, glints on water), AgX filmic tone mapping with a contrast/saturation look, SMAA and a light vignette. Exposure adapts like an eye at dusk and night, when colours fade to a moonlit blue.
* **Sun Shadows:** Three cascaded shadow maps: a sharp one around the camera, a wider one for the trees and land, and a terrain-only one reaching kilometres out, so mountains shade the valleys at sunset. Trees (alpha-tested leaves that sway as they do), billboards, boulders, terrain and the character cast; canopies shade themselves.
* **Character & Physics:** A rigged, realistically proportioned explorer (Ranger or Villager, male or female; the Ranger's hood comes down with G) with walk, jog and run each in their own band of speed and kept in step, a runner's weight (half a second to the jog, a second more to the run, a short skid to stop, turns that widen with speed, a plant-and-pivot to turn round) and lean (into the acceleration, banked into turns), three-part jumps, a roll after hard landings and a real swim stroke, driven by a fixed-step physics controller — acceleration and friction, sprint, jumping with coyote time, gravity and real ground contact. The feet are placed on the terrain (each lifted onto the ground under it, the hips sinking for the lower one, the soles tilted to the slope), so nothing sinks into a hillside. Slopes too steep to walk can be climbed the way a climber does it: one limb at a time in a climber's order, feet under the hips, hips in to the rock and shifting over the holding foot, the head following the reaching hand, stamina draining, a lunge up, and a pull-up over the edge at the top. The slide is feet first: hips down and leaning back, the lead leg out, the other folded under it, a hand trailing on the ground.
* **Living Grass:** Dense, thin, instanced blades (around 60 per square metre at high quality, with drier blades and sun-bleached tips) in world-fixed patches (only the patches in view are drawn, simpler blades farther away) with wind gusts and sunlight shining through them. Blades bend away from your legs while your feet are on the ground, stay trodden down along the path you walked and slowly stand back up, spring up while you're in the air and flatten where you land. Styles: meadow, wild & tall, wildflowers, dry steppe or none. Blades and ground share one colour function, noise texture and light model, so the field blends into the land around it.
* **Terrain Materials:** Per-pixel grass (lush and dry drifts, alpine meadow higher up), stony soil on slopes, stratified rock, snow on the highest peaks, sandy shores and leaf litter under the trees. Close up, photo-scanned 2K textures (Poly Haven, CC0) add detail, bumps, ambient occlusion and roughness while each layer keeps its palette colour, rock projected three ways so cliffs aren't smeared; wet ground turns glossy and mirrors the sky. The terrain reaches 2 to 4 km depending on quality, with distant forests drawn as tree crowns where the trees themselves end.
* **Forests, Ferns & Boulders:** Placed deterministically from noise and the terrain: forests in broad patches, pines taking over with altitude and on slopes, oaks, ashes and aspens in the lowlands, a tree line around 200 m, ferns on the forest floor, boulders on slopes and toward the mountains. Realistic trees from EZ-Tree with real bark and leaf textures near you, billboards baked from eight directions (lit with baked normals) in the distance, swaying in the wind; photo-scanned boulders and ferns (Poly Haven, CC0); trunks and big rocks block the player and the free camera.
* **Lakes & Swimming:** Water that reflects the sky with Fresnel and sun glitter, lake beds tinted by depth, wading that slows you down, swimming in deep water with stroke-by-stroke propulsion and bobbing, rings and a wake spreading behind you, spray when you wade or run through the shallows, splashes with every stroke and a burst when you jump in. Coming out, the character is wet up to where the water reached (darker, glossy), drips and leaves wet footprints, and dries over about a minute.
* **Sky & Weather:** A physically based sky (Rayleigh and Mie scattering, ozone, the planet's shadow) that also gives the sunlight, sky light and moonlight everything is lit by: white noon sun, orange sunsets, deep blue dusk. Volumetric cumulus shaped from a weather map and Perlin-Worley noise along the planet's curve, lit with multiple scattering and silver linings, carried by a wind you can set (18 m/s by default, visibly drifting) while their shapes grow and change; a quarter of their pixels is ray-marched each frame and the rest rebuilt from history. A high veil of cirrus streaked along the wind glows at sunset. At night 6000 stars by real magnitude and colour twinkle near the horizon and turn about the pole with a Milky Way, under a moon with seas and craters. The weather (changing on its own, or clear, cloudy, overcast, rain, storm) sets the cloud cover; rain falls around you and wets the ground, overcast skies grey the light, storms gust through the trees and strike lightning with thunder following. Flocks of birds wheel over the land by day, and herds of deer graze the meadows and forest edges: they look up when you come near, bolt and leap away if you come closer (crouch to creep up on them), and can be hunted with the bow.
* **Tools:** the Ranger carries a sword, a bow and a torch, the Villager an axe, a hoe and a sickle, modelled in code and worn the way people carried them (belt quivers, scabbards at the left hip, tools tucked in the belt): the Ranger's sword in its scabbard at the left hip, the bow slung on the back, arrows in a belt quiver at the right hip, the torch behind the belt; the Villager's axe hooked in the belt at the right hip under a leather guard, the sickle sheathed at the left hip, the hoe slung on the back, a burlap sack. Taking one out is done step by step: the sword drawn across the body out of the scabbard that stays on the belt, the bow reached for over the shoulder, a guarded tool pulled out and its guard slid off by the other hand into the sack or pouch; putting it away the other way round. Belt tools swing aside from the legs. With a tool in hand the body keeps facing ahead: S backs away, A and D step aside with the hips turned. Holding and using the sword, the axe, the sickle and the torch is real animation from the Universal Animation Libraries (on the upper body while moving, the whole body standing still): the sword's guard and its slashes, overhead strike, dash strike and combos, a woodcutter's two-handed chop (the axe following both hands), a harvest cut with the sickle, the torch held up; each press goes on to the next move, its name shown above the toolbar. The bow is shot as an archer does: side-on to the mark, an arrow taken from the quiver and nocked every shot, drawn to the corner of the mouth; arrows fly with gravity and drag and stick where they strike (the trunk as drawn, the rock's real surface, the ground as it gains detail). Only the axe fells trees: it bites notches slanted along its stroke, deeper on the same spot; a tree falls after 5 to 20 chops by its thickness, toward its notch, hinging at the cut and leaving a stump; the fallen trunk is solid and its crown a thicket. The sword scars bark, the sickle scratches it, the hoe nicks it, the torch scorches it; the hoe turns the soil, the sickle mows grass, bushes can be cut down.
* **Smart Camera:** Smooth third-person follow that moves in front of hills and tree trunks instead of hiding the player, mouse-wheel zoom and a subtle sprint field-of-view. The free camera (V) flies with momentum, keeps above the ground and water and can't pass through mountains, trunks or boulders.
* **Sound:** All made as you play with WebAudio, nothing downloaded: wind rising with the wind and height, rain, birdsong by day and crickets at night, footsteps and splashes on the walk cycle, tool whooshes, chops, clangs and digging, the bow's twang, falling trees, thunder; world sounds pan and fade with distance.

* **Menu & Performance:** Esc opens a drawer of pages: Game (character, graphics quality, resolution, anti-aliasing, grass, sound), Sky (time, weather, clouds and wind, the night sky), World (seed, terrain shape), Visuals (exposure and look, occlusion, bloom, layers), Player (camera, movement, climbing), Stats (live frame-time graph and counters, performance switches; B), Keys and About. Quality sets the resolution cap, terrain reach and density, grass and fern reach, occlusion, bloom, shadow maps, cloud steps and texture size; on a first visit it's chosen from the graphics card. Resolution can be automatic (following the frame time), full, 75 % or 50 %, sharpened when below full; temporal anti-aliasing builds up detail over frames. Ground textures are compressed to BC3 on the graphics card (a quarter of the memory, cached by the browser), trees hidden behind hills aren't drawn, and terrain generation runs in a chosen number of background threads.

**Controls:** WASD / arrows to move, Shift to sprint, Space to jump, C to crouch (while sprinting: slide; in deep water: dive, Space to come up), walk into a too-steep slope to climb it (W/S, A/D, Space to lunge, C to let go), 1 / 2 / 3 to take out a tool (again to put it away) and E or a click to use it (the bow: hold), drag (or P for pointer lock) to look, mouse wheel to zoom, V for the free camera. Esc opens the menu (game settings, sky and weather, world, visuals, player, stats, keys, about), H the keys page, B the stats page. Add `?seed=anything` to the address for another world.

---

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed on your machine (which includes `npm`).

### Installation & Local Development

1.  **Install NPM packages:**
    ```sh
    npm install
    ```

2.  **Run the development server:**
    ```sh
    npm run dev
    ```
    The application will be available at `http://localhost:5173/`.

---

## The Journey to TypeScript

This project was originally written in JavaScript and has been meticulously converted to TypeScript. This refactoring effort significantly improved the project's architecture, code quality, and developer experience.
Refer to this [project-tree](./project_tree.md)

### 1. Project Setup & Typing
The initial phase involved integrating TypeScript into the existing build process.

* **Dependencies:** Added `typescript`, `@types/three`, and other necessary type declarations as development dependencies.
* **Configuration:** A `tsconfig.json` file was created to define strict compiler rules and project structure.
* **Type Implementation:** All `.js` files were migrated to `.ts`. The TypeScript compiler was then used to identify and fix type errors iteratively. This included typing all variables, function signatures, and class properties, and creating interfaces for complex data structures.

### 2. Build Process & Dependencies
The build system was updated to support the new TypeScript codebase.

* **Vite Configuration:** The `vite.config.js` was updated to handle TypeScript compilation seamlessly.
* **Dependency Audit:** All dependencies were updated to their latest versions to ensure full compatibility with the TypeScript ecosystem.
* **Scripts:** A `type-check` script was added to the `package.json` to allow for static type checking without a full build.

### 3. Code Refinements & Bug Fixes
Beyond simple type conversion, the migration provided an opportunity to improve the codebase.

* **Circular Dependencies:** A circular dependency between the `State` and `View` classes was identified and resolved by reordering their initialization sequence.
* **Algorithm Enhancements:** The terrain generation parameters were fine-tuned to create a smoother, more aesthetically pleasing landscape.
* **Shader Improvements:** The terrain shaders were modified to enhance the lighting and shading models, adding more depth and realism to the scene.

---

## Acknowledgements

* A huge thank you to **Bruno Simon** for creating the original project and for his invaluable contributions to the web development community.
* Tree geometry generator from [EZ-Tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck (MIT), vendored in `src/Game/Vendor/ezTree`. Ground and bark textures from Poly Haven and TextureCan (CC0), see `public/textures/CREDITS.md`.
* Rocks and ferns: photo scans from [Poly Haven](https://polyhaven.com) (CC0). `tools/nature/build.mjs` simplifies them (a quadric-error simplifier that keeps texture seams intact) and packs their textures into `public/models/nature` and `public/textures/nature`; `tools/terrain/build.sh` builds the ground textures.
* Post-processing by [postprocessing](https://github.com/pmndrs/postprocessing) (pmndrs, zlib) and [N8AO](https://github.com/N8python/n8ao) (CC0).
* Player characters and animations by **[Quaternius](https://quaternius.com)**, CC0 1.0: [Universal Base Characters](https://quaternius.itch.io/universal-base-characters), [Modular Character Outfits - Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) and the [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) and [Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) (free Standard versions). `tools/characters/build.mjs` rebuilds `public/models/characters` from them; `tools/characters/add-clips.mjs` adds the tool clips.
* Deer and stag by **[Quaternius](https://quaternius.com)**, CC0 1.0, from the [Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html) (via [Poly Pizza](https://poly.pizza/m/T6Cs7tmMHJ)), in `public/models/animals`.