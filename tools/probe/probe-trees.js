// Walking straight on: which trees within 15-60 m switch from drawn to not drawn and back
// (by the hills hiding them, by their cell being dropped, or by the near/mid/far bands),
// counted per cause, with the hiding behind hills on and off.
//   EXTRA='probe=/tools/probe/probe-trees.js' run-chromium.mjs 600
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const pl = g.state.player, keys = g.state.controls.keys.down, veg = g.state.vegetation, trees = g.view.trees, horizon = g.view.horizon
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    if (q.has('nohide')) g.view.player.settings.set('hideHidden', false)
    w.tp(+(q.get('theta') || 0), 1.3, 6, 0.06); w.step(60); await wait(3000)
    const key = (p) => `${p.x.toFixed(2)}:${p.z.toFixed(2)}`
    const state = new Map()          // key -> 'shown' | 'hidden' | 'absent'
    const flips = { hills: 0, cell: 0, total: 0 }, seen = new Set()
    keys.forward = true
    const frames = +(q.get('frames') || 900)
    for (let f = 0; f < frames; f++) {
        w.tp(+(q.get('theta') || 0), 1.3, 6, 0.06); w.step(1)
        if (f % 3) continue
        const p = pl.position.current
        const present = new Set()
        for (const cell of veg.cells.values()) for (const plant of cell.plants) {
            if (plant.kind === 3) continue
            const d = Math.hypot(plant.x - p[0], plant.z - p[2])
            if (d < 15 || d > 60) continue
            const k = key(plant); present.add(k)
            const now = d > 30 && !horizon.visible(plant.x, plant.y + plant.scale, plant.z) ? 'hidden' : 'shown'
            const was = state.get(k)
            if (was && was !== now) { flips.total++; if (was === 'shown' && now === 'hidden' && seen.has(k)) flips.hills++ }
            if (now === 'shown') seen.add(k)
            state.set(k, now)
        }
        for (const [k, s] of state) {
            const [x, z] = k.split(':').map(Number)
            const d = Math.hypot(x - p[0], z - p[2])
            if (!present.has(k) && d > 15 && d < 60 && s === 'shown') { flips.cell++; state.set(k, 'absent') }
        }
    }
    keys.forward = false
    log('walked', frames, 'frames', 'trees seen', seen.size, 'shown then hidden by the hills', flips.hills, 'all switches', flips.total, 'dropped with their cell while in 15-60 m', flips.cell)
    r.update = draw
}
