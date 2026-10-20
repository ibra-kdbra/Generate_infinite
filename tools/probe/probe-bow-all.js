// The bow from start to end: worn on the back, taken out, carried standing and jogging, an arrow
// taken and nocked, drawn, held, loosed, and put away again; from the front, the left (bow
// hand) side and behind, standing still on flat open ground.
//   EXTRA='probe=/tools/probe/probe-bow-all.js&char=male_ranger' run-chromium.mjs 900
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, vp = g.view.player, keys = g.state.controls.keys.down
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', q.get('char') || 'male_ranger'); await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const p0 = [...pl.position.current]; let flat = null
    for (let k = 0; k < 300 && !flat; k += 3) for (let a = 0; a < 6.28; a += 0.3) {
        const x = p0[0] + Math.cos(a) * k, z = p0[2] + Math.sin(a) * k, n = new Float32Array(3)
        pl.sampleGroundNormal(x, z, n, 3)
        if (n[1] > 0.99 && pl.groundAt(x, z) > 1 && !g.state.vegetation.nearest(x, z, 6, [0, 1, 2, 3])) { flat = [x, z]; break }
    }
    const place = () => { const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = 0 }
    const hold = () => w.tp(0, 1.45, 4, 0.06)
    const step = (n) => { for (let i = 0; i < n; i++) { hold(); w.step(1) } }
    place(); step(30)
    const V = vp.model.position.constructor
    const cam = (deg, dist, height, look) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const s = new V(f.z, 0, - f.x), a = deg * Math.PI / 180, base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z], from = [base.x + (f.x * Math.cos(a) + s.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + s.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        r.update = draw
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    const views = q.get('views') ? q.get('views').split(',').map(Number) : [25, 90, 180]
    const film = (tag, dist = 2.2, height = 1.3, look = 1.15) => { for (const deg of views) { cam(deg, dist, height, look); shot(`bow-${tag}-${deg}`); r.update = () => {} } }
    film('worn')
    t.select(1)
    for (let k = 0; k < 6; k++) { step(9); film(`take${k}`) }
    let n = 0; while ((t.transition || !t.inHand.has('bow')) && n++ < 400) step(1)
    step(20); film('carry')
    if (!q.has('nojog')) { keys.forward = true; step(40); film('jog'); keys.forward = false; step(40); place(); step(20) }
    t.useStart()
    for (const k of [8, 16, 26, 36]) { step(k - (t.nockTime * 60 | 0) > 0 ? 8 : 8); film(`nock${k}`, 1.8, 1.5, 1.4) }
    step(40); film('full', 1.8, 1.5, 1.4)
    t.useEnd(); step(3); film('loose', 1.8, 1.5, 1.4); step(30); film('after')
    t.select(1)
    for (let k = 0; k < 6; k++) { step(9); film(`stow${k}`) }
    r.update = draw
}
