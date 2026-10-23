/**
 * The captured mouse's movement, cleaned of what Firefox on Wayland adds to it.
 *
 * There, every movement comes with a second event carrying the pointer's offset from where it
 * was captured, not a movement (known Firefox faults on Wayland: bugzilla 1680397, 1598967).
 * Logged on the owner's machine, the mouse moving steadily:
 *     1,-1 · 107,-112 · 1,-1 · 108,-113 · 1,-1 · 109,-114 ...          (pixel ratio 1)
 *     63,-36 · 217,32 · 63,-36 · 245,16 ...                              (pixel ratio 2.22)
 *     28,2 · 863,-60 · 20,2 · 863,-58 ...                                (x held at the screen's edge)
 * Each offset is the one before plus the movement between them (the offsets in CSS pixels,
 * the movement in the screen's own: divided by the pixel ratio), or the same as the one before
 * on an axis where the pointer has reached the edge of the screen. Their time stamps can't be
 * trusted (the movement's earlier in one session, minus infinity in another).
 *
 * So the offsets are told by that: once the sum holds on every other event a few times running
 * (a mouse speeding up, 10 20 30, gives one sum, not a run of them every other event), every
 * other event is dropped. The two kinds don't always alternate (now and then two movements come
 * together), so the sums are watched on both halves: when they turn up on the other half, the
 * dropping follows them there. Just after a capture the first events are held back (at most 80
 * ms) while this is decided. Without a second stream (other browsers and systems), every
 * movement passes as it came.
 */

type Move = { x: number, y: number }

const HOLD = 10              // events held back after a capture while it's decided
const WAIT = 80              // ms at most that events are held (a short movement still comes out)
const PROVE = 3              // sums, every other event, to start dropping
const LOSE = 12              // events in a row without an offset to stop
const EDGE = 100             // a held value this far from the capture point is the screen's edge

export default class MouseFilter {
    private events: Move[] = []          // the last few, as they came
    private count = 0                    // events since the capture
    private held: Move[] | null = []
    private heldSince = 0
    private ratio = 1
    private doubled = false
    private run = 0                      // sums in a row, every other event (before they're proven)
    private lastSum = - 10               // the count of the last of them
    private offset: Move = { x: 0, y: 0 }  // once proven: the last offset
    private since: Move = { x: 0, y: 0 }   // and the movement since it
    private quiet = 0                    // events since an offset

    /** A new capture: start over. */
    reset() {
        this.events = []
        this.count = 0
        this.held = []
        this.doubled = false
        this.run = 0
        this.lastSum = - 10
    }

    /** One movement in (as reported); the movements to apply out (CSS pixels). */
    push(x: number, y: number, ratio: number): Move[] {
        const move = { x, y }
        this.ratio = ratio
        const index = this.count++
        if (this.held && this.held.length === 0)
            this.heldSince = performance.now()

        let keep = true
        if (this.doubled) {
            // an offset: the last one plus the movement since (or, far out, near the last one)
            if (isOffset(this.offset, this.since, move, ratio) || looksLikeOffset(this.offset, move)) {
                keep = false
                this.offset = move
                this.since = { x: 0, y: 0 }
                this.quiet = 0
            }
            else {
                this.since.x += x
                this.since.y += y
                if (++this.quiet >= LOSE)
                    this.doubled = false
            }
        }
        else {
            // a sum of the two before, every other event (a mouse speeding up, 10 20 30 50, gives
            // sums one after another: not this)
            const n = this.events.length
            const sum = n >= 2 && isOffset(this.events[n - 2], this.events[n - 1], move, ratio)
            if (sum) {
                const gap = index - this.lastSum
                this.run = gap === 2 ? this.run + 1 : gap === 1 ? 0 : 1
                this.lastSum = index
            }
            else if (index - this.lastSum > 2)
                this.run = 0
            if (this.run >= PROVE) {
                this.doubled = true
                this.offset = move
                this.since = { x: 0, y: 0 }
                this.quiet = 0
                keep = false
            }
        }
        this.events.push(move)
        if (this.events.length > 4)
            this.events.shift()

        if (this.held) {
            this.held.push(move)
            if (this.held.length < HOLD && !this.doubled)
                return []
            return this.release(index)
        }
        return keep ? [this.css(move)] : []
    }

    /** Held events kept too long (a short movement just after the capture): let them out. */
    flush(): Move[] {
        if (!this.held || !this.held.length || performance.now() - this.heldSince < WAIT)
            return []
        return this.release(this.count - 1)
    }

    private release(last: number) {
        const held = this.held!
        this.held = null
        if (!this.doubled)
            return held.map((m) => this.css(m))
        // the offsets alternate with the movements up to the proof: every other one back from it
        const first = last - held.length + 1
        const parity = this.lastSum % 2
        return held.filter((_, i) => (first + i) % 2 !== parity).map((m) => this.css(m))
    }

    private css(m: Move) {
        return { x: m.x / this.ratio, y: m.y / this.ratio }
    }
}

/**
 * `next` is the pointer's offset after `offset` and the movement `move` since: on each axis the
 * one before plus the movement (rounding: 2 px and 8 %), or, far out, the same as the one before
 * (held at the screen's edge). Not when all of it is tiny (nothing to tell).
 */
function isOffset(offset: Move, move: Move, next: Move, ratio: number) {
    if (Math.abs(next.x) + Math.abs(next.y) < 6)
        return false
    const axis = (o: number, m: number, v: number) => {
        const step = m / ratio
        if (Math.abs(v - (o + step)) <= 2 + Math.abs(step) * 0.08)
            return true
        return Math.abs(v - o) <= 1 && Math.abs(v) >= EDGE
    }
    return axis(offset.x, move.x, next.x) && axis(offset.y, move.y, next.y)
}

/** Far out and close to the last offset: an offset even where the sum missed (the edge, a lost event). */
function looksLikeOffset(offset: Move, move: Move) {
    const size = Math.abs(move.x) + Math.abs(move.y)
    return size >= EDGE && Math.abs(move.x - offset.x) + Math.abs(move.y - offset.y) < size * 0.25
}
