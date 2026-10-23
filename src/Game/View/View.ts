// 📁sources/Game/View/View.ts (Corrected)

import Camera from './Camera'
import Grass from './Grass'
import Noises from './Noises'
import Player from './Player'
import Renderer from './Renderer'
import Sky from './Sky'
import Terrains from './Terrains'
import Water from './Water'
import SkyLut from './SkyLut'
import Vegetation from './Vegetation'
import TreeShade from './TreeShade'
import Trees from './Trees'
import Splashes from './Splashes'
import GroundWetness from './GroundWetness'
import Shadows from './Shadows'
import Ferns from './Ferns'
import Tools from './Tools'
import Particles from './Particles'
import Weather from './Weather'
import Birds from './Birds'
import Audio from './Audio'
import Horizon from './Horizon'
import Wildlife from './Wildlife'

import * as THREE from 'three'

export default class View {
    static instance: View

    scene!: THREE.Scene
    camera!: Camera
    renderer!: Renderer
    noises!: Noises
    sky!: Sky
    water!: Water
    skyLut!: SkyLut
    vegetation!: Vegetation
    treeShade!: TreeShade
    trees!: Trees
    splashes!: Splashes
    groundWetness!: GroundWetness
    shadows!: Shadows
    ferns!: Ferns
    tools!: Tools
    particles!: Particles
    weather!: Weather
    birds!: Birds
    audio!: Audio
    horizon!: Horizon
    wildlife!: Wildlife
    terrains!: Terrains
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
        this.renderer = new Renderer()      // after the camera: it renders through it
        this.shadows = new Shadows()       // before the materials that receive the shadows

        this.noises = new Noises()
        this.sky = new Sky()
        this.skyLut = new SkyLut()
        this.water = new Water()
        this.terrains = new Terrains()
        this.player = new Player()
        this.grass = new Grass()
        this.vegetation = new Vegetation()
        this.horizon = new Horizon()
        this.trees = new Trees()
        this.ferns = new Ferns()
        this.splashes = new Splashes()
        this.groundWetness = new GroundWetness(this.splashes)
        this.particles = new Particles()
        this.weather = new Weather()
        this.birds = new Birds()
        this.audio = new Audio()
        this.wildlife = new Wildlife()
        this.tools = new Tools()
        this.terrains.material.uniforms.uWetMap.value = this.groundWetness.texture
        this.terrains.material.uniforms.uWetOrigin.value = this.groundWetness.origin
        this.terrains.material.uniforms.uWetSize.value = this.groundWetness.size
        this.treeShade = new TreeShade()
        for (const material of [this.terrains.material, this.grass.material]) {
            material.uniforms.uTreeShade.value = this.treeShade.texture
            material.uniforms.uTreeShadeOrigin.value = this.treeShade.origin
            material.uniforms.uTreeShadeSize.value = this.treeShade.size
        }
    }

    resize() {
        this.camera.resize()
        this.renderer.resize()
        this.sky.resize()
    }

    update() {
        this.sky.update()
        this.skyLut.update()
        this.water.update()
        this.terrains.update()
        this.tools.update()           // hand targets for this frame's pose
        this.player.update()
        this.tools.place()            // the tool in the posed hand
        this.grass.update()
        this.vegetation.update()
        this.horizon.update()
        this.trees.update()
        this.ferns.update()
        this.splashes.update()
        this.weather.update()
        this.birds.update()
        this.wildlife.update()
        this.audio.update()
        this.particles.update()
        this.groundWetness.update()
        this.terrains.material.uniforms.uWetMap.value = this.groundWetness.texture
        this.treeShade.update()
        this.camera.update()
        this.shadows.update()
        this.renderer.update()
    }
}