// The game's own work per frame (state and view updates, not the drawing): standing, running,
// running with a tool in hand, with the camera turning. Milliseconds, the median and the 95th
// percentile of 240 frames each.
//   EXTRA='probe=/tools/probe/probe-cpu.js&char=male_ranger' run.sh 300
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    const q = new URLSearchParams(w.location.search)
    const st = g.view.player.settings, t = g.view.tools, keys = g.state.controls.keys.down
    if (q.get('quality')) st.set('quality', q.get('quality'))
    st.set('character', q.get('char') || 'male_ranger'); await wait(2500); w.step(20)
    const r = g.view.renderer, draw = r.update.bind(r)
    r.update = () => {}
    w.tp(0.3, 1.3, 6, 0.06); w.step(120); await wait(3000); w.step(60)
    const profiling = q.has('profile')
    const measure = async (label, frames = 240, turn = 0) => {
        if (profiling) { log('PROFILE start'); await wait(300) }
        const times = []
        for (let i = 0; i < frames; i++) {
            const camera = g.state.player.camera.thirdPerson
            if (turn) camera.theta += turn
            const start = performance.now(); w.step(1); times.push(performance.now() - start)
        }
        times.sort((a, b) => a - b)
        if (profiling) { log('PROFILE stop ' + label); await wait(1500) }
        log(label, 'median', times[frames >> 1].toFixed(2), 'p95', times[Math.floor(frames * 0.95)].toFixed(2), 'max', times[frames - 1].toFixed(2))
    }
    if (q.has('turning')) { keys.forward = true; await measure('running, turning', 240, 0.02); await measure('running, turning fast', 240, 0.06); keys.forward = false; r.update = draw; return }
    if (!q.has('only')) { await measure('standing'); keys.forward = true; await measure('running'); await measure('running, turning', 240, 0.02); keys.forward = false; w.step(30) }
    t.select(0); w.step(150)
    await measure('sword in hand')
    keys.forward = true; await measure('running with the sword'); if (!q.has('only')) await measure('running with the sword, turning', 240, 0.02); keys.forward = false
    r.update = draw
}
