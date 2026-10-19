export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    const p0 = [...pl.position.current]; let flat = null
    for (let r = 0; r < 400 && !flat; r += 4) for (let a = 0; a < 6.28; a += 0.25) {
        const x = p0[0] + Math.cos(a) * r, z = p0[2] + Math.sin(a) * r, n = new Float32Array(3)
        let ok = true
        for (let d = 0; d < 40 && ok; d += 5) { pl.sampleGroundNormal(x, z - d, n, 3); if (n[1] < 0.985 || pl.groundAt(x, z - d) < 1.5 || g.state.vegetation.nearest(x, z - d, 4, [0, 1, 2, 3])) ok = false }
        if (ok) { flat = [x, z]; break }
    }
    log('flat', JSON.stringify(flat))
    const p = pl.position.current; p[0] = flat[0]; p[2] = flat[1]; p[1] = pl.groundAt(p[0], p[2]); pl.position.previous.set(p); pl.velocity.fill(0)
    const theta = 0     // forward is -z
    w.tp(theta, 1.4, 5, 0.06); pl.rotation = theta; w.step(20)
    const side = (tag) => { w.tp(theta + Math.PI / 2, 1.45, 4.5, 0.06); w.step(1); shot(tag); w.tp(theta, 1.4, 5, 0.06) }
    const front = (tag) => { w.tp(theta + Math.PI, 1.45, 4.5, 0.06); w.step(1); shot(tag); w.tp(theta, 1.4, 5, 0.06) }
    // get going into a run (side)
    keys.forward = true; keys.boost = true
    for (let i = 0; i < 6; i++) { w.step(6); side('start-' + i); log('start', i, 'speed', pl.speed.toFixed(2), 'accel', pl.acceleration.forward.toFixed(1)) }
    w.step(40)
    // a curve to the right at speed (seen from behind)
    keys.strafeRight = true
    for (let i = 0; i < 4; i++) { w.step(6); w.tp(theta, 1.4, 5, 0.06); w.step(1); shot('turn-' + i); log('turn', i, 'speed', pl.speed.toFixed(2), 'lateral', pl.acceleration.right.toFixed(1)) }
    keys.strafeRight = false; w.step(40)
    // stop
    keys.forward = false; keys.boost = false
    for (let i = 0; i < 4; i++) { w.step(5); side('stop-' + i); log('stop', i, 'speed', pl.speed.toFixed(2), 'accel', pl.acceleration.forward.toFixed(1)) }
}
