// Each tool held still (after taking it out), close up from three sides: front, the tool side,
// behind; and the hand's position against the tool's handle (cm).
//   EXTRA='probe=/tools/probe/probe-held.js&char=male_peasant' run-chromium.mjs 600
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', q.get('char') || 'male_peasant'); await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const hold = () => w.tp(0, 1.4, 5, 0.06)
    const step = (n) => { for (let i = 0; i < n; i++) { hold(); w.step(1) } }
    const p0 = [...pl.position.current]; let flat = null
    for (let k = 0; k < 300 && !flat; k += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * k, z = p0[2] + Math.sin(a) * k, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 3)
        if (n[1] > 0.99 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 6, [0, 1, 2, 3])) { flat = [x, z]; break }
    }
    { const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = 0 }
    step(30)
    const V = vp.model.position.constructor
    const cam = (deg, dist, height, look) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const s = new V(f.z, 0, - f.x), a = deg * Math.PI / 180, base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z], from = [base.x + (f.x * Math.cos(a) + s.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + s.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    const only = q.get('tool')
    t.set.forEach((tool, slot) => {
        if (only && only !== tool) return
        t.select(slot); let n = 0; while ((t.transition || !t.inHand.has(tool)) && n++ < 400) step(1)
        step(40)
        const hand = vp.bone(tool === 'bow' ? 'hand_l' : 'hand_r'), model = t.models.get(tool)
        hand.updateWorldMatrix(true, false); model.updateMatrixWorld(true)
        const handAt = hand.getWorldPosition(new V()), origin = model.getWorldPosition(new V())
        log(tool, 'in hand', t.inHand.has(tool), 'hand bone to the tool origin', (handAt.distanceTo(origin) * 100).toFixed(1), 'cm', 'model visible', model.visible, 'parent', model.parent && model.parent.type)
        for (const [name, deg] of [['front', 20], ['side', tool === 'bow' ? 80 : - 80], ['back', 160]]) { r.update = draw; cam(deg, 1.6, 1.4, 1.15); shot(`held-${tool}-${name}`); r.update = () => {} }
        t.select(slot); n = 0; while ((t.transition || t.inHand.size) && n++ < 400) step(1)
        step(20)
    })
    r.update = draw
}
