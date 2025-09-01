// 📁sources/Game/View/View.ts (Corrected)

import Camera from './Camera'
import Chunks from './Chunks'
import Grass from './Grass'
import Noises from './Noises'
import Player from './Player'
import Renderer from './Renderer'
import Sky from './Sky'
import Terrains from './Terrains'
import Water from './Water'

import * as THREE from 'three'

export default class View {
    static instance: View

    scene!: THREE.Scene
    camera!: Camera
    renderer!: Renderer
    noises!: Noises
    sky!: Sky
    water!: Water
    terrains!: Terrains
    chunks!: Chunks
    player!: Player
    grass!: Grass

    static getInstance() {
        return View.instance
    }

    constructor() {
        if (View.instance) {
            return View.instance
        }

        View.instance = this

        this.scene = new THREE.Scene()
        
        // ✅ CORRECT ORDER: Create dependencies first.
        this.camera = new Camera()
        this.renderer = new Renderer() // Now the Renderer can safely access the camera.

        this.noises = new Noises()
        this.sky = new Sky()
        this.water = new Water()
        this.terrains = new Terrains()
        this.chunks = new Chunks()
        this.player = new Player()
        this.grass = new Grass()
    }

    resize() {
        this.camera.resize()
        this.renderer.resize()
        this.sky.resize()
        this.terrains.resize()
    }

    update() {
        this.sky.update()
        this.water.update()
        this.terrains.update()
        this.chunks.update()
        this.player.update()
        this.grass.update()
        this.camera.update()
        this.renderer.update()
    }

    destroy() {
    }
}