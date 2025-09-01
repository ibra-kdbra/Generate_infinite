# Infinite World in TypeScript

### An immersive, infinite, procedurally generated world built with Three.js and WebGL, fully refactored in TypeScript.

This project is a TypeScript-based evolution of the original [Infinite World](https://github.com/brunosimon/infinite-world) concept by the creative developer Bruno Simon. It serves as a technical demonstration of procedural generation and a case study in migrating a JavaScript codebase to TypeScript for enhanced scalability and maintainability.

![Infinite World Screenshot](/public/social/share-1200x630.png)

## Key Features

* **Infinite Procedural Terrain:** Explores a unique, dynamically generated world every time.
* **Built with Three.js:** Leverages the power of **Three.js** for efficient **WebGL** rendering.
* **Fully Typed Codebase:** Migrated from JavaScript to **TypeScript** for robust, maintainable, and error-free code.
* **Enhanced Rendering:** Features improved lighting, shading, and terrain generation algorithms for a more natural look.
* **Collision Detection:** Implemented a camera collision system to prevent clipping through the terrain, improving the user experience.

---

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed on your machine (which includes `npm`).

### Installation & Local Development

1.  **Install NPM packages:**
    ```sh
    npm install
    ```

2.  **Run the development server:**
    ```sh
    npm run dev
    ```
    The application will be available at `http://localhost:5173/`.

---

## The Journey to TypeScript

This project was originally written in JavaScript and has been meticulously converted to TypeScript. This refactoring effort significantly improved the project's architecture, code quality, and developer experience.
Refer to this [project-tree](./project_tree.md)

### 1. Project Setup & Typing
The initial phase involved integrating TypeScript into the existing build process.

* **Dependencies:** Added `typescript`, `@types/three`, and other necessary type declarations as development dependencies.
* **Configuration:** A `tsconfig.json` file was created to define strict compiler rules and project structure.
* **Type Implementation:** All `.js` files were migrated to `.ts`. The TypeScript compiler was then used to identify and fix type errors iteratively. This included typing all variables, function signatures, and class properties, and creating interfaces for complex data structures.

### 2. Build Process & Dependencies
The build system was updated to support the new TypeScript codebase.

* **Vite Configuration:** The `vite.config.js` was updated to handle TypeScript compilation seamlessly.
* **Dependency Audit:** All dependencies were updated to their latest versions to ensure full compatibility with the TypeScript ecosystem.
* **Scripts:** A `type-check` script was added to the `package.json` to allow for static type checking without a full build.

### 3. Code Refinements & Bug Fixes
Beyond simple type conversion, the migration provided an opportunity to improve the codebase.

* **Circular Dependencies:** A circular dependency between the `State` and `View` classes was identified and resolved by reordering their initialization sequence.
* **Algorithm Enhancements:** The terrain generation parameters were fine-tuned to create a smoother, more aesthetically pleasing landscape.
* **Shader Improvements:** The terrain shaders were modified to enhance the lighting and shading models, adding more depth and realism to the scene.

---

## Acknowledgements

* A huge thank you to **Bruno Simon** for creating the original project and for his invaluable contributions to the web development community.