export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const q = new URLSearchParams(location.search), st = g.view.player.settings, t = g.view.tools, pl = g.state.player, keys = g.state.controls.keys.down
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', 'male_peasant'); await wait(2500); w.step(20)
    const p0 = [...pl.position.current]
    let tree = null, bd = 1e9
    for (const cell of g.state.vegetation.cells.values()) for (const pp of cell.plants) if ((pp.kind === 1) && pp.collision > 0.3 && pp.collision < 0.42) {
        // room to fall: no other tree within 5 m
        if (g.state.vegetation.nearest(pp.x + 4, pp.z, 3, [0, 1]) ) continue
        const d = Math.hypot(pp.x - p0[0], pp.z - p0[2]); if (d < bd) { bd = d; tree = pp } }
    log('tree radius', tree.collision.toFixed(2), 'scale', tree.scale.toFixed(1))
    const d = 1.0, a = 0, x = tree.x + Math.cos(a) * d, z = tree.z + Math.sin(a) * d
    const rot = Math.atan2(x - tree.x, z - tree.z)
    const place = (px = x, pz = z, r = rot) => { w.tp(r, 1.3, 4, 0.06); const p = pl.position.current; p[0] = px; p[2] = pz; p[1] = pl.groundAt(px, pz); pl.position.previous.set(p); pl.velocity.fill(0); pl.rotation = r }
    place(); t.select(0); w.step(150)
    const look = (from, at, tag) => { const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]; w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06); shot(tag) }
    let i = 0
    for (; i < 30 && !tree.felled; i++) {
        place(); w.step(2); t.useStart(); t.useEnd()
        w.step(80)
        if (i === 3 || i === 7) look([tree.x + 1.5, tree.y + 1.6, tree.z + 0.9], [tree.x, tree.y + 1.0, tree.z], 'cuts-' + i)
    }
    log('felled after', i, 'presses; stump', tree.stump?.toFixed(2), 'marks left', t.marks.size)
    // step away and watch it fall
    place(x + 2.5, z + 2.5); w.step(30)
    w.step(240)
    look([tree.x + 6, tree.y + 4, tree.z + 7], [tree.x - 3, tree.y + 0.5, tree.z], 'fallen-wide')
    look([tree.x + 1.6, tree.y + 1.3, tree.z + 1.2], [tree.x, tree.y + 0.6, tree.z], 'stump')
    const logs = g.state.vegetation.logs
    log('logs', logs.length, logs[0] && JSON.stringify({ a: logs[0].trunk.a.map(v => +v.toFixed(2)), b: logs[0].trunk.b.map(v => +v.toFixed(2)), r: +logs[0].trunk.radius.toFixed(2) }))
    if (logs[0]) {
        const L = logs[0].trunk, mid = [(L.a[0] + L.b[0]) / 2, (L.a[2] + L.b[2]) / 2]
        const ax = L.b[0] - L.a[0], az = L.b[2] - L.a[2], len = Math.hypot(ax, az), nx = - az / len, nz = ax / len
        // walk into the trunk from the side
        place(mid[0] + nx * 3, mid[1] + nz * 3, Math.atan2(nx, nz)); w.step(5)
        keys.forward = true
        let minD = 9, maxY = - 1e9
        for (let k = 0; k < 120; k++) { w.tp(Math.atan2(nx, nz), 1.3, 4, 0.06); w.step(1); const p = pl.position.current; minD = Math.min(minD, Math.abs((p[0] - mid[0]) * nx + (p[2] - mid[1]) * nz)); maxY = Math.max(maxY, p[1] - pl.groundAt(p[0], p[2])) }
        keys.forward = false
        log('walking into the log: closest to its axis', minD.toFixed(2), '(trunk r', L.radius.toFixed(2), '+ body 0.32) highest above ground', maxY.toFixed(2))
        // into the crown
        const C = logs[0].crown, cm = [(C.a[0] + C.b[0]) / 2, (C.a[2] + C.b[2]) / 2]
        place(cm[0] + nx * 4, cm[1] + nz * 4, Math.atan2(nx, nz)); w.step(5); keys.forward = true
        let minSpeed = 9, hits = 0, last = g.view.trees.uniforms.uTreeHit.value.z; for (let k = 0; k < 120; k++) { w.tp(Math.atan2(nx, nz), 1.3, 4, 0.06); w.step(1); if (k > 40) minSpeed = Math.min(minSpeed, pl.speed); const z = g.view.trees.uniforms.uTreeHit.value.z; if (z !== last) { hits++; last = z } }
        log('branches shaken', hits, 'times')
        keys.forward = false
        log('through the crown: slowest', minSpeed.toFixed(2), 'thicket', pl.thicket.toFixed(2))
    }
}
