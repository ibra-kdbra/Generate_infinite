/**
 * GPU texture compression (BC3, also called DXT5), done in the browser so the downloads stay
 * small WebP files: a layer comes in as RGBA pixels and goes back as a full mipmap chain of
 * 4 × 4 blocks the graphics card reads directly, at a quarter of the memory and bandwidth.
 *
 * Each block's colour is fitted along its principal axis (the line through the colours with
 * the most spread), its alpha separately with eight levels. Normal maps are first repacked
 * the usual way for this format: x in alpha (the precise channel), y in green, roughness in
 * red and blue.
 */
type Job = { id: number, data: Uint8Array, size: number, kind: 'albedo' | 'normal' }

const pixels = new Uint8Array(64)

function encodeBlock(source: Uint8Array, width: number, height: number, bx: number, by: number, out: Uint8Array, o: number) {
    // gather the 16 pixels (clamped at the edges of tiny mip levels)
    for (let py = 0; py < 4; py++)
        for (let px = 0; px < 4; px++) {
            const x = Math.min(bx * 4 + px, width - 1), y = Math.min(by * 4 + py, height - 1)
            const s = (y * width + x) * 4, d = (py * 4 + px) * 4
            pixels[d] = source[s]; pixels[d + 1] = source[s + 1]; pixels[d + 2] = source[s + 2]; pixels[d + 3] = source[s + 3]
        }

    // ── alpha: two endpoints, six levels between ──
    let aMin = 255, aMax = 0
    for (let i = 0; i < 16; i++) {
        const a = pixels[i * 4 + 3]
        if (a < aMin) aMin = a
        if (a > aMax) aMax = a
    }
    out[o] = aMax
    out[o + 1] = aMin
    let low = 0, high = 0
    if (aMax > aMin) {
        const scale = 7 / (aMax - aMin)
        for (let i = 0; i < 16; i++) {
            const position = Math.round((aMax - pixels[i * 4 + 3]) * scale)       // 0 at aMax .. 7 at aMin
            const index = position === 0 ? 0 : position === 7 ? 1 : position + 1
            if (i < 8) low |= index << (3 * i)
            else high |= index << (3 * (i - 8))
        }
    }
    out[o + 2] = low & 255; out[o + 3] = (low >> 8) & 255; out[o + 4] = (low >> 16) & 255
    out[o + 5] = high & 255; out[o + 6] = (high >> 8) & 255; out[o + 7] = (high >> 16) & 255

    // ── colour: endpoints along the principal axis ──
    let mr = 0, mg = 0, mb = 0
    for (let i = 0; i < 16; i++) { mr += pixels[i * 4]; mg += pixels[i * 4 + 1]; mb += pixels[i * 4 + 2] }
    mr /= 16; mg /= 16; mb /= 16
    let crr = 0, cgg = 0, cbb = 0, crg = 0, crb = 0, cgb = 0
    for (let i = 0; i < 16; i++) {
        const r = pixels[i * 4] - mr, g = pixels[i * 4 + 1] - mg, b = pixels[i * 4 + 2] - mb
        crr += r * r; cgg += g * g; cbb += b * b; crg += r * g; crb += r * b; cgb += g * b
    }
    let vr = 1, vg = 1, vb = 1
    for (let k = 0; k < 6; k++) {
        const r = crr * vr + crg * vg + crb * vb
        const g = crg * vr + cgg * vg + cgb * vb
        const b = crb * vr + cgb * vg + cbb * vb
        const length = Math.hypot(r, g, b)
        if (length < 1e-6) { vr = 0.577; vg = 0.577; vb = 0.577; break }
        vr = r / length; vg = g / length; vb = b / length
    }
    let tMin = Infinity, tMax = - Infinity
    for (let i = 0; i < 16; i++) {
        const t = (pixels[i * 4] - mr) * vr + (pixels[i * 4 + 1] - mg) * vg + (pixels[i * 4 + 2] - mb) * vb
        if (t < tMin) tMin = t
        if (t > tMax) tMax = t
    }
    const inset = (tMax - tMin) / 16
    tMin += inset
    tMax -= inset
    const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v
    const pack = (r: number, g: number, b: number) => (Math.round(clamp(r) * 31 / 255) << 11) | (Math.round(clamp(g) * 63 / 255) << 5) | Math.round(clamp(b) * 31 / 255)
    let c0 = pack(mr + vr * tMax, mg + vg * tMax, mb + vb * tMax)
    let c1 = pack(mr + vr * tMin, mg + vg * tMin, mb + vb * tMin)
    if (c0 < c1) { const t = c0; c0 = c1; c1 = t }
    out[o + 8] = c0 & 255; out[o + 9] = c0 >> 8
    out[o + 10] = c1 & 255; out[o + 11] = c1 >> 8
    // the four colours the block can show
    const expand = (c: number) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31]
    const p0 = expand(c0), p1 = expand(c1)
    const palette = [p0, p1, [(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3], [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3]]
    let indices = 0
    if (c0 !== c1) {
        for (let i = 0; i < 16; i++) {
            const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2]
            let best = 0, bestDistance = Infinity
            for (let k = 0; k < 4; k++) {
                const dr = r - palette[k][0], dg = g - palette[k][1], db = b - palette[k][2]
                const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
                if (distance < bestDistance) { bestDistance = distance; best = k }
            }
            indices |= best << (2 * i)
        }
    }
    out[o + 12] = indices & 255; out[o + 13] = (indices >>> 8) & 255; out[o + 14] = (indices >>> 16) & 255; out[o + 15] = (indices >>> 24) & 255
}

function encode(source: Uint8Array, width: number, height: number) {
    const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4)
    const out = new Uint8Array(bw * bh * 16)
    for (let by = 0; by < bh; by++)
        for (let bx = 0; bx < bw; bx++)
            encodeBlock(source, width, height, bx, by, out, (by * bw + bx) * 16)
    return out
}

function halve(source: Uint8Array, width: number, height: number) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1)
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            for (let c = 0; c < 4; c++) {
                const x0 = Math.min(x * 2, width - 1), x1 = Math.min(x * 2 + 1, width - 1)
                const y0 = Math.min(y * 2, height - 1), y1 = Math.min(y * 2 + 1, height - 1)
                out[(y * w + x) * 4 + c] = (source[(y0 * width + x0) * 4 + c] + source[(y0 * width + x1) * 4 + c] + source[(y1 * width + x0) * 4 + c] + source[(y1 * width + x1) * 4 + c] + 2) >> 2
            }
    return out
}

self.onmessage = (event: MessageEvent<Job>) => {
    const { id, size, kind } = event.data
    let data = event.data.data
    if (kind === 'normal') {
        // x to alpha, y stays in green, roughness to red and blue
        for (let i = 0; i < data.length; i += 4) {
            const x = data[i], roughness = data[i + 2]
            data[i] = roughness
            data[i + 2] = roughness
            data[i + 3] = x
        }
    }
    const levels: { width: number, height: number, data: Uint8Array }[] = []
    let width = size, height = size
    for (;;) {
        levels.push({ width, height, data: encode(data, width, height) })
        if (width === 1 && height === 1)
            break
        data = halve(data, width, height)
        width = Math.max(1, width >> 1)
        height = Math.max(1, height >> 1)
    }
    ;(self as unknown as Worker).postMessage({ id, levels }, levels.map((level) => level.data.buffer))
}
