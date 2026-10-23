// The hand grip: how many finger joints were measured, how far each closes, and whether the
// fingers are closed while a tool is held (the angle from what the clip gives).
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, vp = g.view.player
    st.set('character', q.get('char') || 'male_peasant'); await wait(2500); w.step(20)
    g.view.renderer.update = () => {}
    const grip = vp.grip
    log('joints', grip && grip.joints.r.length, grip && grip.joints.l.length)
    if (grip) for (const j of grip.joints.r) log('r', j.bone.name, (2 * Math.acos(Math.min(1, Math.abs(j.bone.quaternion.dot(j.closed)))) * 57.3).toFixed(0), 'deg from now')
    t.select(0); for (let i = 0; i < 200; i++) w.step(1)
    log('fist', JSON.stringify(t.fist), 'in hand', [...t.inHand])
    if (grip) for (const j of grip.joints.r.slice(0, 6)) log('held r', j.bone.name, (2 * Math.acos(Math.min(1, Math.abs(j.bone.quaternion.dot(j.closed)))) * 57.3).toFixed(1), 'deg from closed')

    // in the right hand's frame: the joints of the closed fingers, and the axe's handle line
    const hand = vp.bone('hand_r'); hand.updateWorldMatrix(true, true)
    const inv = hand.matrixWorld.clone().invert()
    const V = vp.model.position.constructor
    const at = (o) => { o.updateWorldMatrix(true, false); const v = new V().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv); return v.toArray().map((x) => x.toFixed(3)).join(',') }
    for (const f of ['index', 'middle', 'pinky', 'thumb']) log(f, [1, 2, 3].map((i) => at(vp.bone(`${f}_0${i}_r`))).join(' | '), 'tip', at(vp.bone(`${f}_04_leaf_r`)))
    const model = t.models.get('axe'); model.updateMatrixWorld(true)
    const a = new V(0, -0.1, 0).applyMatrix4(model.matrixWorld).applyMatrix4(inv), b = new V(0, 0.1, 0).applyMatrix4(model.matrixWorld).applyMatrix4(inv)
    log('handle from', a.toArray().map((x) => x.toFixed(3)).join(','), 'to', b.toArray().map((x) => x.toFixed(3)).join(','))
}
