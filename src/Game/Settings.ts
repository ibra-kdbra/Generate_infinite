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

type Values = {
    character: CharacterName
    quality: Quality
    grass: GrassStyle
    dayLength: DayLength
}

const STORAGE_KEY = 'generate-infinite:settings'

const defaults: Values = {
    character: 'male_ranger',
    quality: 'medium',
    grass: 'meadow',
    dayLength: '20'
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
        this.values = { ...defaults, ...this.load() }
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
