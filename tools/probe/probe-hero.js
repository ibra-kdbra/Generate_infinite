// Pictures for the README: the character at a few places around the start, at a chosen hour,
// the follow camera at several angles. Each place: the ground around it loaded first.
//   EXTRA='probe=/tools/probe/probe-hero.js&hour=17&places=8&char=female_ranger' run.sh 900
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, pl = g.state.player, t = g.view.tools
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', q.get('char') || 'female_ranger'); await wait(2500); w.step(20)
    const hour = +(q.get('hour') || 17), progress = (((hour - 12) / 24) % 1 + 1) % 1
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const seed = +(q.get('seed') || 3)
    let s = seed
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
    const p0 = [...pl.position.current]
    const places = +(q.get('places') || 6), radius = +(q.get('radius') || 400)
    for (let k = 0; k < places; k++) {
        // somewhere on dry ground, not too steep, not inside a trunk
        // (with `vista`: the highest of a few, above the land around it, for a view)
        let at = null, best = - Infinity
        for (let tries = 0, found = 0; tries < 400 && found < (q.has('vista') ? 25 : 1); tries++) {
            const a = rand() * Math.PI * 2, d = 40 + rand() * radius
            const x = p0[0] + Math.cos(a) * d, z = p0[2] + Math.sin(a) * d, n = new Float32Array(3)
            pl.sampleGroundNormal(x, z, n, 3)
            const y = pl.groundAt(x, z)
            if (!(n[1] > 0.96 && y > 2 && !g.state.vegetation.nearest(x, z, 3, [0, 1, 2, 3]))) continue
            found++
            let ring = 0
            for (let j = 0; j < 8; j++) ring += pl.groundAt(x + Math.cos(j * 0.785) * 60, z + Math.sin(j * 0.785) * 60) / 8
            const score = y - ring
            if (score > best) { best = score; at = [x, z] }
        }
        if (!at) continue
        const p = pl.position.current
        p[0] = at[0]; p[2] = at[1]; p[1] = pl.groundAt(at[0], at[1]); pl.position.previous.set(p); pl.velocity.fill(0)
        // with `sunback`: the camera on the sun's side (the land lit from behind it), the body looking out
        const sun = g.state.sun
        w.tp(0, 1.4, 6, progress); w.step(1)
        const sunTheta = Math.atan2(sun.position.x, sun.position.z)
        pl.rotation = q.has('sunback') ? sunTheta : rand() * Math.PI * 2
        // let the land around load
        for (let i = 0; i < 14; i++) { w.tp(pl.rotation + Math.PI, 1.4, 6, progress); w.step(4); await wait(500) }
        if (q.has('tool')) { t.select(+q.get('tool')); for (let i = 0; i < 120; i++) { w.tp(pl.rotation + Math.PI, 1.4, 6, progress); w.step(1) } }
        const views = q.has('sunback')
            ? [['a', 0.35, 1.3, 7.5], ['b', - 0.5, 1.4, 5], ['c', 0.9, 1.45, 4]]
            : [['a', 0.6, 1.42, 5.5], ['b', 2.4, 1.38, 6.5], ['c', - 2.2, 1.45, 4.5]]
        for (const [name, theta, phi, dist] of views) {
            for (let i = 0; i < 8; i++) { w.tp(pl.rotation + theta, phi, dist, progress); w.step(1) }
            r.update = draw; shot(`hero-${seed}-${k}-${name}`, 0.92); r.update = () => {}
        }
        log('place', k, at.map((v) => v.toFixed(0)).join(','), 'height', p[1].toFixed(1))
    }
    r.update = draw
}
