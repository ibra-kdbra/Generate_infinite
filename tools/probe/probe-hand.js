// Close-ups of the hand holding the first tool: from four sides, 40 cm away.
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, vp = g.view.player
    st.set('character', q.get('char') || 'male_peasant'); await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    const hold = () => w.tp(0, 1.4, 5, 0.06)
    if (q.get('slot') !== 'none') { t.select(+(q.get('slot') || 0)); for (let i = 0; i < 200; i++) { hold(); w.step(1) } }
    const side = q.get('hand') || 'r'
    const V = vp.model.position.constructor
    for (const deg of [0, 90, 180, 270]) {
        hold(); w.step(1)
        const hand = vp.bone(`hand_${side}`); hand.updateWorldMatrix(true, false)
        const at = new V(0.0, 0.09, 0).applyMatrix4(hand.matrixWorld)
        const a = deg * Math.PI / 180, d = +(q.get('d') || 0.35)
        const from = [at.x + Math.sin(a) * d, at.y + 0.08, at.z + Math.cos(a) * d]
        const dx = at.x - from[0], dy = at.y - from[1], dz = at.z - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
        r.update = draw; shot(`hand-${side}-${deg}`); r.update = () => {}
    }
    r.update = draw
}
