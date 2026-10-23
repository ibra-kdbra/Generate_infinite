// Scenes for the README, one per run (scene=archer|felling|sunset|night|fall-anim):
//   archer: the Ranger at full draw over the shoulder, morning light at a forest edge
//   felling: the Villager by a tree, a few chops, the tree going over (side view)
//   fall-anim: the same fall, 24 frames, for an animation
//   sunset: a hilltop over water at sunset
//   night: the Ranger with the torch lit at night
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const scene = q.get('scene') || 'archer'
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, vp = g.view.player, veg = g.state.vegetation, trees = g.view.trees
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', scene === 'felling' || scene === 'fall-anim' ? 'male_peasant' : (q.get('char') || 'male_ranger'))
    await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const hour = +(q.get('hour') || { archer: 9.5, felling: 10.5, 'fall-anim': 10.5, sunset: 17.3, night: 22.5 }[scene])
    const progress = (((hour - 12) / 24) % 1 + 1) % 1
    const V = vp.model.position.constructor
    let theta = 0, phi = 1.4, dist = 5
    const hold = () => w.tp(theta, phi, dist, progress)
    const step = (n) => { for (let i = 0; i < n; i++) { hold(); w.step(1) } }
    const settle = async (n = 14) => { for (let i = 0; i < n; i++) { hold(); w.step(4); await wait(500) } }
    const move = (x, z, rotation) => { const p = pl.position.current; p[0] = x; p[2] = z; p[1] = pl.groundAt(x, z); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = rotation }
    const film = (name) => { r.update = draw; shot(name, 0.92); r.update = () => {} }
    const p0 = [...pl.position.current]
    let s = +(q.get('seed') || 5)
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
    const find = (test, tries = 600, radius = 600) => {
        for (let i = 0; i < tries; i++) {
            const a = rand() * Math.PI * 2, d = 30 + rand() * radius
            const x = p0[0] + Math.cos(a) * d, z = p0[2] + Math.sin(a) * d, n = new Float32Array(3)
            pl.sampleGroundNormal(x, z, n, 3)
            const y = pl.groundAt(x, z)
            if (n[1] > 0.96 && y > 2 && !veg.nearest(x, z, +(q.get('clear') || 8), [0, 1, 2, 3]) && test(x, z, y)) return [x, z]
        }
        return null
    }
    const sun = () => { w.tp(0, 1.4, 6, progress); w.step(1); return Math.atan2(g.state.sun.position.x, g.state.sun.position.z) }
    const forestAround = (x, z) => veg.forestAt(x, z)
    if (scene === 'archer') {
        const at = find((x, z) => forestAround(x, z) > 0.25 && forestAround(x, z) < 0.6) ?? find(() => true)
        const face = sun() + Math.PI * 0.75
        move(at[0], at[1], face); theta = face; await settle()
        t.select(1); step(160)
        t.useStart(); step(110)
        // the free camera at the archer's right, ahead of him: the drawn bow side-on (the
        // follow camera can't: aiming, he faces where it looks)
        const side = (deg, d, height, look) => {
            const m = vp.model; m.updateWorldMatrix(true, false)
            const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
            const rgt = new V(f.z, 0, - f.x), a = deg * Math.PI / 180, base = vp.group.getWorldPosition(new V())
            const at = [base.x, base.y + look, base.z], from = [base.x + (f.x * Math.cos(a) + rgt.x * Math.sin(a)) * d, base.y + height, base.z + (f.z * Math.cos(a) + rgt.z * Math.sin(a)) * d]
            const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
            w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), progress)
        }
        side(+(q.get('deg') || - 55), 3.1, 1.55, 1.3); film('show-archer')
        hold(); t.useEnd(); w.step(5); side(+(q.get('deg') || - 55), 3.1, 1.55, 1.3); film('show-archer-loose')
    }
    else if (scene === 'felling' || scene === 'fall-anim') {
        // a lone broadleaf tree in the open, the sun from the side
        let tree = null
        for (let k = 0; k < 400 && !tree; k++) {
            const a = rand() * Math.PI * 2, d = 20 + rand() * 500
            const x = p0[0] + Math.cos(a) * d, z = p0[2] + Math.sin(a) * d
            const plant = veg.nearest(x, z, 8, [1])
            if (plant && plant.scale > 10 && plant.scale < 15 && forestAround(plant.x, plant.z) < 0.3) tree = plant
        }
        move(tree.x + 2.2, tree.z, Math.PI / 2)    // facing -x: the tree
        const light = sun()
        theta = Math.PI / 2 + Math.PI / 2; phi = 1.42; dist = 9
        await settle(18)
        t.select(0); step(200)
        if (scene === 'felling') {
            for (let i = 0; i < 3; i++) { w.game.view.tools.useStart?.(); step(2); w.game.view.tools.useEnd?.(); step(50) }
            film('show-chop')
        }
        trees.fell(tree, 0, 1, 0.8)
        theta = Math.PI / 2; phi = 1.36; dist = 15
        if (scene === 'felling') { step(120); film('show-fall') }
        else for (let i = 0; i < 24; i++) { step(i < 6 ? 12 : 4); film(`fall-${String(i).padStart(2, '0')}`) }
        void light
    }
    else if (scene === 'sunset') {
        let best = null, score = - Infinity
        for (let i = 0; i < 40; i++) {
            const at = find(() => true, 50, 700); if (!at) continue
            const y = pl.groundAt(at[0], at[1]); let ring = 0
            for (let j = 0; j < 8; j++) ring += pl.groundAt(at[0] + Math.cos(j * 0.785) * 70, at[1] + Math.sin(j * 0.785) * 70) / 8
            if (y - ring > score) { score = y - ring; best = at }
        }
        const face = sun()
        move(best[0], best[1], face + Math.PI); theta = face + Math.PI + 0.45; phi = 1.38; dist = 7
        await settle(20)
        film('show-sunset')
    }
    else if (scene === 'night') {
        const at = find((x, z) => forestAround(x, z) > 0.3) ?? find(() => true)
        move(at[0], at[1], 0.4); theta = 0.4 + Math.PI + 0.6; phi = 1.45; dist = 3.6
        await settle()
        t.select(2); step(220)
        t.useStart(); step(60)
        film('show-night')
        t.useEnd()
    }
    r.update = draw
}
