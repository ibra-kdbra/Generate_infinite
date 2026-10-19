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
page.on('console', (message) => {
    const text = message.text()
    const shot = text.match(/^SHOT (\S+) data:image\/jpeg;base64,(.+)$/)
    if (shot)
        fs.writeFileSync(path.join(out, `${shot[1]}.jpg`), Buffer.from(shot[2], 'base64'))
    else if (text.startsWith('PROBE')) {
        console.log(text.slice(6, 1200))
        if (text.includes('DONE')) done()
    }
})
page.on('pageerror', (error) => console.log('PAGE ERROR', error.message))
await page.goto(`http://127.0.0.1:5173/tools/probe/probe-tmp.html?q=high&${extra}`)
await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000))])
await browser.close()
