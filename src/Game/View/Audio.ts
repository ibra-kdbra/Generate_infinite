import * as THREE from 'three'

import View from './View'
import State from '../State/State'
import Settings from '../Settings'
import { WATER_LEVEL } from '../Workers/TerrainShape'

export type Sound = 'swing' | 'heavySwing' | 'hitWood' | 'hitRock' | 'dig' | 'reap' | 'bowDraw' | 'bowRelease' | 'arrowHit'
    | 'treeFall' | 'step' | 'land' | 'splash' | 'equip' | 'jump' | 'snort'

/**
 * Every sound is made here, from oscillators and filtered noise (WebAudio): nothing to
 * download. The ambience follows the world: wind rising with the wind speed, storms and
 * height, rain hissing and pattering, birdsong by day near trees, crickets at night. The
 * character's footsteps follow the walk cycle (grass, or water when wading), landings thud,
 * swimming splashes. Tools whoosh, chop, clang off rock, dig and twang; trees creak and crash;
 * thunder rolls in after the lightning. World sounds pan and fade with direction and
 * distance. Starts on the first click or key (browsers require it).
 */
export default class Audio {
    view: View
    state: State
    context: AudioContext | null = null
    private master!: GainNode
    private white!: AudioBuffer
    private brown!: AudioBuffer
    private wind!: { gain: GainNode, filter: BiquadFilterNode }
    private rain!: { gain: GainNode, patter: GainNode }
    private settings = Settings.getInstance()
    private nextBird = 2
    private nextCricket = 1
    private lastPhase = 0
    private wasGrounded = true
    private wasSwimming = false
    private fall = 0
    private strokeTime = 0

    constructor() {
        this.view = View.getInstance()
        this.state = State.getInstance()
        const start = () => {
            this.start()
            window.removeEventListener('pointerdown', start)
            window.removeEventListener('keydown', start)
        }
        window.addEventListener('pointerdown', start)
        window.addEventListener('keydown', start)
        document.addEventListener('visibilitychange', () => {
            if (!this.context) return
            if (document.hidden) this.context.suspend()
            else this.context.resume()
        })
        this.settings.events.on('change:volume', () => this.applyVolume())
        this.view.weather.events.add((event, delay, strength) => {
            if (event === 'thunder')
                setTimeout(() => this.thunder(strength), delay * 1000)
        })
    }

    private start() {
        if (this.context)
            return
        const context = new AudioContext()
        this.context = context
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = - 14
        compressor.ratio.value = 4
        this.master = context.createGain()
        this.master.connect(compressor).connect(context.destination)
        this.applyVolume()

        // noise: white, and brown (deeper, for wind, rumbles, thuds)
        const length = context.sampleRate * 3
        this.white = context.createBuffer(1, length, context.sampleRate)
        this.brown = context.createBuffer(1, length, context.sampleRate)
        const white = this.white.getChannelData(0), brown = this.brown.getChannelData(0)
        let last = 0
        for (let i = 0; i < length; i++) {
            white[i] = Math.random() * 2 - 1
            last = (last + 0.02 * white[i]) / 1.02
            brown[i] = last * 3.5
        }

        // wind: brown noise, darker or brighter with its strength
        const windSource = this.loop(this.brown)
        const windFilter = context.createBiquadFilter()
        windFilter.type = 'lowpass'
        windFilter.Q.value = 0.8
        const windGain = context.createGain()
        windGain.gain.value = 0
        windSource.connect(windFilter).connect(windGain).connect(this.master)
        this.wind = { gain: windGain, filter: windFilter }

        // rain: a hiss and a softer patter
        const hiss = this.loop(this.white)
        const high = context.createBiquadFilter()
        high.type = 'highpass'
        high.frequency.value = 700
        const low = context.createBiquadFilter()
        low.type = 'lowpass'
        low.frequency.value = 7000
        const rainGain = context.createGain()
        rainGain.gain.value = 0
        hiss.connect(high).connect(low).connect(rainGain).connect(this.master)
        const patterSource = this.loop(this.brown, 1.7)
        const patterFilter = context.createBiquadFilter()
        patterFilter.type = 'bandpass'
        patterFilter.frequency.value = 900
        const patter = context.createGain()
        patter.gain.value = 0
        patterSource.connect(patterFilter).connect(patter).connect(this.master)
        this.rain = { gain: rainGain, patter }
    }

    private applyVolume() {
        if (this.context)
            this.master.gain.setTargetAtTime(this.settings.get('volume'), this.context.currentTime, 0.05)
    }

