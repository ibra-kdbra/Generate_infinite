import * as THREE from 'three'

import Game from '../Game'

export default class TerrainGradient {
    game: Game
    canvas: HTMLCanvasElement
    context: CanvasRenderingContext2D
    texture: THREE.Texture
    colors: {
        aboveFar: string
        aboveClose: string
        belowClose: string
        belowFar: string
    }
    width: number
    height: number

    constructor() {
        this.game = Game.getInstance()

        this.canvas = document.createElement('canvas')
        this.context = this.canvas.getContext('2d')!
        this.texture = new THREE.Texture(this.canvas)

        this.colors = {
            aboveFar: '#ffffff',
            aboveClose: '#a6c33c',
            belowClose: '#2f3d36',
            belowFar: '#011018',
        }

        this.width = 1
        this.height = 512

        this.canvas.width = this.width
        this.canvas.height = this.height

        this.update()
        this.setDebug()
    }

    update() {
        const fill = this.context.createLinearGradient(0, 0, 0, this.height)
        fill.addColorStop(0, this.colors.aboveFar)
        fill.addColorStop(0.49999, this.colors.aboveClose)
        fill.addColorStop(0.51111, this.colors.belowClose)
        fill.addColorStop(1, this.colors.belowFar)

        this.context.fillStyle = fill
        this.context.fillRect(0, 0, this.width, this.height)

        this.texture.needsUpdate = true
    }

    setDebug() {
        const debug = this.game.debug

        if (!debug.active)
            return

        const folder = debug.ui.getFolder('view/terrains/gradient')

        for (const colorKey in this.colors) {
            folder
                .addColor(this.colors, colorKey as keyof typeof this.colors)
                .onChange(() => this.update())
        }
    }
}
