// The captured-mouse path of the real game code, with the browser's capture faked: the pattern
// Firefox on Wayland sends (each move followed by an earlier-stamped event with the pointer's
// offset), fed as mouse events; how far the camera turns, against dragging the same distance.
export default async function ({ w, log, wait }) {
    const g = w.game, t0 = performance.now(); while (!g.loading.done && performance.now() - t0 < 90000) await wait(200)
    g.view.renderer.update = () => {}
    const cam = g.state.player.camera.thirdPerson, viewport = g.state.viewport
    w.tp(0, 1.3, 6, 0.06); w.step(5)
    const canvas = g.view.renderer.instance.domElement
    // fake the capture: the document says the canvas has the pointer, the game thinks it's locked
    Object.defineProperty(w.document, 'pointerLockElement', { configurable: true, get: () => canvas })
    viewport.pointerLock.active = true
    w.document.dispatchEvent(new Event('pointerlockchange'))
    // a mouse event with a chosen time stamp (the bogus ones come stamped earlier)
    const send = (x, stamp) => {
        const e = new MouseEvent('mousemove', { movementX: x, movementY: 0, buttons: 0, bubbles: true })
        Object.defineProperty(e, 'timeStamp', { get: () => stamp })
        w.dispatchEvent(e)
    }
    send(50, 1000)           // the first after capture: skipped
    const before = cam.theta
    // as logged on the owner's machine: each move, then the pointer's offset from where it was
    // captured (the offset before plus this move, in CSS px); the moves stamped minus infinity
    const ratio = w.devicePixelRatio || 1
    let stamp = 2000, offset = 107, total = 0
    for (let i = 0; i < 30; i++) {
        const move = 2 + (i % 3) * 2
        total += move
        offset += move / ratio
        send(move, -9223372036854776); send(Math.round(offset), stamp)
        stamp += 9
        if (i % 2) w.step(1)
    }
    w.step(30)
    const turned = (before - cam.theta) * 57.3
    const side = Math.min(w.innerWidth, w.innerHeight)
    const expected = total / (w.devicePixelRatio || 1) / side * 2 * 57.3
    log(`moved ${total} device px with ${30} bogus events between: the camera turned ${turned.toFixed(2)}°, dragging the same distance turns ${expected.toFixed(2)}°`)
}
