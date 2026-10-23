// The captured mouse, end to end: click into the game (the mouse is captured), move it by known
// amounts, and log what the browser reports (movementX) and how far the camera turned.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    g.view.renderer.update = () => {}
    const cam = g.state.player.camera.thirdPerson
    let moves = [], seen = 0
    w.addEventListener('pointermove', (e) => { moves.push(e.movementX); seen++ })
    const frames = (n) => { for (let i = 0; i < n; i++) w.step(1) }
    w.tp(0, 1.3, 6, 0.06); frames(10)
    const at = w.document.elementFromPoint(300, 200)
    log('under the click:', at && at.tagName, at && at.className)
    w.document.addEventListener('pointerlockerror', () => log('pointer lock ERROR event'))
    const orig = w.HTMLElement.prototype.requestPointerLock
    w.HTMLElement.prototype.requestPointerLock = function (...a) { log('requestPointerLock called with', JSON.stringify(a)); const r = orig.apply(this, a); if (r && r.catch) r.catch((e) => log('request rejected:', String(e))); return r }
    log('ACTION click 300 200'); await wait(1500)
    log('locked', !!w.document.pointerLockElement, 'by', w.document.pointerLockElement && w.document.pointerLockElement.className, 'devicePixelRatio', w.devicePixelRatio)
    for (const [dx, steps] of [[100, 1], [100, 10], [400, 1], [400, 20]]) {
        moves = []; const before = cam.theta
        log(`ACTION move ${dx} 0 ${steps}`); await wait(500)
        frames(20)
        log(`moved ${dx} px in ${steps} events: browser reported movementX`, moves.join(','), `| camera turned ${((before - cam.theta) * 57.3).toFixed(1)}°`)
        log(`ACTION move ${- dx} 0 1`); await wait(300); frames(20)
    }
}
