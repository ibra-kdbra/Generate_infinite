export default async function ({ w, log, wait, shot }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 60000) await wait(200)
    const st = g.view.player.settings, t = g.view.tools, pl = g.state.player, keys = g.state.controls.keys.down, vp = g.view.player
    g.view.renderer.adaptive.enabled = false; g.view.renderer.adaptive.scale = 1; g.view.renderer.resize()
    st.set('character', 'male_ranger'); await wait(2500); w.step(20)
    const theta = 0.3
    w.tp(theta, 1.35, 4.5, 0.06); t.select(0); w.step(80)
    log('stance', pl.stance, 'equipped', t.equipped)
    for (const [label, k] of [['back', 'backward'], ['right', 'strafeRight'], ['left', 'strafeLeft'], ['fwd', 'forward']]) {
        keys[k] = true
        for (let i = 0; i < 30; i++) { w.tp(theta, 1.35, 4.5, 0.06); w.step(1) }
        const v = pl.velocity
        const f = - (v[0] * Math.sin(pl.rotation) + v[2] * Math.cos(pl.rotation))
        log(label, 'speed', Math.hypot(v[0], v[2]).toFixed(2), 'along facing', f.toFixed(2), 'rotation-theta', (pl.rotation - theta).toFixed(2))
        for (let s = 0; s < 6; s++) { w.tp(theta, 1.35, 4.5, 0.06); w.step(5); shot(`st-${label}-${s}`) }
        keys[k] = false; for (let i = 0; i < 30; i++) { w.tp(theta, 1.35, 4.5, 0.06); w.step(1) }
    }
}
