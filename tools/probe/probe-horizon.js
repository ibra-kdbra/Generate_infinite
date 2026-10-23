// Distant land from the ground and from a hill, by day and at sunset: how the far haze meets the sky.
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const st = g.state, p = st.player.position.current
    g.view.renderer.adaptive.enabled = false
    const views = [[3, 0.02, 0.6, 0.12], [3, 0.03, 2.6, 0.12], [80, -0.05, 4.2, 0.12], [3, 0.02, 1.4, 0.23]]
    for (const [i, [h, rx, ry, day]] of views.entries()) {
        w.shot(p[0], (st.chunks.getElevationForPosition(p[0], p[2]) || 0) + h, p[2], rx, ry, day)
        for (let f = 0; f < 8; f++) { w.step(1); await wait(80) }
        shot(`horizon-${i}`)
    }
}
