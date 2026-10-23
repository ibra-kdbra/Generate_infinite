// The Ranger's hood with his hands: with the sword in hand (put away first), lowered, then raised
// again; filmed from the front and the side.
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, vp = g.view.player
    st.set('character', 'male_ranger'); st.set('hood', true); await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const hold = () => w.tp(0, 1.4, 5, 0.06)
    const step = (n) => { for (let i = 0; i < n; i++) { hold(); w.step(1) } }
    const V = vp.model.position.constructor
    const cam = (deg) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const s = new V(f.z, 0, - f.x), a = deg * Math.PI / 180, base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + 1.45, base.z], from = [base.x + (f.x * Math.cos(a) + s.x * Math.sin(a)) * 1.5, base.y + 1.6, base.z + (f.z * Math.cos(a) + s.z * Math.sin(a)) * 1.5]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    const film = (tag) => { for (const deg of [20, 100]) { cam(deg); r.update = draw; shot(`hood-${tag}-${deg}`); r.update = () => {} } }
    step(30)
    t.select(0); step(120)
    t.requestHood(false)
    let k = 0
    for (let i = 0; i < 200 && k < 14; i++) { step(1); if (t.hood && i % 6 === 0) film(`down${String(k++).padStart(2, '0')}`) }
    step(30); log('hood now', st.get('hood'), 'in hand', [...t.inHand])
    t.requestHood(true); k = 0
    for (let i = 0; i < 200 && k < 14; i++) { step(1); if (t.hood && i % 6 === 0) film(`up${String(k++).padStart(2, '0')}`) }
    step(30); log('hood now', st.get('hood'))
    r.update = draw
}
