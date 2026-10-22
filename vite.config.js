import glsl from 'vite-plugin-glsl'
import { defineConfig } from 'vite'
import { execSync } from 'child_process'

// which commit this build is (Vercel names it; locally, git): the game says so in the console
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD').toString() } catch { return 'unknown' } })()).trim().slice(0, 7)

export default defineConfig({
    define: { __BUILD__: JSON.stringify(commit) },
    plugins:
        [
            glsl({ watch: true })
        ],
    // the dev server listens on this machine only: anyone on the same network could otherwise
    // reach it (and read files through it). For a phone on the same Wi-Fi: npm run dev -- --host
    build:
    {
        rollupOptions:
        {
            output:
            {
                // the libraries in their own files: they change rarely, so a returning visitor's
                // browser keeps them cached when only the game changes
                manualChunks(id)
                {
                    if (!id.includes('node_modules'))
                        return
                    if (id.includes('/three/'))
                        return 'three'
                    if (id.includes('/postprocessing/') || id.includes('/n8ao/'))
                        return 'postprocessing'
                    return 'vendor'
                }
            }
        },
        // three.js is one module of about 630 kB minified (160 kB compressed), which no split
        // can make smaller; warn only above that
        chunkSizeWarningLimit: 800
    }
})
