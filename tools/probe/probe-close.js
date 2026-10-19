export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    const q = new URLSearchParams(location.search)
    st.set('character', q.get('char') || 'male_peasant'); await wait(2500); w.step(20)
    const V = vp.model.position.constructor
    const cam = (deg, dist = 1.9, height = 1.45, look = 1.2) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const r = new V(f.z, 0, - f.x), a = deg * Math.PI / 180
        const base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z]
        const from = [base.x + (f.x * Math.cos(a) + r.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + r.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    const p0 = [...pl.position.current]
    let flat = null
    for (let r = 0; r < 300 && !flat; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * r, z = p0[2] + Math.sin(a) * r, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 3)
        if (n[1] > 0.99 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 5, [0, 1, 2, 3])) { flat = [x, z]; break }
    }
    { const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = 0 }
    w.tp(0, 1.3, 4, 0.06); w.step(10)
    cam(180, 2.4, 1.15, 0.95); shot('bag-back'); cam(110, 2.4, 1.15, 0.95); shot('bag-side'); cam(-70, 2.4, 1.15, 0.95); shot('bag-right'); cam(20, 2.4, 1.15, 0.95); shot('bag-front'); if (q.has('bagonly')) return
    const deg = Number(q.get('deg') || 35)
    for (let slot = 0; slot < 3; slot++) {
        const tool = t.set[slot]
        if (q.get('tool') && q.get('tool') !== tool) continue
        w.tp(0, 1.3, 4, 0.06); t.select(slot)
        for (let k = 0; k < 12; k++) { w.step(Math.round(Number(q.get("dstep") || 11))); cam(deg); shot(`${tool}-draw${k}`) }
        log(tool, 'after draw: inHand', [...t.inHand].join(), 'transition', !!t.transition, 'cover', t.coverState.get(tool).at)
        w.step(20); cam(deg); shot(`${tool}-carry`)
        t.select(slot)
        for (let k = 0; k < 10; k++) { w.step(Math.round(Number(q.get("sstep") || 11))); cam(deg); shot(`${tool}-stow${k}`) }
        w.step(30)
        log(tool, 'after stow: inHand', [...t.inHand].join(), 'transition', !!t.transition, 'cover', t.coverState.get(tool).at, t.coverState.get(tool).slide)
    }
}