    private loop(buffer: AudioBuffer, rate = 1) {
        const source = this.context!.createBufferSource()
        source.buffer = buffer
        source.loop = true
        source.playbackRate.value = rate
        source.loopStart = Math.random() * 2
        source.start(0, Math.random() * 2)
        return source
    }

    // ── building blocks ──

    /** Where a world point is heard: a stereo pan and a level by distance (null: too far). */
    private place(at?: THREE.Vector3, range = 60) {
        const context = this.context!
        const panner = context.createStereoPanner()
        let level = 1
        if (at) {
            const camera = this.view.camera.instance
            const offset = at.clone().sub(camera.position)
            const distance = offset.length()
            if (distance > range)
                return null
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
            panner.pan.value = THREE.MathUtils.clamp(offset.normalize().dot(right), - 1, 1) * 0.8
            level = 1 / (1 + distance * distance / 60)
        }
        panner.connect(this.master)
        return { panner, level }
    }

    /** A burst of noise through a filter, with a quick attack and an exponential decay. */
    private noise(output: AudioNode, options: { brown?: boolean, type: BiquadFilterType, frequency: number, toFrequency?: number, q?: number, gain: number, attack?: number, duration: number, rate?: number, delay?: number }) {
        const context = this.context!
        const t = context.currentTime + (options.delay ?? 0)
        const source = context.createBufferSource()
        source.buffer = options.brown ? this.brown : this.white
        source.playbackRate.value = options.rate ?? 1
        const filter = context.createBiquadFilter()
        filter.type = options.type
        filter.frequency.setValueAtTime(options.frequency, t)
        if (options.toFrequency)
            filter.frequency.exponentialRampToValueAtTime(options.toFrequency, t + options.duration)
        filter.Q.value = options.q ?? 1
        const gain = context.createGain()
        const attack = options.attack ?? 0.005
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(options.gain, t + attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + options.duration)
        source.connect(filter).connect(gain).connect(output)
        source.start(t, Math.random() * 2)
        source.stop(t + options.duration + 0.05)
    }

    /** A tone gliding from one pitch to another, decaying. */
    private tone(output: AudioNode, options: { type?: OscillatorType, frequency: number, toFrequency?: number, gain: number, attack?: number, duration: number, delay?: number }) {
        const context = this.context!
        const t = context.currentTime + (options.delay ?? 0)
        const oscillator = context.createOscillator()
        oscillator.type = options.type ?? 'sine'
        oscillator.frequency.setValueAtTime(options.frequency, t)
        if (options.toFrequency)
            oscillator.frequency.exponentialRampToValueAtTime(options.toFrequency, t + options.duration)
        const gain = context.createGain()
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(options.gain, t + (options.attack ?? 0.005))
        gain.gain.exponentialRampToValueAtTime(0.0001, t + options.duration)
        oscillator.connect(gain).connect(output)
        oscillator.start(t)
        oscillator.stop(t + options.duration + 0.05)
    }

    // ── sounds ──

