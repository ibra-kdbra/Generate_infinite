export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, vp = g.view.player
    const V = vp.model.position.constructor, Q = vp.model.quaternion.constructor, M = vp.model.matrix.constructor
    st.set('character', 'male_ranger'); await wait(2500); w.step(10)
    const grip = (clip, time, dirBody, edgeBody) => {
        vp.performances = [{ clip, time, weight: 1, whole: 1 }]; w.step(2)
        const hand = vp.bone('hand_r'); hand.updateWorldMatrix(true, false)
        const H = hand.getWorldQuaternion(new Q()), B = vp.model.getWorldQuaternion(new Q())
        const d = new V(...dirBody).normalize().applyQuaternion(B).applyQuaternion(H.clone().invert())
        let e = new V(...edgeBody).applyQuaternion(B).applyQuaternion(H.clone().invert())
        e.addScaledVector(d, - e.dot(d)).normalize()
        const x = new V().crossVectors(d, e)
        const q = new Q().setFromRotationMatrix(new M().makeBasis(x, d, e))
        log(clip, 'grip quaternion', q.toArray().map(v => +v.toFixed(4)).join(', '))
    }
    grip('Sword_Idle', vp.duration('Sword_Idle') * 0.5, [- 0.12, 0.62, 0.78], [0, - 0.78, 0.62])
    grip('Idle_Torch_Loop', vp.duration('Idle_Torch_Loop') * 0.5, [0.05, 0.95, 0.3], [0, - 0.3, 0.95])
}
