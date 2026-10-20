// Runs a probe in headless Chromium (Playwright) against the dev server, for machines without
// Firefox (a cloud container): the same probes as run.sh, screenshots saved the same way.
//
//   node tools/probe/run-chromium.mjs <seconds> ['probe=/tools/probe/probe-moves.js&slot=0'] [outdir] [width,height]
//
// Playwright comes from the project, or a global install (PLAYWRIGHT=/path/to/playwright).
// WebGL runs in SwiftShader (software) when there is no GPU: slow, fine for pictures; probes that
// film draw only the frames they keep.
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const [seconds = '200', extra = '', out = path.join(path.dirname(new URL(import.meta.url).pathname), 'out'), size = '1366,682'] = process.argv.slice(2)
const where = process.env.PLAYWRIGHT ?? path.join(execSync('npm root -g').toString().trim(), 'playwright')
const { chromium } = await import(fs.existsSync('node_modules/playwright') ? 'playwright' : path.join(where, 'index.mjs'))
fs.mkdirSync(out, { recursive: true })
const [width, height] = size.split(',').map(Number)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width, height } })
let done
const finished = new Promise((resolve) => { done = resolve })
// a probe can profile part of its run: log('PROFILE start') ... log('PROFILE stop <name>'); the
// functions that took the most time (their own, and with what they call) are printed
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
const report = ({ profile }, name) => {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]))
    const self = new Map(), total = new Map()
    const counts = new Map()
    for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1)
    const parent = new Map()
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
    const label = (node) => `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').pop().split('?')[0]}:${node.callFrame.lineNumber + 1}`
    for (const [id, count] of counts) {
        const node = byId.get(id)
        self.set(label(node), (self.get(label(node)) ?? 0) + count)
        const seen = new Set()
        for (let at = id; at !== undefined; at = parent.get(at)) {
            const l = label(byId.get(at))
            if (!seen.has(l)) { total.set(l, (total.get(l) ?? 0) + count); seen.add(l) }
        }
    }
    const all = profile.samples.length
    const top = (map, n) => [...map].filter(([l]) => !/^\((program|idle|root)\)/.test(l)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([l, c]) => `  ${(100 * c / all).toFixed(1).padStart(5)}%  ${l}`).join('\n')
    console.log(`PROFILE ${name}: ${all} samples\n self:\n${top(self, 25)}\n total:\n${top(total, 25)}`)
}
page.on('console', async (message) => {
    const text = message.text()
    if (text === 'PROBE PROFILE start') { await cdp.send('Profiler.start'); return }
    if (text.startsWith('PROBE PROFILE stop')) { report(await cdp.send('Profiler.stop'), text.slice(19)); return }
    const shot = text.match(/^SHOT (\S+) data:image\/jpeg;base64,(.+)$/)
    if (shot)
        fs.writeFileSync(path.join(out, `${shot[1]}.jpg`), Buffer.from(shot[2], 'base64'))
    else if (text.startsWith('PROBE')) {
        console.log(text.slice(6, 1200))
        if (text.includes('DONE')) done()
    }
})
page.on('pageerror', (error) => console.log('PAGE ERROR', error.message))
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5173}/tools/probe/probe-tmp.html?q=${process.env.Q ?? 'high'}&${extra}`)
await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000))])
await browser.close()
