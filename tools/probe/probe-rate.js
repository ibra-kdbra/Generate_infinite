// The frame-rate setting: frames the game runs in 3 s of real time (the browser's own loop) per
// setting, and in the background (window without focus).
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const settings = g.view.player.settings, st = g.state
    const count = async () => { const a = st.time.elapsed, n0 = frames; await wait(3000); return { fps: (frames - n0) / 3, game: (st.time.elapsed - a) / 3 } }
    let frames = 0
    // the drawing left out (a software renderer can't draw even 30 a second): the schedule alone
    g.view.update = () => {}
    const update = st.update.bind(st)
    st.update = () => { frames++; update() }
    log('focused', document.hasFocus())
    await wait(1500)
    for (const rate of ['display', '60', '30']) {
        settings.set('frameRate', rate)
        const r = await count()
        log(`${rate}: ${r.fps.toFixed(1)} frames a second, game time ${r.game.toFixed(2)} s per second`)
    }
    // in the background: the window seen but not played (another one has the focus)
    document.hasFocus = () => false
    for (const rate of ['display', '60']) {
        settings.set('frameRate', rate)
        const r = await count()
        log(`background, ${rate}: ${r.fps.toFixed(1)} frames a second`)
    }
}
