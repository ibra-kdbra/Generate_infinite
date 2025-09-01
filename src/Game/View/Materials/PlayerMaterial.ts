import * as THREE from 'three'

import vertexShader from './shaders/player/vertex.glsl'
import fragmentShader from './shaders/player/fragment.glsl'

export default class PlayerMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms:
            {
                uColor: { value: null },
                uLightnessSmoothness: { value: null },
                uSunPosition: { value: null }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader
        })
    }
}