    /** A one-shot, at a world point (or on the player when none is given). */
    play(sound: Sound, at?: THREE.Vector3, strength = 1) {
        if (!this.context || this.context.state !== 'running')
            return
        const where = this.place(at)
        if (!where)
            return
        const out = where.panner
        const k = where.level * strength
        const vary = () => 0.9 + Math.random() * 0.2
        switch (sound) {
            case 'swing':
                this.noise(out, { type: 'bandpass', frequency: 500 * vary(), toFrequency: 1900 * vary(), q: 1.4, gain: 0.35 * k, attack: 0.08, duration: 0.24 })
                break
            case 'heavySwing':
                this.noise(out, { type: 'bandpass', frequency: 260 * vary(), toFrequency: 900 * vary(), q: 1.1, gain: 0.45 * k, attack: 0.1, duration: 0.32 })
                break
            case 'hitWood':
                this.tone(out, { frequency: 150 * vary(), toFrequency: 70, gain: 0.7 * k, duration: 0.18 })
                this.noise(out, { type: 'lowpass', frequency: 2600, gain: 0.5 * k, duration: 0.05 })
                this.noise(out, { brown: true, type: 'lowpass', frequency: 500, gain: 0.4 * k, duration: 0.2 })
                break
            case 'hitRock':
                for (const f of [1460, 2330, 3180, 4410])
                    this.tone(out, { frequency: f * vary(), gain: 0.12 * k, duration: 0.45 + Math.random() * 0.2 })
                this.noise(out, { type: 'highpass', frequency: 3000, gain: 0.35 * k, duration: 0.05 })
                break
            case 'dig':
                this.noise(out, { brown: true, type: 'lowpass', frequency: 900, gain: 0.8 * k, duration: 0.22 })
                this.noise(out, { type: 'bandpass', frequency: 1800, q: 0.6, gain: 0.12 * k, duration: 0.15, delay: 0.03 })
                break
            case 'reap':
                this.noise(out, { type: 'highpass', frequency: 2600 * vary(), gain: 0.18 * k, attack: 0.02, duration: 0.14 })
                break
            case 'bowDraw':
                this.noise(out, { brown: true, type: 'bandpass', frequency: 320, q: 6, gain: 0.08 * k, attack: 0.25, duration: 0.6, rate: 0.6 })
                break
            case 'bowRelease':
                this.tone(out, { type: 'sawtooth', frequency: 118 * vary(), toFrequency: 96, gain: 0.18 * k, duration: 0.3 })
                this.tone(out, { frequency: 236, toFrequency: 190, gain: 0.25 * k, duration: 0.22 })
                this.noise(out, { type: 'bandpass', frequency: 2400, toFrequency: 900, q: 1.5, gain: 0.2 * k, duration: 0.16 })
                break
            case 'arrowHit':
                this.tone(out, { frequency: 240 * vary(), toFrequency: 130, gain: 0.5 * k, duration: 0.12 })
                this.noise(out, { type: 'bandpass', frequency: 1600, gain: 0.3 * k, duration: 0.05 })
                break
            case 'treeFall':
                // a long creak, then the crash
                this.tone(out, { type: 'sawtooth', frequency: 58, toFrequency: 42, gain: 0.08 * k, attack: 0.3, duration: 1.4 })
                this.noise(out, { brown: true, type: 'lowpass', frequency: 260, gain: 1.0 * k, attack: 0.02, duration: 1.8, delay: 1.2 })
                this.noise(out, { type: 'bandpass', frequency: 1400, q: 0.5, gain: 0.35 * k, attack: 0.01, duration: 0.9, delay: 1.22 })
                break
            case 'step':
                this.noise(out, { type: 'bandpass', frequency: 1100 * vary(), q: 0.8, gain: 0.1 * k, duration: 0.08 })
                this.noise(out, { brown: true, type: 'lowpass', frequency: 300, gain: 0.12 * k, duration: 0.07 })
                break
            case 'jump':
                this.noise(out, { type: 'bandpass', frequency: 900, q: 0.7, gain: 0.08 * k, duration: 0.1 })
                break
            case 'land':
                this.noise(out, { brown: true, type: 'lowpass', frequency: 420, gain: 0.5 * k, duration: 0.22 })
                this.noise(out, { type: 'bandpass', frequency: 1200, q: 0.7, gain: 0.14 * k, duration: 0.1 })
                break
            case 'splash':
                this.noise(out, { type: 'bandpass', frequency: 700, toFrequency: 2400, q: 0.8, gain: 0.4 * k, attack: 0.01, duration: 0.35 })
                this.noise(out, { brown: true, type: 'lowpass', frequency: 600, gain: 0.3 * k, duration: 0.25 })
                break
            case 'snort':
                // a deer's alarm: a sharp nasal blow, then the hooves drumming away
                this.noise(out, { type: 'bandpass', frequency: 900, toFrequency: 500, q: 2, gain: 0.5 * k, attack: 0.01, duration: 0.3 })
                for (let i = 0; i < 10; i++)
                    this.noise(out, { brown: true, type: 'lowpass', frequency: 260, gain: 0.25 * k * (1 - i / 12), duration: 0.08, delay: 0.25 + i * 0.12 + Math.random() * 0.03 })
                break
            case 'equip':
                this.noise(out, { type: 'bandpass', frequency: 2000, q: 1.2, gain: 0.08 * k, attack: 0.03, duration: 0.18 })
                this.tone(out, { frequency: 2600, gain: 0.03 * k, duration: 0.25, delay: 0.12 })
                break
        }
    }

    private thunder(strength: number) {
        if (!this.context || this.context.state !== 'running')
            return
        const where = this.place()!
        if (strength > 0.6)
            this.noise(where.panner, { type: 'highpass', frequency: 1200, gain: 0.5 * strength, duration: 0.25 })
        this.noise(where.panner, { brown: true, type: 'lowpass', frequency: 160, gain: 1.1 * strength, attack: 0.25, duration: 4 + Math.random() * 3, rate: 0.7 })
        this.noise(where.panner, { brown: true, type: 'lowpass', frequency: 90, gain: 0.8 * strength, attack: 0.6, duration: 6, rate: 0.5, delay: 0.4 })
    }

