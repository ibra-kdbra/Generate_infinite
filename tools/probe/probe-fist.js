// The finger bones of the hands, and the closed fist from a clip: where its centre is in the hand
// bone's frame (the point a handle runs through), for both hands.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const vp = g.view.player
    const names = []; vp.model.traverse((o) => { if (o.isBone && /(thumb|index|middle|ring|pinky)/.test(o.name)) names.push(o.name) })
    log('fingers', names.join(' '))
    const V = vp.model.position.constructor
    for (const clip of Object.values(vp.clips)) {
    for (const frac of [0, 0.5]) {
    if (!clip.tracks.some((t) => /index_02_r/.test(t.name))) continue
    for (const track of clip.tracks) {
        const [bone, prop] = track.name.split('.')
        if (prop !== 'quaternion' || !/(thumb|index|middle|ring|pinky)/.test(bone)) continue
        const b = vp.model.getObjectByName(bone); if (!b) continue
        const i = Math.floor(frac * (track.times.length - 1)); b.quaternion.fromArray(track.values, i * 4)
    }
    vp.model.updateMatrixWorld(true)
    for (const side of ['l', 'r']) {
        const hand = vp.model.getObjectByName(`hand_${side}`)
        const inverse = hand.matrixWorld.clone().invert()
        const at = (n) => vp.model.getObjectByName(n).getWorldPosition(new V()).applyMatrix4(inverse)
        const ring = ['index_02', 'middle_02', 'ring_02', 'pinky_02', 'index_03', 'middle_03', 'ring_03', 'pinky_03'].map((n) => at(`${n}_${side}`))
        const knuckles = ['index_01', 'middle_01', 'ring_01', 'pinky_01'].map((n) => at(`${n}_${side}`))
        const c = ring.concat(knuckles).reduce((a, b) => a.add(b), new V()).multiplyScalar(1 / (ring.length + knuckles.length))
        const curl = knuckles.map((k, i) => k.y - at(`${['index', 'middle', 'ring', 'pinky'][i]}_03_${side}`).y)
        log('curl', clip.name, frac, side, curl.map((v) => (v * 100).toFixed(1)).join(','), 'centre', [c.x, c.y, c.z].map((v) => v.toFixed(3)).join(','))
        if (false) log('fist centre', side, [c.x, c.y, c.z].map((v) => v.toFixed(3)).join(','), 'knuckles', knuckles.map((k) => [k.x, k.y, k.z].map((v) => v.toFixed(3)).join(',')).join(' | '), 'tips', ['index_03', 'middle_03'].map((n) => at(`${n}_${side}`)).map((k) => [k.x, k.y, k.z].map((v) => v.toFixed(3)).join(',')).join(' | '))
    }
}
    }
}
