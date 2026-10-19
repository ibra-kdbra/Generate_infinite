export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    const gear = location.search.includes('gear')
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    const p0 = [...pl.position.current]
    let face = null
    const height = (x, z) => {
        // the game's own measure (startClimb): up the steepest line to walkable ground
        const n = new Float32Array(3); let px = x, pz = z
        for (let walked = 0; walked < 8; walked += 0.5) {
            pl.sampleGroundNormal(px, pz, n, 0.45)
            if (n[1] > pl.maxWalkSlope + 0.06 && walked > 0.5) break
            const h = Math.hypot(n[0], n[2]) || 1
            px -= n[0] / h * 0.5 * n[1]; pz -= n[2] / h * 0.5 * n[1]
        }
        return pl.groundAt(px, pz) - pl.groundAt(x, z)
    }
    for (let r = 4; r < 500 && !face; r += 2) for (let b = 0; b < 6.28; b += 0.08) {
        const x = p0[0] + Math.cos(b) * r, z = p0[2] + Math.sin(b) * r
        const n = new Float32Array(3); pl.sampleGroundNormal(x, z, n, 0.45)
        if (n[1] > pl.maxWalkSlope - 0.05 || pl.groundAt(x, z) < 2) continue
        const h = height(x, z)
        if (gear ? h > 4 : (h > 0.8 && h < 2.1)) { face = { x, z, n: [...n], h }; break }
    }
    log('face', JSON.stringify(face))
    const nx = face.n[0], nz = face.n[2], l2 = Math.hypot(nx, nz)
    const sx = face.x + nx / l2 * 0.6, sz = face.z + nz / l2 * 0.6
    pl.position.current[0] = sx; pl.position.current[2] = sz; pl.position.current[1] = pl.groundAt(sx, sz)
    pl.position.previous.set(pl.position.current); pl.velocity.fill(0); pl.rotation = Math.atan2(nx, nz)
    w.tp(Math.atan2(nx / l2, nz / l2), 1.3, 5, 0.06)
    keys.forward = true
    const lookAt = (from, at) => { const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2]; w.shot(from[0], from[1], from[2], Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(- dx, - dz), 0.06) }
    let n = 0
    for (let i = 0; i < 400 && n < 10; i++) {
        w.step(1)
        const p = pl.position.current
        if ((pl.climbing || pl.mantle) && i % 5 === 0) {
            log('frame', n, 'gear', pl.climbGear, pl.climbing ? 'climb' : 'mantle', 'limbs', vp.pose.limbs.map(l => l.t.toFixed(2)).join(','))
            const cn = pl.climbNormal, h = Math.hypot(cn[0], cn[2]), ox = cn[0] / h, oz = cn[2] / h, rx = - oz, rz = ox
            const at = [p[0] + ox * 0.3, p[1] + 0.9, p[2] + oz * 0.3]
            lookAt([at[0] + ox * 1.6 + rx * 2.2, at[1] + 0.3, at[2] + oz * 1.6 + rz * 2.2], at); shot('cs-' + n)
            n++
            w.tp(Math.atan2(nx / l2, nz / l2), 1.3, 5, 0.06)
        }
        if (!pl.climbing && !pl.mantle && i > 60) { log('left climb at', i, pl.movementState); break }
    }
    keys.forward = false
}
