import Game from './Game/Game'

declare const __BUILD__: string
console.info(`[game] build ${__BUILD__}`)

/** The game couldn't start (no WebGL: hardware acceleration off, a blocked or old graphics driver): say so, not a black page. */
function startFailed(error: unknown) {
    console.error('[game] could not start', error)
    const webgl = /webgl/i.test(String(error))
    const message = document.createElement('div')
    message.className = 'loading'
    message.setAttribute('role', 'alert')
    message.innerHTML = `
        <div class="loading-card">
            <p class="drawer-eyebrow">Infinite world</p>
            <h1>Generate Infinite</h1>
            <p class="loading-status">${webgl ? 'This browser couldn\'t start 3D graphics (WebGL).' : 'The world couldn\'t start.'}</p>
            <p class="loading-help">${webgl ? 'Turn on hardware acceleration in the browser\'s settings and reload, or open the game in another browser.' : 'Reload the page to try again.'}</p>
        </div>`
    for (const leftover of document.querySelectorAll('.ui .loading'))
        leftover.remove()
    ;(document.querySelector('.ui') ?? document.body).appendChild(message)
}

const gameElement = document.querySelector('.game')
let game: Game | null = null
if (gameElement) {
    try {
        game = new Game(gameElement)
    }
    catch (error) {
        startFailed(error)
    }
}
if (game) {
    // dev only: lets the browser console / automated checks drive camera and time of day
    if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>
        w.game = game
        // shot(x, y, z, rotateX, rotateY, dayProgress): freeze time, place the fly camera
        w.shot = (x: number, y: number, z: number, rx: number, ry: number, progress = 0.18) => {
            const state = game.state
            const camera = state.player.camera
            state.day.autoUpdate = false
            state.day.progress = progress
            state.day.timeProgress = progress
            if (camera.mode !== 2) {
                camera.mode = 2
                camera.thirdPerson.deactivate()
                camera.fly.activate()
            }
            camera.fly.position[0] = x
            camera.fly.position[1] = y
            camera.fly.position[2] = z
            camera.fly.rotateX = rx
            camera.fly.rotateY = ry
            return 'ok'
        }
        // tp(theta, phi, distance, dayProgress): freeze time, third-person camera at this orbit
        w.tp = (theta: number, phi = 1.15, distance = 7, progress = 0.05) => {
            const state = game.state
            const camera = state.player.camera
            state.day.autoUpdate = false
            state.day.progress = progress
            state.day.timeProgress = progress
            if (camera.mode !== 1) {
                camera.mode = 1
                camera.fly.deactivate()
                camera.thirdPerson.activate()
            }
            camera.thirdPerson.theta = theta
            camera.thirdPerson.phi = phi
            camera.thirdPerson.distance = camera.thirdPerson.targetDistance = distance
            return 'ok'
        }
        // step(frames): advance the game in exact 1/60 s steps, independent of the browser's
        // frame timing (the preview pane throttles requestAnimationFrame)
        w.step = (frames = 60, dt = 1 / 60) => {
            const time = game.state.time
            const realUpdate = time.update
            time.update = () => { time.delta = dt; time.elapsed += dt }
            try {
                for (let i = 0; i < frames; i++) {
                    game.state.update()
                    game.view.update()
                }
            }
            finally {
                time.update = realUpdate
                time.current = Date.now() / 1000
            }
            return frames
        }
    }
}
