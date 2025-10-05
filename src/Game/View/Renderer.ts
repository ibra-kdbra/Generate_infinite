import * as THREE from 'three'
import Game from '../Game'
import View from './View'
import Debug from '../Debug/Debug'
import State from '../State/State'
import Time from '../State/Time'
import Viewport from '../State/Viewport'
import Camera from './Camera'

export default class Renderer {
    game!: Game;
    view!: View;
    state!: State;
    debug!: Debug;
    scene!: THREE.Scene;
    viewport!: Viewport;
    time!: Time;
    camera!: Camera;
    instance!: THREE.WebGLRenderer;
    clearColor!: string;
    context!: WebGLRenderingContext | WebGL2RenderingContext;
    renderTarget!: any;

    constructor() {
        this.game = Game.getInstance()
        this.view = View.getInstance()
        this.state = State.getInstance()
        this.debug = Debug.getInstance()

        this.scene = this.view.scene
        this.viewport = this.state.viewport
        this.time = this.state.time
        this.camera = this.view.camera

        this.setInstance()
    }

    setInstance() {
        this.clearColor = '#222222'

        this.instance = new THREE.WebGLRenderer({
            alpha: false,
            antialias: true,
            powerPreference: 'high-performance'
        })

        this.instance.outputColorSpace = THREE.SRGBColorSpace
        this.instance.toneMapping = THREE.ACESFilmicToneMapping
        this.instance.domElement.style.top = '0'
        this.instance.domElement.style.left = '0'
        this.instance.domElement.style.width = '100%'
        this.instance.domElement.style.height = '100%'

        this.instance.setClearColor(this.clearColor, 1)
        // Add '!' to assert that these values are not null
        this.instance.setSize(this.viewport.width!, this.viewport.height!)
        this.instance.setPixelRatio(this.viewport.clampedPixelRatio!)

        this.context = this.instance.getContext()

        this.debug.stats?.setRenderPanel(this.context)
    }

    resize() {
        // Add '!' to assert that these values are not null
        this.instance.setSize(this.viewport.width!, this.viewport.height!)
        this.instance.setPixelRatio(this.viewport.clampedPixelRatio!)
    }

    update() {
        this.debug.stats?.beforeRender()

        this.instance.render(this.scene, this.camera.instance)

        this.debug.stats?.afterRender()
    }

    destroy() {
        this.instance.renderLists.dispose()
        this.instance.dispose()
        this.renderTarget.dispose()
    }
}
