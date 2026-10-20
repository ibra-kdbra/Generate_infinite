import glsl from 'vite-plugin-glsl'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins:
        [
            glsl({ watch: true })
        ],
    server:
    {
        host: true
    },
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
