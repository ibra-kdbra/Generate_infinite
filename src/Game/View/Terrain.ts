import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Terrains from './Terrains'
import TerrainState from '../State/Terrain'

export default class Terrain {
    state: State
    view: View
    scene: THREE.Scene
    terrains: Terrains
    terrainState: TerrainState
    created: boolean
    geometry!: THREE.BufferGeometry
    texture!: THREE.DataTexture
    material!: THREE.ShaderMaterial
    mesh!: THREE.Mesh

    constructor(terrains: Terrains, terrainState: TerrainState) {
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.scene = this.view.scene

        this.terrains = terrains
        this.terrainState = terrainState
        this.terrainState.renderInstance = this

        this.created = false

        this.terrainState.events.on('ready', () => {
            this.create()
        })
    }

    create() {
        // Recreate
        if (this.created) {
            // Dispose of old geometry
            this.geometry.dispose()

            // Create new geometry
            this.geometry = new THREE.BufferGeometry()
            this.geometry.setAttribute('position', new THREE.BufferAttribute(this.terrainState.positions, 3))
            this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.terrainState.uv, 2))
            this.geometry.setAttribute('aForest', new THREE.BufferAttribute(this.terrainState.forest, 1))
            this.geometry.index = new THREE.BufferAttribute(this.terrainState.indices, 1, false)
            this.mesh.geometry = this.geometry

            // New data too (normals, grass, elevation; the size changes with the subdivisions)
            this.texture.dispose()
            this.texture = this.createTexture()
            this.material.uniforms.uTexture.value = this.texture
            this.material.uniforms.uTextureSize.value = this.texture.image.width
        }

        // Create
        else {
            // Create geometry
            this.geometry = new THREE.BufferGeometry()
            this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.terrainState.positions, 3))
            this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.terrainState.uv, 2))
            this.geometry.setAttribute('aForest', new THREE.BufferAttribute(this.terrainState.forest, 1))
            this.geometry.index = new THREE.BufferAttribute(this.terrainState.indices, 1, false)

            this.texture = this.createTexture()

            // Material: its own data texture, every other uniform shared by reference with the
            // main terrain material so per-frame values (sun, player, sky) reach every chunk.
            // (ShaderMaterial.clone() deep-copies uniforms: chunks kept the sun direction and
            // player position from the moment they were created, which left lighting seams
            // between chunks and the darker ground under the grass where the player had been.)
            const shared = this.terrains.material
            this.material = new THREE.ShaderMaterial({
                vertexShader: shared.vertexShader,
                fragmentShader: shared.fragmentShader,
                uniforms: { ...shared.uniforms, uTexture: { value: this.texture }, uTextureSize: { value: this.texture.image.width } },
                side: shared.side
            })

            // Create mesh
            this.mesh = new THREE.Mesh(this.geometry, this.material)
            const shadows = View.getInstance().shadows
            shadows.addCaster(this.mesh, shadows.depthMaterial, true)
            this.scene.add(this.mesh)

            this.created = true
        }
    }

    createTexture() {
        // size from the data itself: chunks made before a quality change keep their resolution
        const size = Math.round(Math.sqrt(this.terrainState.texture.length / 4))
        const texture = new THREE.DataTexture(
            this.terrainState.texture,
            size,
            size,
            THREE.RGBAFormat,
            THREE.FloatType,
            THREE.UVMapping,
            THREE.ClampToEdgeWrapping,
            THREE.ClampToEdgeWrapping,
            THREE.NearestFilter,
            THREE.NearestFilter
        )
        texture.flipY = false
        texture.needsUpdate = true
        return texture
    }

    update() {

    }

    destroy() {
        if (this.created) {
            this.geometry.dispose()
            this.texture.dispose()
            this.material.dispose()
            this.scene.remove(this.mesh)
        }
    }
}
