// How long a frame takes standing, and running with a tool out (the GPU's and the CPU's share).
export default async function ({ w, log, wait, timing }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    w.tp(0.6, 1.3, 6, 0.08); w.step(60)
    log('standing: ms per frame', timing())
    const t = g.view.tools; t.select(0); w.step(150)
    const keys = g.state.controls.keys.down; keys.forward = true; keys.boost = true
    log('running with a tool: ms per frame', timing())
    keys.forward = false; keys.boost = false
    const s0 = performance.now(); for (let i = 0; i < 60; i++) g.state.update()
    log('state update: ms', ((performance.now() - s0) / 60).toFixed(2))
}
