// The gear worn (nothing in hand), standing and jogging, from behind, both sides and the front.
//   EXTRA='probe=/tools/probe/probe-gear.js&char=male_ranger' run.sh 200
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, pl = g.state.player, vp = g.view.player, keys = g.state.controls.keys.down
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    const char = q.get('char') || 'male_ranger'
    st.set('character', char); await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const V = vp.model.position.constructor
    const cam = (deg, dist = 2.3, height = 1.15, look = 0.95) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const s = new V(f.z, 0, - f.x), a = deg * Math.PI / 180
        const base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z]
        const from = [base.x + (f.x * Math.cos(a) + s.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + s.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        r.update = draw
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    const film = (name) => { shot(name); r.update = () => {} }
    const p0 = [...pl.position.current]
    let flat = null
    for (let k = 0; k < 300 && !flat; k += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * k, z = p0[2] + Math.sin(a) * k, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 3)
        if (n[1] > 0.99 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 5, [0, 1, 2, 3])) { flat = [x, z]; break }
    }
    const place = () => { const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = 0 }
    place(); w.tp(0, 1.3, 4, 0.06); w.step(30)
    const tip = (tool, len) => { const c = g.view.tools.covers.get(tool); if (!c) return 'none'; c.updateMatrixWorld(true); const o = c.getWorldPosition(new V()); const d = new V(0, 1, 0).applyQuaternion(c.getWorldQuaternion(new w.game.view.player.model.quaternion.constructor())); const ground = pl.position.current[1]; return `top ${(o.y - ground).toFixed(2)} tip ${(o.y + d.y * len - ground).toFixed(2)} dir ${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)}` }
    for (const tool of g.view.tools.set) log(tool, 'cover', tip(tool, 0.9), 'at', g.view.tools.coverState.get(tool).at)
    const sides = { back: 180, left: 90, right: - 90, front: 20 }
    for (const [name, deg] of Object.entries(sides)) { cam(deg); film(`${char}-stand-${name}`) }
    // jogging: the camera (orbit) behind, the body turned to its run
    w.tp(0, 1.3, 4, 0.06); keys.forward = true
    for (let i = 0; i < 60; i++) { w.tp(0, 1.3, 4, 0.06); w.step(1) }
    let n = 0
    for (const [name, deg] of Object.entries(sides)) for (let k = 0; k < 2; k++) { for (let i = 0; i < 9; i++) { w.tp(0, 1.3, 4, 0.06); w.step(1) } cam(deg); film(`${char}-jog-${name}-${k}`); n++ }
    keys.forward = false
    r.update = draw
}
