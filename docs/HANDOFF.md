# Handoff: where Generate Infinite stands

A working summary for whoever picks the project up next, in this session or a new
one. It records what was built across the long local sessions of October 2026, how the
pieces fit, how to check changes, what is still open, and the owner's working rules. The
README describes the game itself; this file is about carrying the work on.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173 (dev helpers on window: game, step, tp, shot)
npm run build          # dist/, what Vercel serves
npm run type-check
```

Deployed by Vercel from `main` (production: https://generate-infinite.vercel.app). Every
push to `main` builds and deploys; there is no Netlify site.

## The owner's rules

- Commits are authored as **ibra-kdbra** only (`git -c user.name=ibra-kdbra commit ...`); no
  "Co-authored-by" or tool attribution lines, ever.
- **Ask before pushing.** Ask before downloading anything (say the file, the source, the size).
- Write in plain words to the owner: what changed and what they will see; no jargon walls.
- Don't remove anything of value; prefer measured, verified changes (screenshots and numbers
  from the probe harness) over guesses.

## Map of the code (the parts this work touched most)

| File | What it does |
|---|---|
| `src/Game/State/Player.ts` | Physics: a runner's movement (start, run, turn radius by speed, plant-and-pivot reversals, skid stops, slopes), the stance while drawing the bow (facing the camera; S backs away, A/D side-step; with any other tool the body turns the way it goes), climbing (one limb at a time), swimming, sliding, collisions with trunks, stumps and fallen logs. |
| `src/Game/View/Player.ts` | The character: gaits in speed bands kept in step, the lean into acceleration and turns, side-steps and walking backward, **performances** (animation-library clips played over the upper body while moving, the whole body standing still), hood and hair, wetness. |
| `src/Game/View/CharacterPose.ts` | Procedural pose on top of the clips: two-bone IK for arms and legs, feet on the ground, climbing limbs and grips, slides, dives, the tool hands, the head kept level and looking where it should. |
| `src/Game/View/Tools.ts` | The tools (2,700 lines; worth splitting): how each is worn, drawn and put away (a sheath on the belt, a guard taken off, slung on the back), holding and strokes (clip moves for sword/axe/sickle/torch, keyed moves for hoe/torch strokes), the bow (side-on stance, arrow from the quiver, nocked, drawn to the anchor), arrows (exact trunk/rock/ground contact), hits and their effects, marks on bark, felling. |
| `src/Game/View/ToolModels.ts` | The tools, covers (scabbard, guards), quiver, pouch, sack, modelled in code. |
| `src/Game/View/Trees.ts` + shaders `trees/*.glsl` | Trees; felling (the trunk pivots about the cut, its butt drops off the stump, below the cut is discarded and a stump mesh stands), trunk thickness by height (`trunkRadius`), fallen crowns rustling. |
| `src/Game/State/Vegetation.ts` | Plants; collision at the trunk's real thickness; stumps; fallen logs (solid trunk, crown a thicket). |
| `src/Game/View/Vegetation.ts` | Rocks; `rockHit` (a segment against a rock's real mesh, placed as the shader places it). |
| `src/Game/Menu.ts`, `src/style.css` | The settings drawer (Game / Graphics / Sound / Sky / Keys / About, developer pages apart), the key help, the toolbar's move label. |
| `src/index.ts` | Entry; a clear message if WebGL can't start; dev helpers. |

## Assets and how they were made

- Characters: Quaternius Universal Base Characters + Modular Fantasy Outfits (CC0), built by
  `tools/characters/build.mjs` (needs the source packs). `tools/characters/add-hair.mjs` gave
  the Rangers hair from the Villager builds (no dependencies).
- Animations: `public/models/characters/animations.glb`. The gaits and jumps came from the
  Universal Animation Library; `tools/characters/add-clips.mjs` (no dependencies) added the tool
  clips from **UAL1 Standard** and **UAL2 Standard** (free, CC0, same skeleton), downloaded from
  quaternius.itch.io: Sword_Idle, Sword_Attack, Idle_Torch_Loop, Sword_Regular_A/B/C (+ _Rec),
  Sword_Regular_Combo, Sword_Heavy_Combo, Sword_Dash, Sword_Block, TreeChopping_Loop,
  Farm_Harvest, Farm_PlantSeed, Farm_Watering, Idle_Lantern_Loop, ClimbUp_1m. To redo it:
  `node tools/characters/add-clips.mjs <UAL1_Standard.glb> <UAL2_Standard.glb>`.
- Tool grips for the clips are calibrated quaternions (`GRIP` in Tools.ts): the sword from
  Sword_Idle (blade up and forward in the guard), the torch from Idle_Torch_Loop. Two-handed clips
  (the axe's chop) place the tool from both hands every frame (`inBothHands`).

## Checking changes: the probe harness

`tools/probe/` drives the running dev server in headless Firefox and saves screenshots and
numbers. Start `npm run dev`, then:

```bash
EXTRA='probe=/tools/probe/probe-moves.js&char=male_peasant&slot=0&presses=2' tools/probe/run.sh 200
```

Screenshots land in `tools/probe/out/` (ignored by git), log lines print. Probes:

| Probe | Shows |
|---|---|
| `probe-frame.js` | ms per frame standing and running with a tool; state update cost |
| `probe-moves.js` | a tool held, then N presses filmed (`slot`, `presses`, `frames`, `deg`, `heavy`) |
| `probe-clips.js` | any animation clip with the tool in hand, frame by frame |
| `probe-close.js` | taking a tool out and putting it away, step by step; the gear on the body |
| `probe-bow.js` | the bow: nocking, drawing, release, from the drawing hand's side |
| `probe-tmp.js` | collision of held tools with the body per stroke, tip speeds, farm tool function |
| `probe-tree.js` | felling a tree: cuts, chops needed, stump, walking into the log and the crown |
| `probe-head.js` | the head's roll, pitch and turn in each state |
| `probe-run.js`, `probe-stance.js` | running: start, turn, stop, lean; backing away and side-steps |
| `probe-climb.js` | climbing a short or a tall face |
| `probe-ui.js`, `probe-phone.js` | the settings drawer (desktop and phone width) |

Headless Firefox caps its window at about 1366x682; `probe-phone.js` loads the game in a
390x844 frame to test the phone layout. In a cloud machine without a GPU, WebGL may fall back to
software rendering (slow but usable for screenshots) or be missing (then the game shows its "no
WebGL" message).

## Open work

1. **Bow and hoe animation.** They still use keyed motion, which the owner finds unnatural. The
   owner agreed to download Mixamo clips (FBX Binary, Without Skin, 30 fps, In Place): bow draw,
   aim at full draw, release, aim idle; a two-handed digging motion for the hoe. They go in
   `~/Downloads/mixamo/` on the owner's machine (or get committed somewhere for a cloud session).
   They need retargeting from Mixamo's skeleton to this one (FBXLoader + a bone-name map + the
   rest-pose difference), then the same performance system as the other tools.
2. **More real moves.** Clip-driven moves are few (sword 7, axe 1, sickle 1). The paid "Pro"
   packs or Mixamo would add more; mirroring clips would need the tool to change hands.
3. **Small leftovers:** a few keyed strokes still touch the body by 2-5 cm; the bow's carry and
   draw/stow paths are keyed; stepping up onto a fallen log only works where it lies low.
4. **Size of Tools.ts** (2,700 lines): split into wearing/drawing, strokes, bow, marks/felling.
5. **Future ideas from the owner (not started):** hunting the deer and other animals; turning
   the world into a full game. Advice given: for a full game (combat, inventory, AI, saving),
   consider moving to Godot (free, imports the Quaternius packs, animation trees, IK, physics,
   web export); keep this project as the explorable world.

## What the October sessions did (newest first, see `git log`)

- Tools driven by real animation clips (sword, axe, sickle, torch); per-tool grips; the axe in
  both hands; a performance layer in the player view.
- The head kept level and looking where it should.
- Felling: directional notches along the stroke, the tree falling toward the cut, stumps, solid
  logs, branch thickets that rustle; marks per tool (sword slash, sickle scratch, hoe nick, torch
  scorch); hits needed by trunk thickness (5-20).
- Arrows sticking where they strike (trunks at their real thickness, rocks' real surface, the
  ground as it gains detail).
- Gear worn the way people carried it (scabbard at the left hip, belt quiver, tools in the belt,
  slung bow and hoe), drawn step by step; the archer's draw (side-on, arrow from the quiver).
- A runner's movement (acceleration, turn radius, skid stops, lean) and the tool stance.
- Settings drawer: the gear opened an empty page (fixed); split into short pages.
- Earlier: climbing rebuilt (one limb at a time), hair and a hood toggle, input fixes (keys
  counted twice, clicks lost), the loading screen, sound categories, rendering and performance
  work (temporal AA, adaptive resolution, terrain detail), deer.
