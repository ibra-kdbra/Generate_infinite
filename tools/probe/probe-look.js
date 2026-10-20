// The mouse turning the follow camera: a 100-count movement in one frame (dragging, as a
// captured mouse can't be had headless), how the turn arrives over the next frames.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    g.view.renderer.update = () => {}
    const c = g.state.controls, cam = g.state.player.camera.thirdPerson
    w.tp(0, 1.3, 6, 0.06); w.step(10)
    const start = cam.theta
    c.pointer.down = true
    c.pointer.deltaTemp.x = 100
    const seen = []
    for (let i = 0; i < 8; i++) { w.step(1); seen.push(((start - cam.theta) * 57.3).toFixed(2)) }
    c.pointer.down = false
    w.step(30)
    log('degrees turned after each frame:', seen.join(' '), '| in all', ((start - cam.theta) * 57.3).toFixed(2), '| expected (drag)', (100 / Math.min(innerWidth, innerHeight) * 2 * 57.3).toFixed(2))
}
