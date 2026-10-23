// What the game's own jobs cost (ms, drawing left out): each wrapped and timed while the player
// runs with a tool in hand for a few seconds; the list rebuilds also timed on their own.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, keys = g.state.controls.keys.down
    st.set('character', q.get('char') || 'male_ranger'); await wait(2500)
    g.view.renderer.update = () => {}
    const hold = () => w.tp(0.3, 1.35, 6, 0.06)
    for (let i = 0; i < 60; i++) { hold(); w.step(1) } await wait(3000)
    const timers = new Map()
    const wrap = (owner, name, label) => {
        const f = owner[name].bind(owner)
        owner[name] = (...a) => { const s = performance.now(); const r = f(...a); const e = performance.now() - s; const t = timers.get(label) ?? { total: 0, n: 0, max: 0 }; t.total += e; t.n++; t.max = Math.max(t.max, e); timers.set(label, t); return r }
    }
    const v = g.view, s = g.state
    for (const [o, n, l] of [[v.trees, 'rebuild', 'trees.rebuild'], [v.trees, 'update', 'trees.update'], [v.vegetation, 'rebuild', 'rocks.rebuild'], [v.ferns, 'rebuild', 'ferns.rebuild'],
        [v.horizon, 'update', 'horizon.update'], [v.player, 'update', 'player view (animation, pose, grip)'], [v.tools, 'update', 'tools.update'], [v.tools, 'place', 'tools.place'],
        [v.grass, 'update', 'grass.update'], [v.chunks, 'update', 'chunks view'], [v.terrains, 'update', 'terrains view'], [s.player, 'update', 'player physics'], [s.chunks, 'update', 'chunks state'],
        [s.vegetation, 'update', 'vegetation state'], [v.wildlife, 'update', 'wildlife'], [v.audio, 'update', 'audio'], [v.particles, 'update', 'particles'], [v.birds, 'update', 'birds'], [v.weather, 'update', 'weather'], [v.camera, 'update', 'camera view']])
        if (o && typeof o[n] === 'function') wrap(o, n, l)
    g.view.tools.select(0); for (let i = 0; i < 120; i++) { hold(); w.step(1) }
    timers.clear()
    keys.forward = true
    const frames = 600, start = performance.now()
    for (let i = 0; i < frames; i++) { hold(); w.step(1); if (i % 60 === 0) await wait(50) }
    keys.forward = false
    const all = performance.now() - start
    log(`${frames} frames running with the sword: ${(all / frames).toFixed(2)} ms a frame on average (game work only)`)
    for (const [label, t] of [...timers].sort((a, b) => b[1].total - a[1].total))
        log(label.padEnd(36), 'per frame', (t.total / frames).toFixed(3), 'ms | calls', t.n, '| each', (t.total / t.n).toFixed(3), 'max', t.max.toFixed(2))
}
