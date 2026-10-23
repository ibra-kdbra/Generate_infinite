// How long loading takes and what a frame costs (one standing view, the drawing included):
// light enough to compare the qualities on a software renderer.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    log('loading', g.loading.done ? `${((performance.now() - t0) / 1000).toFixed(1)} s` : 'not done after 90 s')
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    w.tp(0.6, 1.3, 6, 0.08); w.step(10)
    const gl = g.view.renderer.instance.getContext(), px = new Uint8Array(4), info = g.view.renderer.instance.info
    const run = (n) => { const t = performance.now(); w.step(n); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t) / n }
    run(3)
    info.reset(); const ms = Math.min(run(5), run(5))
    log('frame', `${ms.toFixed(0)} ms (software) · draw calls ${Math.round(info.render.calls / 5)} · triangles ${Math.round(info.render.triangles / 5).toLocaleString()} · pixel ratio ${g.view.renderer.instance.getPixelRatio()} · geometries ${info.memory.geometries} · textures ${info.memory.textures}`)
}
