import { EventEmitter } from 'events'

/**
 * Player-facing settings (the settings menu): character, graphics quality, grass style.
 * Remembered in localStorage when it's available; everything works without it.
 */

export const CHARACTERS = {
    male_ranger: 'Ranger',
    female_ranger: 'Ranger (female)',
    male_peasant: 'Villager',
    female_peasant: 'Villager (female)'
} as const

export const QUALITIES = {
    lowest: 'Very low',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    ultra: 'Ultra'
} as const

export const GRASS_STYLES = {
    meadow: 'Meadow',
    wild: 'Wild & tall',
    flowers: 'Wildflowers',
    steppe: 'Dry steppe',
    none: 'No grass'
} as const

export const RESOLUTIONS = {
    auto: 'Auto',
    full: 'Full',
    '75': '75 %',
    '50': '50 %'
} as const

// frames drawn a second at most: fewer, the less the graphics card works (cooler, quieter, a
// laptop's battery lasts longer); 'display' draws every frame the screen shows
export const FRAME_RATES = {
    '30': '30',
    '60': '60',
    display: 'Screen\'s'
} as const

export const ANTIALIASING = {
    smaa: 'SMAA',
    taa: 'Temporal'
} as const

export const THREADS = {
    auto: 'Auto',
    '1': '1',
    '2': '2',
    '4': '4',
    '8': '8'
} as const

export const WEATHERS = {
    auto: 'Changing',
    clear: 'Clear',
    cloudy: 'Cloudy',
    overcast: 'Overcast',
    rain: 'Rain',
    storm: 'Storm'
} as const

export const MOUSE_LOOK = {
    capture: 'Click to capture',
    drag: 'Drag to look'
} as const

export const DAY_LENGTHS = {
    '10': '10 min',
    '20': '20 min',
    '40': '40 min',
    frozen: 'Frozen'
} as const

export type CharacterName = keyof typeof CHARACTERS
export type Quality = keyof typeof QUALITIES
export type GrassStyle = keyof typeof GRASS_STYLES
export type DayLength = keyof typeof DAY_LENGTHS
export type Resolution = keyof typeof RESOLUTIONS
export type Weather = keyof typeof WEATHERS
export type Antialiasing = keyof typeof ANTIALIASING
export type FrameRate = keyof typeof FRAME_RATES
export type Threads = keyof typeof THREADS
export type MouseLook = keyof typeof MOUSE_LOOK

type Values = {
    character: CharacterName
    quality: Quality
    grass: GrassStyle
    dayLength: DayLength
    resolution: Resolution
    frameRate: FrameRate
    weather: Weather
    volume: number
    muted: boolean
    volumeAmbience: number
    volumeNature: number
    volumeBody: number
    volumeTools: number
    volumeWeather: number
    textureCompression: boolean
    hideHidden: boolean
    antialiasing: Antialiasing
    threads: Threads
    hood: boolean
    mouseLook: MouseLook
    mouseSpeed: number          // a factor on how far the mouse turns the camera
}

const STORAGE_KEY = 'generate-infinite:settings'

const defaults: Values = {
    character: 'male_ranger',
    quality: 'medium',
    grass: 'meadow',
    dayLength: '20',
    resolution: 'auto',
    frameRate: '60',
    weather: 'auto',
    volume: 0.6,
    muted: false,
    volumeAmbience: 0.7,
    volumeNature: 0.8,
    volumeBody: 0.8,
    volumeTools: 0.9,
    volumeWeather: 0.8,
    textureCompression: true,
    hideHidden: true,
    antialiasing: 'smaa',
    threads: 'auto',
    hood: true,
    mouseLook: 'drag',
    mouseSpeed: 1
}

/**
 * The graphics card's name. Firefox gives it as the context's RENDERER (its renderer-info
 * extension is deprecated there and will go); Chrome and Safari give a generic name there and
 * the real one only through the extension.
 */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    const plain = String(gl.getParameter(gl.RENDERER))
    if (!/^(webkit webgl|mozilla)$/i.test(plain.trim()))
        return plain
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : plain
}

/**
 * A starting quality for this graphics card: integrated chips (Intel) get low, dedicated
 * NVIDIA and AMD cards high, anything else medium. (Firefox reports a representative model
 * per vendor, so only the vendor and family are reliable.)
 */
function suggestedQuality(): Quality {
    try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' })
        if (!gl)
            return 'lowest'
        const name = rendererName(gl)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        if (/nvidia|geforce|quadro|rtx/i.test(name)) return 'high'
        if (/radeon.*(rx|pro)|amd.*rx/i.test(name)) return 'high'
        if (/iris\s*xe|apple m\d/i.test(name)) return 'medium'
        // drawn by the processor, not a graphics card
        if (/llvmpipe|swiftshader|softpipe|software|basic render/i.test(name)) return 'lowest'
        if (/intel|uhd|hd graphics|mesa/i.test(name)) return 'low'
        return 'medium'
    }
    catch {
        return 'medium'
    }
}

export default class Settings {
    static instance: Settings

    static getInstance() {
        if (!Settings.instance)
            Settings.instance = new Settings()
        return Settings.instance
    }

    events = new EventEmitter()
    values: Values

    private constructor() {
        const stored = this.load()
        // first visit: a quality to suit the graphics card (changeable in the menu)
        this.values = { ...defaults, quality: stored.quality ?? suggestedQuality(), ...stored }
    }

    get<K extends keyof Values>(key: K): Values[K] {
        return this.values[key]
    }

    set<K extends keyof Values>(key: K, value: Values[K]) {
        if (this.values[key] === value)
            return
        this.values[key] = value
        this.save()
        this.events.emit('change', key, value)
        this.events.emit(`change:${key}`, value)
    }

    /** Back to the default value. */
    reset<K extends keyof Values>(key: K) {
        this.set(key, defaults[key])
    }

    private load(): Partial<Values> {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
            const valid: Partial<Values> = {}
            if (stored.character in CHARACTERS) valid.character = stored.character
            if (stored.quality in QUALITIES) valid.quality = stored.quality
            if (stored.grass in GRASS_STYLES) valid.grass = stored.grass
            if (stored.dayLength in DAY_LENGTHS) valid.dayLength = stored.dayLength
            if (stored.resolution in RESOLUTIONS) valid.resolution = stored.resolution
            if (stored.frameRate in FRAME_RATES) valid.frameRate = stored.frameRate
            if (stored.weather in WEATHERS) valid.weather = stored.weather
            if (typeof stored.textureCompression === 'boolean') valid.textureCompression = stored.textureCompression
            if (typeof stored.hideHidden === 'boolean') valid.hideHidden = stored.hideHidden
            if (stored.antialiasing in ANTIALIASING) valid.antialiasing = stored.antialiasing
            if (stored.threads in THREADS) valid.threads = stored.threads
            if (typeof stored.muted === 'boolean') valid.muted = stored.muted
            if (typeof stored.hood === 'boolean') valid.hood = stored.hood
            for (const key of ['volumeAmbience', 'volumeNature', 'volumeBody', 'volumeTools', 'volumeWeather'] as const)
                if (typeof stored[key] === 'number' && stored[key] >= 0 && stored[key] <= 1) valid[key] = stored[key]
            if (typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1) valid.volume = stored.volume
            return valid
        }
        catch {
            return {}
        }
    }

    private save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values))
        }
        catch {
            // private window / storage blocked: settings just aren't remembered
        }
    }
}
