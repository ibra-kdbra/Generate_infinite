import glsl from 'vite-plugin-glsl'
import { defineConfig } from 'vite'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import changelog from './tools/changelog/plugin.js'

// the game's version (About, the Changelog page)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// which commit this build is (Vercel names it; locally, git): the game says so in the console
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD').toString() } catch { return 'unknown' } })()).trim().slice(0, 7)

export default defineConfig(({ command }) => ({
    define: { __BUILD__: JSON.stringify(commit), __VERSION__: JSON.stringify(version) },
    plugins:
        [
            // shaders minified in the build (comments and spaces out: a smaller download)
            glsl({ watch: true, minify: command === 'build' }),
            // the Changelog page's text: CHANGELOG.md and the commits since (tools/changelog)
            changelog()
        ],
    // the dev server listens on this machine only: anyone on the same network could otherwise
    // reach it (and read files through it). For a phone on the same Wi-Fi: npm run dev -- --host
    build:
    {
        rolldownOptions:
        {
            output:
            {
                // the libraries in their own files: they change rarely, so a returning visitor's
                // browser keeps them cached when only the game changes
                codeSplitting:
                {
                    groups:
                    [
                        { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 3 },
                        { name: 'postprocessing', test: /node_modules[\\/](postprocessing|n8ao)[\\/]/, priority: 2 },
                        { name: 'vendor', test: /node_modules[\\/]/, priority: 1 }
                    ]
                }
            }
        },
        // three.js is one module of about 690 kB minified (175 kB compressed), which no split
        // can make smaller; warn only above that
        chunkSizeWarningLimit: 800
    }
}))
