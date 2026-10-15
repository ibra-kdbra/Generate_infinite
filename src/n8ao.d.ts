// n8ao ships without type declarations: the parts used here (View/Renderer.ts)
declare module 'n8ao' {
    import { Pass } from 'postprocessing'
    import { Camera, Color, Scene } from 'three'

    export class N8AOPostPass extends Pass {
        constructor(scene: Scene, camera: Camera, width?: number, height?: number)
        configuration: {
            aoRadius: number
            distanceFalloff: number
            intensity: number
            color: Color
            halfRes: boolean
            depthAwareUpsampling: boolean
            screenSpaceRadius: boolean
            gammaCorrection: boolean
            transparencyAware: boolean
            aoSamples: number
            denoiseSamples: number
            denoiseRadius: number
        }
        setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' | 'Neural-Low' | 'Neural-Medium' | 'Neural-High'): void
    }
}
