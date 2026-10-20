/**
 * The captured mouse's movement, cleaned of what Firefox on Wayland adds to it.
 *
 * There, every movement comes with a second event carrying the pointer's offset from where it
 * was captured, not a movement. Logged on the owner's machine, the mouse moving steadily:
 *     1,-1 · 107,-112 · 1,-1 · 108,-113 · 1,-1 · 109,-114 ...          (pixel ratio 1)
 *     2 · -151 · 4 · -149 · 2 · -148 · 4 · -145 ...                      (pixel ratio 2.22)
 * Each offset is the one before plus the movement between them (the offsets in CSS pixels,
 * the movement in the screen's own: divided by the pixel ratio). Their time stamps can't be
 * trusted (earlier than the movement's in one session, the movement stamped minus infinity in
 * another), so the offsets are told by that sum: once it holds on every other event a few times
 * running (a mouse speeding up, 10, 20, 30, is never taken for them: that's one sum, not one
 * every other event), every other event is dropped until the sums stop. Just after a capture the
 * first events are held back (a few hundredths of a second) while this is decided, so no offset
 * gets through as a jump. Without such a second stream (other browsers and systems), every
 * movement passes as it came.
 */

type Move = { x: number, y: number }

const HOLD = 10              // events held back after a capture while it's decided (three sums every other event, after whatever came first, need up to 9)
const PROVE = 3              // sums in a row, every other event, to start dropping
const LOSE = 3               // sums missed in a row (where the offsets come) to stop
const WAIT = 80              // ms at most that events are held (a short movement still comes out)

export default class MouseFilter {
    private events: Move[] = []          // the last few, as they came
    private count = 0                    // events since the capture
    private held: Move[] | null = []
    private doubled = false
    private parity = 0                   // offsets are the events with count % 2 === parity
    private lastSum = - 10               // the count of the last event that was an offset's sum
    private run = 0                      // sums in a row, every other event
    private missed = 0
    private heldSince = 0
    private ratio = 1

    /** A new capture: start over. */
    reset() {
        this.events = []
        this.count = 0
        this.held = []
        this.doubled = false
        this.lastSum = - 10
        this.run = 0
        this.missed = 0
    }

    /** One movement in (as reported); the movements to apply out (CSS pixels). */
    push(x: number, y: number, ratio: number): Move[] {
        const move = { x, y }
        this.ratio = ratio
        if (this.held && !this.held.length)
            this.heldSince = performance.now()
        const index = this.count++
        const sum = this.events.length >= 2 && isSum(this.events[this.events.length - 2], this.events[this.events.length - 1], move, ratio)
        this.events.push(move)
        if (this.events.length > 4)
            this.events.shift()
        const css = (m: Move) => ({ x: m.x / ratio, y: m.y / ratio })

        // the offset sums: in a run every other event?
        if (sum) {
            this.run = index - this.lastSum === 2 ? this.run + 1 : 1
            this.lastSum = index
        }
        else if (index - this.lastSum > 2)
            this.run = 0
        if (!this.doubled && this.run >= PROVE) {
            this.doubled = true
            this.parity = index % 2
            this.missed = 0
        }

        let out: Move[]
        if (this.doubled && index % 2 === this.parity) {
            // where an offset comes: dropped, unless the sums have stopped
            if (sum)
                this.missed = 0
            else if (++this.missed >= LOSE)
                this.doubled = false
            out = this.doubled ? [] : [css(move)]
        }
        else
            out = [css(move)]

        // just after the capture: hold everything until it's decided, then let out what's real
        if (this.held) {
            this.held.push(move)
            if (this.held.length < HOLD && !this.doubled)
                return []
            const held = this.held
            this.held = null
            const first = index - held.length + 1
            return held.filter((_, i) => !(this.doubled && (first + i) % 2 === this.parity)).map(css)
        }
        return out
    }

    /** Held events kept too long (a short movement just after the capture): let them out as they are. */
    flush(): Move[] {
        if (!this.held || !this.held.length || performance.now() - this.heldSince < WAIT)
            return []
        const held = this.held
        this.held = null
        return held.map((m) => ({ x: m.x / this.ratio, y: m.y / this.ratio }))
    }
}

/** `next` is `offset` plus the movement `move` between them, each axis within 1.5 CSS px (and not all three tiny). */
function isSum(offset: Move, move: Move, next: Move, ratio: number) {
    if (Math.abs(next.x) + Math.abs(next.y) < 6)
        return false
    const x = offset.x + move.x / ratio, y = offset.y + move.y / ratio
    return Math.abs(next.x - x) <= 1.5 && Math.abs(next.y - y) <= 1.5
}
