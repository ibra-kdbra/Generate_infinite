// Depth precision in the distance: the same far view (lakes and slopes 1-4 km out) with the
// camera's near plane at 0.1 m and at 1 m; where the pictures differ, depth decided it.
export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.state, p = st.player.position.current, cam = g.view.camera.instance
    g.view.renderer.adaptive.enabled = false
    st.weather && (st.weather.override = 0)
    for (let i = 0; i < 40; i++) { w.step(2); await wait(50) }
    const views = [[250, -0.12, 0.6], [250, -0.12, 2.6], [120, -0.06, 4.2]]
    for (const [i, [h, rx, ry]] of views.entries()) {
        for (const near of [0.1, 1]) {
            w.shot(p[0], (st.chunks.getElevationForPosition(p[0], p[2]) || 0) + h, p[2], rx, ry, 0.3)
            cam.near = near; cam.updateProjectionMatrix()
            for (let f = 0; f < 12; f++) { w.step(1); await wait(60) }
            cam.near = near; cam.updateProjectionMatrix()
            shot(`depth-${i}-near${near}`)
        }
    }
}
