import * as THREE from 'three'
import { PointTextHelper } from '@jniac/three-point-text-helper'

import View from './View'
import State from '../State/State'
import ChunkState from '../State/Chunk'

export default class ChunkHelper {
    state: State
    view: View
    scene: THREE.Scene
    chunkState: ChunkState
    areaVisible: boolean
    idVisible: boolean
    neighboursIdVisible: boolean
    group!: THREE.Group
    area!: THREE.Mesh
    id!: PointTextHelper
    neighboursIds!: PointTextHelper

    constructor(chunkSate: ChunkState) {
        this.state = State.getInstance()
        this.view = View.getInstance()
        this.scene = this.view.scene

        this.chunkState = chunkSate

        this.areaVisible = true
        this.idVisible = true
        this.neighboursIdVisible = true

        // this.setGroup()
        // this.setArea()
        // this.setId()
        // this.setNeighboursIds()
    }

    setGroup() {
        this.group = new THREE.Group()
        this.group.position.x = this.chunkState.x
        this.group.position.z = this.chunkState.z
        this.scene.add(this.group)
    }

    destroyGroup() {
        if (!this.group)
            return

        this.scene.remove(this.group)
    }

    setArea() {
        this.destroyArea()

        if (!this.areaVisible)
            return

        this.area = new THREE.Mesh(
            new THREE.PlaneGeometry(this.chunkState.size, this.chunkState.size),
            new THREE.MeshBasicMaterial({ wireframe: true })
        )
        this.area.geometry.rotateX(Math.PI * 0.5)

            ; (this.area.material as THREE.MeshBasicMaterial).color.multiplyScalar((this.chunkState.depth + 1) / (this.state.chunks.maxDepth))

        this.group.add(this.area)
    }

    destroyArea() {
        if (!this.area)
            return

        this.area.geometry.dispose()
            ; (this.area.material as THREE.MeshBasicMaterial).dispose()
        this.group.remove(this.area)
    }

    setId() {
        this.destroyId()

        if (!this.idVisible)
            return

        this.id = new PointTextHelper({ charMax: 4 })
            ; (this.id.material as THREE.Material).depthTest = false
            ; (this.id.material as THREE.Material).onBeforeRender = () => { }
        this.id.display({
            text: this.chunkState.id,
            color: '#ffc800',
            size: (this.state.chunks.maxDepth - this.chunkState.depth + 1) * 6,
            position: new THREE.Vector3(0, (this.state.chunks.maxDepth - this.chunkState.depth) * 10, 0)
        })
        this.group.add(this.id)
    }

    destroyId() {
        if (!this.id)
            return

        this.id.geometry.dispose()
            ; (this.id.material as THREE.Material).dispose()
        this.group.remove(this.id)
    }

    setNeighboursIds() {
        this.destroyNeighboursIds()

        if (!this.neighboursIdVisible)
            return

        if (this.chunkState.neighbours.size === 0)
            return

        this.neighboursIds = new PointTextHelper({ charMax: 4 })
            ; (this.neighboursIds.material as THREE.Material).depthTest = false
            ; (this.neighboursIds.material as THREE.Material).onBeforeRender = () => { }
        this.group.add(this.neighboursIds)

        const nChunk = this.chunkState.neighbours.get('n')
        const eChunk = this.chunkState.neighbours.get('e')
        const sChunk = this.chunkState.neighbours.get('s')
        const wChunk = this.chunkState.neighbours.get('w')

        const size = (this.state.chunks.maxDepth - this.chunkState.depth + 1) * 6
        const y = (this.state.chunks.maxDepth - this.chunkState.depth) * 10

        const nLabel = nChunk ? nChunk.id : ''
        this.neighboursIds.display({
            text: nLabel,
            color: '#00bfff',
            size: size,
            position: new THREE.Vector3(
                0,
                y,
                - this.chunkState.quarterSize
            )
        })

        const eLabel = eChunk ? eChunk.id : ''
        this.neighboursIds.display({
            text: eLabel,
            color: '#00bfff',
            size: size,
            position: new THREE.Vector3(
                this.chunkState.quarterSize,
                y,
                0
            )
        })

        const sLabel = sChunk ? sChunk.id : ''
        this.neighboursIds.display({
            text: sLabel,
            color: '#00bfff',
            size: size,
            position: new THREE.Vector3(
                0,
                y,
                this.chunkState.quarterSize
            )
        })

        const wLabel = wChunk ? wChunk.id : ''
        this.neighboursIds.display({
            text: wLabel,
            color: '#00bfff',
            size: size,
            position: new THREE.Vector3(
                - this.chunkState.quarterSize,
                y,
                0
            )
        })
    }

    destroyNeighboursIds() {
        if (!this.neighboursIds)
            return

        this.neighboursIds.geometry.dispose()
            ; (this.neighboursIds.material as THREE.Material).dispose()
        this.group.remove(this.neighboursIds)
    }

    destroy() {
        this.destroyGroup()
        this.destroyArea()
        this.destroyId()
        this.destroyNeighboursIds()
    }
}
