// A game begun at night: every shadow map must be set up on the graphics card (a depth texture
// with its comparison set) even though none is drawn while the sun is down.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const shadows = g.view.shadows, renderer = g.view.renderer.instance
    const report = () => [0, 1, 2].map((i) => { const tex = shadows.uniforms[`uShadowMap${i}`].value; const p = renderer.properties.get(tex); return `${i}: ${tex && tex.isDepthTexture ? 'depth' : 'not depth'}, ${p && p.__webglTexture ? 'set up' : 'NOT set up'}` }).join(' | ')
    log('sun height now', g.state.sun.position.y.toFixed(2), 'shadow maps:', report())
}
