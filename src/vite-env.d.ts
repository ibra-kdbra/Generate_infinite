/// <reference types="vite/client" />

declare module '*.glsl' {
    const value: string
    export default value
}

/** The commit this build was made from (vite.config.js). */
declare const __BUILD__: string
/** The game's version (package.json). */
declare const __VERSION__: string

declare module 'virtual:changelog' {
    const changelog: {
        version: string
        releases: { version: string, date: string | null, summary: string, sections: { name: string, items: string[] }[] }[]
    }
    export default changelog
}
