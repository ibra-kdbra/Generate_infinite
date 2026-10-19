export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', 'male_peasant'); await wait(2500); w.step(20)
    const p0 = [...pl.position.current]; let flat = null
    for (let r = 0; r < 300 && !flat; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * r, z = p0[2] + Math.sin(a) * r, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 3)
        if (n[1] > 0.99 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 5, [0, 1, 2, 3])) { flat = [x, z]; break }
    }
    const place = () => { w.tp(0, 1.3, 4, 0.06); const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = 0 }
    place(); w.step(10)
    const V = vp.model.position.constructor
    const cam = (deg, dist = 2.4, height = 1.25, look = 1.0) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const r = new V(f.z, 0, - f.x), a = deg * Math.PI / 180, base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z], from = [base.x + (f.x * Math.cos(a) + r.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + r.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    for (const [slot, name, time] of [[0, 'chop', 0.56], [0, 'overhead', 0.6], [1, 'dig', 0.64], [1, 'pull', 0.5]]) {
        if (!t.inHand.has(t.set[slot])) { if (t.equipped) { t.select(t.set.indexOf(t.equipped)); w.step(120) } t.select(slot); w.step(140) }
        place(); w.step(5); t.startSwing(t.set[slot], name)
        while (t.swing && t.swing.time < time) w.step(1)
        cam(70); shot(`${name}-a`); cam(20); shot(`${name}-b`)
        w.step(90)
    }
}
