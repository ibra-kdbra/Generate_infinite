# Probes

Scripts that drive the running game in a headless browser and save screenshots and numbers, so
a change is checked by what it does in the game, not by eye in the code. Start the dev server
(`npm run dev`), then run a probe:

```sh
# headless Firefox (with prime-run on an NVIDIA laptop, the real GPU)
EXTRA='probe=/tools/probe/probe-moves.js&char=male_peasant&slot=0&presses=2' tools/probe/run.sh 200

# headless Chromium (a machine without Firefox; software WebGL: slow, fine for pictures)
Q=ultra node tools/probe/run-chromium.mjs 300 'probe=/tools/probe/probe-bench.js' tools/probe/out 960,540
```

Screenshots land in `tools/probe/out/` (ignored by git); the probe's log lines are printed.
The Chromium runner also prints the page's console errors (a shader that fails to compile) and
CPU profiles a probe asks for (`log('PROFILE start')` … `log('PROFILE stop name')`). `Q` sets
the quality (lowest, low, medium, high, ultra), `PORT` another dev server.

A probe is an ES module exporting `async function ({ w, log, wait, shot, timing })`: `w` is the
game page's window (`w.game`, and the dev helpers `w.step(frames)` to advance the game in exact
1/60 s steps, `w.tp(theta, phi, distance, dayProgress)` for the follow camera, `w.shot(x, y, z,
rx, ry)` for a free camera); `shot(name)` saves the canvas.

| Probe | Shows |
|---|---|
| `probe-bench.js` | what each of the game's jobs costs per frame (ms), drawing left out |
| `probe-cpu.js` | the game's work per frame standing, running, turning, with a tool; CPU profiles |
| `probe-frame.js` | ms per frame standing and running with a tool (drawing included) |
| `probe-trees.js` | trees switching in and out of view on a walk, by cause |
| `probe-far.js` | the far terrain as the player travels: pieces drawn over each other or holes; mountains and lakes from high above |
| `probe-seams.js` | height steps along the seams between terrain pieces, against the skirt that hides them |
| `probe-depth.js` | the same far view with the camera's near plane at 0.1 and 1 m (depth precision) |
| `probe-memory.js` | script heap, GPU geometries, textures and programs, chunks over a ~10 km walk (`GC=1` for exact heap numbers) |
| `probe-cost.js`, `probe-rate.js` | loading time and a frame's cost per quality; the frame-rate cap and the background rate |
| `probe-horizon.js` | distant land from the ground and from a hill, by day and at sunset |
| `probe-clearance.js` | each tool's clearance to the body through its strokes and on the run |
| `probe-vis.js` | the tools filmed while walking and running (`walk`, `bare`), or through their strokes |
| `probe-fist.js`, `probe-grip.js`, `probe-where.js` | the closed hand's centre, the fingers closing on a tool, where a worn tool sits on a bone |
| `probe-capture.js`, `probe-mouse.js`, `probe-look.js` | the captured mouse with Firefox's extra events faked; end to end with the real mouse; how a turn arrives |
| `probe-night.js` | a game begun at night: every shadow map set up |
| `probe-save.js` | the world remembered: a tree felled, walked away from and back to, saved, reloaded |
| `probe-contact.js` | each worn and held item's gap to the skin (cm), from the posed mesh |
| `probe-gear.js`, `probe-held.js`, `probe-hand.js` | the gear worn from four sides; tools held; the hand close up |
| `probe-diag.js` | the hips and chest moving in eight directions with a tool (`aim` for the bow drawn) |
| `probe-bow-all.js`, `probe-bow.js` | the bow from the back to the shot and back again |
| `probe-hood.js` | the Ranger raising and lowering his hood |
| `probe-moves.js`, `probe-clips.js`, `probe-strike.js` | a tool's strokes; any animation clip with the tool in hand |
| `probe-close.js` | taking a tool out and putting it away, step by step |
| `probe-tree.js` | felling a tree: cuts, chops needed, stump, the log and the crown |
| `probe-head.js`, `probe-run.js`, `probe-stance.js`, `probe-climb.js` | the head; running, turning, stopping; side-steps; climbing |
| `probe-hero.js`, `probe-showcase.js` | pictures for the README |
| `probe-ui.js`, `probe-phone.js` | the settings drawer, on a desktop and a phone |
