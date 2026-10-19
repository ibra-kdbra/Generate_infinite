// Moving in all eight directions with a tool in hand (the stance): how far the hips and the chest
// turn from the way the body faces, frame by frame, and pictures from behind.
//   EXTRA='probe=/tools/probe/probe-diag.js&char=male_ranger&slot=0&dirs=fr,br' run.sh 200
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', q.get('char') || 'male_ranger'); await wait(2500); w.step(20)
    const theta = 0.3, phi = +(q.get('phi') || 1.35), dist = +(q.get('dist') || 4.5)
    const hold = () => w.tp(theta, phi, dist, 0.06)
    // draw only the frames that are filmed (software WebGL is slow)
    const r = g.view.renderer, draw = r.update.bind(r)
    const film = (name) => { r.update = draw; shot(name); r.update = () => {} }
    r.update = () => {}
    hold(); if (q.get('slot') !== 'none') t.select(+(q.get('slot') || 0)); for (let i = 0; i < 150; i++) { hold(); w.step(1) }
    if (q.has('aim')) { t.useStart(); for (let i = 0; i < 90; i++) { hold(); w.step(1) } }
    log('aiming', t.aiming, 'equipped', t.equipped, 'in hand', [...t.inHand], 'transition', t.transition && t.transition.kind, 'stance', pl.stance)
    film('dg-hold')
    const THREE = { yaw: (o) => { const e = o.matrixWorld.elements; return Math.atan2(e[8], e[10]) } }
    const bone = (n) => vp.model.getObjectByName(n)
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
    const DIRS = { f: ['forward'], b: ['backward'], l: ['strafeLeft'], r: ['strafeRight'], fr: ['forward', 'strafeRight'], fl: ['forward', 'strafeLeft'], br: ['backward', 'strafeRight'], bl: ['backward', 'strafeLeft'] }
    const list = (q.get('dirs') || 'fr,fl,br,bl,r,l').split(',')
    const every = +(q.get('every') || 10)
    for (const d of list) {
        for (const k of DIRS[d]) keys[k] = true
        const rows = []
        for (let i = 0; i < 90; i++) {
            hold(); w.step(1)
            const face = THREE.yaw(vp.model)
            // forward (+z in the body's axes) of the hips and the chest as the bones carry it
            const fwd = (n) => { const f = vp.boneFrame(n); if (!f) return 0; const e = f.quaternion, x = 2 * (e.x * e.z + e.w * e.y), z = 1 - 2 * (e.x * e.x + e.y * e.y); return Math.atan2(x, z) }
            // the turn of a line across the body (left joint minus right joint) from the body's left
            const across = (l, r) => { const a = bone(l).getWorldPosition(new w.game.view.player.model.position.constructor()), b = bone(r).getWorldPosition(a.clone()); const m = vp.model.matrixWorld.elements; const lx = m[0], lz = m[2]; const dx = a.x - b.x, dz = a.z - b.z; return Math.atan2(lx * dz - lz * dx, lx * dx + lz * dz) }
            const hip = - across('thigh_l', 'thigh_r'), chest = - across('upperarm_l', 'upperarm_r'), head = 0
            if (i % 5 === 4) rows.push(`${i + 1}:${(hip * 57.3).toFixed(0)}/${(chest * 57.3).toFixed(0)}`)
            if (i % every === every - 1) film(`dg-${d}-${String(i + 1).padStart(2, '0')}`)
        }
        const v = pl.velocity
        log(d, 'speed', Math.hypot(v[0], v[2]).toFixed(2), 'rot-theta', wrap(pl.rotation - theta).toFixed(2), 'frame:hips/chest deg from facing', rows.join(' '))
        for (const k of DIRS[d]) keys[k] = false
        for (let i = 0; i < 40; i++) { hold(); w.step(1) }
    }
    r.update = draw
}
