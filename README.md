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
* **Character & Physics:** A rigged, realistically proportioned explorer (Ranger or Villager, male or female) with walk, jog and sprint blended by ground speed and kept in step, three-part jumps, a roll after hard landings and a real swim stroke, driven by a fixed-step physics controller — acceleration and friction, sprint, jumping with coyote time, gravity, real ground contact and sliding on slopes too steep to climb.
* **Living Grass:** Dense, thin, instanced blades (around 60 per square metre at high quality, with drier blades and sun-bleached tips) in world-fixed patches (only the patches in view are drawn, simpler blades farther away) with wind gusts and sunlight shining through them. Blades bend away from your legs while your feet are on the ground, stay trodden down along the path you walked and slowly stand back up, spring up while you're in the air and flatten where you land. Styles: meadow, wild & tall, wildflowers, dry steppe or none. Blades and ground share one colour function, noise texture and light model, so the field blends into the land around it.
* **Terrain Materials:** Per-pixel grass (lush and dry drifts, alpine meadow higher up), stony soil on slopes, stratified rock, snow on the highest peaks, sandy shores and leaf litter under the trees. Close up, photo-scanned 2K textures (Poly Haven, CC0) add detail, bumps, ambient occlusion and roughness while each layer keeps its palette colour, rock projected three ways so cliffs aren't smeared; wet ground turns glossy and mirrors the sky. The terrain reaches 2 to 4 km depending on quality, with distant forests drawn as tree crowns where the trees themselves end.
* **Forests, Ferns & Boulders:** Placed deterministically from noise and the terrain: forests in broad patches, pines taking over with altitude and on slopes, oaks, ashes and aspens in the lowlands, a tree line around 200 m, ferns on the forest floor, boulders on slopes and toward the mountains. Realistic trees from EZ-Tree with real bark and leaf textures near you, billboards baked from eight directions (lit with baked normals) in the distance, swaying in the wind; photo-scanned boulders and ferns (Poly Haven, CC0); trunks and big rocks block the player and the free camera.
* **Lakes & Swimming:** Water that reflects the sky with Fresnel and sun glitter, lake beds tinted by depth, wading that slows you down, swimming in deep water with stroke-by-stroke propulsion and bobbing, rings and a wake spreading behind you, spray when you wade or run through the shallows, splashes with every stroke and a burst when you jump in. Coming out, the character is wet up to where the water reached (darker, glossy), drips and leaves wet footprints, and dries over about a minute.
* **Atmosphere & Clouds:** A physically based sky (Rayleigh and Mie scattering, ozone, the planet's shadow) that also gives the sunlight, sky light and moonlight everything is lit by: white noon sun, orange sunsets, deep blue dusk, a sun and moon in the sky and stars behind the clouds. Distant land fades into the horizon's colour. Volumetric cumulus and stratocumulus, shaped from a weather map and Perlin-Worley noise along the planet's curve and lit with multiple-scattering and silver linings, drift slowly with the wind while their shapes evolve, accumulated over frames without smearing, and cast moving shadows over the land.
* **Tools:** the Ranger carries a sword, a bow and a torch, the Villager an axe, a hoe and a sickle, modelled in code. Using one plays a timed action whose hand poses the arms follow (a two-bone solver over the walking clips): the sword and sickle cut the grass they sweep, the axe shakes the tree it strikes, the hoe turns the soil, arrows fly with gravity and stick where they land, and the torch lights the character and the land around it at night.
* **Smart Camera:** Smooth third-person follow that moves in front of hills and tree trunks instead of hiding the player, mouse-wheel zoom and a subtle sprint field-of-view. The free camera (V) flies with momentum, keeps above the ground and water and can't pass through mountains, trunks or boulders.

* **Settings Menu & Performance:** Gear button or Esc: character, graphics quality and grass style, with a live frame rate readout. Quality sets the render resolution cap, terrain reach and mesh density, grass and fern reach, ambient occlusion, bloom and anti-aliasing, shadow maps, cloud ray-march steps and texture size; on a first visit it's chosen from the graphics card (low on integrated Intel chips, high on NVIDIA and AMD cards). The render resolution also adapts to the frame time.

**Controls:** WASD / arrows to move, Shift to sprint, C to crouch (while sprinting: slide; in deep water: dive, Space to come up), Space to jump, 1 / 2 / 3 to take out a tool (again to put it away) and E or a click to use it, drag (or P for pointer lock) to look, mouse wheel to zoom, Esc for settings, V to switch to the free camera, B for the developer panel (performance, time of day, world seed and terrain shape, clouds, rendering: exposure, contrast, saturation, AO and bloom, layers). Add `?seed=anything` to the address for another world.

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
* Player characters and animations by **[Quaternius](https://quaternius.com)**, CC0 1.0: [Universal Base Characters](https://quaternius.itch.io/universal-base-characters), [Modular Character Outfits - Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) and the [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) (free Standard versions). `tools/characters/build.mjs` rebuilds `public/models/characters` from them.