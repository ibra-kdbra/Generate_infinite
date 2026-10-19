export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    const q = new URLSearchParams(location.search)
    const set = q.get('set') || 'ranger', only = q.get('tool'), strokes = (q.get('strokes') || '').split(',').filter(Boolean), views = (q.get('views') || 'f,s').split(',')
    st.set('character', set === 'peasant' ? 'male_peasant' : 'male_ranger'); await wait(2500); w.step(20)
    const V = vp.model.position.constructor
    const p0 = [...pl.position.current]
    let flat = null
    for (let r = 0; r < 200 && !flat; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * r, z = p0[2] + Math.sin(a) * r, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 3)
        if (n[1] > 0.99 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 5, [0, 1, 2, 3])) { flat = [x, z]; break }
    }
    const place = () => { w.tp(0, 1.3, 4, 0.06); const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = 0 }
    place(); w.step(30)
    const cam = (deg, dist = 2.7, height = 1.15, look = 0.95) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const r = new V(f.z, 0, - f.x), a = deg * Math.PI / 180
        const base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z]
        const from = [base.x + (f.x * Math.cos(a) + r.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + r.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    const angles = { f: 25, s: 95, b: 205, l: - 80 }
    if (q.has('bare')) {
        for (const boost of [false, true]) {
            place(); keys.forward = true; keys.boost = boost; for (let i = 0; i < 40; i++) { w.tp(pl.rotation - Math.PI / 2, 1.5, 2.6, 0.06); w.step(1) }
            for (let k = 0; k < 10; k++) { w.tp(pl.rotation - Math.PI / 2, 1.5, 2.6, 0.06); w.step(boost ? 3 : 4); shot(`bare-${boost ? 'run' : 'walk'}-s${k}`) }
            keys.forward = false; keys.boost = false; w.step(40)
        }
        return
    }
    for (let slot = 0; slot < 3; slot++) {
        t.select(slot); w.step(50)
        const tool = t.equipped
        if (only && tool !== only) { t.select(slot); w.step(40); continue }
        if (q.has('walk')) {
            for (const boost of [false, true]) {
                place(); keys.forward = true; keys.boost = boost; for (let i = 0; i < 40; i++) { w.tp(pl.rotation + (q.has("leftside") ? - 1 : 1) * Math.PI / 2, 1.5, 3.2, 0.06); w.step(1) }
                for (let k = 0; k < 10; k++) { w.tp(pl.rotation + (q.has("leftside") ? - 1 : 1) * Math.PI / 2, 1.5, 3.2, 0.06); w.step(boost ? 3 : 4); shot(`${tool}-${boost ? 'run' : 'walk'}-s${k}`) }
                keys.forward = false; keys.boost = false; w.step(40)
            }
        }
        if (tool === 'torch' || q.has('walk')) { t.select(slot); w.step(40); continue }
        for (const name of (strokes.length ? strokes : [null])) for (const view of views) {
            place(); w.step(5)
            if (tool === 'bow') { t.useStart(); for (let k = 0; k < 9; k++) { w.step(5); cam(angles[view]); shot(`${tool}-${view}${k}`) } t.useEnd(); w.step(1); cam(angles[view]); shot(`${tool}-${view}9`) }
            else {
                if (name) t.startSwing(tool, name); else { t.useStart(); t.useEnd() }
                const dur = t.swing.keys[t.swing.keys.length - 1].t
                for (let k = 0; k < 10 && t.swing; k++) { w.step(Math.max(1, Math.round(dur * 60 / 10))); cam(angles[view]); shot(`${tool}-${name || 'x'}-${view}${k}`) }
            }
            w.step(70)
        }
        t.select(slot); w.step(40)
    }
}
