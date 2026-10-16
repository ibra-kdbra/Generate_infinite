import * as THREE from 'three'

import Game from './Game'

/**
 * The loading screen: the world is generated, textured and lit behind it, and it lifts only
 * when everything is in place, instead of showing a half-built scene that corrects itself.
 * It waits for the terrain around the player (and shows how much of the land is ready), the
 * ground textures, the character and the trees, puts the player on the ground, compiles every
 * shader the scene uses, lets a few frames settle (shadows, clouds, the exposure), then fades.
 */
export default class Loading {
    game: Game
    element: HTMLElement
    done = false
    private bar: HTMLElement
    private status: HTMLElement
    private started = performance.now()
    private phase: 'world' | 'shaders' | 'settle' | 'fade' = 'world'
    private settleFrames = 0
    private shown = 0              // displayed progress, eased

    constructor(game: Game) {
        this.game = game
        this.element = document.createElement('div')
        this.element.className = 'loading'
        this.element.setAttribute('role', 'status')
        this.element.innerHTML = `
            <div class="loading-card">
                <p class="drawer-eyebrow">Infinite world</p>
                <h1>Generate Infinite</h1>
                <div class="loading-bar" aria-hidden="true"><span></span></div>
                <p class="loading-status">Shaping the land…</p>
            </div>
            <p class="loading-hint"><kbd>Esc</kbd> menu <kbd>H</kbd> keys <kbd>M</kbd> sound</p>`
        document.querySelector('.ui')!.appendChild(this.element)
        this.bar = this.element.querySelector('.loading-bar span')!
        this.status = this.element.querySelector('.loading-status')!
    }

    /** How ready the world is (0..1) and what it's waiting for. */
    private progress(): [number, string] {
        const { state, view } = this.game
        const terrains = [...state.terrains.terrains.values()]
        const land = terrains.length ? terrains.filter((terrain) => terrain.ready).length / terrains.length : 0
        const p = state.player.position.current
        const chunk = state.chunks.getDeepestChunkForPosition(p[0], p[2])
        const underfoot = !!(chunk && chunk.terrain && chunk.terrain.ready)
        const textures = view.terrains.material.uniforms.uGroundReady.value === 1
        const character = view.player.model !== null
        const trees = view.trees.ready
        const parts = [land >= 0.97 && underfoot, textures, character, trees]
        const share = land * 0.6 + (textures ? 0.15 : 0) + (character ? 0.1 : 0) + (trees ? 0.15 : 0)
        const waiting = land < 0.97 || !underfoot ? 'Shaping the land' : !trees ? 'Growing the forests' : !textures ? 'Laying the ground' : !character ? 'Waking the traveller' : ''
        return [parts.every(Boolean) ? 1 : Math.min(0.97, share), waiting]
    }

    update() {
        if (this.done)
            return
        const { state, view } = this.game
        const elapsed = (performance.now() - this.started) / 1000
        if (this.phase === 'world') {
            const [ready, waiting] = this.progress()
            this.shown += (ready - this.shown) * 0.15
            this.bar.style.transform = `scaleX(${this.shown.toFixed(3)})`
            this.status.textContent = waiting ? `${waiting}… ${Math.round(ready * 100)} %` : 'Almost there…'
            if ((ready >= 1 && elapsed > 1) || elapsed > 45) {
                // stand the player on the ground before anything is seen
                const p = state.player.position.current
                const ground = state.chunks.getElevationForPosition(p[0], p[2])
                if (typeof ground === 'number') {
                    p[1] = ground
                    state.player.velocity[0] = state.player.velocity[1] = state.player.velocity[2] = 0
                }
                this.phase = 'shaders'
                this.status.textContent = 'Preparing the light…'
                const renderer = view.renderer.instance as THREE.WebGLRenderer & { compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown> }
                const compile = renderer.compileAsync ? renderer.compileAsync(view.scene, view.camera.instance) : Promise.resolve()
                compile.catch(() => {}).finally(() => { this.phase = 'settle' })
            }
        }
        else if (this.phase === 'settle') {
            this.bar.style.transform = 'scaleX(1)'
            // a few frames for the shadows, the clouds' history and the exposure to settle
            if (++this.settleFrames > 20) {
                this.phase = 'fade'
                this.element.classList.add('is-leaving')
                setTimeout(() => {
                    this.element.remove()
                    this.done = true
                }, 700)
            }
        }
    }
}
