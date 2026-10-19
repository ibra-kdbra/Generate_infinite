export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', 'male_ranger'); await wait(2500); w.step(20)
    const V = vp.model.position.constructor, Q = vp.model.quaternion.constructor
    const head = () => {
        const b = vp.bone('Head'); b.updateWorldMatrix(true, false)
        const q = b.getWorldQuaternion(new Q())
        // the head's up and forward in the world, from its rest frame relative to the body
        const rest = vp.headRest
        return q
    }
    // measure: roll of the head = angle between the head's "up" (in its bind-relative frame) and world up, after removing yaw
    const bind = (() => { const b = vp.bone('Head'); return null })()
    const cam = (deg, dist = 1.2, height = 1.7, look = 1.62) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const f = new V(0, 0, 1).transformDirection(m.matrixWorld); f.y = 0; f.normalize()
        const r = new V(f.z, 0, - f.x), a = deg * Math.PI / 180, base = vp.group.getWorldPosition(new V())
        const at = [base.x, base.y + look, base.z], from = [base.x + (f.x * Math.cos(a) + r.x * Math.sin(a)) * dist, base.y + height, base.z + (f.z * Math.cos(a) + r.z * Math.sin(a)) * dist]
        const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]
        w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06)
    }
    let R0 = null
    const measure = (tag) => {
        const m = vp.model; m.updateWorldMatrix(true, false)
        const b = vp.bone('Head'); b.updateWorldMatrix(true, false)
        const mq = m.getWorldQuaternion(new Q()), hq = b.getWorldQuaternion(new Q())
        const R = mq.clone().invert().multiply(hq)
        if (!R0) R0 = R.clone()
        // the head now, in the world, as if it carried the body's axes at rest
        const H = hq.clone().multiply(R0.clone().invert()).multiply(mq.clone().invert()).multiply(vp.group.getWorldQuaternion(new Q()))
        const H2 = hq.clone().multiply(R0.clone().invert().multiply(mq.clone().invert()).multiply(mq))
        const W = hq.clone().multiply(R0.clone().invert())          // world rotation taking the idle body-aligned head frame to now
        const up = new V(0, 1, 0).applyQuaternion(W), fwd = new V(0, 0, 1).applyQuaternion(W)
        const bodyF = new V(0, 0, 1).applyQuaternion(mq); bodyF.y = 0; bodyF.normalize()
        const right = new V().crossVectors(fwd, new V(0, 1, 0)).normalize()
        const roll = Math.asin(Math.max(-1, Math.min(1, up.dot(right)))) * 57.3
        const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 57.3
        const fh = fwd.clone(); fh.y = 0; fh.normalize()
        const yaw = Math.atan2(new V().crossVectors(bodyF, fh).y, bodyF.dot(fh)) * 57.3
        log(tag, 'roll', roll.toFixed(0), 'pitch', pitch.toFixed(0), 'yaw vs body', yaw.toFixed(0))
    }
    const snap = (tag) => { measure(tag); cam(20); shot(tag + '-front'); cam(100); shot(tag + '-side') }
    w.tp(0, 1.3, 4, 0.06); w.step(30); snap('idle')
    keys.forward = true; w.step(50); w.tp(pl.rotation, 1.3, 4, 0.06); snap('jog'); keys.boost = true; w.step(60); snap('run')
    keys.strafeRight = true; w.step(25); snap('turn'); keys.strafeRight = false; keys.forward = false; keys.boost = false; w.step(40)
    t.select(0); let n = 0; while ((t.transition || !t.inHand.has('sword')) && n++ < 300) w.step(1)
    w.step(10); snap('sword')
    keys.backward = true; w.step(40); snap('back'); keys.backward = false; keys.strafeLeft = true; w.step(30); snap('strafe'); keys.strafeLeft = false; w.step(30)
    t.startSwing('sword', 'forehand'); w.step(12); snap('swing')
    w.step(60); t.select(0); n = 0; while (t.transition && n++ < 300) w.step(1)
    t.select(1); n = 0; while ((t.transition || !t.inHand.has('bow')) && n++ < 300) w.step(1)
    t.useStart(); w.step(70); snap('bow'); t.useEnd()
}
