# From explorable world to game: the engine plan

Written October 2026, when the explorable world was finished: endless terrain, forests, lakes,
sky and weather, the Ranger and the Villager with their tools, felling, archery, and the world
remembered between visits. The question is how to grow it into a real game (inventory,
combat, creatures, quests, saving) while it keeps running in the browser, and where C++ fits.

## The options

| | A. TypeScript + three.js, with a C++ core in WebAssembly | B. Godot 4 (GDScript, C++ extensions) | C. Our own engine in C++ (WebAssembly + WebGL/WebGPU) |
|---|---|---|---|
| What we keep | Everything: the renderer, the shaders, the world, the character, the tools, the probes | The art and the ideas; the code, shaders and world generation are rewritten | The ideas; everything is rewritten |
| Browser | As now (WebGL2) | Web export uses the Compatibility renderer (WebGL2); threads need special headers; C# can't go to the web yet | As good as we make it |
| C++ | Where it pays: world generation, physics, navigation | GDExtension modules (they work on web exports, with extra setup) | All of it |
| Editor, animation tools | None (code, probes) | Full editor, animation trees, scene system | None |
| Time to the first playable game loop | Weeks | Months (the port first) | A year or more |
| Risk | The game layer is ours to build | Our look (custom sky, clouds, grass, trees) is hard to match in its web renderer | Very high |

## Recommendation: A

Keep TypeScript and three.js as the game's shell, renderer and gameplay layer, and add a C++
core compiled to WebAssembly (Emscripten) for the systems where C++ is worth it. It keeps
everything built so far, keeps the game in the browser with no install, and puts C++ where
it gives speed and lasting value. The same C++ core can later run natively (a desktop build,
a server for multiplayer) if that's ever wanted.

What goes where:

- **TypeScript:** rendering (three.js), the character and its animation, tools, the camera,
  the UI and menus, and the game rules (items, inventory, crafting, quests, dialogue). These
  change daily, so they need quick iteration; they are data-driven (items and recipes as
  data files, not code).
- **C++ in WebAssembly, in workers:**
  1. *World generation*: the terrain noise, erosion, rivers, biomes and where plants and rocks
     go. It's pure number crunching, runs in workers already (TypeScript today), and C++ makes
     the heavier generation affordable (real hydraulic erosion, river networks).
  2. *Physics*: [Jolt Physics](https://github.com/jrouwe/JoltPhysics) (C++, used by Horizon
     Forbidden West; a WebAssembly build exists) for the character controller, falling trees,
     thrown things and creatures, instead of our hand-written collisions.
  3. *Navigation*: Recast/Detour (C++, a WebAssembly build exists) for creatures to find their
     way through forests and hills.

How they talk: the C++ side works in its own memory, and the TypeScript side reads results in
batches (positions, heights, contacts) once a frame, never call by call. Worker threads that
share memory need two headers on the site (cross-origin isolation); Vercel sets them in
`vercel.json`.

Rendering stays on WebGL2: WebGPU is on by default in Chrome and Edge, and in Firefox on
Windows and macOS, but on Linux Firefox it's still Nightly only (late 2026). three.js's
WebGPU renderer can be added later without a rewrite.

## The phases

1. **The game layer (TypeScript, about 3 weeks).** Items and an inventory (the tools become
   items; felled trees give wood, the hoe turns up roots, the sickle cuts grass for fodder),
   picking up and dropping, a simple crafting table, a richer save (IndexedDB instead of
   local storage, versioned, several slots). The groundwork for everything after.
2. **The C++ core (about 3 weeks).** Emscripten in the build (and in CI), one module, one
   worker. Start with the world generation: port the terrain shape and plant placement, check
   it gives exactly the same world as the TypeScript version, then measure. Then Jolt for the
   character and the trees.
3. **Creatures and combat (about 4 weeks).** Deer that flee, then hunting (arrows that wound,
   tracking), health and damage for the player, a hostile animal; navigation meshes built per
   area in the C++ worker.
4. **A world worth walking (ongoing).** Biomes (forest, marsh, moor, alpine), rivers that run
   from the mountains to the lakes, paths, ruins and settlements to find, quests to give it a
   thread.

Each phase ends with the game playable and checked the way the current work is: the probes
in `tools/probe` film and measure it, and nothing is merged on a guess.

## What I'd decide first

- **A, B or C.** A is the recommendation; B makes sense only if the editor and Godot's
  animation tools matter more than our look and the browser.
- **Single player or multiplayer later.** It decides whether the game rules must run in the
  C++ core from the start (a server can run it; it can't run the TypeScript renderer).
