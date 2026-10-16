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
export type Threads = keyof typeof THREADS

type Values = {
    character: CharacterName
    quality: Quality
    grass: GrassStyle
    dayLength: DayLength
    resolution: Resolution
    weather: Weather
    volume: number
    textureCompression: boolean
    hideHidden: boolean
    antialiasing: Antialiasing
    threads: Threads
}

const STORAGE_KEY = 'generate-infinite:settings'

const defaults: Values = {
    character: 'male_ranger',
    quality: 'medium',
    grass: 'meadow',
    dayLength: '20',
    resolution: 'auto',
    weather: 'auto',
    volume: 0.6,
    textureCompression: true,
    hideHidden: true,
    antialiasing: 'smaa',
    threads: 'auto'
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
            return 'low'
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        if (/nvidia|geforce|quadro|rtx/i.test(name)) return 'high'
        if (/radeon.*(rx|pro)|amd.*rx/i.test(name)) return 'high'
        if (/iris\s*xe|apple m\d/i.test(name)) return 'medium'
        if (/intel|uhd|hd graphics|mesa|llvmpipe|swiftshader/i.test(name)) return 'low'
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

    private load(): Partial<Values> {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
            const valid: Partial<Values> = {}
            if (stored.character in CHARACTERS) valid.character = stored.character
            if (stored.quality in QUALITIES) valid.quality = stored.quality
            if (stored.grass in GRASS_STYLES) valid.grass = stored.grass
            if (stored.dayLength in DAY_LENGTHS) valid.dayLength = stored.dayLength
            if (stored.resolution in RESOLUTIONS) valid.resolution = stored.resolution
            if (stored.weather in WEATHERS) valid.weather = stored.weather
            if (typeof stored.textureCompression === 'boolean') valid.textureCompression = stored.textureCompression
            if (typeof stored.hideHidden === 'boolean') valid.hideHidden = stored.hideHidden
            if (stored.antialiasing in ANTIALIASING) valid.antialiasing = stored.antialiasing
            if (stored.threads in THREADS) valid.threads = stored.threads
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