    private chirp() {
        const where = this.place()!
        where.panner.pan.value = Math.random() * 1.6 - 0.8
        const base = 2800 + Math.random() * 2200
        const notes = 2 + Math.floor(Math.random() * 4)
        const level = 0.025 + Math.random() * 0.03
        for (let i = 0; i < notes; i++)
            this.tone(where.panner, { frequency: base * (0.9 + Math.random() * 0.25), toFrequency: base * (Math.random() < 0.5 ? 1.35 : 0.75), gain: level, attack: 0.01, duration: 0.07 + Math.random() * 0.06, delay: i * (0.09 + Math.random() * 0.05) })
    }

    private cricket() {
        const where = this.place()!
        where.panner.pan.value = Math.random() * 1.6 - 0.8
        const level = 0.012 + Math.random() * 0.01
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++)
            this.tone(where.panner, { frequency: 4300 + Math.random() * 300, gain: level, attack: 0.004, duration: 0.03, delay: i * 0.07 })
    }

    update() {
        if (!this.context || this.context.state !== 'running')
            return
        const dt = Math.min(this.state.time.delta, 0.1)
        const t = this.context.currentTime
        const player = this.state.player
        const weather = this.view.weather
        const sky = this.view.sky
        const p = player.position.current

        // ── ambience ──
        const height = THREE.MathUtils.smoothstep(p[1] - WATER_LEVEL, 20, 160)
        const windiness = THREE.MathUtils.clamp(sky.wind.speed / 40, 0, 1) * 0.5 + height * 0.4 + weather.storm * 0.6
        this.wind.gain.gain.setTargetAtTime(0.05 + windiness * 0.22, t, 0.5)
        this.wind.filter.frequency.setTargetAtTime(240 + windiness * 900 + Math.sin(this.state.time.elapsed * 0.35) * 80 * windiness, t, 0.6)
        this.rain.gain.gain.setTargetAtTime(weather.rain * 0.22, t, 0.6)
        this.rain.patter.gain.setTargetAtTime(weather.rain * 0.3, t, 0.6)

        const day = THREE.MathUtils.smoothstep(this.state.sun.position.y, 0.0, 0.15)
        const night = 1 - THREE.MathUtils.smoothstep(this.state.sun.position.y, - 0.12, 0.02)
        const forest = this.state.vegetation.forestAt(p[0], p[2])
        this.nextBird -= dt
        if (this.nextBird <= 0) {
            this.nextBird = (1.2 + Math.random() * 4) / Math.max(0.15, forest + 0.3)
            if (day > 0.3 && weather.rain < 0.3 && Math.random() < day)
                this.chirp()
        }
        this.nextCricket -= dt
        if (this.nextCricket <= 0) {
            this.nextCricket = 0.35 + Math.random() * 0.9
            if (night > 0.5 && weather.rain < 0.3)
                this.cricket()
        }

        // ── the character ──
        const gait = this.view.player.gait
        const half = Math.floor(gait.phase * 2)          // a foot comes down twice per cycle
        if (player.grounded && player.speed > 0.6 && !player.sliding && half !== this.lastPhase) {
            const wading = p[1] < WATER_LEVEL
            const strength = THREE.MathUtils.clamp(player.speed / 8, 0.35, 1.1)
            this.play(wading ? 'splash' : 'step', undefined, wading ? strength * 0.4 : strength)
        }
        this.lastPhase = half
        if (!player.grounded && !player.swimming && !player.climbing)
            this.fall = Math.max(this.fall, - player.velocity[1])
        if (player.grounded && !this.wasGrounded) {
            if (this.fall > 4) this.play('land', undefined, THREE.MathUtils.clamp(this.fall / 14, 0.3, 1.3))
            this.fall = 0
        }
        if (!player.grounded && this.wasGrounded && player.velocity[1] > 2)
            this.play('jump')
        this.wasGrounded = player.grounded || player.climbing
        if (player.swimming && !this.wasSwimming)
            this.play('splash', undefined, 1.2)
        this.wasSwimming = player.swimming
        if (player.swimming && player.speed > 0.5) {
            this.strokeTime -= dt
            if (this.strokeTime <= 0) {
                this.strokeTime = 0.7
                this.play('splash', undefined, 0.35)
            }
        }
    }
}
